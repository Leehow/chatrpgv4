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
  applyVisionChildEnv,
  buildChildEnv,
  buildPiCocArgs,
  createJsonlParser,
  mapRpcEventToSse,
  PiCocRpcHost,
  PLAY_TABLE_OPENING_PROMPT,
  SETUP_CHARACTER_OPENING_MARKER,
  setupCharacterOpeningPrompt,
  sessionOpeningFlags,
  summarizeRpcDeath,
  tableIntentFromOpeningPhase,
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

test("sessionOpeningFlags reads the authoritative opening phase, not investigator files", () => {
  assert.deepEqual(sessionOpeningFlags({ spawned: true, phase: "character_creation" }), {
    character_setup: true,
    host_opening: true,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: false, phase: "character_creation" }), {
    character_setup: true,
    host_opening: false,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: false, phase: "ready_for_table" }), {
    character_setup: false,
    host_opening: false,
  });
  assert.deepEqual(sessionOpeningFlags({ spawned: true, phase: "active" }), {
    character_setup: false,
    host_opening: true,
  });
  // Source-gated module preparation is not character setup.
  assert.deepEqual(sessionOpeningFlags({ spawned: true, phase: "module_preparation" }), {
    character_setup: false,
    host_opening: true,
  });
  // Projection unavailable: the coc_session_role-derived intent decides.
  assert.deepEqual(
    sessionOpeningFlags({ spawned: false, phase: null, tableIntent: "character-setup" }),
    { character_setup: true, host_opening: false },
  );
  assert.deepEqual(
    sessionOpeningFlags({ spawned: false, phase: null, tableIntent: "continue" }),
    { character_setup: false, host_opening: false },
  );
});

test("tableIntentFromOpeningPhase follows the projection's session_role", () => {
  assert.equal(
    tableIntentFromOpeningPhase({
      phase: "character_creation",
      session_role: "setup",
      character_setup_confirmed: false,
    }),
    "character-setup",
  );
  assert.equal(
    tableIntentFromOpeningPhase({
      phase: "ready_for_table",
      session_role: "play",
      character_setup_confirmed: true,
    }),
    "continue",
  );
  assert.equal(
    tableIntentFromOpeningPhase({ phase: "active", session_role: "play" }),
    "continue",
  );
  // PDF module preparation is still a setup-side session.
  assert.equal(
    tableIntentFromOpeningPhase({ phase: "module_preparation", session_role: "setup" }),
    "character-setup",
  );
  // Drift-kill case: placeholder investigator files exist on disk, but the
  // authoritative phase still reports unconfirmed character creation. The old
  // resolveInvestigator directory scan would have answered "continue".
  assert.equal(
    tableIntentFromOpeningPhase({
      phase: "character_creation",
      session_role: "setup",
      character_setup_confirmed: false,
      campaign_status: "active",
    }),
    "character-setup",
  );
  assert.equal(tableIntentFromOpeningPhase(null), null);
  assert.equal(tableIntentFromOpeningPhase({}), null);
});

test("buildChildEnv marks an attached UI and play workspace", () => {
  const env = buildChildEnv({
    workspace: "/tmp/coc-workspace",
    repoRoot: "/tmp/missing-repo",
    campaignId: "haunting-1",
    tableIntent: "character-setup",
    parentEnv: { PATH: "/usr/bin", HOME: "/tmp" },
    userPrefs: {},
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
    userPrefs: {},
  });
  assert.equal(env.COC_PI_CLI, keeperCli);
  assert.ok(env.PATH.startsWith(path.join(repoRoot, "runtime", "adapters", "keeper", "node_modules", ".bin")));
});

