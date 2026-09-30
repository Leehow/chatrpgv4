/**
 * SL-99 (contract §140.1): a reader step's stream may be silent for as long as the model takes to write its draft.
 *
 * The Masks table (lanes on grok-build/grok-4.5 low): opening reads read-4 and read-5 each viewed seven page images,
 * wrote "Writing the opening draft...", and ended `Provider stream timed out: no response event for 60000 ms`. The
 * silence was not the images: grok's tool-call arguments arrive in one burst after the model has generated them
 * (every grok-build tool call on record has exactly one `toolcall_delta`), so a draft call is silent for as long as
 * its generation takes. The healthy retry of the same draft was silent 55.8 s; the worst healthy silence of any
 * reader step on record is 122.3 s.
 *
 * The reader's allowance is data (`content/rulesets/coc7/host-budgets.json`, `reading.idle_ms`); the Keeper's (the
 * agent home's, `runtime/launch.ts`) and a `mod` lane child's (`LANE_HTTP_IDLE_TIMEOUT_MS`) do not move.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { LANE_HTTP_IDLE_TIMEOUT_MS, runtimeCapabilities } from "../../runtime/tasks.ts";
import { READING_IDLE_FALLBACK, readingIdleBudget, resetReadingIdleBudgetCache } from "../../runtime/jev/host-budgets.ts";
import { piLaunch } from "../../runtime/launch.ts";
import { PI_ENTRIES } from "../../runtime/deployment.mjs";
import { providerSpend, resentUsage } from "../../runtime/jev/provider-budget.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHIPPED = join(ROOT, "content", "rulesets", "coc7", "host-budgets.json");
const json = (path, value) => writeFile(path, JSON.stringify(value) + "\n");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const KEEPER_IDLE_MS = 60_000;

async function temporary(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A content root holding only the host budgets, with the given `reading` entry. */
async function contentWith(t, reading) {
  const root = await temporary(t, "coc reading budget ");
  await mkdir(join(root, "rulesets", "coc7"), { recursive: true });
  await json(join(root, "rulesets", "coc7", "host-budgets.json"), { schema_version: 1, look_budget: { per_turn: 8, tools: [] },
    ...(reading === undefined ? {} : { reading }) });
  return root;
}

