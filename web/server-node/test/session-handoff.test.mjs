import test from "node:test";
import assert from "node:assert/strict";

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  mapRpcEventToSse,
  parseSetupHandoffEvent,
  PiCocRpcError,
  PiCocRpcHost,
  PLAY_TABLE_OPENING_PROMPT,
  PLAY_TURN_RECOVERY_PROMPT,
  UI_AUTO_OPEN_MARKER,
} from "../pi-coc-rpc.mjs";
import {
  CampaignHostOrchestrator,
  consumeDeliveredTurnProcessingFault,
  parseSessionRoleStdout,
  SESSION_BUSY_CODE,
  SESSION_TRANSITIONING_CODE,
  transitioningInputError,
} from "../session-handoff.mjs";

function fakeHost({ campaignId = "c1" } = {}) {
  const listeners = new Set();
  const host = {
    campaignId,
    sessionId: `web-${campaignId}`,
    closed: false,
    lastExitCode: null,
    repoRoot: "/tmp/repo",
    workspace: "/tmp/ws",
    agentDir: "",
    launcherPath: "/tmp/pi-coc",
    tableIntent: "character-setup",
    provider: "",
    model: "",
    thinking: "",
    spawnFn: null,
    attached: 0,
    prompted: 0,
    recoveryPrompted: 0,
    lastPrompt: null,
    readyCalls: 0,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(event) {
      for (const fn of listeners) fn(event);
    },
    async waitUntilReady() {
      this.readyCalls += 1;
    },
    async attachOpening({ onSse } = {}) {
      this.attached += 1;
      onSse?.({ event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } });
      return { opened: true };
    },
    async promptPlayOpening({ onSse } = {}) {
      this.prompted += 1;
      this.lastPrompt = PLAY_TABLE_OPENING_PROMPT;
      onSse?.({ event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } });
      return { opened: true };
    },
    async waitForAbortSettlement() {
      this.waitedForIdleAbort = true;
      return true;
    },
    async promptTurnRecovery({ onSse } = {}) {
      this.recoveryPrompted += 1;
      this.lastPrompt = PLAY_TURN_RECOVERY_PROMPT;
      onSse?.({ event: "delta", data: { text: "已从保留的回合结算继续。" } });
      return { recovered: true };
    },
    async close(options) {
      this.closeOptions = options;
      this.closed = true;
      this.emit({ type: "process_exit", code: 0, signal: "SIGTERM" });
    },
  };
  return host;
}

test("parseSetupHandoffEvent reads custom_message details", () => {
  const payload = {
    type: "coc_setup_handoff",
    campaign_id: "haunting-1",
    receipt: { decision_id: "d1" },
    at: "2026-04-08T00:00:00.000Z",
  };
  assert.deepEqual(
    parseSetupHandoffEvent({
      type: "custom_message",
      customType: "coc_setup_handoff",
      details: payload,
    }),
    payload,
  );
  assert.deepEqual(
    mapRpcEventToSse({
      type: "custom_message",
      customType: "coc_setup_handoff",
      content: JSON.stringify(payload),
      details: payload,
    }),
    [{ event: "coc_setup_handoff", data: payload }],
  );
});

test("handoff event path: spawn + attach + role flip", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.tableIntent = opts.tableIntent;
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("haunting-1", { tableIntent: "character-setup" });
  assert.equal(created.length, 1);

  created[0].emit({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "haunting-1",
      receipt: { decision_id: "setup.complete" },
      at: "2026-04-08T12:00:00.000Z",
    },
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created.length, 2);
  assert.equal(created[0].closed, true);
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 0);
  assert.equal(created[1].tableIntent, "continue");
  assert.deepEqual(orchestrator.statusOf("haunting-1"), {
    session_role: "play",
    transitioning: true,
  });
  const frames = [];
  await orchestrator.completeHandoffOpening("haunting-1", {
    onSse: (frame) => frames.push(frame),
  });
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 1);
  assert.equal(created[1].lastPrompt, null);
  assert.deepEqual(frames, [
    { event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } },
  ]);
  assert.deepEqual(orchestrator.statusOf("haunting-1"), {
    session_role: "play",
    transitioning: false,
  });
  assert.equal(orchestrator.getHost("haunting-1"), created[1]);
});

