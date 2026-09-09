import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "pi-coc TS progress "));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await symlink(join(REPO, "node_modules"), join(temporary, "node_modules"), "dir");
await build({
  entryPoints: { rpc: join(REPO, "kernel-ts/rpc.ts"), api: join(REPO, "kernel-ts/testing/api.ts") },
  outdir: temporary, outExtension: { ".js": ".mjs" },
  bundle: true, packages: "external", format: "esm", platform: "node", target: "node22", logLevel: "silent",
});
const api = await import(pathToFileURL(join(temporary, "api.mjs")).href);

const CREATE = { id: "c1", module: "the-haunting", pregen: "thomas-hayes", play_language: "en" };
const OPENING = "The study smells of dust and old paper. Knott waits by the window, watching you.";

function environment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "0",
    GIT_AUTHOR_DATE: "2000-01-02T03:04:05Z", GIT_COMMITTER_DATE: "2000-01-02T03:04:05Z", TZ: "UTC" };
}

async function runtime(name) {
  const workspace = join(temporary, name);
  await mkdir(workspace, { recursive: true });
  // The bundled test kernel has no native flock; a no-op flock keeps the guard path real.
  const context = await api.createKernelContext({ workspace, content: join(REPO, "content"), seed: "progress", env: environment(), locks: api.createAdvisoryLocks(async () => {}) });
  const kernel = api.createKernelRuntime(context);
  return { context, handlers: kernel.handlers, close: () => kernel.close() };
}

test("progress frames are opt-in, precede the response and carry id, stage, detail and at", async () => {
  const seen = [];
  const methods = { "kernel.hello": (_params, report) => {
    seen.push(typeof report);
    report?.("load");
    report?.("commit", "turn 4 committed");
    return { done: true };
  } };
  const requests = [
    JSON.stringify({ id: "opted", method: "kernel.hello", params: {}, progress: true }),
    JSON.stringify({ id: "silent", method: "kernel.hello", params: {} }),
    JSON.stringify({ id: "false-flag", method: "kernel.hello", params: {}, progress: false }),
  ].join("\n");
  let output = "";
  await api.serve(Readable.from([requests]), new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } }), methods);
  assert.deepEqual(seen, ["function", "undefined", "undefined"], "only an explicit progress:true arms the reporter");
  const lines = output.trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => `${line.id}:${line.progress ? line.progress.stage : "result"}`), [
    "opted:load", "opted:commit", "opted:result", "silent:result", "false-flag:result",
  ]);
  assert.equal(lines[1].progress.detail, "turn 4 committed");
  for (const frame of lines.filter(line => line.progress)) {
    assert.match(frame.progress.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "at is the kernel ISO timestamp");
    assert.equal(frame.ok, undefined, "a frame never settles the call");
    assert.equal(frame.result, undefined, "a frame carries no result data");
  }
});

test("narrate reports load through poststep once each, in pipeline order; replay stays silent", async (t) => {
  const { handlers, close } = await runtime("narrate stages");
  t.after(close);
  await handlers["campaign.create"](CREATE);
  const stages = [];
  const result = await handlers["table.narrate"]({ campaign: "c1", call_id: "t0-c1", text: OPENING },
    (stage, detail) => stages.push(detail ? `${stage}:${detail}` : stage));
  assert.deepEqual(stages, ["load", "validate", "project", "write", "commit", "poststep"]);
  assert.equal(typeof result.commit, "string");
  const replayed = [];
  const replay = await handlers["table.narrate"]({ campaign: "c1", call_id: "t0-c1", text: OPENING },
    stage => replayed.push(stage));
  assert.deepEqual(replayed, [], "an idempotent replay exits before the first stage boundary");
  assert.equal(replay.commit, result.commit);
  const silent = await handlers["table.player_input"]({ campaign: "c1", text: "I look around the study." });
  assert.equal(silent.state, "open", "handlers without a reporter behave exactly as before");
});

test("a failed commit reports up to write and never commit or poststep", async (t) => {
  const { context, handlers, close } = await runtime("commit failure");
  t.after(close);
  await handlers["campaign.create"](CREATE);
  await rm(join(context.workspace, ".coc", "repos", "c1.git"), { recursive: true, force: true });
  const stages = [];
  await assert.rejects(
    handlers["table.narrate"]({ campaign: "c1", call_id: "t0-c1", text: OPENING }, stage => stages.push(stage)),
    error => error.code === "commit_failed");
  assert.deepEqual(stages, ["load", "validate", "project", "write"]);
});

test("the subprocess wire carries one JSON frame per stage ahead of the narrate response", async () => {
  const workspace = join(temporary, "wire");
  await mkdir(workspace, { recursive: true });
  const requests = [
    { id: "create", method: "campaign.create", params: CREATE },
    { id: "narrate", method: "table.narrate", params: { campaign: "c1", call_id: "t0-c1", text: OPENING }, progress: true },
    { id: "replay", method: "table.narrate", params: { campaign: "c1", call_id: "t0-c1", text: OPENING }, progress: true },
    { id: "input", method: "table.player_input", params: { campaign: "c1", text: "I look around the study." } },
    { id: "plain", method: "table.narrate", params: { campaign: "c1", call_id: "t1-c1", text: "Knott nods slowly and draws the curtains." } },
  ];
  const run = spawnSync(process.execPath, [join(temporary, "rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")], {
    cwd: temporary, encoding: "utf8", timeout: 120000, env: environment(),
    input: requests.map(value => JSON.stringify(value)).join("\n"),
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split("\n").map(JSON.parse);
  const responses = lines.filter(line => !line.progress);
  assert.deepEqual(responses.map(line => [line.id, line.ok]), requests.map(value => [value.id, true]));
  const frames = lines.filter(line => line.progress);
  assert.deepEqual(frames.map(line => [line.id, line.progress.stage]),
    ["load", "validate", "project", "write", "commit", "poststep"].map(stage => ["narrate", stage]),
    "frames only for the opted-in first narrate; the replay and the unflagged narrate stay silent");
  const lastFrame = lines.indexOf(frames.at(-1));
  const response = lines.findIndex(line => line.id === "narrate" && !line.progress);
  assert.ok(lastFrame < response, "every frame precedes the response that settles the call");
  assert.equal(typeof lines[response].result.commit, "string");
  assert.equal(lines[response].result.commit, responses[2].result.commit, "the replay returns the committed turn");
});
