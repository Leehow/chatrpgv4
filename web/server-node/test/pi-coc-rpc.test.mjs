import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  EMPTY_PLAYER_TURN_KIND,
  EMPTY_PLAYER_TURN_MESSAGE,
  HANDOFF_EXIT_CODE,
  HOST_PI_EXTENSION_RELS,
  HOST_WEB_SEARCH_EXTENSION_REL,
  UI_AUTO_OPEN_MARKER,
  UI_IDLE_MARKER,
  applyVisionChildEnv,
  buildChildEnv,
  buildPiCocArgs,
  createJsonlParser,
  deliveryReceiptFromToolEvent,
  hostPiExtensionPaths,
  injectWebSearchKeysIntoEnv,
  mapRpcEventToSse,
  PiCocRpcHost,
  PLAY_TABLE_OPENING_PROMPT,
  PLAY_TURN_RECOVERY_PROMPT,
  isAgentAlreadyProcessingError,
  isUnfinalizedSilentTurn,
  observeUnfinalizedTurn,
  observeToolFailureStreak,
  isToolRetryExhausted,
  toolRetryExhaustedFault,
  TOOL_RETRY_LIMIT,
  TOOL_RETRY_EXHAUSTED_KIND,
  PiCocRpcError,
  resolveHostWebSearchExtension,
  resolvePiCocLauncher,
  SETUP_CHARACTER_OPENING_MARKER,
  setupCharacterOpeningPrompt,
  sessionOpeningFlags,
  summarizeRpcDeath,
  tableIntentFromOpeningPhase,
  webSessionId,
} from "../pi-coc-rpc.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HOST_WEB_SEARCH_EXTENSION = resolveHostWebSearchExtension(REPO_ROOT);

function canonicalTextSha256(text) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(text), "utf8")
    .digest("hex")}`;
}

function argsWithoutExtensions(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--extension") {
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function extensionPaths(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--extension" && args[i + 1]) {
      out.push(args[i + 1]);
      i += 1;
    }
  }
  return out;
}

test("already-processing reject is classified for attach recovery", () => {
  assert.equal(
    isAgentAlreadyProcessingError(new PiCocRpcError(
      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
      { kind: "pi_coc_rpc_rejected" },
    )),
    true,
  );
  assert.equal(
    isAgentAlreadyProcessingError(new PiCocRpcError("nope", { kind: "pi_coc_rpc_rejected" })),
    false,
  );
});

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
    argsWithoutExtensions(
      buildPiCocArgs({ campaignId: "haunting-1", sessionId: "web-haunting-1", repoRoot: REPO_ROOT }),
    ),
    ["--mode", "rpc", "--session-id", "web-haunting-1", "--campaign", "haunting-1"],
  );
});

test("buildPiCocArgs pins the selected model and exact supported thinking at startup", () => {
  assert.deepEqual(
    argsWithoutExtensions(
      buildPiCocArgs({
        campaignId: "haunting-1",
        sessionId: "web-haunting-1",
        provider: "jellytoken",
        model: "deepseek-v4-flash",
        thinking: "off",
        repoRoot: REPO_ROOT,
      }),
    ),
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

test("buildPiCocArgs mounts host web-search and hosted-search extensions that exist", () => {
  const required = hostPiExtensionPaths(REPO_ROOT);
  assert.equal(required.length, HOST_PI_EXTENSION_RELS.length);
  assert.deepEqual(required.map((p) => path.basename(p)), [
    "web-search.ts",
    "openai-server-tools.ts",
    "xai-server-tools.ts",
  ]);
  for (const abs of required) {
    assert.equal(path.isAbsolute(abs), true);
    assert.equal(fs.existsSync(abs), true, `missing host extension: ${abs}`);
  }
  assert.equal(required[0], HOST_WEB_SEARCH_EXTENSION);
  assert.equal(path.normalize(required[0]).endsWith(HOST_WEB_SEARCH_EXTENSION_REL), true);
  const args = buildPiCocArgs({
    campaignId: "haunting-1",
    sessionId: "web-haunting-1",
    repoRoot: REPO_ROOT,
  });
  assert.deepEqual(extensionPaths(args).slice(0, required.length), required);
  assert.doesNotMatch(JSON.stringify(args), /ApiKey|exa-/i);
});

test("pi-coc launcher forwards --extension into USER_ARGS instead of swallowing it", () => {
  const launcher = resolvePiCocLauncher(REPO_ROOT);
  const src = fs.readFileSync(launcher, "utf8");
  assert.match(src, /USER_ARGS=\(\)/);
  assert.match(src, /PI_ARGS\+=\("\$\{USER_ARGS\[@\]\}"\)/);
  assert.doesNotMatch(src, /--extension\)/);
  const start = src.indexOf("WANT_NEW=0");
  const loopStart = src.indexOf("USER_ARGS=()");
  const done = src.indexOf("\ndone\n", loopStart);
  assert.ok(start >= 0 && loopStart > start && done > loopStart);
  const loop = src.slice(start, done + "\ndone".length);
  const ext = HOST_WEB_SEARCH_EXTENSION;
  const run = spawnSync("bash", ["-s", "--",
    "--mode", "rpc",
    "--session-id", "web-haunting-1",
    "--campaign", "haunting-1",
    "--extension", ext,
  ], {
    encoding: "utf8",
    input: `${loop}\nprintf '%s\\n' "\${USER_ARGS[@]}"\n`,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const lines = run.stdout.split("\n").filter(Boolean);
  assert.deepEqual(lines, [
    "--mode",
    "rpc",
    "--session-id",
    "web-haunting-1",
    "--extension",
    ext,
  ]);
  assert.equal(lines.includes("--campaign"), false);
  assert.equal(lines.includes("haunting-1"), false);
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

test("terminal turn-processing fault maps to a typed SSE error, never narration", () => {
  const fault = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: "fault-campaign",
    turn_id: "turn-1",
    player_turn_epoch: 7,
    code: "state_claim_compiler_invalid",
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "result_invalid",
    requested_model: { provider: "xai", id: "grok-4.5", api: "openai-completions" },
    elapsed_ms: 1234,
    secret_extra: "must-not-leak",
  };
  const frames = mapRpcEventToSse({
    type: "custom_message",
    customType: "coc-turn-processing-fault",
    content: JSON.stringify(fault),
    details: fault,
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "error");
  assert.equal(frames[0].data.message, fault.message);
  assert.equal(frames[0].data.code, fault.code);
  assert.equal(frames[0].data.retryable, false);
  assert.deepEqual(frames[0].data.details.requested_model, fault.requested_model);
  assert.equal(frames[0].data.details.pending_turn_preserved, true);
  assert.equal("secret_extra" in frames[0].data.details, false);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
});

test("session-journal custom fault with data maps to the same typed SSE error", () => {
  const fault = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: "fault-campaign",
    turn_id: "turn-1",
    player_turn_epoch: 7,
    code: "state_claim_compiler_invalid",
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "result_invalid",
    requested_model: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
    elapsed_ms: 40573,
  };
  const frames = mapRpcEventToSse({
    type: "custom",
    customType: "coc-turn-processing-fault",
    data: fault,
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "error");
  assert.equal(frames[0].data.code, "state_claim_compiler_invalid");
  assert.equal(frames[0].data.details.pending_turn_preserved, true);
});

test("required-visible recovery preserves terminal typed fault instead of replacing it", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "typed-fault-recovery",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({
    requireVisibleText: true,
    onSse: (frame) => frames.push(frame),
  });
  const fault = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: "typed-fault-recovery",
    turn_id: "turn-retained",
    player_turn_epoch: 4,
    code: "state_claim_compiler_invalid",
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "result_invalid",
    requested_model: null,
    elapsed_ms: 55,
  };
  child.stdout.write(`${JSON.stringify({
    type: "custom_message",
    customType: "coc-turn-processing-fault",
    content: JSON.stringify(fault),
    details: fault,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.pending_turn_preserved === true,
  );
  assert.deepEqual(frames.map((frame) => frame.event), ["error"]);
  assert.equal(frames[0].data.code, "state_claim_compiler_invalid");
});

