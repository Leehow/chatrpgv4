/**
 * Contract §186.2: every Pi child of one reading job round runs in memory under one session id derived from
 * (module id, job id, round), so its provider cache key is the round's: Pi's Responses transport sends it as
 * `prompt_cache_key` (and its session affinity headers), and the grok-build hook as `x-grok-conv-id`.
 *
 * The child test loads the emitted `build/` (the vendored Pi and `build/extensions/module/reader-context.mjs`): run
 * `npm run build:runtime` first.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeRuntimeContext } from "../../runtime/host.ts";
import { runtimeCapabilities } from "../../runtime/tasks.ts";
import { PI_PACKAGE_ROOT } from "../../runtime/deployment.mjs";
import { readerCommand, readingCacheId, runReader } from "../../extensions/module/reader.ts";
import { CONVERSATION_HEADER, routeCacheByConversation } from "../../extensions/grok-build-oauth/agent/cache-routing.js";
import { GROK_BUILD_PROVIDER_ID } from "../../extensions/grok-build-oauth/agent/models.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PI = join(ROOT, PI_PACKAGE_ROOT, "dist");
const json = (path, value) => writeFile(path, JSON.stringify(value) + "\n");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function temporary(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("§186.2: the cache identity is a UUID of (module, job, round) that Pi accepts as a session id", async () => {
  const { assertValidSessionId } = await import(pathToFileURL(join(PI, "core", "session-manager.js")).href);
  const id = readingCacheId("book-4", "read-37", 2);
  assert.equal(readingCacheId("book-4", "read-37", 2), id, "the same round always derives the same id");
  for (const other of [readingCacheId("book-4", "read-37", 1), readingCacheId("book-4", "read-38", 2), readingCacheId("book-5", "read-37", 2)])
    assert.notEqual(other, id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.doesNotThrow(() => assertValidSessionId(id));
  assert.ok(id.length <= 64, "fits an OpenAI prompt_cache_key unclipped");
});

test("§186.2: the reader command carries --no-session --session-id; Pi opens an in-memory session under it and the grok hook routes by it", async t => {
  const id = readingCacheId("book", "read-1", 1);
  const command = readerCommand("grok-build/grok-4.5", "/task/prompt.md", "low", true, true, undefined, undefined, false, false, false, id);
  assert.deepEqual(command.slice(command.indexOf("--no-session"), command.indexOf("--no-session") + 3), ["--no-session", "--session-id", id]);
  assert.equal(readerCommand("grok-build/grok-4.5").includes("--session-id"), false, "a child without a round keeps a fresh id");
  // Pi's own parser and session factory, on exactly these arguments.
  const { parseArgs } = await import(pathToFileURL(join(PI, "cli", "args.js")).href);
  const { createSessionManager } = await import(pathToFileURL(join(PI, "main.js")).href);
  const parsed = parseArgs(command.slice(2, -1));
  assert.equal(parsed.noSession, true);
  const cwd = await temporary(t, "coc cache identity ");
  const sessionManager = await createSessionManager(parsed, cwd, undefined, undefined);
  assert.equal(sessionManager.getSessionId(), id);
  assert.equal(sessionManager.getSessionFile?.(), undefined, "nothing is persisted under the round's id");
  const headers = {};
  routeCacheByConversation(headers, { model: { provider: GROK_BUILD_PROVIDER_ID }, sessionManager });
  assert.equal(headers[CONVERSATION_HEADER], id);
});

/** A minimal OpenAI Responses endpoint: records each request's headers and body, answers one short message. */
function responsesProvider(t) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      seen.push({ headers: request.headers, body: JSON.parse(body || "{}") });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      const item = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [] };
      send({ type: "response.created", response: { id: "resp_1", status: "in_progress" } });
      send({ type: "response.output_item.added", output_index: 0, item });
      send({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Done." });
      send({ type: "response.output_item.done", output_index: 0, item: { ...item, content: [{ type: "output_text", text: "Done.", annotations: [] }] } });
      send({ type: "response.completed", response: { id: "resp_1", status: "completed",
        usage: { input_tokens: 1200, output_tokens: 3, total_tokens: 1203, input_tokens_details: { cached_tokens: 200 } } } });
      response.end();
    });
  });
  t.after(() => new Promise(done => server.close(done)));
  return new Promise(ready => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, seen })));
}

