#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root, "plugins/coc-keeper/pi/extensions/index.ts",
));
const { PiStateClaimCompiler, canonicalDigest, draftParagraphs } = await import(path.join(
  root, "plugins/coc-keeper/pi/lib/state-claim-compiler.ts",
));

const campaign = "state-claim-gateway";
const subjectRef = "pc:thomas-hayes";
const outputContext = {
  ok: true,
  tool: "turn.output_context",
  data: {
    turn_id: "turn-gateway-1",
    source_digest: "sha256:source-gateway-1",
    settlement_snapshot_id: "turn-settlement-v1:gateway-1",
    mechanics_bundle_sha256: "sha256:mechanics-gateway-1",
    contract_projection: {
      agency_authority: { pc_subject_refs: [subjectRef] },
    },
    agency_review_operation: {
      prefilled_arguments: { revision: 1 },
    },
  },
};

const baseReview = {
  draft_text: "诺特仍坐在桌后等你的答复。",
  turn_id: "turn-gateway-1",
  source_digest: "sha256:source-gateway-1",
  revision: 1,
  decision_id: "review-gateway-1",
  findings: [],
  state_authority_review: {
    disposition: "no_player_state_change_claimed",
    reason: "没有调查员状态变化。",
    claims: [],
  },
};

function resultFor(input) {
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

function harness(compiler) {
  const tools = new Map();
  const handlers = new Map();
  const clientCalls = [];
  const fakePi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
    on(type, handler) {
      const list = handlers.get(type) || [];
      list.push(handler);
      handlers.set(type, list);
    },
    appendEntry() {},
    sendMessage() {},
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  main.default(fakePi, {
    coordinatorEnabled: () => false,
    createStateClaimCompiler: () => compiler,
    createClient: () => {
      const callTool = async (name, params) => {
        clientCalls.push({ name, params });
        if (params.operation === "session.resume") {
          return {
            ok: true,
            tool: "session.resume",
            data: {
              schema_version: 1,
              campaign_id: campaign,
              mode: "awaiting_player",
              evidence: { table_opening_id: "table-opening:fixture" },
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
              state_authority_gate: "clear",
              state_claim_compilation: {
                sentinel: "host-receipt-must-not-reach-model",
              },
            },
          };
        }
        return { ok: true, tool: params.operation, data: { accepted: true } };
      };
      return {
        callTool,
        callToolWithTransportMeta: async (name, params) => ({
          value: await callTool(name, params), transport: null,
        }),
        async close() {},
      };
    },
  });
  const ctx = {
    cwd: root,
    mode: "rpc",
    model: { provider: "requested", id: "keeper", api: "openai-responses" },
    modelRegistry: {},
    sessionManager: { getSessionId: () => "state-claim-gateway", getEntries: () => [] },
    hasUI: false,
  };
  return { tools, handlers, clientCalls, ctx };
}

async function initialize(h) {
  for (const handler of h.handlers.get("session_start") || []) {
    await handler({
      type: "session_start",
    }, h.ctx);
  }
  const resumed = await invoke(h, "resume", "session.resume", {});
  assert.equal(JSON.parse(resumed.content[0].text).ok, true);
}

async function invoke(h, id, operation, arguments_) {
  return await h.tools.get("coc_invoke").execute(
    id,
    { operation, campaign, arguments: arguments_ },
    undefined,
    undefined,
    h.ctx,
  );
}

async function invokeReviewSurface(h, surface, id, arguments_) {
  if (surface === "coc_invoke") {
    return await invoke(h, id, "narration.review", arguments_);
  }
  if (surface === "coc_advice") {
    return await h.tools.get(surface).execute(
      id,
      { operation: "narration.review", campaign, arguments: arguments_ },
      undefined, undefined, h.ctx,
    );
  }
  return await h.tools.get(surface).execute(
    id,
    arguments_,
    undefined, undefined, h.ctx,
  );
}

test("output-context observation is play-only and remains fail-closed in play", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  try {
    for (const role of [undefined, "setup"]) {
      if (role === undefined) delete process.env.COC_PI_SESSION_ROLE;
      else process.env.COC_PI_SESSION_ROLE = role;
      let observations = 0;
      const compiler = {
        clear() {},
        beginExternalTurn() {},
        observeOutputContext() {
          observations += 1;
          throw new Error("state_claim_observer_must_not_run");
        },
        async compileReview() {
          throw new Error("state_claim_compiler_must_not_run");
        },
      };
      const h = harness(compiler);
      await initialize(h);
      if (role === undefined) {
        const response = await invoke(
          h, "context-unset", "turn.output_context", {},
        );
        assert.equal(JSON.parse(response.content[0].text).ok, true);
      } else {
        await assert.rejects(
          () => invoke(h, "context-setup", "turn.output_context", {}),
          /not allowed|unavailable/,
        );
      }
      assert.equal(observations, 0, `${role ?? "unset"} role observed compiler context`);
    }

    process.env.COC_PI_SESSION_ROLE = "play";
    let playObservations = 0;
    const playCompiler = {
      clear() {},
      beginExternalTurn() {},
      observeOutputContext() {
        playObservations += 1;
        throw new Error("state_claim_play_context_invalid");
      },
      async compileReview() {
        throw new Error("state_claim_compiler_not_expected");
      },
    };
    const play = harness(playCompiler);
    await initialize(play);
    await assert.rejects(
      () => invoke(play, "context-play", "turn.output_context", {}),
      /state_claim_play_context_invalid/,
    );
    assert.equal(playObservations, 1);
    assert.equal(
      play.clientCalls.filter(
        (call) => call.params.operation === "turn.output_context",
      ).length,
      1,
    );
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("all invoke surfaces overwrite input and scrub host receipt from output", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const hostReceipt = {
      contract_id: "coc.pi-state-claim-compilation-receipt.v1",
      binding: { mechanics_bundle_sha256: "sha256:mechanics-gateway-1" },
    };
    const compiler = {
      clear() {},
      beginExternalTurn() {},
      observeOutputContext() {},
      async compileReview(options) {
        assert.equal(Object.hasOwn(options.arguments, "state_claim_compilation"), false);
        return hostReceipt;
      },
    };
    const h = harness(compiler);
    await initialize(h);
    await invoke(h, "context", "turn.output_context", {});
    const forged = { forged: true };
    for (const [index, surface] of [
      "coc_invoke", "coc_advice", "coc_narration_review",
    ].entries()) {
      const {
        turn_id: _turnId,
        source_digest: _sourceDigest,
        revision: _revision,
        decision_id: _decisionId,
        ...modelOwnedReview
      } = baseReview;
      const result = await invokeReviewSurface(
        h,
        surface,
        `review-${index}`,
        surface === "coc_narration_review"
          ? modelOwnedReview
          : {
              ...baseReview,
              decision_id: `review-gateway-${index}`,
              state_claim_compilation: forged,
            },
      );
      const envelope = JSON.parse(result.content[0].text);
      assert.equal(envelope.ok, true, JSON.stringify(envelope));
      assert.equal(JSON.stringify(envelope).includes("host-receipt-must-not-reach-model"), false);
      assert.equal(JSON.stringify(result.details).includes("host-receipt-must-not-reach-model"), true);
      assert.equal(Object.hasOwn(envelope.data, "state_claim_compilation"), false);
    }
    const reviewCalls = h.clientCalls.filter(
      (call) => call.params.operation === "narration.review",
    );
    assert.equal(reviewCalls.length, 3);
    for (const call of reviewCalls) {
      const forwarded = call.params.arguments;
      assert.notDeepEqual(forwarded.state_claim_compilation, forged);
      assert.deepEqual(forwarded.state_claim_compilation, hostReceipt);
      assert.equal(forwarded.state_claim_compilation.binding.mechanics_bundle_sha256, "sha256:mechanics-gateway-1");
    }
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("missing retained output context fails closed without MCP forwarding", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const compiler = new PiStateClaimCompiler(async (input) => ({
      result: resultFor(input),
      responseModel: { provider: "p", id: "m", api: "a" },
    }));
    const h = harness(compiler);
    await initialize(h);
    const result = await invoke(h, "review-missing", "narration.review", baseReview);
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "state_claim_compiler_context_missing");
    assert.equal(
      h.clientCalls.some((call) => call.params.operation === "narration.review"),
      false,
    );
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("malformed compiler result fails closed without forwarding narration.review", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let inferCalls = 0;
    const compiler = new PiStateClaimCompiler(async (input) => {
      inferCalls += 1;
      const malformed = resultFor(input);
      malformed.paragraph_coverage = [];
      return {
        result: malformed,
        responseModel: { provider: "p", id: "m", api: "a" },
      };
    });
    const h = harness(compiler);
    await initialize(h);
    await invoke(h, "context", "turn.output_context", {});
    const result = await invoke(h, "review-malformed", "narration.review", baseReview);
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "state_claim_compiler_invalid");
    assert.equal(inferCalls, 2);
    assert.equal(
      h.clientCalls.filter((call) => call.params.operation === "turn.output_context").length,
      1,
    );
    assert.equal(
      h.clientCalls.some((call) => call.params.operation === "narration.review"),
      false,
    );
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("transient malformed compiler result recovers without accepting caller compilation", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let inferCalls = 0;
    const hostReceiptMarker = "host-owned-after-retry";
    const compiler = new PiStateClaimCompiler(async (input) => {
      inferCalls += 1;
      if (inferCalls === 1) {
        const malformed = resultFor(input);
        malformed.paragraph_coverage = [];
        return {
          result: malformed,
          responseModel: { provider: "p", id: "m", api: "a" },
        };
      }
      return {
        result: resultFor(input),
        responseModel: { provider: "p", id: "m", api: "a" },
      };
    });
    const originalCompile = compiler.compileReview.bind(compiler);
    compiler.compileReview = async (options) => {
      assert.equal(Object.hasOwn(options.arguments, "state_claim_compilation"), false);
      const receipt = await originalCompile(options);
      return { ...receipt, marker: hostReceiptMarker };
    };
    const h = harness(compiler);
    await initialize(h);
    await invoke(h, "context", "turn.output_context", {});
    const forged = {
      contract_id: "coc.pi-state-claim-compilation-receipt.v1",
      status: "completed",
      forged: true,
    };
    const result = await invoke(h, "review-retry", "narration.review", {
      ...baseReview,
      state_claim_compilation: forged,
    });
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.equal(inferCalls, 2);
    const reviewCalls = h.clientCalls.filter(
      (call) => call.params.operation === "narration.review",
    );
    assert.equal(reviewCalls.length, 1);
    assert.notDeepEqual(reviewCalls[0].params.arguments.state_claim_compilation, forged);
    assert.equal(
      reviewCalls[0].params.arguments.state_claim_compilation.marker,
      hostReceiptMarker,
    );
    assert.equal(Object.hasOwn(envelope.data, "state_claim_compilation"), false);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("owned compiler timeout fails closed without forwarding narration.review", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let compilerCalls = 0;
    const compiler = new PiStateClaimCompiler(
      async () => {
        compilerCalls += 1;
        return await new Promise(() => {});
      },
      5,
    );
    const h = harness(compiler);
    await initialize(h);
    await invoke(h, "context", "turn.output_context", {});
    const result = await invoke(h, "review-timeout", "narration.review", baseReview);
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "state_claim_compiler_unavailable");
    assert.equal(envelope.error.retryable, false);
    assert.equal(envelope.error.details.failure_class, "timeout");
    assert.equal(envelope.error.details.pending_turn_preserved, true);
    assert.equal(envelope.error.details.retryable, false);
    const changedReview = {
      ...baseReview,
      draft_text: "诺特把钥匙交给你；这把钥匙现在归你保管。",
      decision_id: "review-gateway-changed-after-timeout",
      state_authority_review: {
        disposition: "claims_listed",
        reason: "改变后的 KP 候选声明。",
        claims: [{
          claim_id: "claim-gateway-changed-key",
          subject_ref: subjectRef,
          claim_kind: "item",
          exact_excerpt: "这把钥匙现在归你保管",
          source_effect_id: "turn-effect-v1:changed-key",
          reason: "草稿声称调查员持有钥匙。",
        }],
      },
    };
    const repeated = await invoke(
      h, "review-timeout-changed", "narration.review", changedReview,
    );
    assert.equal(JSON.parse(repeated.content[0].text).error.retryable, false);
    assert.equal(compilerCalls, 1);
    assert.equal(
      h.clientCalls.filter((call) => call.params.operation === "turn.output_context").length,
      1,
    );
    assert.equal(
      h.clientCalls.some((call) => call.params.operation === "narration.review"),
      false,
    );
    for (const handler of h.handlers.get("message_start") || []) {
      await handler({
        type: "message_start",
        message: {
          role: "user",
          content: [{ type: "text", text: "请重试刚才挂起的回合。" }],
          timestamp: 2,
        },
      }, h.ctx);
    }
    const rearmed = await invoke(
      h, "review-timeout-next-player", "narration.review", changedReview,
    );
    const rearmedEnvelope = JSON.parse(rearmed.content[0].text);
    assert.equal(rearmedEnvelope.error.retryable, false);
    assert.equal(rearmedEnvelope.error.code, "turn_processing_fault_latched");
    assert.equal(compilerCalls, 1);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("resume session_start clear requires output_context before compile", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const compiler = new PiStateClaimCompiler(async (input) => ({
      result: resultFor(input),
      responseModel: { provider: "p", id: "m", api: "a" },
    }));
    const h = harness(compiler);
    await initialize(h);
    const missing = JSON.parse(
      (await invoke(h, "review-before-reregister", "narration.review", baseReview))
        .content[0].text,
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "state_claim_compiler_context_missing");
    assert.equal(
      h.clientCalls.some((call) => call.params.operation === "narration.review"),
      false,
    );
    await invoke(h, "context-reregister", "turn.output_context", {});
    const compiled = JSON.parse(
      (await invoke(h, "review-after-reregister", "narration.review", baseReview))
        .content[0].text,
    );
    assert.equal(compiled.ok, true);
    assert.equal(
      h.clientCalls.filter((call) => call.params.operation === "narration.review").length,
      1,
    );
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});