test("opening attach fails into stall recovery when the source-review wait goes silently dead", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "review-wait-stall",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
    turnIdleTimeoutMs: 150,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "t1",
    args: {},
    result: { ok: false, error: { code: "gate", phase: "opening_source_review_required" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  // No further stdout progress: the review latch stays armed and stdout goes
  // quiet far beyond the idle bound. The pre-fix behavior held the opening
  // SSE open until the whole 15-minute budget expired.
  await assert.rejects(
    host.attachOpening(),
    (error) => error.kind === "pi_coc_rpc_idle_timeout"
      && error.details?.idle_classification === "opening_review_wait_no_progress",
  );
});

test("opening attach completes normally when source review clears within the idle bound", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "review-wait-clears",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
    turnIdleTimeoutMs: 150,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "t2",
    args: {},
    result: { ok: false, error: { code: "gate", phase: "opening_source_review_required" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "custom_message",
    customType: "coc-opening-source-review-lifecycle",
    content: JSON.stringify({ status: "reviewed" }),
    details: { status: "reviewed" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "灯火未亮全，先把桌边的事说清楚。" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const opened = await host.attachOpening();
  assert.equal(opened.opened, true);
});

test("prompt raises a terminal turn fault only after relaying its one typed SSE error", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "typed-fault-prompt",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const prompted = host.prompt("玩家行动", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({
    id: request.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const fault = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: "typed-fault-prompt",
    turn_id: "turn-retained",
    player_turn_epoch: 2,
    code: "state_claim_compiler_invalid",
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "result_invalid",
    requested_model: null,
    elapsed_ms: 8,
  };
  child.stdout.write(`${JSON.stringify({
    type: "custom_message",
    customType: "coc-turn-processing-fault",
    content: JSON.stringify(fault),
    details: fault,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  await assert.rejects(
    prompted,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.pending_turn_preserved === true,
  );
  assert.deepEqual(frames.map((frame) => frame.event), ["error"]);
  assert.equal(frames[0].data.message, fault.message);
});

test("prompt settles a terminal turn fault immediately without waiting for agent_settled", { timeout: 3000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "typed-fault-immediate",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const prompted = host.prompt("我还在等钥匙", {
    timeoutMs: 2500,
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({
    id: request.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const fault = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    stage: "state_claim_compilation",
    campaign_id: "typed-fault-immediate",
    turn_id: "turn-retained",
    player_turn_epoch: 2,
    code: "state_claim_compiler_invalid",
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    retryable: false,
    will_retry: false,
    pending_turn_preserved: true,
    failure_class: "result_invalid",
    requested_model: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
    elapsed_ms: 40573,
  };
  child.stdout.write(`${JSON.stringify({
    type: "custom",
    customType: "coc-turn-processing-fault",
    data: fault,
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: {
      ok: false,
      tool: "narration.review",
      error: { code: "turn_processing_fault_latched" },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    result: { ok: true, tool: "state.journal", data: { turn_number: 2 } },
  })}\n`);

  await assert.rejects(
    prompted,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.pending_turn_preserved === true
      && error.details?.code === "state_claim_compiler_invalid",
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
  const commands = written.join("").trim().split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(commands.filter((row) => row.type === "prompt").length, 1);
  assert.equal(commands.some((row) => row.type === "abort"), true);
});

test("prompt aborts after three identical tool failures and names the tool", { timeout: 3000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "tool-retry-cap",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const prompted = host.prompt("继续等钥匙", {
    timeoutMs: 2500,
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({
    id: request.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const fail = {
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: {
      ok: false,
      tool: "narration.review",
      error: {
        code: "turn_processing_fault_latched",
        message: "this player turn has a terminal processing fault; recover the preserved turn before retrying",
      },
    },
  };
  child.stdout.write(`${JSON.stringify(fail)}\n`);
  child.stdout.write(`${JSON.stringify(fail)}\n`);
  child.stdout.write(`${JSON.stringify(fail)}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    result: { ok: true, tool: "turn.output_context", data: {} },
  })}\n`);

  await assert.rejects(
    prompted,
    (error) => error.kind === TOOL_RETRY_EXHAUSTED_KIND
      && /narration\.review/.test(error.message)
      && /turn_processing_fault_latched/.test(error.message),
  );
  const errors = frames.filter((frame) => frame.event === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].data.message, /narration\.review/);
  assert.match(errors[0].data.message, /turn_processing_fault_latched/);
  const commands = written.join("").trim().split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(commands.some((row) => row.type === "abort"), true);
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

test("buildChildEnv pins all Pi-Coc home variables to the exact repo home", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-rpc-home-ws-"));
  const repoRoot = path.join(workspace, "current-repo");
  const productAgentDir = path.join(workspace, "desktop-data", "pi-agent");
  const runtimeAgentDir = path.join(repoRoot, ".pi", "coc-agent");
  try {
    // Presence of a legacy workspace home must not redirect writable runtime
    // identity, even when PI_CODING_AGENT_DIR was inherited from elsewhere.
    fs.mkdirSync(path.join(workspace, ".pi", "agent"), { recursive: true });
    const env = buildChildEnv({
      workspace,
      repoRoot,
      campaignId: "home-pin",
      sessionId: "web-home-pin",
      agentDir: productAgentDir,
      parentEnv: {
        PATH: "/usr/bin",
        HOME: "/tmp",
        PI_AGENT_DIR: "/tmp/inherited-agent",
        PI_COC_AGENT_DIR: "/tmp/foreign-repo/.pi/coc-agent",
        PI_CODING_AGENT_DIR: path.join(workspace, ".pi", "agent"),
      },
      userPrefs: {},
    });
    assert.equal(env.PI_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(env.PI_CODING_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(env.PI_COC_AGENT_DIR, path.resolve(runtimeAgentDir));

    const inheritedProduct = path.join(workspace, "parent-product", "pi-agent");
    const inherited = buildChildEnv({
      workspace,
      repoRoot,
      campaignId: "home-pin-parent",
      parentEnv: {
        PATH: "/usr/bin",
        HOME: "/tmp",
        PI_AGENT_DIR: inheritedProduct,
        PI_CODING_AGENT_DIR: path.join(workspace, ".pi", "agent"),
      },
      userPrefs: {},
    });
    assert.equal(inherited.PI_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(inherited.PI_CODING_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(inherited.PI_COC_AGENT_DIR, path.resolve(runtimeAgentDir));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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

test("buildChildEnv injects EXA_API_KEY from web-search.json and does not overwrite a parent key", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-web-search-env-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-web-search-ws-"));
  const secret = "exa-test-secret-not-for-logs";
  try {
    fs.writeFileSync(
      path.join(agentDir, "web-search.json"),
      `${JSON.stringify({ exaApiKey: secret, workflow: "none" }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const env = buildChildEnv({
      workspace,
      repoRoot: "/tmp/missing-repo",
      campaignId: "haunting-1",
      agentDir,
      parentEnv: { PATH: "/usr/bin", HOME: "/tmp", PI_AGENT_DIR: agentDir },
      userPrefs: {},
    });
    assert.equal(env.EXA_API_KEY, secret);
    const pinned = buildChildEnv({
      workspace,
      repoRoot: "/tmp/missing-repo",
      campaignId: "haunting-1",
      agentDir,
      parentEnv: {
        PATH: "/usr/bin",
        HOME: "/tmp",
        PI_AGENT_DIR: agentDir,
        EXA_API_KEY: "parent-wins",
      },
      userPrefs: {},
    });
    assert.equal(pinned.EXA_API_KEY, "parent-wins");
    const args = buildPiCocArgs({
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      repoRoot: REPO_ROOT,
    });
    assert.equal(JSON.stringify(args).includes(secret), false);
    const view = injectWebSearchKeysIntoEnv({}, { keyDirs: [agentDir] });
    assert.equal(view.EXA_API_KEY, secret);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildChildEnv injects Tavily and Perplexity keys plus routing without echoing secrets in args", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-web-search-tvly-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-web-search-tvly-ws-"));
  const tavilySecret = "tvly-child-secret-not-for-logs";
  const pplxSecret = "pplx-child-secret-not-for-logs";
  try {
    fs.writeFileSync(
      path.join(agentDir, "web-search.json"),
      `${JSON.stringify({
        tavilyApiKey: tavilySecret,
        perplexityApiKey: pplxSecret,
        searchRouting: { providers: ["tavily", "perplexity", "exa"] },
        workflow: "none",
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const env = buildChildEnv({
      workspace,
      repoRoot: "/tmp/missing-repo",
      campaignId: "haunting-1",
      agentDir,
      parentEnv: { PATH: "/usr/bin", HOME: "/tmp", PI_AGENT_DIR: agentDir },
      userPrefs: {},
    });
    assert.equal(env.TAVILY_API_KEY, tavilySecret);
    assert.equal(env.PERPLEXITY_API_KEY, pplxSecret);
    assert.equal(env.WEB_SEARCH_ROUTING, "tavily,perplexity,exa");
    const pinned = buildChildEnv({
      workspace,
      repoRoot: "/tmp/missing-repo",
      campaignId: "haunting-1",
      agentDir,
      parentEnv: {
        PATH: "/usr/bin",
        HOME: "/tmp",
        PI_AGENT_DIR: agentDir,
        TAVILY_API_KEY: "parent-tavily",
        PERPLEXITY_API_KEY: "parent-pplx",
      },
      userPrefs: {},
    });
    assert.equal(pinned.TAVILY_API_KEY, "parent-tavily");
    assert.equal(pinned.PERPLEXITY_API_KEY, "parent-pplx");
    const args = buildPiCocArgs({
      campaignId: "haunting-1",
      sessionId: "web-haunting-1",
      repoRoot: REPO_ROOT,
    });
    const argsText = JSON.stringify(args);
    assert.equal(argsText.includes(tavilySecret), false);
    assert.equal(argsText.includes(pplxSecret), false);
    const view = injectWebSearchKeysIntoEnv({}, { keyDirs: [agentDir] });
    assert.equal(view.TAVILY_API_KEY, tavilySecret);
    assert.equal(view.PERPLEXITY_API_KEY, pplxSecret);
    assert.equal(view.WEB_SEARCH_ROUTING, "tavily,perplexity,exa");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("PiCocRpcHost start passes existing host extension paths into spawn args", () => {
  let captured;
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: REPO_ROOT,
    workspace: "/tmp/ws",
    campaignId: "c-ext",
    sessionId: "web-c-ext",
    launcherPath: process.execPath,
    spawnFn: (cmd, args, opts) => {
      captured = { cmd, args, env: opts.env };
      return child;
    },
  });
  host.start();
  const required = hostPiExtensionPaths(REPO_ROOT);
  for (const abs of required) {
    assert.equal(fs.existsSync(abs), true, `missing host extension: ${abs}`);
  }
  assert.deepEqual(extensionPaths(captured.args).slice(0, required.length), required);
});

test("PiCocRpcHost separates repo runtime writes from legacy transcript hydration", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "coc-rpc-home-host-ws-"));
  const repoRoot = path.join(workspace, "current-repo");
  const productAgentDir = path.join(workspace, "desktop-data", "pi-agent");
  const runtimeAgentDir = path.join(repoRoot, ".pi", "coc-agent");
  const sessionId = "web-runtime-home-pin";
  try {
    const legacySessionDir = path.join(workspace, ".pi", "agent", "sessions", "cwd");
    fs.mkdirSync(legacySessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacySessionDir, `2026-08-21T00-00-00Z_${sessionId}.jsonl`),
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "旧记录仍可显示。" }],
        },
      })}\n`,
    );
    let capturedEnv;
    const child = fakeChild();
    const host = new PiCocRpcHost({
      repoRoot,
      workspace,
      campaignId: "runtime-home-pin",
      sessionId,
      agentDir: productAgentDir,
      launcherPath: process.execPath,
      spawnFn: (_cmd, _args, options) => {
        capturedEnv = options.env;
        return child;
      },
    });
    assert.equal(host.agentDir, path.resolve(productAgentDir));
    assert.equal(host.runtimeAgentDir, path.resolve(runtimeAgentDir));
    host.start();
    assert.equal(capturedEnv.PI_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(capturedEnv.PI_CODING_AGENT_DIR, path.resolve(runtimeAgentDir));
    assert.equal(capturedEnv.PI_COC_AGENT_DIR, path.resolve(runtimeAgentDir));
    child.stderr.write(`${UI_IDLE_MARKER}\n`);
    const frames = [];
    const result = await host.attachOpening({
      onSse: (frame) => frames.push(frame),
    });
    assert.deepEqual(result, { opened: true });
    assert.deepEqual(frames, [{ event: "delta", data: { text: "旧记录仍可显示。" } }]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
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

test("mapRpcEventToSse buffers draft text and forwards only settled text", () => {
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_update",
      usage: { input: 12, output: 3 },
      assistantMessageEvent: { type: "text_delta", delta: "你好" },
    }),
    [
      { event: "usage", data: { input: 12, output: 3 } },
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
    [{ event: "delta", data: { text: "最终文本" } }],
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "[in_game]\n正式开场。\n[/in_game]" }],
      },
    }),
    [{ event: "delta", data: { text: "正式开场。" } }],
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

test("prompt fails a silent settle without inventing text or emitting notice", async () => {
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
  await assert.rejects(
    promptP,
    (err) => err.kind === EMPTY_PLAYER_TURN_KIND
      && err.message === EMPTY_PLAYER_TURN_MESSAGE,
  );
  assert.deepEqual(frames, [
    { event: "thinking", data: { text: "叙事进了思考频道" } },
  ]);
});

test("observeToolFailureStreak trips after three identical tool failures", () => {
  const fail = {
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: {
      ok: false,
      tool: "narration.review",
      error: {
        code: "turn_processing_fault_latched",
        message: "this player turn has a terminal processing fault; recover the preserved turn before retrying",
      },
    },
  };
  let state = observeToolFailureStreak(fail);
  assert.equal(isToolRetryExhausted(state), false);
  state = observeToolFailureStreak(fail, state);
  assert.equal(isToolRetryExhausted(state), false);
  state = observeToolFailureStreak(fail, state);
  assert.equal(isToolRetryExhausted(state), true);
  assert.equal(state.tool, "narration.review");
  assert.equal(state.code, "turn_processing_fault_latched");
  assert.equal(state.count, TOOL_RETRY_LIMIT);
  const frame = toolRetryExhaustedFault(state);
  assert.equal(frame.event, "error");
  assert.match(frame.data.message, /narration\.review/);
  assert.match(frame.data.message, /turn_processing_fault_latched/);
  assert.match(frame.data.message, /3 次/);
  assert.equal(frame.data.code, TOOL_RETRY_EXHAUSTED_KIND);
});

test("observeToolFailureStreak does not mix different tools or codes", () => {
  const review = {
    type: "tool_execution_end",
    result: {
      ok: false,
      tool: "narration.review",
      error: { code: "turn_processing_fault_latched" },
    },
  };
  const finalize = {
    type: "tool_execution_end",
    result: {
      ok: false,
      tool: "turn.finalize",
      error: { code: "narration_review_required" },
    },
  };
  let state = observeToolFailureStreak(review);
  state = observeToolFailureStreak(review, state);
  state = observeToolFailureStreak(finalize, state);
  assert.equal(isToolRetryExhausted(state), false);
  assert.equal(state.tool, "turn.finalize");
  assert.equal(state.count, 1);
  state = observeToolFailureStreak({
    type: "tool_execution_end",
    result: { ok: true, tool: "turn.finalize", data: {} },
  }, state);
  assert.equal(state.count, 0);
});

test("observeUnfinalizedTurn treats failed finalize without delivery as unfinalized", () => {
  let state = observeUnfinalizedTurn({
    type: "tool_execution_end",
    result: { ok: true, tool: "state.journal", data: { turn_number: 2 } },
  });
  assert.equal(isUnfinalizedSilentTurn(state), true);
  state = observeUnfinalizedTurn({
    type: "tool_execution_end",
    result: {
      ok: false,
      tool: "turn.finalize",
      error: "narration_review_required",
    },
  }, state);
  assert.equal(isUnfinalizedSilentTurn(state), true);
  state = observeUnfinalizedTurn({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "fin-ok",
        rendered_text: "钥匙到了。",
        rendered_sha256: canonicalTextSha256("钥匙到了。"),
      },
    },
  }, state);
  assert.equal(isUnfinalizedSilentTurn(state), false);
});

test("prompt recovers an unfinalized silent settle without repeating player input", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "unfinalized-silent",
    sessionId: "web-unfinalized-silent",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("我坐着等钥匙", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    result: { ok: true, tool: "state.journal", data: { turn_number: 2 } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    result: { ok: false, tool: "turn.finalize", error: "narration_review_required" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 1_700));
  const promptRows = written.join("").trim().split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.type === "prompt");
  assert.equal(promptRows.length, 2);
  assert.equal(promptRows[0].message, "我坐着等钥匙");
  assert.equal(promptRows[1].message, PLAY_TURN_RECOVERY_PROMPT);
  const second = promptRows[1];
  child.stdout.write(`${JSON.stringify({ id: second.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "诺特把钥匙推过来。" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  try {
    const result = await promptP;
    assert.equal(result.sawPlayerText, true);
    assert.equal(frames.some((frame) => frame.event === "delta" && frame.data?.text === "诺特把钥匙推过来。"), true);
    assert.equal(frames.some((frame) => frame.event === "error"), false);
  } finally {
    await host.close({ protocolAbort: false });
  }
});

test("prompt resolves unchanged when a visible delta arrives", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "c-visible",
    sessionId: "web-c-visible",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("我推开门", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({ id: first.id, type: "response", command: "prompt", success: true })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "门轴发出一声干涩的吱呀。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "门轴发出一声干涩的吱呀。" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await promptP;
  assert.equal(result.sawPlayerText, true);
  assert.equal(result.sawError, false);
  assert.deepEqual(frames, [
    { event: "delta", data: { text: "门轴发出一声干涩的吱呀。" } },
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
    [{ event: "delta", data: { text: "可见叙事" } }],
  );
});

test("finalization delivery metadata is extracted only from exact canonical receipts", () => {
  const renderedText = "精确结算文本";
  const renderedSha256 = canonicalTextSha256(renderedText);
  const receipt = deliveryReceiptFromToolEvent({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          tool: "turn.finalize",
          data: {
            finalization_id: "finalization-1",
            rendered_text: renderedText,
            rendered_sha256: renderedSha256,
          },
        }),
      }],
    },
  });
  assert.deepEqual(receipt, {
    finalizationId: "finalization-1",
    renderedText,
    renderedSha256,
  });
  assert.equal(deliveryReceiptFromToolEvent({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "finalization-forged-digest",
        rendered_text: renderedText,
        rendered_sha256: `sha256:${"0".repeat(64)}`,
      },
    },
  }), null);
  for (const [finalizationId, emptyText] of [
    ["", renderedText],
    ["finalization-empty-text", ""],
  ]) {
    assert.equal(deliveryReceiptFromToolEvent({
      type: "tool_execution_end",
      toolName: "coc_turn_finalize",
      result: {
        ok: true,
        tool: "turn.finalize",
        data: {
          finalization_id: finalizationId,
          rendered_text: emptyText,
          rendered_sha256: canonicalTextSha256(emptyText),
        },
      },
    }), null);
  }
  assert.equal(deliveryReceiptFromToolEvent({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: { ok: false, error: { code: "no_unfinalized_journal" } },
  }), null);
});

test("host offers delivery acknowledgement only after exact finalization text reaches SSE", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "delivery-campaign",
    sessionId: "web-delivery-campaign",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const prompt = host.prompt("继续", { onSse: () => true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const request = JSON.parse(written[0].trim());
  child.stdout.write(`${JSON.stringify({
    id: request.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "finalization-delivery",
        rendered_text: "精确交付",
        rendered_sha256: canonicalTextSha256("精确交付"),
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "精确交付" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await prompt;
  assert.equal(host.offerStreamedDelivery(() => false), null);
  assert.deepEqual(host.offerStreamedDelivery(() => true), {
    finalizationId: "finalization-delivery",
    renderedText: "精确交付",
    renderedSha256: canonicalTextSha256("精确交付"),
  });
  assert.equal(host.takeStreamedDelivery(), null);
});

test("turn recovery exposes delivery only when the SSE client accepted its text", async (t) => {
  for (const accepted of [false, true]) {
    await t.test(`accepted=${accepted}`, async () => {
      const child = fakeChild();
      const written = [];
      child.stdin.on("data", (chunk) => written.push(String(chunk)));
      const host = new PiCocRpcHost({
        repoRoot: "/tmp/missing-repo",
        workspace: "/tmp/ws",
        campaignId: `recovery-delivery-${accepted}`,
        sessionId: `web-recovery-delivery-${accepted}`,
        launcherPath: process.execPath,
        spawnFn: () => child,
      });
      host.start();
      const prompt = host.promptTurnRecovery({ onSse: () => accepted });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const request = JSON.parse(written[0].trim());
      child.stdout.write(`${JSON.stringify({
        id: request.id, type: "response", command: "prompt", success: true,
      })}\n`);
      child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
      child.stdout.write(`${JSON.stringify({
        type: "tool_execution_end",
        toolName: "coc_turn_finalize",
        result: {
          ok: true,
          tool: "turn.finalize",
          data: {
            finalization_id: `recovery-finalization-${accepted}`,
            rendered_text: "恢复结算文本",
            rendered_sha256: canonicalTextSha256("恢复结算文本"),
          },
        },
      })}\n`);
      child.stdout.write(`${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "恢复结算文本" }],
        },
      })}\n`);
      child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

      await prompt;
      const delivery = host.takeStreamedDelivery();
      if (accepted) {
        assert.equal(delivery?.finalizationId, "recovery-finalization-true");
      } else {
        assert.equal(delivery, null, "disconnected delivery stays pending for replay");
      }
    });
  }
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
    child.emit("close", 0, null);
  };
  return child;
}

test("PiCocRpcHost does not re-submit the model already pinned at startup", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "model-pin",
    sessionId: "web-model-pin",
    launcherPath: process.execPath,
    provider: "zai-coding-cn",
    model: "glm-5.3",
    spawnFn: () => child,
  });
  host.start();

  await host.setModel("zai-coding-cn", "glm-5.3");
  assert.deepEqual(written, []);

  const switched = host.setModel("jellytoken", "deepseek-v4-flash");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(written.length, 1);
  const request = JSON.parse(written[0].trim());
  assert.deepEqual(
    { type: request.type, provider: request.provider, modelId: request.modelId },
    { type: "set_model", provider: "jellytoken", modelId: "deepseek-v4-flash" },
  );
  child.stdout.write(`${JSON.stringify({ id: request.id, type: "response", success: true })}\n`);
  await switched;

  await host.setModel("jellytoken", "deepseek-v4-flash");
  assert.equal(written.length, 1);
});

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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "好。" }] },
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "幕布正在升起。" }] },
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "雨夜里的科比特宅邸。" }] },
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