test("delayed exit 42 from the replaced setup host cannot respawn twice", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("handoff-dedupe", {
    tableIntent: "character-setup",
  });
  const setupHost = created[0];
  setupHost.emit({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "handoff-dedupe",
      receipt: { decision_id: "handoff-dedupe-1" },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(created.length, 2);
  assert.equal(orchestrator.getHost("handoff-dedupe"), created[1]);

  setupHost.emit({ type: "process_exit", code: 42, signal: null });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(created.length, 2);
  assert.equal(orchestrator.getHost("handoff-dedupe"), created[1]);
});

test("exit code 42 fallback starts the same handoff", async () => {
  const created = [];
  let resolveCalls = 0;
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => {
      resolveCalls += 1;
      return "play";
    },
  });
  await orchestrator.acquire("c42", { tableIntent: "character-setup" });
  created[0].emit({ type: "process_exit", code: 42, signal: null });
  created[0].closed = true;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created.length, 2);
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 0);
  assert.equal(resolveCalls, 1);
  assert.deepEqual(orchestrator.statusOf("c42"), {
    session_role: "play",
    transitioning: true,
  });
  await orchestrator.completeHandoffOpening("c42");
  assert.equal(created[1].prompted, 0);
  assert.equal(created[1].attached, 1);
  assert.deepEqual(orchestrator.statusOf("c42"), {
    session_role: "play",
    transitioning: false,
  });
});

test("respawn keeps setup intent when coc_session_role still judges setup", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.tableIntent = opts.tableIntent;
      created.push(host);
      return host;
    },
    // Authoritative single source: e.g. a placeholder-investigator campaign
    // whose files exist on disk but whose setup is not confirmed.
    resolveRoleFn: async () => "setup",
  });
  await orchestrator.acquire("still-setup", { tableIntent: "character-setup" });
  created[0].emit({ type: "process_exit", code: 42, signal: null });
  created[0].closed = true;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created.length, 2);
  assert.equal(created[1].tableIntent, "character-setup");
  assert.deepEqual(orchestrator.statusOf("still-setup"), {
    session_role: "setup",
    transitioning: true,
  });
});

test("player input is rejected while transitioning", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    attachFn: async () => gate,
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("c-in", { tableIntent: "character-setup" });
  const pending = orchestrator.completeHandoffOpening("c-in", { reason: "event" });
  assert.equal(orchestrator.isTransitioning("c-in"), true);
  const err = transitioningInputError();
  assert.equal(err.code, SESSION_TRANSITIONING_CODE);
  assert.equal(err.status, 409);
  assert.throws(
    () => orchestrator.assertAcceptsPlayerInput("c-in"),
    (caught) => caught.code === SESSION_TRANSITIONING_CODE,
  );
  release();
  await pending;
  orchestrator.assertAcceptsPlayerInput("c-in");
});