test("buildChildEnv sets COC_PI_PDF_MODEL from vision prefs and never writes COC_PI_OPENING_MODEL", () => {
  const enabled = buildChildEnv({
    workspace: "/tmp/coc-workspace",
    repoRoot: "/tmp/missing-repo",
    campaignId: "haunting-1",
    parentEnv: {
      PATH: "/usr/bin",
      HOME: "/tmp",
      COC_PI_OPENING_MODEL: "deepseek/deepseek-v4-flash",
      COC_PI_PDF_MODEL: "stale/model",
    },
    userPrefs: {
      visionEnabled: true,
      visionProvider: "xai",
      visionModel: "grok-4.6",
    },
  });
  assert.equal(enabled.COC_PI_PDF_MODEL, "xai/grok-4.6");
  assert.equal(enabled.COC_PI_OPENING_MODEL, "deepseek/deepseek-v4-flash");

  const disabled = buildChildEnv({
    workspace: "/tmp/coc-workspace",
    repoRoot: "/tmp/missing-repo",
    parentEnv: {
      PATH: "/usr/bin",
      HOME: "/tmp",
      COC_PI_OPENING_MODEL: "deepseek/deepseek-v4-flash",
      COC_PI_PDF_MODEL: "stale/model",
    },
    userPrefs: { visionEnabled: false, visionProvider: "xai", visionModel: "grok-4.6" },
  });
  assert.equal(disabled.COC_PI_PDF_MODEL, undefined);
  assert.equal(disabled.COC_PI_OPENING_MODEL, "deepseek/deepseek-v4-flash");

  const env = { COC_PI_OPENING_MODEL: "keep-me", COC_PI_PDF_MODEL: "stale" };
  applyVisionChildEnv(env, {
    visionEnabled: true,
    visionProvider: "openai",
    visionModel: "gpt-5",
  });
  assert.equal(env.COC_PI_PDF_MODEL, "openai/gpt-5");
  assert.equal(env.COC_PI_OPENING_MODEL, "keep-me");
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
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "最终文本" }],
      },
    }),
    [
      { event: "delta_reset", data: {} },
      { event: "delta", data: { text: "最终文本" } },
    ],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "[in_game]\n正式开场。\n[/in_game]" }],
      },
    }),
    [
      { event: "delta_reset", data: {} },
      { event: "delta", data: { text: "正式开场。" } },
    ],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }] },
    }),
    [],
  );
});

test("mapRpcEventToSse keeps legacy tool frames compatible and strips scheduler meta", () => {
  const transport = {
    request_id: 17,
    execution_class: "parallel_read",
    queue_ms: 2.5,
    execute_ms: 40,
    parallel_read_width: 4,
    active_count: 2,
    fallback_reason: null,
  };
  assert.deepEqual(
    mapRpcEventToSse({
      type: "tool_execution_end",
      toolCallId: "call-parallel-1",
      toolName: "coc_invoke",
      args: { operation: "setup.phase" },
      result: { details: { ok: true, coc_transport: transport } },
    }),
    [{
      event: "tool",
      data: {
        phase: "end",
        tool: "setup.phase",
        tool_call_id: "call-parallel-1",
      },
    }],
  );
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

test("empty keeper-only message_end does not erase preceding visible narration", () => {
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "background readiness" }],
      },
    }),
    [],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "可见叙事" }],
      },
    }),
    [
      { event: "delta_reset", data: {} },
      { event: "delta", data: { text: "可见叙事" } },
    ],
  );
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