test("attachOpening replays only current-child output settled before UI attach", async () => {
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先建卡" }] },
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
  assert.match(PLAY_TABLE_OPENING_PROMPT, /pending turn/);
  assert.match(PLAY_TABLE_OPENING_PROMPT, /awaiting_player/);
  assert.match(PLAY_TABLE_OPENING_PROMPT, /Never replay an older assistant opening/);
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
    uiIntentConfirmMs: 0,
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先告诉我：这个人是谁？" }] },
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

test("attachOpening with play intent fails closed when resume continuation never starts", async () => {
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
  await assert.rejects(
    host.attachOpening(),
    (error) => error.kind === "pi_coc_play_resume_not_started",
  );
  assert.equal(
    written.join("").split("\n").filter(Boolean)
      .some((line) => JSON.parse(line).type === "prompt"),
    false,
  );
});

test("attachOpening accepts a silent resume continuation that settled during the UI-intent wait", async () => {
  // Live race: the current child's auto-open continuation
  // (agent_start -> session.resume -> agent_settled) runs and settles while
  // attachOpening is still awaiting UI intent — stdout events and the stderr
  // auto-open marker are unordered streams, so the whole turn can complete
  // before the marker is observed. The exact host-local resume receipt plus
  // the settled agent turn is the canonical proof of the continuation.
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-resume-race-"));
  try {
    const sessionDir = path.join(agentDir, "sessions", "cwd");
    fs.mkdirSync(sessionDir, { recursive: true });
    // Historical public assistant transcript: must never be replayed for a
    // live-turn resume continuation.
    fs.writeFileSync(
      path.join(sessionDir, "2026-08-24T00-00-00Z_web-resume-race.jsonl"),
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "旧的开场叙述" }],
        },
      })}\n`,
    );
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "resume-race",
      sessionId: "web-resume-race",
      agentDir,
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    const frames = [];
    const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
    await new Promise((r) => setTimeout(r, 30));
    // The continuation settles completely inside the UI-intent wait.
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_start",
      toolName: "coc_session_resume",
      toolCallId: "resume-race-1",
      args: {},
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_session_resume",
      toolCallId: "resume-race-1",
      result: {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: "resume-race",
          mode: "already_acknowledged",
        },
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    await new Promise((r) => setTimeout(r, 20));
    // The auto-open marker lands after the continuation already settled.
    child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
    assert.deepEqual(await attached, { opened: true });
    assert.equal(frames.some((frame) => frame.event === "delta"), false);
    assert.equal(JSON.stringify(frames).includes("旧的开场叙述"), false);
    const commands = written.join("").split("\n").filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(commands.some((row) => row.type === "prompt"), false);
    // Exactly one resume tool execution relayed; no mutation, finalization,
    // or other tool activity appears.
    assert.deepEqual(frames.filter((frame) => frame.event === "tool"), [
      { event: "tool", data: { phase: "start", tool: "coc_session_resume", tool_call_id: "resume-race-1" } },
      { event: "tool", data: { phase: "end", tool: "coc_session_resume", tool_call_id: "resume-race-1" } },
    ]);
    const again = await host.attachOpening();
    assert.deepEqual(again, { opened: true });
    assert.equal(
      written.join("").split("\n").filter(Boolean)
        .filter((line) => JSON.parse(line).type === "prompt").length,
      0,
    );
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("attachOpening does not accept a settled silent resume for another campaign", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "resume-race",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const attached = host.attachOpening({ onSse: () => {} });
  await new Promise((r) => setTimeout(r, 30));
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: "other-campaign",
        mode: "already_acknowledged",
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_play_resume_not_started",
  );
  assert.equal(written.join("").includes('"type":"prompt"'), false);
});

test("attachOpening rejects an idle resume result legitimized only by an unrelated later turn", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "resume-race",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const attached = host.attachOpening({ onSse: () => {} });
  await new Promise((r) => setTimeout(r, 30));
  // Canonical successful resume envelope for the exact bound campaign, but
  // received while no observed agent turn is streaming: it can never be
  // bound to a producing turn.
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: "resume-race",
        mode: "already_acknowledged",
      },
    },
  })}\n`);
  // An unrelated later turn starts and settles; it must not adopt the idle
  // receipt as proof of its own resume continuation.
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_play_resume_not_started",
  );
  assert.equal(written.join("").includes('"type":"prompt"'), false);
});