test("opening attach failure preserves the exact handoff error", async () => {
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    attachFn: async () => {
      throw new Error("play respawn lost RPC readiness");
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("broken", { tableIntent: "character-setup" });
  await assert.rejects(
    () => orchestrator.completeHandoffOpening("broken", { reason: "exit_42" }),
    (err) => {
      assert.equal(err.code, "session_handoff_failed");
      assert.equal(
        err.message,
        "建卡到开桌交接失败：play respawn lost RPC readiness",
      );
      return true;
    },
  );
});

test("same campaign refuses a second live child", async () => {
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("solo", { tableIntent: "setup" });
  await assert.rejects(
    () => orchestrator.acquire("solo", { tableIntent: "play" }, { reuse: false, exclusive: true }),
    (err) => err.code === SESSION_BUSY_CODE,
  );
  assert.equal(orchestrator.hosts.size, 1);
});

test("terminal turn fault retires only its exact host and refresh resumes on a fresh child", async () => {
  const created = [];
  const fault = {
    message: "回合处理失败：玩家状态声明编译未完成。当前回合仍保留，请刷新后恢复。",
    code: "state_claim_compiler_invalid",
    details: {
      kind: "turn_processing_fault",
      status: "terminal",
      pending_turn_preserved: true,
    },
  };
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.tableIntent = opts.tableIntent;
      if (created.length === 0) {
        host.attachOpening = async ({ onSse } = {}) => {
          onSse?.({ event: "error", data: fault });
          throw new PiCocRpcError(fault.message, {
            kind: "pi_coc_turn_processing_fault",
            details: fault.details,
          });
        };
      } else {
        host.attachOpening = async ({ onSse } = {}) => {
          onSse?.({ event: "tool", data: {
            phase: "start", tool: "coc_session_resume",
            tool_call_id: "resume-after-refresh",
          } });
          onSse?.({ event: "tool", data: {
            phase: "end", tool: "coc_session_resume",
            tool_call_id: "resume-after-refresh",
          } });
          onSse?.({ event: "delta", data: { text: "已从保留回合恢复。" } });
          return { opened: true };
        };
      }
      created.push(host);
      return host;
    },
  });

  const { host: poisoned } = await orchestrator.acquire(
    "fault-refresh", { tableIntent: "continue" },
  );
  const firstFrames = [];
  await assert.rejects(
    poisoned.attachOpening({ onSse: (frame) => firstFrames.push(frame) }),
    (error) => error.kind === "pi_coc_turn_processing_fault",
  );
  assert.deepEqual(firstFrames, [{ event: "error", data: fault }]);
  let genericHttpErrors = 0;
  const consumed = await consumeDeliveredTurnProcessingFault({
    error: new PiCocRpcError(fault.message, {
      kind: "pi_coc_turn_processing_fault",
      details: fault.details,
    }),
    campaignId: "fault-refresh",
    expectedHost: poisoned,
    orchestrator,
  });
  if (!consumed) genericHttpErrors += 1;
  assert.equal(consumed, true);
  assert.equal(genericHttpErrors, 0, "HTTP catch must not append a generic second error");
  assert.equal(poisoned.closed, true);
  assert.equal(orchestrator.getHost("fault-refresh"), null);

  const { host: refreshed, spawned } = await orchestrator.acquire(
    "fault-refresh", { tableIntent: "continue" },
  );
  assert.equal(spawned, true);
  assert.notEqual(refreshed, poisoned);
  const refreshedFrames = [];
  await refreshed.attachOpening({ onSse: (frame) => refreshedFrames.push(frame) });
  assert.deepEqual(refreshedFrames.map((frame) => [
    frame.event, frame.data?.phase ?? null, frame.data?.tool ?? null,
  ]), [
    ["tool", "start", "coc_session_resume"],
    ["tool", "end", "coc_session_resume"],
    ["delta", null, null],
  ]);

  const replacement = fakeHost({ campaignId: "fault-refresh" });
  orchestrator.hosts.set("fault-refresh", replacement);
  assert.equal(await orchestrator.retireExactHost("fault-refresh", refreshed), false);
  assert.equal(refreshed.closed, false);
  assert.equal(orchestrator.getHost("fault-refresh"), replacement);
});

test("tool retry exhaustion retires the host without a second generic error", async () => {
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => fakeHost({ campaignId: opts.campaignId }),
  });
  const { host } = await orchestrator.acquire("retry-cap", { tableIntent: "continue" });
  const consumed = await consumeDeliveredTurnProcessingFault({
    error: new PiCocRpcError("工具 narration.review 连续失败 3 次后已中断：latched。请刷新后恢复。", {
      kind: "pi_coc_tool_retry_exhausted",
      details: { tool: "narration.review", error_code: "latched" },
    }),
    campaignId: "retry-cap",
    expectedHost: host,
    orchestrator,
  });
  assert.equal(consumed, true);
  assert.equal(host.closed, true);
  assert.equal(orchestrator.getHost("retry-cap"), null);
});

test("exact-host retirement fences replacement spawn until one shared close settles", async () => {
  const created = [];
  let releaseClose;
  const closeGate = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.tableIntent = opts.tableIntent;
      host.closeCalls = 0;
      if (created.length === 0) {
        host.close = async (options) => {
          host.closeCalls += 1;
          host.closeOptions = options;
          await closeGate;
          host.closed = true;
        };
      }
      created.push(host);
      return host;
    },
  });
  const { host: poisoned } = await orchestrator.acquire(
    "retirement-fence", { tableIntent: "continue" },
  );

  const firstRetire = orchestrator.retireExactHost("retirement-fence", poisoned);
  const joinedRetire = orchestrator.retireExactHost("retirement-fence", poisoned);
  const waitingAcquire = orchestrator.acquire(
    "retirement-fence",
    { tableIntent: "continue" },
    { reuse: false, exclusive: true },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(poisoned.closeCalls, 1, "same-host retire callers must share one close");
  assert.equal(orchestrator.getHost("retirement-fence"), poisoned);
  assert.equal(orchestrator.isTransitioning("retirement-fence"), true);
  assert.equal(created.length, 1, "acquire must not spawn while close ownership is unsettled");

  releaseClose();
  assert.equal(await firstRetire, true);
  assert.equal(await joinedRetire, true);
  const { host: replacement, spawned } = await waitingAcquire;
  assert.equal(spawned, true);
  assert.notEqual(replacement, poisoned);
  assert.equal(created.length, 2);
});

