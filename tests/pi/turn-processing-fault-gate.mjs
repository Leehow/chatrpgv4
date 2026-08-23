#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const extension = await import(path.join(
  root, "plugins/coc-keeper/pi/extensions/index.ts",
));
const {
  PiStateClaimCompiler,
  PiStateClaimCompilerFailure,
  canonicalDigest,
  draftParagraphs,
} = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/state-claim-compiler.ts",
));

const campaign = "turn-processing-fault";
const baseReview = {
  draft_text: "诺特仍坐在桌后等你的答复。",
  turn_id: "turn-fault-1",
  source_digest: "sha256:source-fault-1",
  revision: 1,
  decision_id: "review-fault-1",
  findings: [],
  state_authority_review: {
    disposition: "no_player_state_change_claimed",
    reason: "没有调查员状态变化。",
    claims: [],
  },
};
const outputContext = {
  ok: true,
  tool: "turn.output_context",
  data: {
    turn_id: baseReview.turn_id,
    source_digest: baseReview.source_digest,
    settlement_snapshot_id: "turn-settlement-v1:fault-1",
    mechanics_bundle_sha256: "sha256:mechanics-fault-1",
    contract_projection: {
      agency_authority: { pc_subject_refs: ["pc:fault-investigator"] },
    },
    agency_review_operation: {
      prefilled_arguments: { revision: 1 },
    },
  },
};

function assistant(text, timestamp) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  };
}