test("attachOpening does not accept noncanonical resume receipts as silent proof", async () => {
  // pending_finalization keeps its own finalize-or-fault contract; exact
  // campaign identity and the canonical schema are mandatory — missing or
  // non-string campaign_id and noncanonical schema_version never qualify.
  for (const data of [
    { schema_version: 1, campaign_id: "resume-race", mode: "pending_finalization" },
    { schema_version: 1, campaign_id: "resume-race", mode: "table_opening" },
    { schema_version: 1, mode: "already_acknowledged" },
    { schema_version: 1, campaign_id: 123, mode: "awaiting_player" },
    { schema_version: 2, campaign_id: "resume-race", mode: "awaiting_player" },
    { campaign_id: "resume-race", mode: "awaiting_player" },
  ]) {
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "resume-race",
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    const attached = host.attachOpening({ onSse: () => {} });
    await new Promise((r) => setTimeout(r, 30));
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_session_resume",
      result: { ok: true, tool: "session.resume", data },
    })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    child.stderr.write(`${UI_IDLE_MARKER}\n`);
    await assert.rejects(
      attached,
      (error) => error.kind === "pi_coc_play_resume_not_started",
    );
    assert.equal(written.join("").includes('"type":"prompt"'), false);
  }
});

test("attachOpening does not accept a failed resume envelope as silent proof", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "resume-race",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const attached = host.attachOpening({ onSse: () => {} });
  await new Promise((r) => setTimeout(r, 30));
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: {
      ok: false,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: "resume-race",
        mode: "already_acknowledged",
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_play_resume_not_started",
  );
  assert.equal(written.join("").includes('"type":"prompt"'), false);
});