test("failed exact-host retirement keeps the poisoned slot fenced", async () => {
  const created = [];
  let rejectClose;
  const closeGate = new Promise((resolve, reject) => {
    rejectClose = reject;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = fakeHost({ campaignId: opts.campaignId });
      host.closeCalls = 0;
      if (created.length === 0) {
        host.close = async () => {
          host.closeCalls += 1;
          await closeGate;
        };
      }
      created.push(host);
      return host;
    },
  });
  const { host: poisoned } = await orchestrator.acquire(
    "retirement-close-failure", { tableIntent: "continue" },
  );

  const retiring = orchestrator.retireExactHost("retirement-close-failure", poisoned);
  const waitingAcquire = orchestrator.acquire(
    "retirement-close-failure",
    { tableIntent: "continue" },
    { reuse: false, exclusive: true },
  );
  await new Promise((resolve) => setImmediate(resolve));
  rejectClose(new Error("process and stdio did not settle"));

  assert.equal(await retiring, false);
  await assert.rejects(
    waitingAcquire,
    (error) => error.code === SESSION_TRANSITIONING_CODE,
  );
  assert.equal(orchestrator.getHost("retirement-close-failure"), poisoned);
  assert.equal(orchestrator.isTransitioning("retirement-close-failure"), true);
  assert.equal(created.length, 1, "close failure must not free the child slot");
  assert.equal(
    await orchestrator.retireExactHost("retirement-close-failure", poisoned),
    false,
  );
  assert.equal(poisoned.closeCalls, 1, "failed retirement remains the shared fence");
});

test("model catalog refresh replaces the live host with the selected model", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      created.push(host);
      return host;
    },
  });
  const { host: original } = await orchestrator.acquire("model-refresh", {
    tableIntent: "continue",
    provider: "xai",
    model: "grok-4.5",
    thinking: "low",
  });

  const replacement = await orchestrator.restartForModel("model-refresh", {
    provider: "qwen-token-plan-cn",
    model: "qwen3.8-max",
    thinking: "low",
  });

  assert.equal(original.closed, true);
  assert.equal(created.length, 2);
  assert.equal(replacement.provider, "qwen-token-plan-cn");
  assert.equal(replacement.model, "qwen3.8-max");
  assert.equal(replacement.sessionId, original.sessionId);
  assert.deepEqual(orchestrator.statusOf("model-refresh"), {
    session_role: "play",
    transitioning: false,
  });
});

test("provider stall recovery respawns the same session and resumes without player resend", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  const { host: stalled } = await orchestrator.acquire("stall-recovery", {
    tableIntent: "continue",
    provider: "grok-relay",
    model: "grok-4.5",
    turnIdleTimeoutMs: 3210,
    nowFn: () => 123,
  });
  const frames = [];
  const [recovered, concurrent] = await Promise.all([
    orchestrator.recoverStalledTurn("stall-recovery", {
      onSse: (frame) => frames.push(frame),
    }),
    orchestrator.recoverStalledTurn("stall-recovery", {
      onSse: (frame) => frames.push(frame),
    }),
  ]);

  assert.equal(stalled.waitedForIdleAbort, true);
  assert.equal(stalled.closed, true);
  assert.deepEqual(stalled.closeOptions, { protocolAbort: false });
  assert.equal(created.length, 2);
  assert.equal(recovered.host, created[1]);
  assert.equal(concurrent.host, recovered.host, "concurrent recovery must join one replacement");
  assert.equal(recovered.host.sessionId, stalled.sessionId);
  assert.equal(recovered.host.turnIdleTimeoutMs, stalled.turnIdleTimeoutMs);
  assert.equal(recovered.host.nowFn, stalled.nowFn);
  assert.equal(recovered.host.recoveryPrompted, 0);
  assert.equal(recovered.host.attached, 1);
  assert.equal(recovered.host.lastPrompt, null);
  assert.equal(recovered.promptResult.opened, true);
  assert.deepEqual(frames, [
    { event: "delta", data: { text: "雾中的宅邸在你面前显出轮廓。" } },
  ]);
  assert.deepEqual(orchestrator.statusOf("stall-recovery"), {
    session_role: "play",
    transitioning: false,
  });
});