function visibleText(message) {
  return (message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

test("gate latches one fault, clears pending follow-up, suppresses prose, and resets externally", () => {
  const gate = new extension.OpeningTerminalContinuationGate();
  gate.observeMessageStart({
    role: "user",
    content: [{ type: "text", text: "继续。" }],
  });
  assert.equal(gate.acceptVisibleAssistantFinal("未结算草稿", true), false);

  const base = {
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
  };
  const first = gate.armTurnProcessingFault(base);
  const duplicate = gate.armTurnProcessingFault({ ...base, code: "changed" });
  assert.equal(first.first, true);
  assert.equal(duplicate.first, false);
  assert.equal(duplicate.fault, first.fault);
  assert.equal(gate.takeMechanicalOutputGateEnvelope(), null);
  assert.equal(gate.acceptVisibleAssistantFinal("模型伪造的处理故障说明", true), false);

  const delivery = gate.takeTurnProcessingFaultForDelivery();
  assert.equal(delivery, first.fault);
  assert.equal(gate.takeTurnProcessingFaultForDelivery(), null);
  gate.releaseTurnProcessingFaultDelivery(delivery);
  assert.equal(gate.takeTurnProcessingFaultForDelivery(), first.fault);

  gate.observeMessageStart({
    role: "user",
    content: [{ type: "text", text: "刷新后恢复。" }],
  });
  assert.equal(gate.currentTurnProcessingFault(), first.fault);
  assert.equal(
    gate.armFrozenReviewRecovery({ campaign_id: "missing" }),
    false,
  );
  gate.reset();
  assert.equal(gate.currentTurnProcessingFault(), null);
});

test("extension emits one safe fault, latches changed args, retries failed delivery without follow-up", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let compilerCalls = 0;
    const compiler = new PiStateClaimCompiler(async () => {
      compilerCalls += 1;
      throw new PiStateClaimCompilerFailure(
        "state_claim_response_invalid",
        "protocol_invalid",
        { provider: "xai", id: "grok-4.5", api: "openai-responses" },
        4,
      );
    });
    const tools = new Map();
    const handlers = new Map();
    const appended = [];
    const sent = [];
    const sendAttempts = [];
    const clientCalls = [];
    let failFirstFaultDelivery = true;
    const pi = {
      registerTool(tool) { tools.set(tool.name, tool); },
      registerCommand() {},
      registerShortcut() {},
      on(type, handler) {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
      },
      appendEntry(type, value) { appended.push({ type, value }); },
      sendMessage(message, options) {
        sendAttempts.push({ message, options });
        if (
          message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE
          && failFirstFaultDelivery
        ) {
          failFirstFaultDelivery = false;
          throw new Error("transient fault delivery failure");
        }
        sent.push({ message, options });
      },
      setActiveTools() {},
      getThinkingLevel: () => "off",
    };
    const callTool = async (_name, params) => {
      clientCalls.push(params);
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: campaign,
            mode: "awaiting_player",
            evidence: { table_opening_id: "table-opening:fault" },
            next_operations: [],
          },
        };
      }
      if (params.operation === "turn.output_context") return outputContext;
      return { ok: true, tool: params.operation, data: {} };
    };
    extension.default(pi, {
      coordinatorEnabled: async () => false,
      startupCampaignId: () => null,
      createStateClaimCompiler: () => compiler,
      createClient: () => ({
        callTool,
        callToolWithTransportMeta: async (name, params) => ({
          value: await callTool(name, params), transport: null,
        }),
        async close() {},
      }),
    });
    const ctx = {
      cwd: root,
      mode: "rpc",
      model: {
        provider: "xai", id: "grok-4.5", api: "openai-responses",
      },
      sessionManager: {
        getSessionId: () => "turn-processing-fault-gate",
        getEntries: () => [],
      },
      hasUI: false,
    };
    for (const handler of handlers.get("session_start") ?? []) {
      await handler({ type: "session_start" }, ctx);
    }
    const invoke = async (id, operation, arguments_) => tools.get("coc_invoke").execute(
      id,
      { operation, campaign, arguments: arguments_ },
      undefined, undefined, ctx,
    );
    await invoke("resume", "session.resume", {});
    for (const handler of handlers.get("message_start") ?? []) {
      await handler({
        type: "message_start",
        message: {
          role: "user",
          content: [{ type: "text", text: "询问报酬。" }],
          timestamp: 1,
        },
      }, ctx);
    }
    await invoke("context", "turn.output_context", {});

    const first = JSON.parse((await invoke(
      "review-1", "narration.review", baseReview,
    )).content[0].text);
    assert.equal(first.error.code, "state_claim_compiler_invalid");
    assert.equal(first.error.retryable, false);
    const fault = first.error.details;
    assert.deepEqual(Object.keys(fault).sort(), [
      "campaign_id", "code", "contract_id", "elapsed_ms", "failure_class",
      "kind", "message", "pending_turn_preserved", "player_turn_epoch",
      "requested_model", "retryable", "revision", "run_id", "schema_version",
      "session_id", "source_digest", "stage", "status", "turn_id",
      "will_retry",
    ].sort());
    assert.equal(fault.revision, 1);
    assert.equal(fault.source_digest, baseReview.source_digest);
    assert.equal(fault.run_id, "turn-processing-fault-gate");
    assert.equal(fault.session_id, "turn-processing-fault-gate");
    assert.equal(fault.failure_class, "protocol_invalid");
    assert.equal(fault.player_turn_epoch, 1);
    assert.equal(
      appended.filter((entry) => entry.type === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE).length,
      1,
    );

    const changed = {
      ...baseReview,
      draft_text: "完全不同的草稿。",
      decision_id: "review-fault-changed",
    };
    const latched = JSON.parse((await invoke(
      "review-2", "narration.review", changed,
    )).content[0].text);
    assert.equal(latched.error.code, "turn_processing_fault_latched");
    assert.equal(compilerCalls, 2);
    assert.equal(
      clientCalls.some((call) => call.operation === "narration.review"),
      false,
    );

    const faultAttemptsBeforeTranscript = sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    );
    assert.equal(faultAttemptsBeforeTranscript.length, 1);
    assert.equal(faultAttemptsBeforeTranscript[0].options.triggerTurn, false);
    const prose = assistant("模型伪造的处理故障说明", 2);
    let transformed;
    for (const handler of handlers.get("message_end") ?? []) {
      transformed = await handler({ type: "message_end", message: prose }, ctx);
    }
    assert.equal(visibleText(transformed?.message ?? prose), "");
    const faultAttempts = sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    );
    assert.equal(faultAttempts.length, 2);
    assert.equal(faultAttempts[1].options.triggerTurn, false);
    assert.equal(sent.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length, 1);
    assert.equal(sendAttempts.some((entry) => entry.options?.triggerTurn === true), false);

    const laterProse = assistant("仍然不能泄漏。", 3);
    for (const handler of handlers.get("message_end") ?? []) {
      await handler({ type: "message_end", message: laterProse }, ctx);
    }
    assert.equal(sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length, 2);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("extension retries a retained fault at agent_end when no prose message settles", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const compiler = new PiStateClaimCompiler(async () => {
      throw new PiStateClaimCompilerFailure(
        "state_claim_response_invalid",
        "protocol_invalid",
        { provider: "xai", id: "grok-4.5", api: "openai-responses" },
        4,
      );
    });
    const tools = new Map();
    const handlers = new Map();
    const sent = [];
    const sendAttempts = [];
    let failFirstFaultDelivery = true;
    const pi = {
      registerTool(tool) { tools.set(tool.name, tool); },
      registerCommand() {},
      registerShortcut() {},
      on(type, handler) {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
      },
      appendEntry() {},
      sendMessage(message, options) {
        sendAttempts.push({ message, options });
        if (
          message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE
          && failFirstFaultDelivery
        ) {
          failFirstFaultDelivery = false;
          throw new Error("transient fault delivery failure");
        }
        sent.push({ message, options });
      },
      setActiveTools() {},
      getThinkingLevel: () => "off",
    };
    const callTool = async (_name, params) => {
      if (params.operation === "session.resume") {
        return {
          ok: true,
          tool: "session.resume",
          data: {
            schema_version: 1,
            campaign_id: campaign,
            mode: "awaiting_player",
            evidence: { table_opening_id: "table-opening:fault" },
            next_operations: [],
          },
        };
      }
      if (params.operation === "turn.output_context") return outputContext;
      return { ok: true, tool: params.operation, data: {} };
    };
    extension.default(pi, {
      coordinatorEnabled: async () => false,
      startupCampaignId: () => null,
      createStateClaimCompiler: () => compiler,
      createClient: () => ({
        callTool,
        callToolWithTransportMeta: async (name, params) => ({
          value: await callTool(name, params), transport: null,
        }),
        async close() {},
      }),
    });
    const ctx = {
      cwd: root,
      mode: "rpc",
      model: {
        provider: "xai", id: "grok-4.5", api: "openai-responses",
      },
      sessionManager: {
        getSessionId: () => "turn-processing-fault-agent-end",
        getEntries: () => [],
      },
      hasUI: false,
    };
    for (const handler of handlers.get("session_start") ?? []) {
      await handler({ type: "session_start" }, ctx);
    }
    const invoke = async (id, operation, arguments_) => tools.get("coc_invoke").execute(
      id,
      { operation, campaign, arguments: arguments_ },
      undefined, undefined, ctx,
    );
    await invoke("resume", "session.resume", {});
    for (const handler of handlers.get("message_start") ?? []) {
      await handler({
        type: "message_start",
        message: {
          role: "user",
          content: [{ type: "text", text: "询问报酬。" }],
          timestamp: 1,
        },
      }, ctx);
    }
    await invoke("context", "turn.output_context", {});
    const failed = JSON.parse((await invoke(
      "review", "narration.review", baseReview,
    )).content[0].text);
    assert.equal(failed.error.code, "state_claim_compiler_invalid");
    assert.equal(sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length, 1);

    for (const handler of handlers.get("agent_end") ?? []) {
      await handler({ type: "agent_end" }, ctx);
    }
    await new Promise((resolve) => setImmediate(resolve));

    const faultAttempts = sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    );
    assert.equal(faultAttempts.length, 2);
    assert.equal(faultAttempts[1].options.triggerTurn, false);
    assert.equal(sent.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length, 1);
    assert.equal(sendAttempts.some((entry) => entry.options?.triggerTurn === true), false);

    for (const handler of handlers.get("agent_end") ?? []) {
      await handler({ type: "agent_end" }, ctx);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sendAttempts.filter(
      (entry) => entry.message.customType === extension.TURN_PROCESSING_FAULT_CUSTOM_TYPE,
    ).length, 2);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