test("§186.2: a real reader child sends the round's id as prompt_cache_key and session affinity, and reports its first call's uncached input", async t => {
  const home = await temporary(t, "coc cache child ");
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  const { port, seen } = await responsesProvider(t);
  await json(join(agent, "models.json"), { providers: { cachebox: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", apiKey: "unused",
    models: [{ id: "cache-1", contextWindow: 100000, maxTokens: 4096 }] } } });
  await json(join(agent, "settings.json"), { quietStartup: true });
  const context = composeRuntimeContext({ owner: "preparation", home }, {
    resourceRoot: ROOT,
    env: { ...process.env, PI_OFFLINE: "1", UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_CONTENT_ROOT: undefined },
    agentHome: agent,
  });
  const cwd = join(home, "read-1");
  await mkdir(cwd, { recursive: true });
  const prompt = join(home, "reader.md");
  await writeFile(prompt, "Answer in one short sentence.\n");
  const cacheId = readingCacheId("book", "read-1", 2);
  const outcome = await runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd, timeoutMs: 60_000, cacheId,
    model: "cachebox/cache-1", thinking: "off", tools: "read", systemPrompt: prompt, eventLog: join(cwd, "read-2.jsonl"), brief: "Say done." } },
    new AbortController().signal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.prompt_cache_key, cacheId, "Pi's Responses transport keys the provider cache by the round");
  assert.equal(seen[0].headers.session_id, cacheId);
  assert.equal(seen[0].headers["x-client-request-id"], cacheId);
  const [session] = (await readFile(join(cwd, "read-2.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual([session.type, session.id], ["session", cacheId]);
  assert.equal(outcome.firstCallUncached, 1000, "input tokens less the cached ones");
});

test("§186.1 + §186.2: the launch carries the round's session id and exactly the requested image budget to the child", async t => {
  const home = await temporary(t, "coc cache launch ");
  const executable = join(home, "capture.mjs"), launcher = join(home, "selected node");
  await writeFile(executable, `import {writeFileSync} from 'node:fs';\nwriteFileSync('launch.json',JSON.stringify({argv:process.argv.slice(2),images:process.env.PI_COC_READER_IMAGE_HISTORY??null}));\n`);
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`);
  await chmod(launcher, 0o755);
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  await json(join(agent, "models-store.json"), { selected: { models: [{ id: "current-model" }] } });
  // A stale value in the host's own environment must not reach a child that asked for no budget.
  const context = composeRuntimeContext({ owner: "preparation", home }, { resourceRoot: ROOT, agentHome: agent, nodeExecutable: launcher,
    env: { ...process.env, UV_OFFLINE: "1", UV_NO_SYNC: "1", PI_COC_READER_CMD: undefined, PI_COC_READER_IMAGE_HISTORY: "4" } });
  const launch = async (dir, extra) => {
    const cwd = join(home, dir);
    await mkdir(cwd, { recursive: true });
    const outcome = await runtimeCapabilities.runTask(context, { kind: "reader", request: { cwd, brief: "Capture launch flags only", model: "selected/current-model", ...extra } },
      new AbortController().signal);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return JSON.parse(await readFile(join(cwd, "launch.json"), "utf8"));
  };
  const id = readingCacheId("book", "read-9", 1);
  const round = await launch("round", { cacheId: id, imageHistory: 12 });
  assert.deepEqual(round.argv.slice(round.argv.indexOf("--no-session"), round.argv.indexOf("--no-session") + 3), ["--no-session", "--session-id", id]);
  assert.equal(round.images, "12");
  const plain = await launch("plain", {});
  assert.equal(plain.argv.includes("--session-id"), false);
  assert.equal(plain.images, null, "no budget asked, none inherited");
  const refused = await runReader({ cwd: join(home, "plain"), brief: "unused", cacheId: "not a uuid" }, context);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /cache id is a UUID/);
});