test("provider stall recovery drains an exited host before replacing it", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  const { host: exited } = await orchestrator.acquire("exited-stall-recovery", {
    tableIntent: "continue",
  });
  exited.closed = true;
  let drained = false;
  exited.close = async (options) => {
    exited.closeOptions = options;
    drained = true;
  };

  const recovered = await orchestrator.recoverStalledTurn("exited-stall-recovery");

  assert.equal(drained, true, "replacement must wait for the old host's stdio drain");
  assert.deepEqual(exited.closeOptions, { protocolAbort: false });
  assert.equal(created.length, 2);
  assert.equal(recovered.host, created[1]);
});

test("failed provider-stall recovery retires the replacement before accepting another input", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      if (created.length === 1) {
        host.attachOpening = async () => {
          host.streaming = true;
          const error = new Error("recovery provider stalled");
          error.kind = "pi_coc_rpc_idle_timeout";
          throw error;
        };
      }
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  await orchestrator.acquire("failed-stall-recovery", { tableIntent: "continue" });

  await assert.rejects(
    orchestrator.recoverStalledTurn("failed-stall-recovery"),
    (error) => error.kind === "pi_coc_rpc_recovery_failed",
  );
  assert.equal(created.length, 2, "recovery must not recurse into another host");
  assert.equal(created[1].closed, true, "the possibly-streaming replacement must be fenced");
  assert.equal(orchestrator.getHost("failed-stall-recovery"), null);
  assert.deepEqual(orchestrator.statusOf("failed-stall-recovery"), {
    session_role: "play",
    transitioning: false,
  });
});

test("setup handoff during stall recovery cedes to one play replacement", async () => {
  const created = [];
  let releaseAbortWait;
  const abortWait = new Promise((resolve) => {
    releaseAbortWait = resolve;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      if (created.length === 0) {
        host.waitForAbortSettlement = () => abortWait;
      }
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  const { host: setupHost } = await orchestrator.acquire("handoff-during-recovery", {
    tableIntent: "character-setup",
  });
  const recovery = orchestrator.recoverStalledTurn("handoff-during-recovery");
  await new Promise((resolve) => setTimeout(resolve, 0));
  setupHost.emit({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "handoff-during-recovery",
      receipt: { decision_id: "handoff-during-recovery" },
    },
  });
  releaseAbortWait(true);

  const recovered = await recovery;
  assert.equal(created.length, 2);
  assert.equal(recovered.host, created[1]);
  assert.equal(recovered.host.tableIntent, "continue");
  assert.equal(recovered.host.recoveryPrompted, 0);
  assert.deepEqual(recovered.promptResult, { handoff: true });
  assert.equal(orchestrator.getHost("handoff-during-recovery"), recovered.host);
  assert.deepEqual(orchestrator.statusOf("handoff-during-recovery"), {
    session_role: "play",
    transitioning: true,
  });
});

test("stall recovery joins a setup handoff that already owns the campaign transition", async () => {
  const created = [];
  let releaseRole;
  const roleBarrier = new Promise((resolve) => {
    releaseRole = resolve;
  });
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => {
      await roleBarrier;
      return "play";
    },
  });
  await orchestrator.acquire("handoff-before-recovery", {
    tableIntent: "character-setup",
  });
  const handoff = orchestrator.beginHandoff("handoff-before-recovery", {
    reason: "coc_setup_handoff",
    handoff: { decision_id: "handoff-before-recovery" },
  });
  const recovery = orchestrator.recoverStalledTurn("handoff-before-recovery");
  releaseRole();

  const [playHost, recovered] = await Promise.all([handoff, recovery]);

  assert.equal(created.length, 2, "handoff and recovery must share one replacement");
  assert.equal(recovered.host, playHost);
  assert.deepEqual(recovered.promptResult, { handoff: true });
  assert.equal(orchestrator.getHost("handoff-before-recovery"), playHost);
});

