/**
 * Contract §37.11.1 (2026-09-29): one fast-model setting serves both the admission review the player waits on and
 * the reviews that run after the turn was delivered. At `off` the continuity review failed its artifact on 13 of 15
 * turns (1 of 14 at `low`, same build, same model), while `off` only bought the blocking admission review 1.4 s.
 * A lane that declares `afterDelivery` is raised to `after_delivery_lanes.thinking_floor`
 * (`content/rulesets/coc7/host-budgets.json`) when its level came from the setting, the table or the default;
 * an operator's environment override and a caller-named level stay as chosen, and nothing is ever lowered.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLane } from "../../extensions/lanes/subsession.ts";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { runtimeCapabilities } from "../../runtime/tasks.ts";
import { raiseThinkingToFloor } from "../../runtime/fast-model.ts";
import { AFTER_DELIVERY_LANE_FALLBACK, afterDeliveryLaneBudget, resetAfterDeliveryLaneBudgetCache } from "../../runtime/jev/host-budgets.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "after-delivery-floor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function agentHome(t, level) {
  const agent = join(await temporary(t), "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "models-store.json"), JSON.stringify({ fast: { models: [{ id: "small" }] }, table: { models: [{ id: "keeper" }] } }));
  await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({ extensions: { "coc-keeper": { settings: {
    "ext.coc-keeper.laneModel": { model: "fast/small" }, ...(level ? { "ext.coc-keeper.laneThinking": { level } } : {}) } } } }));
  return agent;
}

function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

test("raiseThinkingToFloor only ever moves a known level up to a known floor", () => {
  assert.equal(raiseThinkingToFloor("off", "low"), "low");
  assert.equal(raiseThinkingToFloor("minimal", "low"), "low");
  assert.equal(raiseThinkingToFloor("low", "low"), "low");
  assert.equal(raiseThinkingToFloor("high", "low"), "high", "never lowered");
  assert.equal(raiseThinkingToFloor("off", undefined), "off");
  assert.equal(raiseThinkingToFloor("off", "loud"), "off", "an unknown floor compares as nothing");
});

test("the floor is data: the shipped value, a fixture's value, and the fallback for a bad one", async t => {
  resetAfterDeliveryLaneBudgetCache();
  t.after(resetAfterDeliveryLaneBudgetCache);
  const shipped = JSON.parse(await readFile(join(ROOT, "content/rulesets/coc7/host-budgets.json"), "utf8")).after_delivery_lanes.thinking_floor;
  assert.equal((await afterDeliveryLaneBudget()).thinkingFloor, shipped);
  for (const [value, expected] of [["medium", "medium"], ["loud", AFTER_DELIVERY_LANE_FALLBACK.thinkingFloor], [7, AFTER_DELIVERY_LANE_FALLBACK.thinkingFloor]]) {
    const content = await temporary(t);
    await mkdir(join(content, "rulesets", "coc7"), { recursive: true });
    await writeFile(join(content, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ after_delivery_lanes: { thinking_floor: value } }));
    assert.equal((await afterDeliveryLaneBudget(content)).thinkingFloor, expected, String(value));
  }
});

/** One zero-tool lane round on the fast model; returns the `start` row. */
async function laneStart(t, { level, afterDelivery, env = {} }) {
  const agent = await agentHome(t, level);
  withEnv(t, { PI_CODING_AGENT_DIR: agent, PI_COC_VERIFIER_MODEL: undefined, PI_COC_VERIFIER_MODEL_THINKING: undefined, PI_COC_LANE_THINKING: undefined, ...env });
  const rows = [];
  const ctx = { cwd: agent, model: { provider: "table", id: "keeper" }, thinkingLevel: "off", modelRegistry: {
    find: (provider, id) => ({ provider, id, api: "openai-completions", reasoning: true }),
    complete: async () => ({ stopReason: "stop", content: [{ type: "text", text: '{"ok":true}' }] }),
  } };
  const result = await runLane({ ctx, envName: "PI_COC_VERIFIER_MODEL", lane: "verifier", systemPrompt: "return json", input: "x",
    record: row => rows.push(row), ...(afterDelivery ? { afterDelivery: true } : {}), shape: parsed => (parsed?.ok === true ? parsed : undefined) });
  assert.equal(result.ok, true, JSON.stringify(result));
  return rows.find(row => row.phase === "start");
}

test("a post-delivery lane at the setting's off runs at the floor, and its row says the floor decided", async t => {
  const start = await laneStart(t, { level: "off", afterDelivery: true });
  assert.equal(start.lane_thinking, "low");
  assert.equal(start.lane_thinking_effective, "low");
  assert.equal(start.thinking_source, "after-delivery-floor");
});

test("a lane the player waits on keeps the setting's off", async t => {
  const start = await laneStart(t, { level: "off", afterDelivery: false });
  assert.equal(start.lane_thinking, "off");
  assert.equal(start.thinking_source, "setting");
});

test("an operator's own environment override is never raised; a higher setting is never lowered", async t => {
  const operator = await laneStart(t, { level: "off", afterDelivery: true, env: { PI_COC_LANE_THINKING: "off" } });
  assert.deepEqual([operator.lane_thinking, operator.thinking_source], ["off", "operator"]);
  const high = await laneStart(t, { level: "high", afterDelivery: true });
  assert.deepEqual([high.lane_thinking, high.thinking_source], ["high", "setting"]);
});

/** A mod child whose launcher records its argv instead of starting pi. */
async function childThinking(t, { level, afterDelivery, env = {} }) {
  const agent = await agentHome(t, level);
  const home = await temporary(t), executable = join(home, "capture-argv.mjs"), launcher = join(home, "node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';\nwriteFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const context = composeRuntimeContext({ owner: "preparation", home }, {
    resourceRoot: ROOT, agentHome: agent, nodeExecutable: launcher,
    env: { ...process.env, UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_MOD_MODEL: undefined, PI_COC_MOD_THINKING: undefined, ...env },
  });
  const cwd = join(home, "mod");
  await mkdir(cwd);
  const outcome = await runtimeCapabilities.runTask(context, { kind: "mod", request: { cwd, brief: "capture", ...(afterDelivery ? { afterDelivery: true } : {}) } }, new AbortController().signal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const argv = JSON.parse(await readFile(join(cwd, "launch-argv.json"), "utf8"));
  return argv[argv.indexOf("--thinking") + 1];
}

test("a post-delivery Mod child at the setting's off launches at the floor; a pre-delivery one keeps off", async t => {
  assert.equal(await childThinking(t, { level: "off", afterDelivery: true }), "low");
  assert.equal(await childThinking(t, { level: "off", afterDelivery: false }), "off");
});

test("PI_COC_MOD_THINKING stays the operator's word even after delivery", async t => {
  assert.equal(await childThinking(t, { level: "off", afterDelivery: true, env: { PI_COC_MOD_THINKING: "off" } }), "off");
});