function validCompilerResult(input) {
  return {
    schema_version: 1,
    contract_id: "coc.pi-state-claim-compiler-result.v1",
    disposition: "no_claims_detected",
    reason: "Every paragraph was reviewed.",
    claims: [],
    paragraph_coverage: draftParagraphs(input.draft_text).map((text, paragraph_index) => ({
      paragraph_index,
      paragraph_sha256: canonicalDigest(text),
      claim_indices: [],
    })),
  };
}

function pendingResumeEnvelope() {
  return {
    ok: true,
    tool: "session.resume",
    data: {
      schema_version: 1,
      campaign_id: campaign,
      mode: "pending_finalization",
      next_operations: ["turn.finalize"],
    },
  };
}

async function recoveryHarness(options = {}) {
  const infer = options.infer ?? (async () => {
    throw new PiStateClaimCompilerFailure(
      "state_claim_response_invalid",
      options.failureClass ?? "result_invalid",
      { provider: "xai", id: "grok-4.5", api: "openai-responses" },
      4,
    );
  });
  const compiler = options.compiler ?? new PiStateClaimCompiler(infer);
  const tools = new Map();
  const handlers = new Map();
  const clientCalls = [];
  const appended = [];
  let resumeMode = options.initialResumeMode ?? "awaiting_player";
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    appendEntry(type, value) { appended.push({ type, value }); },
    sendMessage() {},
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  const callTool = async (_name, params) => {
    clientCalls.push(params);
    if (params.operation === "session.resume") {
      if (resumeMode === "pending_finalization") return pendingResumeEnvelope();
      return {
        ok: true,
        tool: "session.resume",
        data: {
          schema_version: 1,
          campaign_id: campaign,
          mode: "awaiting_player",
          evidence: { table_opening_id: "table-opening:fault" },
          next_operations: [],
        },
      };
    }
    if (params.operation === "turn.output_context") return outputContext;
    if (params.operation === "narration.review") {
      return {
        ok: true,
        tool: "narration.review",
        data: {
          accepted: true,
          review_id: "review-recovered-1",
          state_claim_compilation: params.arguments.state_claim_compilation,
        },
      };
    }
    if (params.operation === "turn.finalize") {
      return {
        ok: true,
        tool: "turn.finalize",
        data: {
          rendered_text: "诺特仍坐在桌后等你的答复。",
          rendered_text_sha256: canonicalDigest("诺特仍坐在桌后等你的答复。"),
        },
      };
    }
    return { ok: true, tool: params.operation, data: {} };
  };
  extension.default(pi, {
    coordinatorEnabled: async () => false,
    startupCampaignId: () => null,
    createStateClaimCompiler: () => compiler,
    createClient: () => ({
      callTool,
      callToolWithTransportMeta: async (name, params) => ({
        value: await callTool(name, params), transport: null,
      }),
      async close() {},
    }),
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
    sessionManager: {
      getSessionId: () => options.sessionId ?? "turn-processing-fault-recovery",
      getEntries: () => [],
    },
    hasUI: false,
  };
  for (const handler of handlers.get("session_start") ?? []) {
    await handler({ type: "session_start" }, ctx);
  }
  const invoke = async (id, operation, arguments_) => tools.get("coc_invoke").execute(
    id,
    { operation, campaign, arguments: arguments_ },
    undefined, undefined, ctx,
  );
  const parse = async (id, operation, arguments_) => JSON.parse(
    (await invoke(id, operation, arguments_)).content[0].text,
  );
  return {
    compiler,
    clientCalls,
    appended,
    ctx,
    invoke,
    parse,
    setResumeMode(mode) { resumeMode = mode; },
    async player(text) {
      for (const handler of handlers.get("message_start") ?? []) {
        await handler({
          type: "message_start",
          message: {
            role: "user",
            content: [{ type: "text", text }],
            timestamp: Date.now(),
          },
        }, ctx);
      }
    },
  };
}

function mutationCount(calls) {
  return calls.filter((call) => (
    call.operation === "state.journal"
    || String(call.operation || "").startsWith("rules.")
    || (
      String(call.operation || "").startsWith("state.")
      && call.operation !== "state.journal"
    )
  )).length;
}

test("resume-armed recovery retries compiler once and finalizes with host receipt", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let inferCalls = 0;
    const h = await recoveryHarness({
      infer: async (input) => {
        inferCalls += 1;
        if (inferCalls <= 2) {
          throw new PiStateClaimCompilerFailure(
            "state_claim_coverage_incomplete",
            "result_invalid",
            { provider: "xai", id: "grok-4.5", api: "openai-responses" },
            4,
          );
        }
        return {
          result: validCompilerResult(input),
          responseModel: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
        };
      },
    });
    await h.parse("resume", "session.resume", {});
    await h.player("询问报酬。");
    await h.parse("context", "turn.output_context", {});
    const first = await h.parse("review-1", "narration.review", baseReview);
    assert.equal(first.error.code, "state_claim_compiler_invalid");
    assert.equal(inferCalls, 2);
    const mutationsAfterFail = mutationCount(h.clientCalls);

    const noResume = await h.parse("review-no-resume", "narration.review", {
      ...baseReview,
      draft_text: "新的地下室叙述。",
      decision_id: "review-fault-retry",
    });
    assert.equal(noResume.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 2);

    h.setResumeMode("pending_finalization");
    const resumed = await h.parse("recover-resume", "session.resume", {});
    assert.equal(resumed.data.mode, "pending_finalization");
    assert.equal(
      resumed.data.host_recovery_guidance.review_recovery.armed,
      true,
    );
    assert.equal(
      resumed.data.host_recovery_guidance.review_recovery.exact_card_path,
      "coc_turn_output_context.data.agency_review_operation",
    );

    const mismatched = await h.parse("review-mismatch", "narration.review", {
      ...baseReview,
      turn_id: "turn-other",
      draft_text: "新的地下室叙述。",
      decision_id: "review-fault-mismatch",
    });
    assert.equal(mismatched.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 2);

    const recovered = await h.parse("review-recover", "narration.review", {
      ...baseReview,
      draft_text: "新的地下室叙述。",
      decision_id: "review-fault-recover",
      state_claim_compilation: { forged: true },
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(inferCalls, 3);
    const reviewCalls = h.clientCalls.filter((call) => call.operation === "narration.review");
    assert.equal(reviewCalls.length, 1);
    assert.equal(reviewCalls[0].arguments.state_claim_compilation.forged, undefined);
    assert.equal(
      reviewCalls[0].arguments.state_claim_compilation.contract_id,
      "coc.pi-state-claim-compilation-receipt.v1",
    );
    const finalized = await h.parse("finalize", "turn.finalize", {
      decision_id: "journal-1:finalize",
      revision: 1,
      draft: "新的地下室叙述。",
      coverage: [],
      narration_review_id: "review-recovered-1",
      agency_claims: [],
    });
    assert.equal(finalized.ok, true, JSON.stringify(finalized));
    assert.equal(mutationCount(h.clientCalls), mutationsAfterFail);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("second final invalid stays latched and timeout is not recovery-armed", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let inferCalls = 0;
    const h = await recoveryHarness({
      infer: async () => {
        inferCalls += 1;
        throw new PiStateClaimCompilerFailure(
          "state_claim_coverage_incomplete",
          "result_invalid",
          { provider: "xai", id: "grok-4.5", api: "openai-responses" },
          4,
        );
      },
    });
    await h.parse("resume", "session.resume", {});
    await h.player("询问报酬。");
    await h.parse("context", "turn.output_context", {});
    const first = await h.parse("review-1", "narration.review", baseReview);
    assert.equal(first.error.code, "state_claim_compiler_invalid");
    assert.equal(inferCalls, 2);
    h.setResumeMode("pending_finalization");
    const armed = await h.parse("recover-resume", "session.resume", {});
    assert.equal(armed.data.host_recovery_guidance.review_recovery.armed, true);
    const second = await h.parse("review-2", "narration.review", {
      ...baseReview,
      draft_text: "另一段修订草稿。",
      decision_id: "review-fault-second",
    });
    assert.equal(second.error.code, "state_claim_compiler_invalid");
    assert.equal(inferCalls, 4);
    const rearmed = await h.parse("recover-resume-2", "session.resume", {});
    assert.equal(rearmed.data.host_recovery_guidance.review_recovery.armed, false);
    const third = await h.parse("review-3", "narration.review", {
      ...baseReview,
      draft_text: "第三段修订草稿。",
      decision_id: "review-fault-third",
    });
    assert.equal(third.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 4);

    const timeout = await recoveryHarness({
      sessionId: "turn-processing-fault-timeout",
      failureClass: "timeout",
      infer: async () => {
        throw new PiStateClaimCompilerFailure(
          "state_claim_compiler_timeout",
          "timeout",
          { provider: "xai", id: "grok-4.5", api: "openai-responses" },
          4,
        );
      },
    });
    await timeout.parse("resume", "session.resume", {});
    await timeout.player("询问报酬。");
    await timeout.parse("context", "turn.output_context", {});
    const timedOut = await timeout.parse("review-timeout", "narration.review", baseReview);
    assert.equal(timedOut.error.code, "state_claim_compiler_unavailable");
    assert.equal(timedOut.error.details.failure_class, "timeout");
    timeout.setResumeMode("pending_finalization");
    const timeoutResume = await timeout.parse("timeout-resume", "session.resume", {});
    assert.equal(
      timeoutResume.data.host_recovery_guidance.review_recovery.armed,
      false,
    );
    const timeoutRetry = await timeout.parse("review-timeout-2", "narration.review", {
      ...baseReview,
      draft_text: "超时后不能恢复。",
      decision_id: "review-timeout-2",
    });
    assert.equal(timeoutRetry.error.code, "turn_processing_fault_latched");
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("new player action and restart-style pending resume stay fail-closed", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let inferCalls = 0;
    const h = await recoveryHarness({
      infer: async () => {
        inferCalls += 1;
        throw new PiStateClaimCompilerFailure(
          "state_claim_coverage_incomplete",
          "result_invalid",
          { provider: "xai", id: "grok-4.5", api: "openai-responses" },
          4,
        );
      },
    });
    await h.parse("resume", "session.resume", {});
    await h.player("询问报酬。");
    await h.parse("context", "turn.output_context", {});
    await h.parse("review-1", "narration.review", baseReview);
    assert.equal(inferCalls, 2);
    await h.player("新的玩家行动。");
    const afterPlayer = await h.parse("review-after-player", "narration.review", {
      ...baseReview,
      draft_text: "新的地下室叙述。",
      decision_id: "review-after-player",
    });
    assert.equal(afterPlayer.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 2);
    h.setResumeMode("pending_finalization");
    await h.parse("late-resume", "session.resume", {});
    const afterLateResume = await h.parse("review-late", "narration.review", {
      ...baseReview,
      draft_text: "新的地下室叙述。",
      decision_id: "review-late",
    });
    assert.equal(afterLateResume.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 2);

    let restartCalls = 0;
    const restart = await recoveryHarness({
      sessionId: "turn-processing-fault-restart",
      initialResumeMode: "pending_finalization",
      infer: async (input) => {
        restartCalls += 1;
        return {
          result: validCompilerResult(input),
          responseModel: { provider: "xai", id: "grok-4.5", api: "openai-responses" },
        };
      },
    });
    const restartResume = await restart.parse("restart-resume", "session.resume", {});
    assert.equal(restartResume.data.mode, "pending_finalization");
    assert.equal(
      restartResume.data.host_recovery_guidance.review_recovery.armed,
      false,
    );
    await restart.parse("restart-context", "turn.output_context", {});
    const restartReview = await restart.parse("restart-review", "narration.review", {
      ...baseReview,
      draft_text: "进程重启后的新草稿。",
      decision_id: "review-restart",
    });
    assert.equal(restartReview.ok, true, JSON.stringify(restartReview));
    assert.equal(restartCalls, 1);
    const restartReviewCalls = restart.clientCalls.filter(
      (call) => call.operation === "narration.review",
    );
    assert.equal(
      restartReviewCalls[0].arguments.state_claim_compilation.contract_id,
      "coc.pi-state-claim-compilation-receipt.v1",
    );
    assert.equal(mutationCount(restart.clientCalls), 0);
    const restartFinalize = await restart.parse("restart-finalize", "turn.finalize", {
      decision_id: "journal-1:finalize",
      revision: 1,
      draft: "进程重启后的新草稿。",
      coverage: [],
      narration_review_id: "review-recovered-1",
      agency_claims: [],
    });
    assert.equal(restartFinalize.ok, true, JSON.stringify(restartFinalize));
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});