test("setup handoff drains an exited host before spawning play", async () => {
  const created = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => {
      const host = Object.assign(fakeHost({ campaignId: opts.campaignId }), opts);
      created.push(host);
      return host;
    },
    resolveRoleFn: async () => "play",
  });
  const { host: exitedSetup } = await orchestrator.acquire("exited-setup-handoff", {
    tableIntent: "character-setup",
  });
  exitedSetup.closed = true;
  let drained = false;
  exitedSetup.close = async () => {
    drained = true;
  };
  exitedSetup.emit({
    type: "custom_message",
    customType: "coc_setup_handoff",
    details: {
      type: "coc_setup_handoff",
      campaign_id: "exited-setup-handoff",
      receipt: { decision_id: "exited-setup-handoff" },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(drained, true, "handoff must wait for the old host's stdio drain");
  assert.equal(created.length, 2);
  assert.equal(created[1].tableIntent, "continue");
});

test("parseSessionRoleStdout reads play or setup from JSON or token", () => {
  assert.equal(parseSessionRoleStdout('{"role":"play","status":"ready_for_table"}'), "play");
  assert.equal(parseSessionRoleStdout("play"), "play");
  assert.equal(parseSessionRoleStdout('{"role":"setup","status":"setup"}'), "setup");
  assert.equal(parseSessionRoleStdout("setup"), "setup");
});

function fakeRpcChild({ prompts, autoOpen = false } = {}) {
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
  stdin.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === "get_state") {
        stdout.write(`${JSON.stringify({
          id: msg.id,
          type: "response",
          command: "get_state",
          success: true,
        })}\n`);
        if (autoOpen) {
          autoOpen = false;
          queueMicrotask(() => {
            stderr.write(`${UI_AUTO_OPEN_MARKER}\n`);
            stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
            stdout.write(`${JSON.stringify({
              type: "tool_execution_start",
              toolName: "coc_session_resume",
              toolCallId: "resume-on-attach",
            })}\n`);
            stdout.write(`${JSON.stringify({
              type: "tool_execution_end",
              toolName: "coc_session_resume",
              toolCallId: "resume-on-attach",
              result: {
                ok: true,
                tool: "session.resume",
                data: { mode: "table_opening" },
              },
            })}\n`);
            stdout.write(`${JSON.stringify({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "宅邸的门缝里漏出一丝冷光。",
              },
            })}\n`);
            stdout.write(`${JSON.stringify({
              type: "message_end",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "宅邸的门缝里漏出一丝冷光。" }],
              },
            })}\n`);
            stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
          });
        }
        continue;
      }
      if (msg.type === "prompt") {
        prompts?.push(msg);
        stdout.write(`${JSON.stringify({
          id: msg.id,
          type: "response",
          command: "prompt",
          success: true,
        })}\n`);
        stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
        stdout.write(`${JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "宅邸的门缝里漏出一丝冷光。" },
        })}\n`);
        stdout.write(`${JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "宅邸的门缝里漏出一丝冷光。" }],
          },
        })}\n`);
        stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
      }
    }
  });
  return child;
}

test("respawned play child attaches to its one extension-owned continuation", async () => {
  const setupPrompts = [];
  const playPrompts = [];
  const children = [];
  const orchestrator = new CampaignHostOrchestrator({
    createHost: (opts) => new PiCocRpcHost({
      ...opts,
      repoRoot: "/tmp/missing-repo",
      workspace: "/tmp/ws",
      launcherPath: process.execPath,
      spawnFn: () => {
        const prompts = children.length === 0 ? setupPrompts : playPrompts;
        const child = fakeRpcChild({
          prompts,
          autoOpen: children.length > 0,
        });
        children.push(child);
        return child;
      },
    }),
    resolveRoleFn: async () => "play",
  });

  await orchestrator.acquire("rpc-order", { tableIntent: "character-setup" });
  assert.equal(children.length, 1);
  orchestrator.getHost("rpc-order").child.emit("exit", 42, null);
  orchestrator.getHost("rpc-order").child.emit("close", 42, null);

  const frames = [];
  await orchestrator.completeHandoffOpening("rpc-order", {
    reason: "exit_42",
    onSse: (frame) => frames.push(frame),
  });

  assert.equal(children.length, 2);
  assert.equal(setupPrompts.length, 0);
  assert.equal(playPrompts.length, 0);
  assert.deepEqual(frames, [
    { event: "tool", data: { phase: "start", tool: "coc_session_resume", tool_call_id: "resume-on-attach" } },
    { event: "tool", data: { phase: "end", tool: "coc_session_resume", tool_call_id: "resume-on-attach" } },
    { event: "delta", data: { text: "宅邸的门缝里漏出一丝冷光。" } },
  ]);
  assert.deepEqual(orchestrator.statusOf("rpc-order"), {
    session_role: "play",
    transitioning: false,
  });
});
