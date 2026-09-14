import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeRuntimeContext, createRuntime } from "../../runtime/host.ts";
import { providerExtensionManifests } from "../../runtime/deployment.mjs";
import { runtimeCapabilities, runCheck } from "../../runtime/tasks.ts";
import { readerCommand, runReader } from "../../extensions/module/reader.ts";
import modsExtension from "../../extensions/mods/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const active = () => new AbortController().signal;
const json = (path, value) => writeFile(path, JSON.stringify(value) + "\n");
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "coc runtime reader "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function options(env = {}, extra = {}) {
  return { resourceRoot: ROOT, env: { ...process.env, UV_OFFLINE: "1", UV_NO_SYNC: "1", ...env }, ...extra };
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(accept => setTimeout(accept, 10));
  }
  throw new Error("Disposable subprocess did not reach its expected state");
}
async function command(file, args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(file, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("close", code => accept({ code, stdout, stderr }));
  });
}

async function exitedDescendant(home) {
  const executable = join(home, "exited-owner.mjs");
  await writeFile(executable, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit','ipc']});
child.once('message',()=>{
 writeFileSync(process.env.RUNTIME_TEST_PROCESSES,JSON.stringify({parent:process.pid,child:child.pid}));
 process.stdout.write(JSON.stringify({ok:true})+'\\n',()=>process.exit(0));
});\n`);
  return executable;
}

test("reader provider retries preserve recovery while terminal and malformed streams fail", async t => {
  const error = {type:"message_end", message:{role:"assistant", stopReason:"error", errorMessage:"Provider 500: Auth context expired"}};
  const success = {type:"message_end", message:{role:"assistant", stopReason:"toolUse", content:[]}};
  for (const sample of [
    {name:"recovered", events:[error, {type:"auto_retry_start",attempt:1}, success, {type:"auto_retry_end",success:true,attempt:1}], ok:true},
    {name:"terminal", events:[success, error, {type:"auto_retry_end",success:false,finalError:"Provider retry exhausted"}], ok:false, reason:/Provider retry exhausted/},
    {name:"malformed", events:[error, success], malformed:true, ok:false, reason:/unreadable reader event/},
  ]) {
    await t.test(sample.name, async t => {
      const home = await temporary(t), executable = join(home, "events.mjs"), eventLog = join(home, "events.jsonl");
      await writeFile(executable, (sample.malformed ? "console.log('not-json');\n" : "")
        + sample.events.map(event => `console.log(${JSON.stringify(JSON.stringify(event))});`).join("\n"));
      const context = composeRuntimeContext({owner:"preparation", home}, options({PI_COC_READER_CMD:JSON.stringify([process.execPath, executable])}));
      const outcome = await runReader({cwd:home, brief:"Run the event fixture", eventLog}, context);
      assert.equal(outcome.ok, sample.ok, JSON.stringify(outcome));
      if (sample.reason) assert.match(outcome.error, sample.reason);
      const logged = (await readFile(eventLog,"utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(logged.length, sample.events.length);
      assert.equal(logged[0].message.errorMessage ?? logged[1].message.errorMessage, error.message.errorMessage);
    });
  }
});

test("reader jobs preserve tool flags and captured deployment state across ambient changes", async t => {
  const home = await temporary(t), content = join(home, "selected content"), cwd = join(home, "attempt one");
  await mkdir(join(content, "setup"), { recursive: true });
  await mkdir(cwd);
  await writeFile(join(content, "setup", "visual-reader.md"), "Captured source instructions\n## Index phase\nIndex only\n## Read phase\nRead only\n## Verify phase\nReview only\n");
  const executable = join(home, "transport.mjs");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';
writeFileSync('capture.json',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),agent:process.env.PI_CODING_AGENT_DIR,campaign:process.env.PI_COC_CAMPAIGN,mode:process.env.PI_COC_MODE,marker:process.env.RUNTIME_TEST_MARKER,options:JSON.parse(process.env.PI_COC_RUNTIME_OPTIONS)}));
console.log(JSON.stringify({type:'transport_ready'}));\n`);
  const context = composeRuntimeContext({ owner: "preparation", home, campaign: "unused-campaign" }, options({
    PI_COC_READER_CMD: JSON.stringify([process.execPath, executable]), PI_COC_MODE: "play", RUNTIME_TEST_MARKER: "captured",
  }, { contentRoot: content, agentHome: join(home, "selected agent") }));
  const before = process.env.PI_COC_READER_CMD;
  process.env.PI_COC_READER_CMD = '["missing-ambient-command"]';
  t.after(() => { if (before === undefined) delete process.env.PI_COC_READER_CMD; else process.env.PI_COC_READER_CMD = before; });
  const brief = "--literal brief with 'quotes' and $(unexpanded)";
  const result = await runtimeCapabilities.runTask(context, { kind: "reader", request: {
    cwd, brief, model: "fixture/model", thinking: "low", prompt: { phase: "read" }, eventLog: join(cwd, "events.jsonl"),
  } }, active());
  assert.equal(result.ok, true, JSON.stringify(result));
  const captured = JSON.parse(await readFile(join(cwd, "capture.json"), "utf8"));
  assert.deepEqual(captured.args, [brief]);
  assert.equal(captured.cwd, await realpath(cwd));
  assert.equal(captured.agent, join(home, "selected agent"));
  assert.equal(captured.marker, "captured");
  assert.equal(captured.campaign, undefined);
  assert.equal(captured.mode, undefined);
  assert.equal(captured.options.contentRoot, content);
  const instruction = await readFile(join(cwd, "instructions-read.md"), "utf8");
  assert.match(instruction, /Captured source instructions/);
  assert.match(instruction, /Read only/);
  assert.doesNotMatch(instruction, /Index only|Review only/);
  assert.match(await readFile(join(cwd, "events.jsonl"), "utf8"), /transport_ready/);
  assert.match(await readFile(join(cwd, "host-bin", "node"), "utf8"), new RegExp(context.nodeExecutable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const checker = await readFile(join(cwd, "host-bin", "coc-read-check"), "utf8");
  assert.ok(checker.includes(context.entrypoints.check));
  assert.ok(context.entrypoints.check.endsWith('/build/runtime/check.mjs'));
  await assert.rejects(readFile(join(cwd, "host-bin", "python3")), {code: 'ENOENT'});
  const flags = readerCommand("fixture/model", "/task/prompt.md", "low", true, true, { ...context, env: {} });
  assert.equal(flags[0], context.nodeExecutable);
  assert.equal(flags[flags.indexOf("--tools") + 1], "read,write,edit,bash,pdf,submit_reading");
  assert.equal(flags[flags.indexOf(context.entrypoints.readerSubmit) - 1], "--extension");
  for (const flag of ["--no-session", "--no-context-files", "--no-extensions", "--no-skills"]) assert.ok(flags.includes(flag));
  const mounted = flags.flatMap((value, index) => value === "-e" ? [flags[index + 1]] : []);
  assert.deepEqual(mounted, context.entrypoints.providerExtensions);
  assert.equal(mounted.includes(context.entrypoints.imageGen), false);
  assert.equal(mounted.includes(context.entrypoints.agent), false);
  for (const path of context.entrypoints.extensions) assert.equal(mounted.includes(path), false);
  await assert.rejects(runReader({ cwd, brief }), /captured host runtime context/);
});

test("Mod model overrides come from the captured environment and do not redirect reader tasks", async t => {
  const home = await temporary(t), executable = join(home, "capture-argv.mjs"), launcher = join(home, "selected node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';
writeFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  // Both fixture models must be ones a lane child could resolve; the override under test is which
  // of them is chosen, not whether an unrunnable one is allowed to launch.
  await json(join(agent, "models-store.json"), { captured: { models: [{ id: "mod-model" }] }, selected: { models: [{ id: "current-model" }] } });
  const context = composeRuntimeContext({ owner: "preparation", home }, options({
    PI_COC_READER_CMD: undefined, PI_COC_MOD_MODEL: " captured/mod-model ",
  }, { agentHome: agent, nodeExecutable: launcher }));
  const previous = process.env.PI_COC_MOD_MODEL;
  process.env.PI_COC_MOD_MODEL = "late/ambient-model";
  t.after(() => { if (previous === undefined) delete process.env.PI_COC_MOD_MODEL; else process.env.PI_COC_MOD_MODEL = previous; });
  for (const [kind, expected] of [["mod", "captured/mod-model"], ["reader", "selected/current-model"]]) {
    const cwd = join(home, kind);
    await mkdir(cwd);
    const outcome = await runtimeCapabilities.runTask(context, { kind, request: { cwd, brief: "Capture launch flags only", model: "selected/current-model" } }, active());
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const args = JSON.parse(await readFile(join(cwd, "launch-argv.json"), "utf8"));
    assert.equal(args[args.indexOf("--model") + 1], expected);
  }
});

/**
 * Contract §37.9: choosing the lane's model without its reasoning effort only half-separates it from the
 * table. A lane pinned to a fast model still ran at the Keeper's own `high`, which is how a continuity
 * review spent its whole wall-clock budget inside a first thinking stream it never finished.
 */
test("Mod reasoning effort overrides the table's, and does not redirect reader tasks", async t => {
  const home = await temporary(t), executable = join(home, "capture-argv.mjs"), launcher = join(home, "selected node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';
writeFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  await json(join(agent, "models-store.json"), { selected: { models: [{ id: "current-model" }] } });
  const context = composeRuntimeContext({ owner: "preparation", home }, options({
    PI_COC_READER_CMD: undefined, PI_COC_MOD_THINKING: " low ",
  }, { agentHome: agent, nodeExecutable: launcher }));
  for (const [kind, expected] of [["mod", "low"], ["reader", "high"]]) {
    const cwd = join(home, kind);
    await mkdir(cwd);
    const outcome = await runtimeCapabilities.runTask(context,
      { kind, request: { cwd, brief: "Capture launch flags only", model: "selected/current-model", thinking: "high" } }, active());
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const args = JSON.parse(await readFile(join(cwd, "launch-argv.json"), "utf8"));
    assert.equal(args[args.indexOf("--thinking") + 1], expected);
    // The two overrides are independent: an effort choice never moves the lane to another model.
    assert.equal(args[args.indexOf("--model") + 1], "selected/current-model");
  }
});

test("lane children mount the provider extensions, and a lane model is never re-named", async t => {
  const home = await temporary(t), executable = join(home, "capture-model.mjs"), launcher = join(home, "selected node"), agent = join(home, "agent"), captured = join(home, "captured", "argv.json");
  await mkdir(join(home, "captured"));
  await writeFile(executable, `import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(captured)},JSON.stringify(process.argv.slice(2)));\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  await mkdir(agent, { recursive: true });
  // `grok-build` is registered by an extension and lands in neither registry file. The child mounts
  // that extension, so the model runs as written: re-pointing it at another provider carrying the
  // same id would move the lane to a different account and drop the extension's own rewriting.
  await json(join(agent, "models-store.json"), { xai: { models: [{ id: "grok-4.6" }] } });
  await json(join(agent, "models.json"), { providers: { mine: { baseUrl: "https://example.invalid/v1", api: "openai-completions", models: [{ id: "special" }] } } });
  await json(join(agent, "auth.json"), { xai: { type: "api_key", key: "written" }, mine: { type: "api_key", key: "written" } });
  const context = composeRuntimeContext({ owner: "preparation", home }, options({}, { agentHome: agent, nodeExecutable: launcher }));
  const launch = async model => {
    const outcome = await runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd: home, brief: "Capture the model flag", model } }, active());
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const args = JSON.parse(await readFile(captured, "utf8"));
    return args[args.indexOf("--model") + 1];
  };
  for (const model of ["grok-build/grok-4.6", "deepseek-extended/deepseek-flash", "xai/grok-4.6", "mine/special"]) {
    assert.equal(await launch(model), model);
  }
  // The child mounts every provider extension by the same list the session launcher reads.
  const mounted = JSON.parse(await readFile(captured, "utf8"));
  for (const path of context.entrypoints.providerExtensions) {
    assert.ok(mounted.includes(path), `the lane child did not mount ${path}`);
    assert.equal(mounted[mounted.indexOf(path) - 1], "-e");
  }
  assert.ok(context.entrypoints.providerExtensions.length >= 2);
  assert.ok(mounted.includes("--no-extensions"));
  // A provider no child can resolve is refused by name here, not left to die in the child with no
  // events and a lane message that never says which part was unavailable.
  for (const [model, fragment] of [["elsewhere/special", /no provider "elsewhere"/], ["xai/unlisted", /lists no model "unlisted"/]]) {
    await assert.rejects(
      runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd: home, brief: "Refused", model } }, active()),
      error => {
        assert.equal(error.details?.reason, "lane_model_unavailable");
        assert.equal(error.details?.model, model);
        assert.match(error.message, fragment);
        assert.match(error.message, new RegExp(model.replace("/", "\\/")));
        return true;
      });
  }
  // Neither registry file reads: the lane must not judge, and the string passes through.
  const bare = join(home, "bare agent");
  await mkdir(bare, { recursive: true });
  const bareContext = composeRuntimeContext({ owner: "preparation", home }, options({}, { agentHome: bare, nodeExecutable: launcher }));
  const bareOutcome = await runtimeCapabilities.runTask(bareContext, { kind: "reader", request: { cwd: home, brief: "Capture the model flag", model: "unknowable/model" } }, active());
  assert.equal(bareOutcome.ok, true, JSON.stringify(bareOutcome));
  const bareArgs = JSON.parse(await readFile(captured, "utf8"));
  assert.equal(bareArgs[bareArgs.indexOf("--model") + 1], "unknowable/model");
});

test("every provider extension in the tree is discovered, and registers the id its manifest declares", async t => {
  // Nothing lists these: the manifest states `auth.provider.id`, discovery reads it, and both mounts
  // plus the lane refusal follow from that one fact. This holds the code to the manifest, so an id
  // renamed inside an extension cannot leave it mounted under one name and judged under another.
  const found = providerExtensionManifests(ROOT);
  assert.ok(found.length >= 2, `discovery found ${found.length} provider extensions`);
  assert.deepEqual(found.map(entry => entry.name).sort(), ["deepseek", "grok-build-oauth"]);
  for (const { name, providers, entry } of found) {
    const manifest = JSON.parse(await readFile(join(ROOT, "extensions", name, "pipiui-extension.json"), "utf8"));
    assert.deepEqual([...providers], [manifest.auth.provider.id]);
    assert.equal(entry, join(ROOT, "build/extensions", name, manifest.agent.extension.replace(/\.js$/, ".mjs")));
    const registered = [];
    const pi = new Proxy({
      registerProvider: (id) => { registered.push(id); },
      registerTool: () => {}, registerCommand: () => {}, on: () => {}, emit: () => {},
      getThinkingLevel: () => "low", settings: { get: () => undefined, set: () => {} },
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    (await import(join(ROOT, "extensions", name, manifest.agent.extension))).default(pi);
    assert.deepEqual(registered, [...providers], `${name} registers ${JSON.stringify(registered)}`);
  }
  // An extension with no provider (image-gen registers tools) must not be mounted into lanes.
  assert.equal(found.some(entry => entry.name === "image-gen"), false);
});

test("source and Mod checks invoke shared read-only validators and preserve rejected drafts", async t => {
  const home = await temporary(t), packet = join(home, "task packet.json"), draft = join(home, "source draft.json");
  await json(packet, { purpose: "guidance", module_id: "book-one", source: { page_count: 2 }, known_nodes: [] });
  const sourceDraft = { nodes: [{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: [{ page: 1 }], properties: { is_entrance: true } }],
    claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: [] };
  await json(draft, sourceDraft);
  const context = composeRuntimeContext({ owner: "check", home }, options({}, {backend: 'typescript'}));
  const before = await readFile(draft), files = await readdir(home);
  const valid = await runCheck(context, { kind: "source-draft", packet, draft }, active());
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.deepEqual(valid.required_view_pages, [1]);
  assert.deepEqual(await readFile(draft), before);
  assert.deepEqual(await readdir(home), files);
  const native = composeRuntimeContext({owner: "check", home}, options({PATH: ""}, {backend: "typescript"}));
  assert.deepEqual(await runCheck(native, {kind: "source-draft", packet, draft}, active()), valid);
  assert.deepEqual(await readFile(draft), before);
  assert.deepEqual(await readdir(home), files);
  await json(draft, { ...sourceDraft, nodes: [{ ...sourceDraft.nodes[0], source_refs: [{ page: 3 }] }] });
  const rejectedBytes = await readFile(draft);
  const rejected = await runCheck(context, {kind: "source-draft", packet, draft}, active());
  assert.equal(rejected.ok, false);
  assert.deepEqual(await runCheck(native, {kind: "source-draft", packet, draft}, active()), rejected);
  assert.deepEqual(await readFile(draft), rejectedBytes);
  const mod = join(home, "Mod definition.json");
  await json(mod, { name: "Notebook", category: "item", description: "A ruled paper notebook.", basis: "A bounded equipment definition.", parameters: { effects: [] }, player_view: { description: "A notebook.", fields: [] } });
  assert.deepEqual(await runCheck(context, { kind: "mod-definition", draft: mod }, active()), { ok: true, name: "Notebook" });
  await json(mod, { name: "Notebook" });
  assert.equal((await runCheck(context, { kind: "mod-definition", draft: mod }, active())).ok, false);
  assert.equal((await readdir(home)).includes(".coc"), false);
  assert.equal((await readdir(home)).includes("campaigns"), false);
});

test("the TypeScript checker CLI preserves source page integers without Python", async t => {
  const home = await temporary(t), packet = join(home, "packet.json"), draft = join(home, "draft.json");
  await writeFile(packet, '{"purpose":"guidance","module_id":"book-one","source":{"page_count":9007199254740993},"known_nodes":[]}');
  await writeFile(draft, '{"nodes":[{"node_id":"scene-dock","node_kind":"scene","name":"Dock","source_refs":[{"page":9007199254740993}],"properties":{"is_entrance":true}}],"claims":[],"node_refs":[],"coverage":{},"dependencies":[],"critical":[],"ready_nodes":[]}');
  const before = await readFile(draft);
  const result = await command(process.execPath, [join(ROOT, "build/runtime/check.mjs"), "--packet", packet, "--draft", draft], {
    ...process.env, PATH: "", PI_COC_HOME: home,
    PI_COC_RUNTIME_OPTIONS: JSON.stringify({backend: "typescript", resourceRoot: ROOT}),
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"required_view_pages": \[9007199254740993\]/);
  assert.deepEqual(await readFile(draft), before);
  assert.equal((await readdir(home)).includes(".coc"), false);
});

test("the stable checker CLI retains source flags and selected TypeScript checks never fall back", async t => {
  const home = await temporary(t), mod = join(home, "definition with spaces.json");
  await json(mod, { name: "Notebook", category: "item", description: "A notebook.", basis: "Ordinary equipment.", parameters: { effects: [] }, player_view: { description: "A notebook.", fields: [] } });
  const env = options().env;
  const valid = await command(join(ROOT, "bin", "coc-read-check"), ["--kind", "mod-definition", "--draft", mod], env);
  assert.equal(valid.code, 0, valid.stdout + valid.stderr);
  assert.equal(JSON.parse(valid.stdout).name, "Notebook");
  const context = composeRuntimeContext({ owner: "check", home }, options({ PATH: "" }, { backend: "typescript" }));
  assert.deepEqual(await runCheck(context, {kind: "mod-definition", draft: mod}, active()), {ok: true, name: "Notebook"});
  const native = await command(process.execPath, [join(ROOT, "build/runtime/check.mjs"), "--kind", "mod-definition", "--draft", mod], {
    ...env, PATH: "", PI_COC_RUNTIME: "typescript", PI_COC_RUNTIME_OPTIONS: undefined,
  });
  assert.equal(native.code, 0, native.stdout + native.stderr);
  assert.deepEqual(JSON.parse(native.stdout), {ok: true, name: "Notebook"});
  await json(mod, {name: "Notebook"});
  const rejected = await runCheck(composeRuntimeContext({owner: "check", home}, options()), {kind: "mod-definition", draft: mod}, active());
  assert.equal(rejected.ok, false);
  assert.deepEqual(await runCheck(context, {kind: "mod-definition", draft: mod}, active()), rejected);
});

test("closing one owner kills its reader group and preserves artifacts without stopping another owner", async t => {
  const home = await temporary(t), executable = join(home, "process-group.mjs");
  await writeFile(executable, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const grandchild=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync('processes.json',JSON.stringify({parent:process.pid,child:grandchild.pid}));
setInterval(()=>{},1000);\n`);
  const launch = options({ PI_COC_READER_CMD: JSON.stringify([process.execPath, executable]) }, { capabilities: runtimeCapabilities });
  const firstDir = join(home, "first"), secondDir = join(home, "second");
  await mkdir(firstDir); await mkdir(secondDir);
  const first = createRuntime({ owner: "preparation", home: firstDir }, launch);
  const second = createRuntime({ owner: "preparation", home: secondDir }, launch);
  t.after(async () => { await Promise.all([first.close(), second.close()]); });
  const one = first.runTask({ kind: "reader", request: { cwd: firstDir, brief: "transport one", timeoutMs: 10_000 } }).catch(error => error);
  const two = second.runTask({ kind: "reader", request: { cwd: secondDir, brief: "transport two", timeoutMs: 10_000 } }).catch(error => error);
  const observed = async dir => { try { return JSON.parse(await readFile(join(dir, "processes.json"), "utf8")); } catch { return undefined; } };
  const [a, b] = await Promise.all([until(() => observed(firstDir)), until(() => observed(secondDir))]);
  await first.close();
  assert.equal((await one).details?.reason, "runtime_closed");
  await until(() => { try { process.kill(a.child, 0); return false; } catch { return true; } });
  assert.throws(() => process.kill(a.parent, 0));
  assert.doesNotThrow(() => process.kill(b.parent, 0));
  assert.deepEqual(await observed(firstDir), a);
  await assert.rejects(first.runTask({ kind: "reader", request: { cwd: firstDir, brief: "closed" } }), /closed/);
  await second.close(); await two;
  await until(() => { try { process.kill(b.child, 0); return false; } catch { return true; } });
});

test("an exited reader releases descendants holding inherited output without waiting for its task timeout", async t => {
  const home = await temporary(t), executable = await exitedDescendant(home), processes = join(home, "processes.json");
  const context = composeRuntimeContext({ owner: "preparation", home }, options({
    PI_COC_READER_CMD: JSON.stringify([process.execPath, executable]), RUNTIME_TEST_PROCESSES: processes,
  }));
  const controller = new AbortController();
  let finished = false, outcome, failure;
  const pending = runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd: home, brief: "Transport only" } }, controller.signal)
    .then(result => { outcome = result; finished = true; }, error => { failure = error; finished = true; });
  t.after(async () => { controller.abort(); await pending; });
  await until(() => finished);
  assert.equal(failure, undefined);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.timedOut, false);
  const pids = JSON.parse(await readFile(processes, "utf8"));
  assert.throws(() => process.kill(pids.parent, 0));
  await until(() => { try { process.kill(pids.child, 0); return false; } catch { return true; } });
});