test("ordinary play reopen settles silently after resume awaiting_player", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "awaiting-player",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_start",
    toolName: "coc_session_resume",
    toolCallId: "resume-awaiting",
    args: {},
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    toolCallId: "resume-awaiting",
    result: { ok: true, tool: "session.resume", data: { mode: "awaiting_player" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.deepEqual(await attached, { opened: true });
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
  assert.deepEqual(frames.filter((frame) => frame.event === "tool"), [
    { event: "tool", data: { phase: "start", tool: "coc_session_resume", tool_call_id: "resume-awaiting" } },
    { event: "tool", data: { phase: "end", tool: "coc_session_resume", tool_call_id: "resume-awaiting" } },
  ]);
  assert.equal(written.join("").includes('"type":"prompt"'), false);
});

test("pending-finalization reopen requires canonical finalize and exact delivery before success", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-pi-pending-reopen-"));
  try {
    const sessionDir = path.join(agentDir, "sessions", "cwd");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "2026-08-23T00-00-00Z_web-pending.jsonl"),
      [
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "旧的正式开场" }] },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: "要求20美元预付款" },
        }),
      ].join("\n") + "\n",
    );
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "pending",
      sessionId: "web-pending",
      agentDir,
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    const frames = [];
    const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_session_resume",
      result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_narration_review",
      result: { ok: true, tool: "narration.review", data: { review_id: "review-ok" } },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    await assert.rejects(
      attached,
      (error) => error.kind === "pi_coc_turn_processing_fault"
        && error.details?.code === "turn_finalization_obligation_unmet"
        && error.details?.pending_turn_preserved === true,
    );
    assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
    assert.equal(frames.some((frame) => frame.event === "delta"), false);
    assert.equal(JSON.stringify(frames).includes("旧的正式开场"), false);
    assert.equal(written.join("").includes("要求20美元预付款"), false);
    assert.equal(written.join("").includes('"type":"prompt"'), false);

    const recoveredChild = fakeChild();
    const recovered = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "pending",
      sessionId: "web-pending",
      agentDir,
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => recoveredChild,
    });
    recovered.start();
    recoveredChild.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
    recoveredChild.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    const recoveredFrames = [];
    const reopened = recovered.attachOpening({
      onSse: (frame) => recoveredFrames.push(frame),
    });
    recoveredChild.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_session_resume",
      result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
    })}\n`);
    recoveredChild.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_turn_finalize",
      result: {
        ok: true,
        tool: "turn.finalize",
        data: {
          finalization_id: "pending-finalization-recovered",
          rendered_text: "诺特把预付款和钥匙推到你面前。",
          rendered_sha256: canonicalTextSha256("诺特把预付款和钥匙推到你面前。"),
        },
      },
    })}\n`);
    recoveredChild.stdout.write(`${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "诺特把预付款和钥匙推到你面前。" }],
      },
    })}\n`);
    recoveredChild.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

    assert.deepEqual(await reopened, { opened: true });
    assert.deepEqual(
      recoveredFrames.filter((frame) => frame.event === "delta"),
      [{ event: "delta", data: { text: "诺特把预付款和钥匙推到你面前。" } }],
    );
    assert.equal(recoveredFrames.filter((frame) => frame.event === "error").length, 0);
    assert.equal(recovered.takeStreamedDelivery()?.finalizationId, "pending-finalization-recovered");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("pre-attach open-turn recovery cannot replay an unfinalized settlement as success", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "pre-attach-open-turn-recovery",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "open_turn_recovery" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: { ok: true, tool: "narration.review", data: { review_id: "pre-attach-review" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const frames = [];
  await assert.rejects(
    host.attachOpening({ onSse: (frame) => frames.push(frame) }),
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.recovery_mode === "open_turn_recovery",
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
});

test("pre-attach pending-finalization obligation survives into the live settle wait", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "pre-attach-pending-finalization-race",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const frames = [];
  const attached = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: { ok: true, tool: "narration.review", data: { review_id: "pre-attach-race-review" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.code === "turn_finalization_obligation_unmet"
      && error.details?.recovery_mode === "pending_finalization",
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
});

test("pre-attach pending-finalization accepts one exact finalized delivery", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "pre-attach-pending-finalization-success",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const renderedText = "恢复后的唯一精确交付。";
  const renderedSha256 = canonicalTextSha256(renderedText);
  const frames = [];
  const attached = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "pre-attach-finalization-success",
        rendered_text: renderedText,
        rendered_sha256: renderedSha256,
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: renderedText }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  assert.deepEqual(await attached, { opened: true });
  assert.deepEqual(
    frames.filter((frame) => frame.event === "delta"),
    [{ event: "delta", data: { text: renderedText } }],
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 0);
  assert.deepEqual(host.takeStreamedDelivery(), {
    finalizationId: "pre-attach-finalization-success",
    renderedText,
    renderedSha256,
  });
  assert.equal(host.takeStreamedDelivery(), null);
});

test("invalid finalization digest cannot satisfy a recovery obligation", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "invalid-finalization-digest",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "invalid-finalization-digest",
        rendered_text: "摘要与文本不一致。",
        rendered_sha256: `sha256:${"0".repeat(64)}`,
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "摘要与文本不一致。" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.code === "turn_finalization_obligation_unmet"
      && error.details?.finalization_receipt_observed === false,
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
  assert.equal(host.takeStreamedDelivery(), null);
});

