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
      "requested_model", "retryable", "schema_version", "stage", "status",
      "turn_id", "will_retry",
    ].sort());
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
    assert.equal(compilerCalls, 1);
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