test("cancelling a check stops its disposable process group without rewriting input", async t => {
  const home = await temporary(t), transport = join(home, "checking-transport.mjs"), launcher = join(home, "selected-node");
  await writeFile(transport, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{stdio:'ignore'});
writeFileSync(process.env.RUNTIME_TEST_PROCESSES,JSON.stringify({parent:process.pid,child:child.pid}));
setInterval(()=>{},1000);\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(transport)} "$@"\n`);
  await chmod(launcher, 0o755);
  const processes = join(home, "processes.json"), draft = join(home, "retained.json");
  await json(draft, { retained: true });
  const context = composeRuntimeContext({ owner: "check", home }, options({ PATH: home, RUNTIME_TEST_PROCESSES: processes }, {nodeExecutable: launcher}));
  const controller = new AbortController();
  const result = runCheck(context, { kind: "mod-definition", draft }, controller.signal).catch(error => error);
  t.after(async () => { controller.abort(); await result; });
  const pids = await until(async () => { try { return JSON.parse(await readFile(processes, "utf8")); } catch { return undefined; } });
  controller.abort();
  assert.match((await result).message, /cancelled/i);
  await until(() => { try { process.kill(pids.child, 0); return false; } catch { return true; } });
  assert.throws(() => process.kill(pids.parent, 0));
  assert.deepEqual(JSON.parse(await readFile(draft, "utf8")), { retained: true });
});

test("an exited checker releases inherited output descendants and preserves its completed result", async t => {
  const home = await temporary(t), transport = await exitedDescendant(home), launcher = join(home, "selected-node");
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(transport)} "$@"\n`);
  await chmod(launcher, 0o755);
  const processes = join(home, "processes.json"), draft = join(home, "retained.json");
  await json(draft, { retained: true });
  const context = composeRuntimeContext({ owner: "check", home }, options({ PATH: home, RUNTIME_TEST_PROCESSES: processes }, {nodeExecutable: launcher}));
  const controller = new AbortController();
  let finished = false, outcome, failure;
  const pending = runCheck(context, { kind: "mod-definition", draft }, controller.signal)
    .then(result => { outcome = result; finished = true; }, error => { failure = error; finished = true; });
  t.after(async () => { controller.abort(); await pending; });
  await until(() => finished);
  assert.equal(failure, undefined);
  assert.deepEqual(outcome, { ok: true });
  const pids = JSON.parse(await readFile(processes, "utf8"));
  assert.throws(() => process.kill(pids.parent, 0));
  await until(() => { try { process.kill(pids.child, 0); return false; } catch { return true; } });
  assert.deepEqual(JSON.parse(await readFile(draft, "utf8")), { retained: true });
});