test("recovery delivery rejected by a disconnected attach stream cannot report success", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "disconnected-recovery-delivery",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({
    onSse: (frame) => {
      frames.push(frame);
      return frame.event !== "delta";
    },
  });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_turn_finalize",
    result: {
      ok: true,
      tool: "turn.finalize",
      data: {
        finalization_id: "disconnected-finalization",
        rendered_text: "恢复后的精确文本",
        rendered_sha256: canonicalTextSha256("恢复后的精确文本"),
      },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "恢复后的精确文本" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.finalization_receipt_observed === true
      && error.details?.delivery_observed === false,
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(host.takeStreamedDelivery(), null);
});

test("RPC EOF with a pending recovery finalization obligation is a typed fault", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "recovery-eof",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    result: { ok: true, tool: "narration.review", data: { review_id: "review-before-eof" } },
  })}\n`);
  child.emit("exit", 1, null);
  child.emit("close", 1, null);

  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_turn_processing_fault"
      && error.details?.code === "turn_finalization_obligation_unmet",
  );
  assert.equal(frames.filter((frame) => frame.event === "error").length, 1);
  assert.equal(frames.some((frame) => frame.event === "delta"), false);
});

test("explicit setup handoff may transfer an armed recovery obligation", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "recovery-handoff",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "open_turn_recovery" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "recovery-handoff",
      receipt: { decision_id: "recovery-handoff" },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  assert.deepEqual(await attached, { opened: true });
  assert.equal(frames.filter((frame) => frame.event === "error").length, 0);
  assert.equal(frames.filter((frame) => frame.event === "coc_setup_handoff").length, 1);
});

test("genuine table opening delivers the receipt text exactly once", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "new-table-opening",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    result: { ok: true, tool: "session.resume", data: { mode: "table_opening" } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_evidence_table_opening",
    result: { ok: true, tool: "evidence.table_opening" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "十月的雨落在波士顿街头。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "十月的雨落在波士顿街头。" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.deepEqual(await attached, { opened: true });
  assert.deepEqual(frames.filter((frame) => frame.event === "delta"), [{
    event: "delta",
    data: { text: "十月的雨落在波士顿街头。" },
  }]);
  const secondFrames = [];
  assert.deepEqual(await host.attachOpening({
    onSse: (frame) => secondFrames.push(frame),
  }), { opened: true });
  assert.deepEqual(secondFrames, []);
});

test("concurrent play attaches join one continuation and do not duplicate SSE delivery", async () => {
  const child = fakeChild();
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "attach-singleflight",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const firstFrames = [];
  const secondFrames = [];
  const first = host.attachOpening({ onSse: (frame) => firstFrames.push(frame) });
  const second = host.attachOpening({ onSse: (frame) => secondFrames.push(frame) });
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "仅交付一次" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "仅交付一次" }],
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.deepEqual(await Promise.all([first, second]), [
    { opened: true },
    { opened: true },
  ]);
  assert.deepEqual(firstFrames, [{ event: "delta", data: { text: "仅交付一次" } }]);
  assert.deepEqual(secondFrames, []);
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先建卡：你是谁？" }] },
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

test("attachOpening joins an in-flight auto-open instead of failing already-processing", async () => {
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
    setupOpeningFollowUpMs: 80,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attachP = host.attachOpening({
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 250));
  const cmds = writtenCommands(written).filter((row) => row.type === "prompt");
  assert.equal(cmds.length, 1);
  child.stdout.write(`${JSON.stringify({
    id: cmds[0].id,
    type: "response",
    command: "prompt",
    success: false,
    error: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
  })}\n`);
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "你想成为怎样的人？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "你想成为怎样的人？" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.equal(result.opened, true);
  assert.equal(
    frames.some((frame) => frame.data?.text === "你想成为怎样的人？"),
    true,
  );
});

test("host-owned prompt joins auto-open instead of writing a competing prompt", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "host-owned-join",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
    setupOpeningFollowUpMs: 80,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  await new Promise((r) => setTimeout(r, 10));
  const frames = [];
  const promptP = host.prompt("不得抢开桌", {
    hostOwned: true,
    failIfSilent: false,
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "prompt").length,
    0,
  );
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "先告诉我：你是谁？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先告诉我：你是谁？" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await promptP;
  assert.equal(result.attachedToInFlight, true);
  assert.equal(
    frames.some((frame) => frame.data?.text === "先告诉我：你是谁？"),
    true,
  );
});

test("attachOpening does not inject when auto-open follow-up starts after a silent settle", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "silent-follow-up",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
    setupOpeningFollowUpMs: 200,
    uiIntentConfirmMs: 0,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attachP = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  await new Promise((r) => setTimeout(r, 20));
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
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
    writtenCommands(written).some((row) => row.type === "prompt"),
    false,
  );
  assert.equal(frames.at(-1)?.data?.text, "罗马使团里，你是谁？");
});

test("attachOpening follows auto-open that arrives after an idle marker", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "idle-then-open",
    tableIntent: "character-setup",
    launcherPath: process.execPath,
    spawnFn: () => child,
    uiIntentConfirmMs: 80,
  });
  host.start();
  child.stderr.write(`${UI_IDLE_MARKER}\n`);
  const frames = [];
  const attachP = host.attachOpening({ onSse: (frame) => frames.push(frame) });
  await new Promise((r) => setTimeout(r, 20));
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "先建卡：你是谁？" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "先建卡：你是谁？" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await attachP;
  assert.deepEqual(result, { opened: true });
  assert.equal(
    writtenCommands(written).some((row) => row.type === "prompt"),
    false,
  );
  assert.equal(frames.at(-1)?.data?.text, "先建卡：你是谁？");
});

test("player prompt retries once after already-processing when the agent is idle", async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "player-retry",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("我推开门", {
    onSse: (frame) => frames.push(frame),
  });
  await new Promise((r) => setTimeout(r, 20));
  const first = writtenCommands(written)[0];
  child.stdout.write(`${JSON.stringify({
    id: first.id,
    type: "response",
    command: "prompt",
    success: false,
    error: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
  })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  const prompts = writtenCommands(written).filter((row) => row.type === "prompt");
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].message, "我推开门");
  assert.equal(prompts[1].streamingBehavior, undefined);
  child.stdout.write(`${JSON.stringify({
    id: prompts[1].id,
    type: "response",
    command: "prompt",
    success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "门轴发出一声干涩的吱呀。" },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "门轴发出一声干涩的吱呀。" }] },
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  const result = await promptP;
  assert.equal(result.sawPlayerText, true);
  assert.equal(result.attachedToInFlight, undefined);
  assert.deepEqual(frames, [{ event: "delta", data: { text: "门轴发出一声干涩的吱呀。" } }]);
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
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "开桌" }] },
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

test("provider idle after a tool result aborts once and fences late events", { timeout: 2000 }, async () => {
  const child = fakeChild();
  child.kill = () => setImmediate(() => {
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
  });
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  let now = 0;
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "idle-after-journal",
    sessionId: "web-idle-after-journal",
    launcherPath: process.execPath,
    spawnFn: () => child,
    turnIdleTimeoutMs: 100,
    nowFn: () => now,
  });
  host.start();
  const frames = [];
  const promptP = host.prompt("我接受委托。", {
    onSse: (frame) => frames.push(frame),
    timeoutMs: 30_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const first = writtenCommands(written)[0];
  child.stdout.write(`${JSON.stringify({
    id: first.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  now = 90;
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_invoke",
    args: { operation: "state.journal" },
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          tool: "state.journal",
          data: { journal_id: "journal-1" },
        }),
      }],
    },
  })}\n`);
  now = 180;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    0,
    "a tool result must reset the provider-idle deadline",
  );

  now = 191;
  const outcome = await Promise.race([
    promptP.then(
      () => ({ resolved: true }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 200)),
  ]);
  if (outcome.pending) {
    await host.abort();
    await promptP.catch(() => {});
    assert.fail("idle provider continuation remained attached");
  }
  assert.equal(outcome.error?.kind, "pi_coc_rpc_idle_timeout");
  assert.deepEqual(outcome.error?.details, {
    idle_classification: "post_tool_success_no_agent_settled",
    active_tools: [],
    last_tool_terminal: {
      tool_call_id: "unidentified-tool-call",
      tool: "state.journal",
      outcome: "success",
      error_code: null,
    },
    finalization_status: "absent",
  });
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    1,
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    1,
    "the watchdog must never send repeated abort commands",
  );

  const frameCount = frames.length;
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "迟到草稿" }] },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(frames.length, frameCount, "late aborted-turn events must stay off SSE");
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await host.close({ protocolAbort: false });
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    1,
    "recovery shutdown must not send a second abort after the watchdog abort",
  );
});

test("attachOpening aborts a silent provider continuation after successful review", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  let now = 0;
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "attach-idle-after-review",
    sessionId: "web-attach-idle-after-review",
    tableIntent: "continue",
    launcherPath: process.execPath,
    spawnFn: () => child,
    turnIdleTimeoutMs: 100,
    nowFn: () => now,
  });
  host.start();
  child.stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  const frames = [];
  const attached = host.attachOpening({
    onSse: (frame) => frames.push(frame),
    timeoutMs: 30_000,
  });
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    toolCallId: "resume-idle",
    result: { ok: true, tool: "session.resume", data: { mode: "pending_finalization" } },
  })}\n`);
  now = 50;
  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_end",
    toolName: "coc_narration_review",
    toolCallId: "review-idle",
    result: { ok: true, tool: "narration.review", data: { review_id: "review-idle" } },
  })}\n`);
  now = 75;
  child.stdout.write(`${JSON.stringify({
    type: "message_start",
    message: { role: "assistant", content: [] },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  now = 176;

  await assert.rejects(
    attached,
    (error) => error.kind === "pi_coc_rpc_idle_timeout"
      && error.details?.idle_classification === "post_tool_success_no_agent_settled",
  );
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    1,
  );
  const frameCount = frames.length;
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "迟到恢复文本" }] },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(frames.length, frameCount, "late attach events stay behind the abort fence");
});

