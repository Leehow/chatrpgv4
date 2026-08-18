import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  HANDOFF_EXIT_CODE,
  UI_AUTO_OPEN_MARKER,
  UI_IDLE_MARKER,
  buildChildEnv,
  buildPiCocArgs,
  createJsonlParser,
  mapRpcEventToSse,
  PiCocRpcHost,
  sessionOpeningFlags,
  summarizeRpcDeath,
  webSessionId,
} from "../pi-coc-rpc.mjs";

test("webSessionId stays inside Pi session-id grammar", () => {
  assert.equal(webSessionId("the-haunting"), "web-the-haunting");
  assert.equal(webSessionId("foo:bar"), "web-foo-bar");
});

test("summarizeRpcDeath prefers the Error line over a leading warning", () => {
  const stderr = [
    "pi-coc: no /app/payload/.venv/bin/python3; run 'uv sync --frozen' or PDF ingest will fail",
    "Warning: No project session found with id 'web-the-haunting-qs'",
    "Error: Failed to load extension \"/repo\": ParseError: Unexpected character ' '.",
  ].join("\n");
  const summary = summarizeRpcDeath(stderr);
  assert.match(summary, /Failed to load extension/);
  assert.doesNotMatch(summary, /PDF ingest/);
});

test("buildPiCocArgs uses RPC mode and a campaign selector", () => {
  assert.deepEqual(
    buildPiCocArgs({ campaignId: "haunting-1", sessionId: "web-haunting-1" }),
    ["--mode", "rpc", "--session-id", "web-haunting-1", "--campaign", "haunting-1"],
  );
});

test("buildPiCocArgs pins the selected model and exact supported thinking at startup", () => {
  assert.deepEqual(
    buildPiCocArgs({
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      provider: "jellytoken",
      model: "deepseek-v4-flash",
      thinking: "off",
    }),
    [
      "--mode", "rpc",
      "--session-id", "web-haunting-1",
      "--campaign", "haunting-1",
      "--provider", "jellytoken",
      "--model", "deepseek-v4-flash",
      "--thinking", "off",
    ],
  );
});

test("sessionOpeningFlags opens the host only for a fresh spawn", () => {
  assert.deepEqual(sessionOpeningFlags({ spawned: true, hasInvestigator: false }), {
    character_setup: true,
    host_opening: true,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: false, hasInvestigator: false }), {
    character_setup: true,
    host_opening: false,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: false, hasInvestigator: true }), {
    character_setup: false,
    host_opening: false,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: true, hasInvestigator: true }), {
    character_setup: false,
    host_opening: true,
  });
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

test("buildChildEnv pins keeper pi CLI over parent COC_PI_CLI", (t) => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const keeperCli = path.join(
    repoRoot,
    "runtime",
    "adapters",
    "keeper",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  // Isolated git worktrees do not carry runtime/adapters/keeper/node_modules.
  if (!fs.existsSync(keeperCli)) {
    t.skip("keeper pi CLI not vendored in this worktree");
    return;
  }
  const env = buildChildEnv({
    workspace: "/tmp/coc-workspace",
    repoRoot,
    campaignId: "haunting-1",
    parentEnv: {
      PATH: "/Applications/PipiUI.app/Contents/Resources/pipiui-embedded/pi/bin:/usr/bin",
      COC_PI_CLI: "/Applications/PipiUI.app/Contents/Resources/pipiui-embedded/pi/bin/pi",
      HOME: "/tmp",
    },
  });
  assert.equal(env.COC_PI_CLI, keeperCli);
  assert.ok(env.PATH.startsWith(path.join(repoRoot, "runtime", "adapters", "keeper", "node_modules", ".bin")));
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

test("mapRpcEventToSse surfaces a settled model error, but not a retry", () => {
  const failedAssistant = {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "400: Messages with role 'tool' must be a response",
  };
  assert.deepEqual(
    mapRpcEventToSse({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "user", content: "x" }, failedAssistant],
    }),
    [{
      event: "error",
      data: {
        message: "pi 模型调用失败：400: Messages with role 'tool' must be a response",
      },
    }],
  );
  assert.deepEqual(
    mapRpcEventToSse({ type: "agent_end", willRetry: true, messages: [failedAssistant] }),
    [],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", content: [{ type: "text", text: "好" }], stopReason: "stop" }],
    }),
    [],
  );
});

test("prompt emits a notice when a turn settles with no visible text", async () => {
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
  const promptP = host.prompt("调查地下室", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "叙事进了思考频道" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await promptP;
  assert.deepEqual(frames, [
    { event: "thinking", data: { text: "叙事进了思考频道" } },
    {
      event: "notice",
      data: {
        message:
          "本回合未产出玩家可见文本（模型可能把叙事写进了思考频道或回合未结算）；请重试同一行动。",
      },
    },
  ]);
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

test("attachOpening returns without replaying a turn that settled before the UI attached", async () => {
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
  assert.deepEqual(frames, []);
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

test("attachOpening replays the existing Pi assistant when the host stays idle", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-idle-"));
  try {
    const sessionDir = path.join(agentDir, "sessions", "cwd");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "2026-08-17T04-46-20Z_web-c1.jsonl"),
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "先告诉我：这个人是谁？" }],
        },
      })}\n`,
    );
    const child = fakeChild();
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "c1",
      sessionId: "web-c1",
      agentDir,
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    child.stderr.write(`${UI_IDLE_MARKER}\n`);
    const frames = [];
    const result = await host.attachOpening({
      onSse: (frame) => frames.push(frame),
    });
    assert.deepEqual(result, { opened: true });
    assert.deepEqual(frames, [{ event: "delta", data: { text: "先告诉我：这个人是谁？" } }]);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
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

function writtenCommands(written) {
  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("abort writes an abort command and unblocks a live attachOpening", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
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
  const attachP = host.attachOpening({ timeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 20));
  await host.abort();
  await assert.rejects(attachP, (err) => err.kind === "pi_coc_rpc_aborted");
  assert.equal(
    writtenCommands(written).some((row) => row.type === "abort"),
    true,
  );
});

test("abort unblocks prompt before agent_settled", { timeout: 2000 }, async () => {
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
  const promptP = host.prompt("我推开门", { timeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 20));
  const first = writtenCommands(written)[0];
  assert.equal(first.type, "prompt");
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await new Promise((r) => setTimeout(r, 20));
  await host.abort();
  await assert.rejects(promptP, (err) => err.kind === "pi_coc_rpc_aborted");
});

test("abort unblocks attachOpening while waiting for UI intent", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c1",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const attachP = host.attachOpening({ timeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 20));
  await host.abort();
  await assert.rejects(attachP, (err) => err.kind === "pi_coc_rpc_aborted");
});

test("mapRpcEventToSse treats process_exit 42 as setup handoff", () => {
  const frames = mapRpcEventToSse({
    type: "process_exit",
    code: HANDOFF_EXIT_CODE,
    signal: null,
    campaign_id: "c42",
  });
  assert.equal(frames[0].event, "coc_setup_handoff");
  assert.equal(frames[0].data.reason, "exit_42");
});

test("prompt settles on exit 42 instead of throwing during turn", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c42",
    sessionId: "web-c42",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const promptP = host.prompt("完成建卡");
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.emit("exit", HANDOFF_EXIT_CODE, null);
  await promptP;
  assert.equal(host.lastExitCode, HANDOFF_EXIT_CODE);
  assert.equal(host.isHandoffShutdown(), true);
});
