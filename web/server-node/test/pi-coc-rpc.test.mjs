import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  UI_AUTO_OPEN_MARKER,
  UI_IDLE_MARKER,
  buildChildEnv,
  buildPiCocArgs,
  createJsonlParser,
  mapRpcEventToSse,
  PiCocRpcHost,
  webSessionId,
} from "../pi-coc-rpc.mjs";

test("webSessionId stays inside Pi session-id grammar", () => {
  assert.equal(webSessionId("the-haunting"), "web-the-haunting");
  assert.equal(webSessionId("foo:bar"), "web-foo-bar");
});

test("buildPiCocArgs uses RPC mode and a campaign selector", () => {
  assert.deepEqual(
    buildPiCocArgs({ campaignId: "haunting-1", sessionId: "web-haunting-1" }),
    ["--mode", "rpc", "--session-id", "web-haunting-1", "--campaign", "haunting-1"],
  );
});

test("buildChildEnv marks an attached UI and play workspace", () => {
  const env = buildChildEnv({
    workspace: "/tmp/coc-workspace",
    repoRoot: "/tmp/missing-repo",
    campaignId: "haunting-1",
    tableIntent: "character-setup",
    parentEnv: { PATH: "/usr/bin", HOME: "/tmp" },
  });
  assert.equal(env.COC_WORKSPACE, "/tmp/coc-workspace");
  assert.equal(env.COC_PI_ATTACHED_UI, "1");
  assert.equal(env.PI_COC_CAMPAIGN_ID, "haunting-1");
  assert.equal(env.COC_HOST, "pi");
  assert.equal(env.COC_PI_TABLE_INTENT, "character-setup");
});

test("JSONL parser splits only on LF and ignores a U+2028 inside JSON", () => {
  const rows = [];
  const parser = createJsonlParser((obj) => rows.push(obj));
  parser.push('{"type":"a","text":"foo\u2028bar"}\n{"type":"b"}\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "a");
  assert.equal(rows[0].text, "foo\u2028bar");
  assert.equal(rows[1].type, "b");
});

test("mapRpcEventToSse forwards text, thinking, usage, and tools", () => {
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_update",
      usage: { input: 12, output: 3 },
      assistantMessageEvent: { type: "text_delta", delta: "你好" },
    }),
    [
      { event: "usage", data: { input: 12, output: 3 } },
      { event: "delta", data: { text: "你好" } },
    ],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    }),
    [{ event: "thinking", data: { text: "hmm" } }],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "tool_execution_start",
      toolName: "coc_invoke",
      args: { operation: "session.resume" },
    }),
    [{ event: "tool", data: { phase: "start", tool: "session.resume" } }],
  );
  assert.deepEqual(mapRpcEventToSse({ type: "agent_settled" }), []);
});

function fakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {
    child.emit("exit", 0, null);
  };
  return child;
}

test("PiCocRpcHost prompts until agent_settled and maps live SSE", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c1",
    sessionId: "web-c1",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("叫大牛批，是医生", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  assert.equal(first.type, "prompt");
  assert.equal(first.message, "叫大牛批，是医生");
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "好。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await promptP;
  assert.deepEqual(frames, [{ event: "delta", data: { text: "好。" } }]);
});

test("attachOpening replays a turn that settled before the UI attached", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c1",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "先建卡" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 20));
  const frames = [];
  const result = await host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  assert.deepEqual(result, { opened: true });
  assert.deepEqual(frames, [{ event: "delta", data: { text: "先建卡" } }]);
});

test("attachOpening returns immediately on idle UI intent", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c1",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  const result = await host.attachOpening();
  assert.deepEqual(result, { opened: false });
});

test("attachOpening follows an auto-open already in flight", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c1",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attachP = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "开桌" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.deepEqual(result, { opened: true });
  assert.deepEqual(frames, [{ event: "delta", data: { text: "开桌" } }]);
});