test("native PDF capabilities remain available independently of the selected check backend", async t => {
  const home = await temporary(t), pdf = join(home, "source with spaces.pdf"), cache = join(home, "pages");
  const stream = "1 0 0 rg 0 0 200 100 re f";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let bytes = "%PDF-1.7\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(bytes)); bytes += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(bytes);
  bytes += `xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await writeFile(pdf, bytes);
  const context = composeRuntimeContext({ owner: "preparation", home }, options({ PATH: "" }, { backend: "typescript" }));
  const info = await runtimeCapabilities.sourceInfo(context, { pdf, cache }, active());
  assert.equal(info.page_count, 1);
  const page = await runtimeCapabilities.sourcePage(context, { pdf, cache, page: 1, pixels: 256 }, active());
  assert.equal(page.width, 256);
  assert.equal(page.height, 128);
  assert.equal(page.file_sha256, info.file_sha256);
  assert.ok((await readFile(page.path)).byteLength > 0);
  assert.equal((await runtimeCapabilities.sourcePage(context, { pdf, cache, page: 1, pixels: 256 }, active())).reused, true);
  await assert.rejects(runtimeCapabilities.sourceInfo(context, { pdf, cache }, AbortSignal.abort()), /cancelled/);
});

test("Mod tasks use the existing owner check and retry the retained draft before acceptance", async t => {
  const home = await temporary(t), pi = { events: new EventEmitter(), on() {} };
  let bridge;
  pi.events.on("coc:mods-bridge", value => { bridge = value; });
  modsExtension(pi);
  const operations = [], briefs = [];
  let checks = 0;
  pi.events.emit("coc:kernel-bridge", { runtime: {
    async runTask(task) { operations.push(task.kind); briefs.push(task.request.brief); return { ok: true }; },
    async check(request) { operations.push(request.kind); return ++checks === 1 ? { ok: false, error: "repair required" } : { ok: true }; },
  }, async call(method) {
    operations.push(method);
    // The host asks what deferred registration is ready before it writes anything.
    if (method === "mods.queued") return { effects: [], unfinished: [] };
    if (method === "mods.job") return { enabled: true, cwd: home, system_prompt: join(home, "instructions.md"), job: "owned-job" };
    return { definition: { name: "Notebook" } };
  } });
  const payload = { campaign: "owned-campaign", effects: [{ kind: "define", name: "Notebook", category: "item" }] };
  await bridge.prepare("apply", payload);
  assert.deepEqual(operations, ["mods.queued", "mods.job", "mod", "mod-definition", "mod", "mod-definition", "mods.accept"]);
  // The host runs that gate itself -- it is the "mod-definition" in operations above -- so the brief no
  // longer sends the child to a shell for it, and the child is no longer handed one.
  assert.doesNotMatch(briefs[0], /coc-read-check|bash/);
  assert.doesNotMatch(briefs[0], /PYTHONPATH|\buv\b|\bpython\b/);
  assert.match(briefs[1], /repair required/);
  assert.equal(payload.effects[0]._definition.name, "Notebook");
  assert.deepEqual((await readdir(home)).sort(), ["run-1.json", "run-2.json"]);
  pi.events.emit("coc:kernel-bridge", { call: undefined, runtime: undefined });
  await assert.rejects(bridge.prepare("apply", payload), /unavailable/);
});

test("the definition checker prints which key to move, because that output is the child's whole finding", async t => {
  const home = await temporary(t), mod = join(home, "nested trait.json");
  const measured = [{name: "length", value: 91, unit: "cm", basis: "Fixture measurement."}];
  const base = {name: "Notebook", category: "item", description: "A notebook.", basis: "Ordinary equipment.",
    player_view: {description: "A notebook.", fields: []}};
  // Sixteen drafts on record nested traits inside parameters; eleven answered the refusal by deleting them.
  await json(mod, {...base, parameters: {effects: [], traits: measured}});
  const rejected = await command(join(ROOT, "bin", "coc-read-check"), ["--kind", "mod-definition", "--draft", mod], options().env);
  const report = JSON.parse(rejected.stdout);
  assert.equal(report.ok, false, rejected.stdout + rejected.stderr);
  assert.match(report.error, /traits/);
  assert.match(report.fix ?? "", /move it beside parameters/);
  // A fix that never leaves the kernel cannot repair anything: this stdout is all the child gets.
  await json(mod, {...base, parameters: {effects: []}, traits: measured});
  const accepted = await command(join(ROOT, "bin", "coc-read-check"), ["--kind", "mod-definition", "--draft", mod], options().env);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).name, "Notebook");
});
