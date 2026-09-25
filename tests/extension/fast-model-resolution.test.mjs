/**
 * Every lane that has to be quick resolves its model through the one fast-model setting (contract
 * §37.10.1, 2026-09-23): the lane's own environment variable first -- the operator's override --
 * then the setting, then the table's own model ("Follow the table").
 *
 * Each case drives the seam the lane itself calls: `runLane` for the zero-tool lanes, the runtime's
 * `mod` task for the tool-enabled children (and the voice / NPC writers that hand it an operator's
 * pinned choice), the adaptation service with its real model resolver, and `fastLaneChoice` for the
 * map-words row. The Electron host's projections have no node seam, so they are checked at the source.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fastLaneChoice, resolveLaneModel, runLane } from "../../extensions/lanes/subsession.ts";
import { adaptationModel, adaptationService } from "../../extensions/kernel/adaptation.ts";
import { writeVoice } from "../../extensions/npc-voice/writer.ts";
import { authorNpc } from "../../extensions/npc/writer.ts";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { runtimeCapabilities } from "../../runtime/tasks.ts";
import { LANE_THINKING_DEFAULT } from "../../runtime/fast-model.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TABLE = "table/keeper", FAST = "fast/small", OPERATOR = "operator/pinned";

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "fast-model-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** An agent home holding the fast-model setting, or none at all ("Follow the table"). */
async function agentHome(t, model, level) {
  const agent = join(await temporary(t), "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "models-store.json"), JSON.stringify({
    table: { models: [{ id: "keeper" }] }, fast: { models: [{ id: "small" }] }, operator: { models: [{ id: "pinned" }, { id: "mod" }] },
  }));
  if (model) await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({ extensions: { "coc-keeper": { settings: {
    "ext.coc-keeper.laneModel": { model }, ...(level ? { "ext.coc-keeper.laneThinking": { level } } : {}) } } } }));
  return agent;
}

/** Set (or, with undefined, remove) process variables for one case and put them back after. */
function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

/** A session context the lanes read: its own model is the table's, and the registry knows every fixture model. */
function sessionCtx(cwd) {
  const asked = [];
  return { asked, ctx: {
    cwd, model: { provider: "table", id: "keeper" },
    modelRegistry: {
      find: (provider, id) => ({ provider, id }),
      complete: async (model) => { asked.push(`${model.provider}/${model.id}`); return { stopReason: "stop", content: [{ type: "text", text: '{"ok":true}' }] }; },
    },
  } };
}

/** The three cases every re-pointed lane must answer the same way. */
const CASES = [
  { name: "variable unset, setting present", setting: FAST, env: undefined, expected: FAST },
  { name: "variable set", setting: FAST, env: OPERATOR, expected: OPERATOR },
  { name: "neither", setting: undefined, env: undefined, expected: TABLE },
];

const ZERO_TOOL_LANES = [
  ["admission", "PI_COC_ADMISSION_MODEL"], ["verifier", "PI_COC_VERIFIER_MODEL"], ["memory", "PI_COC_MEMORY_MODEL"],
  ["journal", "PI_COC_NPCJOURNAL_MODEL"], ["voice", "PI_COC_VOICE_MODEL"],
];

test("every zero-tool lane asks the fast model, the operator's variable wins, and the table is the last resort", async t => {
  for (const [lane, envName] of ZERO_TOOL_LANES) for (const sample of CASES) await t.test(`${lane}: ${sample.name}`, async t => {
    const agent = await agentHome(t, sample.setting);
    withEnv(t, { PI_CODING_AGENT_DIR: agent, [envName]: sample.env });
    const { ctx, asked } = sessionCtx(agent);
    const result = await runLane({ ctx, envName, lane, systemPrompt: "return json", input: "x",
      shape: parsed => (parsed && parsed.ok === true ? parsed : undefined) });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.model, sample.expected, "the lane's own row names the model it ran on");
    assert.deepEqual(asked, [sample.expected], "and that is the model the completion was sent to");
  });
});

/** A lane child whose launcher records its argv instead of starting pi. */
async function childContext(t, agent, env = {}) {
  const home = await temporary(t), executable = join(home, "capture-argv.mjs"), launcher = join(home, "node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';\nwriteFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const context = composeRuntimeContext({ owner: "preparation", home }, {
    resourceRoot: ROOT, agentHome: agent, nodeExecutable: launcher,
    env: { ...process.env, UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined,
      PI_COC_MOD_MODEL: undefined, PI_COC_MOD_THINKING: undefined, ...env },
  });
  const runtime = { home, signal: new AbortController().signal, runTask: (task, signal) => runtimeCapabilities.runTask(context, task, signal ?? new AbortController().signal) };
  return { home, context, runtime };
}
const flag = (argv, name) => argv[argv.indexOf(name) + 1];
async function launched(dir) {
  const argv = JSON.parse(await readFile(join(dir, "launch-argv.json"), "utf8"));
  return { model: flag(argv, "--model"), thinking: flag(argv, "--thinking") };
}

