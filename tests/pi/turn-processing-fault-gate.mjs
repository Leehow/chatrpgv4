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
const { NonRetryableFailureCircuit } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/nonretry-circuit.ts",
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
// Canonical producer shape (coc_operation_turn_output.py
// _tool_turn_output_context + coc_mcp_wire.py projection): explicit
// agency_review_required, complete agency-authority subject refs, a full
// review card carrying the exact turn/source/revision identities, and the
// review-required finalize card on its coc_turn_finalize surface. The
// pre-fa8deb27 fixture (implicit agency mode, card-less review stub, no
// finalize card) predates the output-context acceptance hardening and has
// been failing the suite since; this is test upkeep to the current producer
// contract, not an expectation change.
const outputContext = {
  ok: true,
  tool: "turn.output_context",
  data: {
    turn_id: baseReview.turn_id,
    source_digest: baseReview.source_digest,
    settlement_snapshot_id: "turn-settlement-v1:fault-1",
    mechanics_bundle_sha256: "sha256:mechanics-fault-1",
    contract_projection: {
      agency_review_required: true,
      agency_authority: { pc_subject_refs: ["pc:fault-investigator"] },
    },
    agency_review_operation: {
      operation: "narration.review",
      invoke_via: "coc_narration_review",
      prefilled_arguments: {
        turn_id: baseReview.turn_id,
        source_digest: baseReview.source_digest,
        revision: 1,
      },
      missing_arguments: [
        "decision_id", "draft_text", "findings", "state_authority_review",
      ],
      discovery_required: false,
      authority: "semantic_agency_and_player_state_review",
    },
    finalize_operation: {
      operation: "turn.finalize",
      invoke_via: "coc_turn_finalize",
      prefilled_arguments: {
        decision_id: "journal-1:finalize",
        revision: 1,
        coverage: [],
      },
      missing_arguments: ["draft", "narration_review_id", "agency_claims"],
      discovery_required: false,
      authority: "settled_output_completeness",
      hard_gate: true,
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
    gate.armFrozenReviewRecovery({
      campaign_id: "missing",
      run_id: "run",
      session_id: "session",
      turn_id: "turn",
      revision: 1,
      source_digest: "sha256:source",
    }),
    false,
  );
  gate.reset();
  assert.equal(gate.currentTurnProcessingFault(), null);
});