/** A runtime context whose "pi" records its argv; the agent home carries the operator's (the Keeper's) 60 s. */
async function capturing(t, contentRoot) {
  const home = await temporary(t, "coc reader idle ");
  const executable = join(home, "capture-argv.mjs"), launcher = join(home, "selected node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';\nwriteFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  await json(join(agent, "models-store.json"), { selected: { models: [{ id: "current-model" }] } });
  await json(join(agent, "settings.json"), { quietStartup: true, httpIdleTimeoutMs: KEEPER_IDLE_MS });
  const context = composeRuntimeContext({ owner: "preparation", home }, {
    resourceRoot: ROOT, ...(contentRoot ? { contentRoot } : {}),
    env: { ...process.env, UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_CONTENT_ROOT: undefined,
      PI_COC_MOD_MODEL: undefined, PI_COC_MOD_THINKING: undefined, PI_COC_MOD_HTTP_IDLE_TIMEOUT_MS: undefined },
    agentHome: agent, nodeExecutable: launcher,
  });
  const launch = async (kind, dir) => {
    const cwd = join(home, dir);
    await mkdir(cwd, { recursive: true });
    const outcome = await runtimeCapabilities.runTask(context,
      { kind, request: { cwd, brief: "Capture launch flags only", model: "selected/current-model" } }, new AbortController().signal);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return { argv: JSON.parse(await readFile(join(cwd, "launch-argv.json"), "utf8")),
      settings: JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8")) };
  };
  return { agent, launch };
}

test("readingIdleBudget: the shipped host-budgets.json carries SL-99's reading entry; a fixture root is read, not assumed", async t => {
  resetReadingIdleBudgetCache();
  const shipped = JSON.parse(await readFile(SHIPPED, "utf8"));
  assert.equal(typeof shipped.reading?.idle_ms, "number", "the reading entry is data in the shipped file");
  assert.deepEqual(await readingIdleBudget(join(ROOT, "content")), { idleMs: shipped.reading.idle_ms });
  assert.deepEqual(await readingIdleBudget(await contentWith(t, { idle_ms: 123_456 })), { idleMs: 123_456 });
  assert.deepEqual(await readingIdleBudget(await contentWith(t, { idle_ms: 90_000.7 })), { idleMs: 90_000 }, "whole milliseconds, as Pi floors them");
  for (const reading of [undefined, { idle_ms: 0 }, { idle_ms: -5 }, { idle_ms: "long" }, {}])
    assert.deepEqual(await readingIdleBudget(await contentWith(t, reading)), READING_IDLE_FALLBACK, JSON.stringify(reading));
  assert.deepEqual(await readingIdleBudget(join(await temporary(t, "coc no content "), "missing")), READING_IDLE_FALLBACK);
});

/**
 * The number is only meaningful against what it sits between, so the measurement is asserted here rather than left in
 * a comment (the ticket's Comments carry the full table: 6,606 reader steps across the retained work directories).
 */
test("the shipped reading allowance clears the worst healthy reader silence and the slowest draft call on record", async () => {
  const { reading } = JSON.parse(await readFile(SHIPPED, "utf8"));
  // grok-4.6 review step, silent before its first event; grok-4.6 author step, silent 114.4 s before an
  // 8,025-output-token submit_reading call arrived. Both went on to finish.
  const WORST_HEALTHY_READER_SILENCE_MS = 122_300;
  // The largest draft call on record (§20 addendum 2: 10,933 output tokens) at the slowest silent generation rate
  // measured on a grok reader (65.3 output tokens a second): a tool call whose arguments arrive in one burst.
  const LARGEST_DRAFT_AT_SLOWEST_RATE_MS = Math.ceil(10_933 / 65.3 * 1000);
  assert.ok(reading.idle_ms > WORST_HEALTHY_READER_SILENCE_MS, `${reading.idle_ms} would cut a healthy reader step`);
  assert.ok(reading.idle_ms > LARGEST_DRAFT_AT_SLOWEST_RATE_MS, `${reading.idle_ms} would cut the largest draft call on record`);
  assert.ok(reading.idle_ms > KEEPER_IDLE_MS, "the reader's allowance is longer than the table's, or this entry is moot");
});

test("a reader child gets the reading allowance from the data file; a mod lane child keeps its own; the agent home is untouched", async t => {
  const { agent, launch } = await capturing(t, await contentWith(t, { idle_ms: 123_456 }));
  const reader = await launch("reader", "reader");
  assert.deepEqual(reader.settings, { httpIdleTimeoutMs: 123_456, retry: { provider: { maxRetries: 0 } } });
  // Pi reads `<cwd>/.pi/settings.json` only for a trusted project.
  assert.ok(reader.argv.includes("--approve"), JSON.stringify(reader.argv));
  const mod = await launch("mod", "mod");
  assert.deepEqual(mod.settings, { httpIdleTimeoutMs: LANE_HTTP_IDLE_TIMEOUT_MS, retry: { provider: { maxRetries: 0 } } });
  assert.deepEqual(JSON.parse(await readFile(join(agent, "settings.json"), "utf8")), { quietStartup: true, httpIdleTimeoutMs: KEEPER_IDLE_MS },
    "the operator's value, which the Keeper runs on, is neither read nor rewritten");
});

test("with the shipped content a reader child carries the shipped reading.idle_ms", async t => {
  const { reading } = JSON.parse(await readFile(SHIPPED, "utf8"));
  const { launch } = await capturing(t);
  assert.equal((await launch("reader", "reader")).settings.httpIdleTimeoutMs, reading.idle_ms);
});

test("a Keeper session keeps the table's 60 s even when the content carries a reading allowance", async t => {
  const root = await temporary(t, "coc keeper idle ");
  await mkdir(join(root, "prompts"));
  await writeFile(join(root, "prompts", "keeper.md"), "# Keeper\n");
  await mkdir(join(root, "content", "rulesets", "coc7"), { recursive: true });
  await json(join(root, "content", "rulesets", "coc7", "host-budgets.json"), { schema_version: 1, reading: { idle_ms: 123_456 } });
  await mkdir(dirname(join(root, PI_ENTRIES.pi)), { recursive: true });
  await writeFile(join(root, PI_ENTRIES.pi), "");
  await mkdir(join(root, 'build/runtime'), { recursive: true });
  await writeFile(join(root, 'build/runtime/pi-hybrid.mjs'), "");
  const env = { ...process.env };
  for (const key of ["PI_COC_LOOP_ENGINE", "PI_COC_LAYOUT", "PI_CODING_AGENT_DIR", "PI_COC_HOME", "PI_COC_CONTENT_ROOT", "PI_COC_CAMPAIGN"]) delete env[key];
  await piLaunch(["--campaign", "keeper-idle"], { resourceRoot: root, env });
  const settings = JSON.parse(await readFile(join(root, ".pi", "coc-agent", "settings.json"), "utf8"));
  assert.equal(settings.httpIdleTimeoutMs, KEEPER_IDLE_MS);
});

test("§140.1 resentUsage: every attempt is charged what the reporting resend reported, never above the reservation, never below the report", () => {
  const model = { provider: "test", id: "vision", api: "openai-responses", maxTokens: 100, contextWindow: 10_000,
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } };
  const bound = { model, inputTokens: 10_000, outputTokens: 100 };
  const reserved = providerSpend(bound);
  const usage = { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, cost: { total: 0.00004 } };
  assert.equal(resentUsage(usage, 1, bound), usage, "a single attempt is the report unchanged");
  assert.deepEqual(resentUsage(usage, 3, bound), { input: 45, output: 15, cacheRead: 0, cacheWrite: 0, cost: { total: 3 * 0.00004 } });
  assert.deepEqual(resentUsage({ ...usage, input: 6_000, cacheRead: 0, cacheWrite: 0, output: 70 }, 2, bound),
    { input: 10_000, output: 100, cacheRead: 0, cacheWrite: 0, cost: { total: 0.00008 } }, "the inferred part stops at the reservation");
  assert.equal(resentUsage({ ...usage, output: 150 }, 2, bound).output, 150, "a reported overrun of the resend is still reported");
  assert.equal(resentUsage({ input: 1 }, 2, bound).input, 1, "unreadable usage passes through, to be charged whole");
  assert.ok(resentUsage(usage, 400, bound).cost.total <= reserved.costUsd);
});

/** Headers and a first chunk, then silence (the Masks shape); the second request answers. */
function stallingProvider(t) {
  let seen = 0;
  const bodies = [];
  const server = createServer(socket => {
    let received = "";
    socket.on("error", () => {});
    socket.on("data", data => {
      received += data;
      const head = received.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(received.slice(0, head))?.[1] ?? 0);
      if (Buffer.byteLength(received.slice(head + 4)) < length) return;
      bodies.push(received.slice(head + 4));
      received = "";
      const first = seen++ === 0;
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n");
      const send = payload => {
        const chunk = `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
        socket.write(`${Buffer.byteLength(chunk).toString(16)}\r\n${chunk}\r\n`);
      };
      const chunk = (delta, finish = null) => ({ id: "1", object: "chat.completion.chunk", created: 1, model: "stall",
        choices: [{ index: 0, delta, finish_reason: finish }] });
      send(chunk({ role: "assistant", content: "Writing the draft" }));
      if (first) return;  // ...and then nothing: the model is "generating its tool call"
      send(chunk({ content: "." }));
      send({ ...chunk({}, "stop"), usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } });
      send("[DONE]");
      socket.write("0\r\n\r\n");
    });
  });
  t.after(() => new Promise(done => server.close(done)));
  return new Promise(ready => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, bodies })));
}

/**
 * The real product path: `runtime/tasks.ts` launches a real Pi reader child with the reading allowance from a
 * fixture content root (2 s, so the test is quick), under the host-owned provider lease. The agent home asks for
 * ten minutes -- if the child ran on it, the stall would outlive the test. Pi's own auto-retry resends the attempt,
 * and the resend must be recognised as identical (the digest the child sends), so the failed attempt is paid from its
 * own reservation and measured by the resend: no call is charged its whole reservation.
 *
 * The child loads the emitted `build/extensions/module/reader-context.mjs` (the child side of the provider channel):
 * run `npm run build:runtime` first, or a stale build sends no digest and this reads as a regression.
 */
test("a real reader child cuts a silent stream at the reading allowance, and pi's resend pays for the failed attempt", async t => {
  const content = await contentWith(t, { idle_ms: 2_000 });
  const home = await temporary(t, "coc reader live ");
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  const { port, bodies } = await stallingProvider(t);
  await json(join(agent, "models.json"), { providers: { stallbox: {
    baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused",
    models: [{ id: "stall-1", contextWindow: 100000, maxTokens: 4096 }] } } });
  await json(join(agent, "settings.json"), { quietStartup: true, httpIdleTimeoutMs: 600_000,
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 } });
  const context = composeRuntimeContext({ owner: "preparation", home }, {
    resourceRoot: ROOT, contentRoot: content,
    env: { ...process.env, PI_OFFLINE: "1", UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_CONTENT_ROOT: undefined },
    agentHome: agent,
  });
  const cwd = join(home, "read-1");
  await mkdir(cwd, { recursive: true });
  const prompt = join(home, "reader.md");
  await writeFile(prompt, "Answer in one short sentence.\n");
  const began = Date.now();
  const outcome = await runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd, timeoutMs: 60_000,
    model: "stallbox/stall-1", thinking: "off", tools: "read", systemPrompt: prompt, eventLog: join(cwd, "read-1.jsonl"),
    brief: "Say nothing else." } }, new AbortController().signal);
  const ms = Date.now() - began;

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.ok(ms < 30_000, `${ms} ms: the stall was not cut at the reading allowance`);
  const events = (await readFile(join(cwd, "read-1.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const failed = events.find(event => event.type === "message_end" && event.message?.stopReason === "error");
  assert.match(failed?.message?.errorMessage ?? "", /no response event for 2000 ms/, "cut by the reader's own allowance");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1], "pi's auto-retry resends the identical request");
  // One reservation for both attempts: nothing charged whole, and each attempt charged the resend's 50 input tokens.
  assert.equal(outcome.usage.unknownCalls, 0, JSON.stringify(outcome.usage));
  assert.equal(outcome.usage.inputTokens, 2 * 50);
  assert.equal(outcome.usage.actions, 1);
});