test("prompt stays attached across an extension-queued follow-up turn", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-follow-up",
    sessionId: "web-c-follow-up",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  let resolved = false;
  const promptP = host.prompt("确认开桌", {
    onSse: (frame) => frames.push(frame),
  }).then((value) => {
    resolved = true;
    return value;
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(resolved, false, "the first settle must not unlock the browser");
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "幕布正在升起。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await promptP;
  assert.deepEqual(frames, [{ event: "delta", data: { text: "幕布正在升起。" } }]);
});

test("promptPlayOpening writes the host opening prompt and requires a visible delta", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-open",
    sessionId: "web-c-open",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const openP = host.promptPlayOpening({
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  assert.equal(first.type, "prompt");
  assert.equal(first.message, PLAY_TABLE_OPENING_PROMPT);
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "雨夜里的科比特宅邸。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await openP;
  assert.equal(result.opened, true);
  assert.deepEqual(frames, [{ event: "delta", data: { text: "雨夜里的科比特宅邸。" } }]);
});

test("promptPlayOpening fails closed without visible player text", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-silent",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const openP = host.promptPlayOpening();
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await assert.rejects(
    openP,
    (err) => err.kind === "pi_coc_opening_not_visible"
      && err.message === "开桌会话未产出玩家可见文本。",
  );
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

test("attachOpening replays settled session assistant text without injecting", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-settled-"));
  try {
    const sessionDir = path.join(agentDir, "sessions", "cwd");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "2026-08-20T03-06-16Z_web-needs-inv.jsonl"),
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "先告诉我：这个人是谁？" }],
        },
      })}\n`,
    );
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "needs-inv",
      sessionId: "web-needs-inv",
      agentDir,
      tableIntent: "character-setup",
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    await new Promise((r) => setTimeout(r, 20));
    const frames = [];
    const result = await host.attachOpening({
      onSse: (frame) => frames.push(frame),
    });
    assert.deepEqual(result, { opened: true });
    assert.deepEqual(frames, [{ event: "delta", data: { text: "先告诉我：这个人是谁？" } }]);
    assert.equal(
      written.join("").split("\n").filter(Boolean).some((line) => JSON.parse(line).type === "prompt"),
      false,
    );
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
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

test("fresh character-setup opener resumes before source-gated contract", () => {
  const message = setupCharacterOpeningPrompt({
    campaignId: "pdf-fresh-bind",
    workspace: "/tmp/ws",
  });
  assert.match(message, new RegExp(SETUP_CHARACTER_OPENING_MARKER));
  assert.match(message, /coc_session_resume/);
  assert.match(message, /coc_setup_investigator_contract/);
  assert.match(message, /"tool":\s*"coc_session_resume"/);
  assert.match(message, /character_creation_unblocked=true/);
  assert.match(message, /Do not call investigator_contract until/i);
});

test("play-table opener still resumes an already-selected generation exactly once", () => {
  assert.equal(PLAY_TABLE_OPENING_PROMPT.match(/session\.resume/g)?.length, 1);
  assert.match(PLAY_TABLE_OPENING_PROMPT, /coc_evidence_table_opening/);
  assert.match(PLAY_TABLE_OPENING_PROMPT, /opening is already persisted/);
});

test("attachOpening character-setup injects one hidden prompt when auto-open is silent", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "needs-inv",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  const frames = [];
  const attachP = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 40));
  const cmds = written.join("").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].type, "prompt");
  assert.equal(
    cmds[0].message,
    setupCharacterOpeningPrompt({ campaignId: "needs-inv", workspace: path.resolve("/tmp/ws") }),
  );
  assert.match(cmds[0].message, new RegExp(SETUP_CHARACTER_OPENING_MARKER));
  assert.match(cmds[0].message, /coc_session_resume/);
  child.stdout.write(`${JSON.stringify({ id: cmds[0].id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "先告诉我：这个人是谁？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.equal(result.setupOpeningPrompted, true);
  assert.deepEqual(frames, [{ event: "delta", data: { text: "先告诉我：这个人是谁？" } }]);
  const again = await host.attachOpening();
  const cmdsAfter = written.join("").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(cmdsAfter.filter((row) => row.type === "prompt").length, 1);
  assert.deepEqual(again, { opened: true });
});

test("attachOpening with play intent (ready_for_table/active) never injects the setup opener", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "resumed-table",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  const result = await host.attachOpening();
  // Play reopen stays a resume: no hidden setup prompt is ever written.
  assert.deepEqual(result, { opened: false });
  assert.equal(
    written.join("").split("\n").filter(Boolean)
      .some((line) => JSON.parse(line).type === "prompt"),
    false,
  );
});

test("attachOpening character-setup does not inject when auto-open already has visible text", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "needs-inv",
    tableIntent: "character-setup",
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
    assistantMessageEvent: { type: "text_delta", delta: "先建卡：你是谁？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.deepEqual(result, { opened: true });
  assert.deepEqual(frames, [{ event: "delta", data: { text: "先建卡：你是谁？" } }]);
  assert.equal(
    written.join("").split("\n").filter(Boolean).some((line) => JSON.parse(line).type === "prompt"),
    false,
  );
});

test("attachOpening waits for source review follow-up instead of injecting a competing setup prompt", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "source-review",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: { details: { phase: "opening_source_review_required" } },
        }),
      }],
    },
  })}\n`);
  const frames = [];
  const attachP = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "罗马使团里，你是谁？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "罗马使团里，你是谁？" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.deepEqual(result, { opened: true });
  assert.equal(
    written.join("").split("\n").filter(Boolean)
      .some((line) => JSON.parse(line).type === "prompt"),
    false,
  );
  assert.equal(frames.at(-1)?.data?.text, "罗马使团里，你是谁？");
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

test("handoff opening fails without a visible delta and never emits the silent fallback", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-handoff",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attachP = host.attachOpening({
    onSse: (frame) => frames.push(frame),
    requireVisibleText: true,
  });
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await assert.rejects(
    attachP,
    (err) => err.kind === "pi_coc_opening_not_visible",
  );
  assert.equal(frames.some((frame) => frame.event === "notice"), false);
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

test("setup handoff event followed by agent_settled stays pending without a silent notice", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-event",
    sessionId: "web-c-event",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("完成建卡", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: { type: "coc_setup_handoff", campaign_id: "c-event" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await promptP;
  assert.equal(result.handoff, true);
  assert.deepEqual(frames.map((frame) => frame.event), ["coc_setup_handoff"]);
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
  const frames = [];
  const promptP = host.prompt("完成建卡", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.emit("exit", HANDOFF_EXIT_CODE, null);
  const result = await promptP;
  assert.equal(result.handoff, true);
  assert.equal(host.lastExitCode, HANDOFF_EXIT_CODE);
  assert.equal(host.isHandoffShutdown(), true);
  assert.equal(frames.some((frame) => frame.event === "notice"), false);
  assert.deepEqual(frames.map((frame) => frame.event), ["coc_setup_handoff"]);
});