test("late player epoch cannot arm frozen review recovery", () => {
  const gate = new extension.OpeningTerminalContinuationGate();
  gate.observeMessageStart({
    role: "user",
    content: [{ type: "text", text: "询问报酬。" }],
  });
  const identity = {
    campaign_id: campaign,
    run_id: "turn-processing-fault-gate",
    session_id: "turn-processing-fault-gate",
    turn_id: baseReview.turn_id,
    revision: 1,
    source_digest: baseReview.source_digest,
    failure_class: "result_invalid",
  };
  const first = gate.armTurnProcessingFault({
    schema_version: 1,
    contract_id: "coc.pi-turn-processing-fault.v1",
    kind: "turn_processing_fault",
    status: "terminal",
    ...identity,
  });
  assert.equal(first.first, true);
  assert.equal(gate.armFrozenReviewRecovery(identity), true);
  gate.observeMessageStart({
    role: "user",
    content: [{ type: "text", text: "新的玩家行动。" }],
  });
  assert.equal(gate.armFrozenReviewRecovery(identity), false);
  assert.equal(
    gate.matchFrozenReviewRecovery(identity),
    "reject",
  );
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
  const contextEnvelope = options.outputContext ?? outputContext;
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
    if (params.operation === "turn.output_context") return contextEnvelope;
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
    assert.equal(resumed.data.host_recovery_guidance.review_recovery.revision, 1);
    assert.equal(
      resumed.data.host_recovery_guidance.review_recovery.instruction.includes("revision-1"),
      false,
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

    for (const [label, failureClass, message] of [
      ["provider", "provider_unavailable", "state_claim_compiler_unavailable"],
      ["capability", "capability_unsupported", "state_claim_model_api_unsupported"],
    ]) {
      const blocked = await recoveryHarness({
        sessionId: `turn-processing-fault-${label}`,
        infer: async () => {
          throw new PiStateClaimCompilerFailure(
            message,
            failureClass,
            { provider: "xai", id: "grok-4.5", api: "openai-responses" },
            4,
          );
        },
      });
      await blocked.parse("resume", "session.resume", {});
      await blocked.player("询问报酬。");
      await blocked.parse("context", "turn.output_context", {});
      const failed = await blocked.parse(`review-${label}`, "narration.review", baseReview);
      assert.equal(failed.error.code, "state_claim_compiler_unavailable", label);
      assert.equal(failed.error.details.failure_class, failureClass, label);
      blocked.setResumeMode("pending_finalization");
      const blockedResume = await blocked.parse(`${label}-resume`, "session.resume", {});
      assert.equal(
        blockedResume.data.host_recovery_guidance.review_recovery.armed,
        false,
        label,
      );
      const blockedRetry = await blocked.parse(`review-${label}-2`, "narration.review", {
        ...baseReview,
        draft_text: `${label} 后不能恢复。`,
        decision_id: `review-${label}-2`,
      });
      assert.equal(blockedRetry.error.code, "turn_processing_fault_latched", label);
    }
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
    const lateResume = await h.parse("late-resume", "session.resume", {});
    assert.equal(
      lateResume.data.host_recovery_guidance.review_recovery.armed,
      false,
    );
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

test("context missing does not consume the resume-armed recovery", async () => {
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
    await h.parse("review-1", "narration.review", baseReview);
    assert.equal(inferCalls, 2);
    h.setResumeMode("pending_finalization");
    const armed = await h.parse("recover-resume", "session.resume", {});
    assert.equal(armed.data.host_recovery_guidance.review_recovery.armed, true);
    h.compiler.clear();
    const missing = await h.parse("review-missing", "narration.review", {
      ...baseReview,
      draft_text: "缺上下文的草稿。",
      decision_id: "review-missing",
    });
    assert.equal(missing.error.code, "state_claim_compiler_context_missing");
    assert.equal(inferCalls, 2);
    const stillArmed = await h.parse("recover-resume-2", "session.resume", {});
    assert.equal(
      stillArmed.data.host_recovery_guidance.review_recovery.armed,
      true,
    );
    await h.parse("context-2", "turn.output_context", {});
    const recovered = await h.parse("review-recover", "narration.review", {
      ...baseReview,
      draft_text: "补上下文后的草稿。",
      decision_id: "review-after-missing",
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(inferCalls, 3);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("frozen revision 2 recovery uses the host card revision", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const revisionTwoContext = {
      ...outputContext,
      data: {
        ...outputContext.data,
        agency_review_operation: {
          ...outputContext.data.agency_review_operation,
          prefilled_arguments: {
            ...outputContext.data.agency_review_operation.prefilled_arguments,
            revision: 2,
          },
        },
        finalize_operation: {
          ...outputContext.data.finalize_operation,
          prefilled_arguments: {
            ...outputContext.data.finalize_operation.prefilled_arguments,
            revision: 2,
          },
        },
      },
    };
    let inferCalls = 0;
    const h = await recoveryHarness({
      outputContext: revisionTwoContext,
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
    const reviewTwo = { ...baseReview, revision: 2, decision_id: "review-rev-2" };
    await h.parse("resume", "session.resume", {});
    await h.player("询问报酬。");
    await h.parse("context", "turn.output_context", {});
    const first = await h.parse("review-1", "narration.review", reviewTwo);
    assert.equal(first.error.code, "state_claim_compiler_invalid");
    h.setResumeMode("pending_finalization");
    const resumed = await h.parse("recover-resume", "session.resume", {});
    assert.equal(resumed.data.host_recovery_guidance.review_recovery.armed, true);
    assert.equal(resumed.data.host_recovery_guidance.review_recovery.revision, 2);
    const wrongRevision = await h.parse("review-wrong-rev", "narration.review", {
      ...reviewTwo,
      revision: 1,
      draft_text: "错误地写成 revision 1。",
      decision_id: "review-wrong-rev",
    });
    assert.equal(wrongRevision.error.code, "turn_processing_fault_latched");
    assert.equal(inferCalls, 2);
    const recovered = await h.parse("review-recover", "narration.review", {
      ...reviewTwo,
      draft_text: "按冻结 revision 2 重写。",
      decision_id: "review-rev-2-recover",
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(inferCalls, 3);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

// Generic progress APIs reject every regression. The only accepted faulted
// → output_context_ready transition uses the circuit's public opaque,
// single-use host-binding-refresh authorization API; it binds operation,
// turn/source/revision, player epoch, session generation, and eligibility.
test("nonretry circuit requires explicit host-binding-refresh authorization", () => {
  const circuitCampaign = "turn-processing-fault";
  const faultedProgress = {
    playerTurnEpoch: 1,
    canonicalProgressRevision: 2,
    stage: "faulted",
    campaignRevision: "manifest:9",
    journalRevision: "turn-fault-1",
    reviewRevision: null,
    finalizedRenderedSha256: null,
    closedObligationCount: 0,
  };
  const recoveredProgress = (overrides = {}) => ({
    ...faultedProgress,
    stage: "output_context_ready",
    canonicalProgressRevision: 3,
    ...overrides,
  });
  const latchedCircuit = () => {
    const circuit = new NonRetryableFailureCircuit();
    circuit.advance({
      campaignId: circuitCampaign,
      playerTurnEpoch: faultedProgress.playerTurnEpoch,
      canonicalProgress: faultedProgress,
    });
    return circuit;
  };
  const authorizationArgs = (overrides = {}) => ({
    kind: "host_binding_refresh",
    operation: "turn.output_context",
    recoverableBy: "host_binding_refresh",
    recoveryEligible: true,
    campaignId: circuitCampaign,
    turnId: faultedProgress.journalRevision,
    sourceDigest: "sha256:source-fault-1",
    outputRevision: 3,
    playerTurnEpoch: 1,
    sessionGeneration: 7,
    fromProgress: faultedProgress,
    toProgress: recoveredProgress(),
    ...overrides,
  });
  const consumeAuthorization = (circuit, authorization, overrides = {}) => (
    circuit.advanceAuthorizedHostBindingRefresh({
      campaignId: circuitCampaign,
      authorization,
      operation: "turn.output_context",
      turnId: faultedProgress.journalRevision,
      sourceDigest: "sha256:source-fault-1",
      outputRevision: 3,
      playerTurnEpoch: 1,
      sessionGeneration: 7,
      canonicalProgress: recoveredProgress(),
      ...overrides,
    })
  );
  const progressBlocked = (circuit, progress, salt) => {
    const blocked = circuit.preflight({
      campaignId: circuitCampaign,
      operation: "narration.review",
      phase: "live_turn",
      operationArgs: { decision_id: salt },
      playerTurnEpoch: progress.playerTurnEpoch,
      canonicalProgress: progress,
    });
    return blocked !== null && blocked.error?.code === "canonical_progress_rejected";
  };

  // Missing authorization: the generic API remains strict.
  {
    const circuit = latchedCircuit();
    circuit.advance({
      campaignId: circuitCampaign,
      playerTurnEpoch: 1,
      canonicalProgress: recoveredProgress(),
    });
    assert.equal(
      progressBlocked(circuit, recoveredProgress(), "missing-authorization"),
      true,
    );
  }

  // Public authorization succeeds only for the exact validated host lane.
  {
    const circuit = latchedCircuit();
    const authorization = circuit.authorizeHostBindingRefresh(
      authorizationArgs(),
    );
    assert.ok(authorization !== null);
    assert.equal(consumeAuthorization(circuit, authorization), true);
    assert.equal(
      progressBlocked(circuit, recoveredProgress(), "recovered-live"),
      false,
      "authorized fault recovery must be accepted",
    );
    assert.equal(
      consumeAuthorization(circuit, authorization),
      false,
      "authorization is consumed exactly once",
    );
  }

  // The public mint rejects wrong kind/operation/identity/epoch/revision and
  // non-recoverable state. No accepted private shape is manufactured.
  for (const [label, overrides] of [
    ["wrong kind", { kind: "generic_refresh" }],
    ["wrong operation", { operation: "narration.review" }],
    ["missing turn identity", { turnId: "" }],
    ["wrong turn identity", { turnId: "turn-other-9" }],
    ["wrong player epoch", { playerTurnEpoch: 2 }],
    ["wrong output revision", { outputRevision: 0 }],
    ["wrong canonical revision", {
      toProgress: recoveredProgress({ canonicalProgressRevision: 4 }),
    }],
    ["non-recoverable state", { recoveryEligible: false }],
    ["wrong recoverable-by", { recoverableBy: "model_next_action" }],
  ]) {
    const circuit = latchedCircuit();
    assert.equal(
      circuit.authorizeHostBindingRefresh(authorizationArgs(overrides)),
      null,
      label,
    );
  }

  // A real opaque authorization rejects divergent use fields and is consumed
  // on the first bad use, including source, session, identity, and revision.
  for (const [label, useOverrides] of [
    ["wrong source", { sourceDigest: "sha256:other-source" }],
    ["wrong session generation", { sessionGeneration: 8 }],
    ["wrong use identity", { turnId: "turn-other-9" }],
    ["wrong use epoch", { playerTurnEpoch: 2 }],
    ["wrong use output revision", { outputRevision: 4 }],
    ["wrong use progress", {
      canonicalProgress: recoveredProgress({ canonicalProgressRevision: 4 }),
    }],
  ]) {
    const circuit = latchedCircuit();
    const authorization = circuit.authorizeHostBindingRefresh(
      authorizationArgs(),
    );
    assert.ok(authorization !== null, label);
    assert.equal(consumeAuthorization(circuit, authorization, useOverrides), false, label);
    assert.equal(consumeAuthorization(circuit, authorization), false, `${label}: consumed`);
  }

  // Authorized recovery retains existing failure fingerprints and budget.
  {
    const circuit = latchedCircuit();
    circuit.observe({
      campaignId: circuitCampaign,
      operation: "narration.review",
      phase: "live_turn",
      operationArgs: { draft_text: "same semantic draft" },
      envelope: {
        ok: false,
        error: { code: "state_claim_compiler_invalid", class: "compiler" },
        retryable: false,
        will_retry: false,
      },
      playerTurnEpoch: 1,
      canonicalProgress: faultedProgress,
    });
    const before = circuit.captureHostHydrationState(circuitCampaign);
    const authorization = circuit.authorizeHostBindingRefresh(
      authorizationArgs(),
    );
    assert.ok(authorization !== null);
    assert.equal(consumeAuthorization(circuit, authorization), true);
    const after = circuit.captureHostHydrationState(circuitCampaign);
    assert.deepEqual(
      after.failures,
      before.failures,
      "authorized refresh must retain failure fingerprints/recovery budget",
    );
  }

  // Near-miss candidates keep the existing regressive refusal.
  for (const [label, overrides] of [
    ["wrong stage review_ready", { stage: "review_ready" }],
    ["wrong stage journaled", { stage: "journaled" }],
    ["wrong stage acting", { stage: "acting" }],
    ["wrong stage finalized", { stage: "finalized" }],
    ["missing turn identity", { journalRevision: null }],
    ["divergent turn identity", { journalRevision: "turn-other-9" }],
    ["same revision", { canonicalProgressRevision: 2 }],
    ["two revisions forward", { canonicalProgressRevision: 4 }],
    ["stale player epoch", { playerTurnEpoch: 0 }],
  ]) {
    const circuit = latchedCircuit();
    const candidate = recoveredProgress(overrides);
    circuit.advance({
      campaignId: circuitCampaign,
      playerTurnEpoch: candidate.playerTurnEpoch,
      canonicalProgress: candidate,
    });
    assert.equal(
      progressBlocked(circuit, candidate, label),
      true,
      `${label}: near-miss recovery must stay rejected`,
    );
  }

  // A divergent repeat after a successful recovery is a projection conflict,
  // not another authorized transition.
  {
    const circuit = latchedCircuit();
    const authorization = circuit.authorizeHostBindingRefresh(
      authorizationArgs(),
    );
    assert.ok(authorization !== null);
    assert.equal(consumeAuthorization(circuit, authorization), true);
    const divergent = recoveredProgress({ journalRevision: "turn-forged-9" });
    assert.equal(
      progressBlocked(circuit, divergent, "divergent-after-recovery"),
      true,
      "divergent repeat after recovery must stay rejected",
    );
  }

  // Regression from a non-faulted progress is never authorized.
  {
    const circuit = new NonRetryableFailureCircuit();
    circuit.advance({
      campaignId: circuitCampaign,
      playerTurnEpoch: 1,
      canonicalProgress: recoveredProgress(),
    });
    const regressing = {
      ...faultedProgress,
      stage: "journaled",
      canonicalProgressRevision: 4,
    };
    circuit.advance({
      campaignId: circuitCampaign,
      playerTurnEpoch: 1,
      canonicalProgress: regressing,
    });
    assert.equal(
      progressBlocked(circuit, regressing, "non-faulted-regression"),
      true,
      "regression against non-faulted progress must stay rejected",
    );
  }
});