test("accepted prompt with no agent_start still reaches the provider-idle watchdog", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  let now = 0;
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "idle-before-agent-start",
    sessionId: "web-idle-before-agent-start",
    launcherPath: process.execPath,
    spawnFn: () => child,
    turnIdleTimeoutMs: 100,
    nowFn: () => now,
  });
  host.start();
  const promptP = host.prompt("开始", { timeoutMs: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const first = writtenCommands(written)[0];
  child.stdout.write(`${JSON.stringify({
    id: first.id, type: "response", command: "prompt", success: true,
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  now = 101;

  await assert.rejects(promptP, (error) => error.kind === "pi_coc_rpc_idle_timeout");
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "abort").length,
    1,
  );
});

test("explicit abort rejects a new prompt until agent_settled instead of queuing followUp", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "manual-abort-boundary",
    sessionId: "web-manual-abort-boundary",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const firstPrompt = host.prompt("第一次行动");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const first = writtenCommands(written)[0];
  child.stdout.write(`${JSON.stringify({
    id: first.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await host.abort();
  await assert.rejects(firstPrompt, (error) => error.kind === "pi_coc_rpc_aborted");

  await assert.rejects(
    host.prompt("不得成为 followUp"),
    (error) => error.kind === "pi_coc_rpc_abort_pending",
  );
  assert.equal(
    writtenCommands(written).filter((row) => row.type === "prompt").length,
    1,
  );
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
});

test("explicit abort dominates agent_settled before the next waiter tick", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "abort-before-settle-tick",
    sessionId: "web-abort-before-settle-tick",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();
  const promptP = host.prompt("写状态后停止");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const first = writtenCommands(written)[0];
  child.stdout.write(`${JSON.stringify({
    id: first.id, type: "response", command: "prompt", success: true,
  })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  await host.abort();
  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);

  await assert.rejects(promptP, (error) => error.kind === "pi_coc_rpc_aborted");
});

test("close never reports a killed child closed without observing process exit", { timeout: 2000 }, async () => {
  const child = fakeChild();
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "unconfirmed-close",
    sessionId: "web-unconfirmed-close",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  host.start();

  await assert.rejects(
    host.close({ protocolAbort: false, termTimeoutMs: 10, killTimeoutMs: 10 }),
    (error) => error.kind === "pi_coc_rpc_close_timeout",
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(host.closed, false);
});

test("close waits for stdio close so a buffered final handoff event is observed", { timeout: 2000 }, async () => {
  const child = fakeChild();
  child.kill = () => {
    child.emit("exit", 0, null);
    setImmediate(() => {
      child.stdout.write(`${JSON.stringify({
        type: "custom_message",
        customType: "coc_setup_handoff",
        details: {
          type: "coc_setup_handoff",
          campaign_id: "buffered-handoff",
          receipt: { decision_id: "buffered-handoff" },
        },
      })}\n`);
      child.emit("close", 0, null);
    });
  };
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "buffered-handoff",
    sessionId: "web-buffered-handoff",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  const events = [];
  host.onEvent((event) => events.push(event));
  host.start();

  await host.close({ protocolAbort: false, termTimeoutMs: 100, killTimeoutMs: 100 });
  assert.equal(
    events.some((event) => event.customType === "coc_setup_handoff"),
    true,
  );
});

test("close called after exit still waits for buffered stdio before releasing ownership", { timeout: 2000 }, async () => {
  const child = fakeChild();
  child.kill = () => assert.fail("an already-exited child must not be signalled again");
  const host = new PiCocRpcHost({
    repoRoot: "/tmp/missing-repo",
    workspace: "/tmp/ws",
    campaignId: "exit-before-close",
    sessionId: "web-exit-before-close",
    launcherPath: process.execPath,
    spawnFn: () => child,
  });
  const events = [];
  host.onEvent((event) => events.push(event));
  host.start();
  child.emit("exit", 0, null);
  const closing = host.close({ protocolAbort: false, termTimeoutMs: 100, killTimeoutMs: 100 });
  setImmediate(() => {
    child.stdout.write(`${JSON.stringify({
      type: "custom_message",
      customType: "coc_setup_handoff",
      details: {
        type: "coc_setup_handoff",
        campaign_id: "exit-before-close",
        receipt: { decision_id: "exit-before-close" },
      },
    })}\n`);
    child.emit("close", 0, null);
  });
  await closing;
  assert.equal(
    events.some((event) => event.customType === "coc_setup_handoff"),
    true,
  );
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

// ------------------------------------------- resume continuation patience
//
// Regression: a retained-turn play campaign opens through a real multi-step
// session.resume continuation (recovery work can run for minutes). The
// attach flow must keep waiting while the child keeps producing stdout RPC
// progress and only fail after a true quiet window — and an abandoned settle
// wait must never surface its late timer rejection as an unhandled rejection
// that takes the whole server process down (both found in live browser
// play against a retained-turn campaign).

function trackUnhandledRejections() {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  return {
    seen,
    stop: () => process.off("unhandledRejection", onUnhandled),
  };
}

function resumeToolEndEvent(mode, campaignId, callId) {
  return {
    type: "tool_execution_end",
    toolName: "coc_session_resume",
    toolCallId: callId,
    result: {
      ok: true,
      tool: "session.resume",
      data: {
        schema_version: 1,
        campaign_id: campaignId,
        mode,
      },
    },
  };
}

test("attachOpening keeps waiting for a recovery continuation while stdout progress flows", async () => {
  const unhandled = trackUnhandledRejections();
  try {
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "slow-recovery",
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
      uiIntentPatienceMs: 250,
      resumeStartQuietMs: 600,
    });
    host.start();
    const frames = [];
    const attached = host.attachOpening({ onSse: (frame) => frames.push(frame) });
    await new Promise((r) => setTimeout(r, 30));
    // Turn 1 settles entirely inside the UI-intent wait: a silent-looking
    // open_turn_recovery resume with no player text yet.
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    child.stdout.write(`${JSON.stringify(resumeToolEndEvent("open_turn_recovery", "slow-recovery", "r1"))}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    // The follow-up recovery continuation starts only after a gap that has
    // no streaming agent turn — exactly the window that used to trip the
    // fixed one-minute start bound and fail the attach outright.
    await new Promise((r) => setTimeout(r, 290));
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    const renderedText = "恢复后的开场叙述。";
    child.stdout.write(`${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: renderedText }],
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: "tool_execution_end",
      toolName: "coc_turn_finalize",
      result: {
        ok: true,
        tool: "turn.finalize",
        data: {
          finalization_id: "fin-slow-recovery-1",
          rendered_text: renderedText,
          rendered_sha256: canonicalTextSha256(renderedText),
        },
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    assert.deepEqual(await attached, { opened: true });
    assert.equal(
      frames.some((frame) => frame.event === "delta" && frame.data.text === renderedText),
      true,
    );
    assert.equal(
      written.join("").split("\n").filter(Boolean)
        .some((line) => JSON.parse(line).type === "prompt"),
      false,
    );
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(unhandled.seen, []);
    await host.close();
  } finally {
    unhandled.stop();
  }
});

test("an abandoned turn settle wait keeps its late rejection observed", async () => {
  const unhandled = trackUnhandledRejections();
  try {
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "prompt-abandon",
      launcherPath: process.execPath,
      spawnFn: () => child,
    });
    host.start();
    // The prompt RPC is rejected outright, so prompt() throws without
    // awaiting its settle wait; the wait stays armed and later observes the
    // recovery resume + settle, which rejects with the finalization fault.
    const promptP = host.prompt("我检查罗盘。");
    await new Promise((r) => setTimeout(r, 20));
    const request = JSON.parse(written[written.length - 1].trim());
    assert.equal(request.type, "prompt");
    child.stdout.write(`${JSON.stringify({
      id: request.id,
      type: "response",
      command: "prompt",
      success: false,
      error: "session busy",
    })}\n`);
    await assert.rejects(
      promptP,
      (error) => error.kind === "pi_coc_rpc_rejected",
    );
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    child.stdout.write(`${JSON.stringify(resumeToolEndEvent("open_turn_recovery", "prompt-abandon", "r1"))}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    // Past the settle quiescence the abandoned wait rejects with the fault;
    // the guard must keep that rejection observed instead of unhandled.
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(unhandled.seen, []);
    await host.close();
  } finally {
    unhandled.stop();
  }
});

test("attachOpening still fails closed on a quiet wedged resume host", async () => {
  const unhandled = trackUnhandledRejections();
  try {
    const child = fakeChild();
    const written = [];
    child.stdin.on("data", (chunk) => written.push(String(chunk)));
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "wedged-resume",
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
      uiIntentPatienceMs: 150,
      resumeStartQuietMs: 250,
    });
    host.start();
    await assert.rejects(
      host.attachOpening(),
      (error) => error.kind === "pi_coc_play_resume_not_started",
    );
    assert.equal(
      written.join("").split("\n").filter(Boolean)
        .some((line) => JSON.parse(line).type === "prompt"),
      false,
    );
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(unhandled.seen, []);
    await host.close();
  } finally {
    unhandled.stop();
  }
});

test("attachOpening surfaces an undelivered recovery finalization as a turn fault", async () => {
  const unhandled = trackUnhandledRejections();
  try {
    const child = fakeChild();
    const host = new PiCocRpcHost({
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      campaignId: "recovery-fault",
      tableIntent: "continue",
      launcherPath: process.execPath,
      spawnFn: () => child,
      uiIntentPatienceMs: 200,
    });
    host.start();
    const attached = host.attachOpening({ onSse: () => {} });
    await new Promise((r) => setTimeout(r, 30));
    // The continuation turn is still streaming when the attach flow enters
    // its settle wait, so the resume below arms the recovery-finalization
    // obligation inside that awaited wait.
    child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    await new Promise((r) => setTimeout(r, 250));
    child.stdout.write(`${JSON.stringify(resumeToolEndEvent("open_turn_recovery", "recovery-fault", "r1"))}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    // Settling without the retained turn's finalization delivery surfaces
    // the structured turn fault through the attach request itself.
    await assert.rejects(
      attached,
      (error) => error.kind === "pi_coc_turn_processing_fault",
    );
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(unhandled.seen, []);
    await host.close();
  } finally {
    unhandled.stop();
  }
});