test("a Mod child runs on the fast model; PI_COC_MOD_MODEL wins; the table is the last resort", async t => {
  for (const sample of CASES) await t.test(sample.name, async t => {
    const agent = await agentHome(t, sample.setting);
    const { home, context } = await childContext(t, agent, { PI_COC_MOD_MODEL: sample.env });
    const cwd = join(home, "mod");
    await mkdir(cwd);
    const outcome = await runtimeCapabilities.runTask(context, { kind: "mod", request: { cwd, brief: "capture", model: TABLE, thinking: "high" } }, new AbortController().signal);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.deepEqual(await launched(cwd), { model: sample.expected, thinking: LANE_THINKING_DEFAULT });
  });
});

/**
 * §135.27.1: the agent home's `models.json` may begin with the product's corrections note (`//` lines)
 * or an operator's own comments. The lane child catalog must read it the way Pi does, or a provider
 * defined only there is refused as one the lane "cannot run".
 */
test("a Mod child accepts a provider defined only in a commented models.json", async t => {
  const agent = await agentHome(t, "custom/only");
  await writeFile(join(agent, "models.json"), `// the product's note sits above the JSON\n// and Pi's loader strips it\n${JSON.stringify({ providers: { custom: { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", models: [{ id: "only" }] } } })}\n`);
  const { home, context } = await childContext(t, agent);
  const cwd = join(home, "mod");
  await mkdir(cwd);
  const outcome = await runtimeCapabilities.runTask(context, { kind: "mod", request: { cwd, brief: "capture", model: TABLE, thinking: "high" } }, new AbortController().signal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.deepEqual(await launched(cwd), { model: "custom/only", thinking: LANE_THINKING_DEFAULT });
});

/**
 * A voice writer or NPC author hands the runtime a model it already resolved. When that model is the
 * operator's own per-lane variable it is pinned: before §37.10.1 the runtime re-resolved every `mod`
 * task, so the moment a setting existed it silently replaced `PI_COC_VOICE_MODEL` / `PI_COC_NPC_MODEL`.
 */
test("the voice writer and the NPC author keep an operator's per-lane model over the setting and PI_COC_MOD_MODEL", async t => {
  const writers = [
    ["voice", "PI_COC_VOICE_MODEL", async (runtime, model, pinned) => {
      await writeVoice({ runtime, jobId: "j", model, pinned, systemPrompt: "s", input: "i", signal: new AbortController().signal, shape: () => ({}) });
      return join(runtime.home, ".coc", "npc-voice", "attempts");
    }],
    ["npc", "PI_COC_NPC_MODEL", async (runtime, model, pinned) => {
      await authorNpc({ runtime, jobId: "j", model, pinned, instruction: "s", input: {}, signal: new AbortController().signal }).catch(() => undefined);
      return join(runtime.home, ".coc", "npc", "attempts");
    }],
  ];
  for (const [lane, envName, write] of writers) for (const sample of CASES) await t.test(`${lane}: ${sample.name}`, async t => {
    const agent = await agentHome(t, sample.setting);
    withEnv(t, { PI_CODING_AGENT_DIR: agent, [envName]: sample.env });
    // Whenever the lane's own variable is set, the general Mod override is set too: only because the
    // writer pins the operator's per-lane choice does the more specific one win.
    const { runtime } = await childContext(t, agent, { PI_COC_MOD_MODEL: sample.env ? "operator/mod" : undefined });
    const { ctx } = sessionCtx(agent);
    const resolved = resolveLaneModel(ctx, envName);
    assert.equal(resolved.ok, true);
    const root = await write(runtime, `${resolved.model.provider}/${resolved.model.id}`, resolved.source === "operator");
    const [key] = await readdir(root), [attempt] = await readdir(join(root, key));
    assert.equal((await launched(join(root, key, attempt))).model, sample.expected);
  });
});

test("an adaptation creator and reviewer run on the fast model at the lane's own effort", async t => {
  for (const sample of CASES) await t.test(sample.name, async t => {
    const agent = await agentHome(t, sample.setting, sample.setting ? "medium" : undefined);
    withEnv(t, { PI_CODING_AGENT_DIR: agent, PI_COC_ADAPTATION_MODEL: sample.env });
    const root = await temporary(t);
    for (const role of ["create", "review"]) {
      await mkdir(join(root, role));
      await writeFile(join(root, role, "focus.json"), JSON.stringify({ purpose: "new_destination", request: "One route." }));
    }
    const task = role => ({ key: "k", attempt: 1, role, cwd: join(root, role), system_prompt: join(root, role, "prompt.md") });
    const call = async (method, args) => method === "adaptation.prepare" ? { name: args.name, status: "pending", task: task("create") }
      : method === "adaptation.draft" ? { task: task("review") } : { name: args.name, status: "ready" };
    const runs = [], owner = new AbortController();
    t.after(() => owner.abort());
    const runtime = { signal: owner.signal, runTask: async request => { runs.push(request.request); return { ok: true, code: 0 }; } };
    const { ctx } = sessionCtx(agent);
    const service = adaptationService(runtime, call, () => adaptationModel(ctx));
    assert.equal((await service.lookup({ campaign: "c", action: "prepare", name: "Route" })).status, "ready");
    assert.deepEqual(runs.map(run => [run.model, run.thinking]),
      Array(2).fill([sample.expected, sample.setting ? "medium" : LANE_THINKING_DEFAULT]),
      "both phases, and never the table's effort");
  });
});

test("the map-words lane's row names the model its Mod child actually runs on", async t => {
  for (const sample of CASES) await t.test(sample.name, async t => {
    const agent = await agentHome(t, sample.setting);
    withEnv(t, { PI_CODING_AGENT_DIR: agent, PI_COC_MOD_MODEL: sample.env });
    const { ctx } = sessionCtx(agent);
    assert.equal(fastLaneChoice(ctx, "PI_COC_MOD_MODEL", TABLE).model, sample.expected);
  });
});

/**
 * The Electron host's own projections -- the character card, the sheet's lanes, a delivery's words,
 * the standing labels and a document's presentation -- are started from `PiBackend`, which has no
 * node-test seam. They used to hand the worker the table's model and effort; every one of them now
 * goes through `cocFastLane`, and the only table model left is module preparation, which reads the
 * book's page images and stays on the table's vision model on purpose (§37.10.1).
 */
test("the host's projections ask for the fast lane, and only module preparation keeps the table's model", async () => {
  const host = await readFile(join(ROOT, "Electron", "packages", "pi-backend", "src", "index.ts"), "utf8");
  for (const call of host.matchAll(/\.(presentation|presentationStatus|documentPresentationStatus)\(\{[^;]*\}\)/gs))
    if (!/\bui:\s*true/.test(call[0])) assert.match(call[0], /cocFastLane\(|\.\.\.lane\b/, call[0].slice(0, 160));
  const table = [...host.matchAll(/`\$\{state\.model\.provider\}\/\$\{state\.model\.id\}`/g)].map(match => host.slice(match.index - 40, match.index + 140));
  assert.equal(table.length, 2, table.join("\n---\n"));
  assert.ok(table.some(site => /vision:/.test(site)), "module preparation keeps the table's vision model");
  assert.ok(table.some(site => site.includes("await this.cocLaneModel() ||")), "the other one is the fallback inside cocFastLane itself");
  const fallback = /const COC_LANE_THINKING_DEFAULT = "([a-z]+)";/.exec(host);
  assert.ok(fallback, "the host no longer declares its copy of the lane's own effort");
  assert.equal(fallback[1], LANE_THINKING_DEFAULT, "the host's projections would run at a level the runtime does not use");
  assert.match(host, /thinking: override\.thinking \|\| await this\.cocLaneThinking\(\) \|\| COC_LANE_THINKING_DEFAULT/,
    "a projection's effort must never fall back to the table's");
});

/** One reader: nothing but `runtime/fast-model.ts` parses the stored key out of a settings document. */
test("the setting has one reader in the runtime, extensions and PipiCOC sources", async () => {
  const readers = [];
  for (const dir of ["runtime", "extensions", "pipicoc"]) {
    for (const entry of await readdir(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|mts|js|mjs)$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? entry.path, entry.name);
      if ((await readFile(path, "utf8")).includes('"ext.coc-keeper.laneModel"')) readers.push(path.slice(ROOT.length + 1));
    }
  }
  // The panel is the writer, not a reader of the document.
  assert.deepEqual(readers.sort(), ["pipicoc/settings-lane-model.js", "runtime/fast-model.ts"]);
});
