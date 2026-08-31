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
const CURRENT_PC_SUBJECT_HANDLE = "pc:current-investigator";
const mechanicsDigest = `sha256:${"6".repeat(64)}`;
const outputContext = {
  ok: true,
  tool: "turn.output_context",
  data: {
    turn_id: "turn-gateway-1",
    source_digest: "sha256:source-gateway-1",
    settlement_snapshot_id: "turn-settlement-v1:gateway-1",
    mechanics_bundle_sha256: mechanicsDigest,
    journal_decision_id: "journal-gateway-1",
    obligations: [],
    mechanics_summary: {
      public_check: [],
      state_delta: [],
      exceptional_effect: [],
      concealed_consequence: [],
    },
    contract_projection: {
      agency_review_required: true,
      player_input: {
        source_ref: "player_input:journal-gateway-1",
        text: "我等待诺特的答复。",
      },
      control_overrides: [],
      agency_authority: {
        pc_subject_refs: [subjectRef],
        involuntary_physiology_sources: [{
          source_ref: "narration_contract:involuntary_physiology",
          source_type: "ownership_contract",
        }],
      },
    },
    agency_review_operation: {
      operation: "narration.review",
      invoke_via: "coc_narration_review",
      prefilled_arguments: {
        turn_id: "turn-gateway-1",
        source_digest: "sha256:source-gateway-1",
        revision: 1,
      },
      missing_arguments: [
        "decision_id", "draft_text", "findings", "state_authority_review",
      ],
    },
    finalize_operation: {
      operation: "turn.finalize",
      invoke_via: "coc_turn_finalize",
      prefilled_arguments: { revision: 1 },
      missing_arguments: ["draft", "narration_review_id", "agency_claims"],
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
// Host-owned settle identity (turn_id/source_digest/revision/decision_id)
// is gateway-bound from the armed output-context card on every surface; the
// model payload carries only this model-owned review shape.
const modelOwnedReview = (({
  turn_id: _turnId,
  source_digest: _sourceDigest,
  revision: _revision,
  decision_id: _decisionId,
  ...owned
}) => owned)(baseReview);


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

function harness(compiler, overrides = {}) {
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
    ...(overrides.createSemanticIdentityRegistry !== undefined
      ? { createSemanticIdentityRegistry: overrides.createSemanticIdentityRegistry }
      : {}),
    createClient: () => {
      const callTool = async (name, params) => {
        clientCalls.push({ name, params });
        if (typeof overrides.callTool === "function") {
          const overridden = await overrides.callTool(name, params, clientCalls);
          if (overridden !== undefined) return overridden;
        }
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
        let rejected = null;
        try {
          await invoke(h, "context-setup", "turn.output_context", {});
        } catch (error) {
          rejected = error;
        }
        assert.ok(
          rejected !== null
            && /not allowed|unavailable/.test(String(rejected)),
          "setup-role output_context must reject: "
            + JSON.stringify(String(rejected ?? "<no rejection>")),
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
      binding: { mechanics_bundle_sha256: mechanicsDigest },
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
      if (surface === "coc_invoke") {
        // state_claim_compilation is HOST-owned on the registered generic
        // surface: the forged receipt is rejected by the strict registered
        // schema BEFORE the compiler runs and BEFORE transport — it can
        // never be model-relayed on this surface.
        const rejected = await invokeReviewSurface(
          h,
          surface,
          `review-${index}`,
          { ...modelOwnedReview, state_claim_compilation: forged },
        );
        const rejectedEnvelope = JSON.parse(rejected.content[0].text);
        assert.equal(rejectedEnvelope.ok, false);
        assert.equal(rejectedEnvelope.error.code, "unknown_model_argument");
        assert.equal(
          JSON.stringify(rejectedEnvelope).includes("host-receipt-must-not-reach-model"),
          false,
          "the forged receipt is never echoed",
        );
        assert.equal(
          h.clientCalls.some((call) => call.params.operation === "narration.review"),
          false,
          "the forged generic receipt never reaches transport",
        );
        continue;
      }
      if (surface === "coc_advice") {
        // The domain-tool surface enforces the same registered generic
        // schema: a host-authored compiler receipt is rejected BEFORE the
        // compiler runs and BEFORE transport — it can never be model-relayed.
        const rejected = await invokeReviewSurface(
          h,
          surface,
          `review-${index}`,
          { ...modelOwnedReview, state_claim_compilation: forged },
        );
        const rejectedEnvelope = JSON.parse(rejected.content[0].text);
        assert.equal(rejectedEnvelope.ok, false);
        assert.equal(rejectedEnvelope.error.code, "unknown_model_argument");
        assert.equal(
          JSON.stringify(rejectedEnvelope).includes("host-receipt-must-not-reach-model"),
          false,
        );
        continue;
      }
      const result = await invokeReviewSurface(
        h,
        surface,
        `review-${index}`,
        modelOwnedReview,
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
    assert.equal(reviewCalls.length, 1);
    for (const call of reviewCalls) {
      const forwarded = call.params.arguments;
      assert.notDeepEqual(forwarded.state_claim_compilation, forged);
      assert.deepEqual(forwarded.state_claim_compilation, hostReceipt);
      assert.equal(forwarded.state_claim_compilation.binding.mechanics_bundle_sha256, mechanicsDigest);
    }
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("rewrite-required review advances the retained host binding before corrected draft", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    let compilation = 0;
    const compiler = new PiStateClaimCompiler(async (input) => {
      compilation += 1;
      const result = resultFor(input);
      if (compilation === 1) {
        result.disposition = "claims_detected";
        result.reason = "The first draft claims an ungrounded current condition.";
        result.claims = [{
          subject_ref: subjectRef,
          claim_kind: "condition",
          exact_excerpt: "你身上一阵钝痛突然顶上来，呼吸跟着短了一截",
          matched_review_claim_id: null,
          reason: "The draft asserts a current player-character condition.",
        }];
        result.paragraph_coverage[0].claim_indices = [0];
      }
      return {
        result,
        responseModel: { provider: "p", id: "m", api: "a" },
      };
    });

    let firstForwarded = null;
    let acceptedRevisionTwo = null;
    const h = harness(compiler, {
      async callTool(_name, params, calls) {
        if (params.operation === "turn.output_context") {
          const outputContextCalls = calls.filter(
            (call) => call.params.operation === "turn.output_context",
          ).length;
          if (outputContextCalls > 1) {
            return {
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
          }
          return undefined;
        }
        if (params.operation !== "narration.review") return undefined;
        const forwarded = params.arguments;
        if (firstForwarded === null) {
          firstForwarded = structuredClone(forwarded);
          return {
            ok: true,
            tool: "narration.review",
            data: {
              review_id: "narration-review-v1:rewrite-required-fixture",
              turn_id: "turn-gateway-1",
              source_digest: "sha256:source-gateway-1",
              revision: 1,
              findings: [],
              agency_gate: "clear",
              state_claim_review_disagreement: true,
              state_authority_gate: "rewrite_required",
              recommendation: "revision_required",
              span_repairs: {
                mode: "excerpt_only",
                spans: [{
                  exact_excerpt: "你身上一阵钝痛突然顶上来，呼吸跟着短了一截",
                  claim_kind: "condition",
                  repair: "rephrase_or_remove",
                }],
              },
            },
          };
        }
        if (
          forwarded.revision !== 2
          || forwarded.decision_id === firstForwarded.decision_id
        ) {
          return {
            ok: false,
            tool: "narration.review",
            error: {
              code: "idempotency_conflict",
              message: "narration.review decision_id already owns another turn/revision/draft/findings request",
              retryable: false,
              class: "idempotency_conflict",
              recoverable_by: "host_binding_refresh",
              allowed_next_actions: [],
              automatic_action: "refresh_retained_binding_or_fault",
            },
          };
        }
        if (acceptedRevisionTwo !== null) {
          if (
            forwarded.decision_id !== acceptedRevisionTwo.decision_id
            || forwarded.draft_text !== acceptedRevisionTwo.draft_text
          ) {
            return {
              ok: false,
              tool: "narration.review",
              error: {
                code: "idempotency_conflict",
                message: "narration.review revision-2 replay changed its frozen request",
                retryable: false,
                class: "idempotency_conflict",
                recoverable_by: "host_binding_refresh",
                allowed_next_actions: [],
                automatic_action: "refresh_retained_binding_or_fault",
              },
            };
          }
        } else {
          acceptedRevisionTwo = structuredClone(forwarded);
        }
        return {
          ok: true,
          tool: "narration.review",
          data: {
            review_id: "narration-review-v1:clear-revision-2-fixture",
            turn_id: "turn-gateway-1",
            source_digest: "sha256:source-gateway-1",
            revision: 2,
            findings: [],
            agency_gate: "clear",
            state_authority_gate: "clear",
            draft_sha256: canonicalDigest(forwarded.draft_text),
            state_authority_review: forwarded.state_authority_review,
            recommendation: "accept",
          },
        };
      },
    });
    await initialize(h);
    await invoke(h, "context", "turn.output_context", {});

    const firstDraft = {
      ...modelOwnedReview,
      draft_text: "你身上一阵钝痛突然顶上来，呼吸跟着短了一截。",
    };
    const first = JSON.parse(
      (await invokeReviewSurface(
        h, "coc_narration_review", "review-revision-1", firstDraft,
      )).content[0].text,
    );
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.state_authority_gate, "rewrite_required");

    const correctedDraft = {
      ...modelOwnedReview,
      draft_text: "诺特仍坐在桌后，钥匙在桌面轻轻碰了一下。",
    };
    const corrected = JSON.parse(
      (await invokeReviewSurface(
        h, "coc_narration_review", "review-revision-2", correctedDraft,
      )).content[0].text,
    );
    const reviewTrace = h.clientCalls
      .filter((call) => call.params.operation === "narration.review")
      .map((call, index, calls) => ({
        revision: call.params.arguments.revision,
        same_decision_as_first: index > 0
          && call.params.arguments.decision_id
            === calls[0].params.arguments.decision_id,
      }));
    assert.equal(corrected.ok, true, JSON.stringify({ corrected, reviewTrace }));
    assert.equal(corrected.data.revision, 2);

    const callsBeforeReplay = h.clientCalls.length;
    const replay = JSON.parse(
      (await invokeReviewSurface(
        h, "coc_narration_review", "review-revision-2-replay", correctedDraft,
      )).content[0].text,
    );
    assert.equal(replay.ok, false, JSON.stringify(replay));
    assert.equal(replay.error.code, "state_claim_compiler_context_missing");
    assert.equal(
      h.clientCalls.length,
      callsBeforeReplay,
      "an accepted review is closed and cannot be repeated at transport",
    );

    const callsBeforeStale = h.clientCalls.length;
    const stale = JSON.parse(
      (await invokeReviewSurface(
        h,
        "coc_narration_review",
        "review-stale-revision",
        { ...correctedDraft, revision: 1 },
      )).content[0].text,
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "state_claim_compiler_context_missing");
    assert.equal(h.clientCalls.length, callsBeforeStale);

    const forwarded = h.clientCalls
      .filter((call) => call.params.operation === "narration.review")
      .map((call) => call.params.arguments);
    assert.equal(forwarded.length, 2);
    assert.deepEqual(forwarded.map((args) => args.revision), [1, 2]);
    assert.equal(compilation, 2, "accepted revision 2 closes the review lane");
    assert.notEqual(forwarded[0].decision_id, forwarded[1].decision_id);
    assert.equal(forwarded[1].turn_id, forwarded[0].turn_id);
    assert.equal(forwarded[1].source_digest, forwarded[0].source_digest);
    assert.equal(
      forwarded[1].state_claim_compilation.binding.settlement_snapshot_id,
      forwarded[0].state_claim_compilation.binding.settlement_snapshot_id,
    );
    assert.equal(
      forwarded[1].state_claim_compilation.binding.mechanics_bundle_sha256,
      forwarded[0].state_claim_compilation.binding.mechanics_bundle_sha256,
    );
    const contextRefreshes = h.clientCalls.filter(
      (call) => call.params.operation === "turn.output_context",
    );
    assert.equal(contextRefreshes.length, 2);
    assert.deepEqual(contextRefreshes[1].params.arguments, {});

    const finalizeTool = h.tools.get("coc_turn_finalize");
    assert.ok(!Object.hasOwn(finalizeTool.parameters.properties, "draft"));
    assert.ok(
      !JSON.stringify(finalizeTool.parameters.properties.agency_claims)
        .includes("exact_excerpt"),
    );
    await finalizeTool.execute(
      "finalize-revision-2",
      {
        coverage: [],
        agency_claims: [],
      },
      undefined,
      undefined,
      h.ctx,
    );
    const finalizeCall = h.clientCalls.filter(
      (call) => call.params.operation === "turn.finalize",
    ).at(-1);
    assert.ok(finalizeCall, "clean revision 2 must arm the finalize binding");
    assert.equal(finalizeCall.params.arguments.revision, 2);
    assert.equal(
      finalizeCall.params.arguments.narration_review_id,
      "narration-review-v1:clear-revision-2-fixture",
    );
    assert.equal(finalizeCall.params.arguments.draft, correctedDraft.draft_text);
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});

test("clear review lets Grok submit semantic spans while host preserves Chinese exact evidence", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  process.env.COC_PI_SESSION_ROLE = "play";
  try {
    const compiler = new PiStateClaimCompiler(async (input) => ({
      result: resultFor(input),
      responseModel: { provider: "xai", id: "grok-4.6", api: "openai-responses" },
    }));
    const draft = (
      "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。"
      + "硬木棱反复撞上骨节，直到指节的皮裂开，血顺着拳面往下淌。\n\n"
      + "诺特没有退，也没有叫人。"
    );
    const stateExcerpt = "直到指节的皮裂开，血顺着拳面往下淌。";
    const stateReview = {
      disposition: "claims_listed",
      reason: "精确记录草稿里的指节伤势。",
      claims: [{
        claim_id: "claim-knuckle-injury",
        subject_ref: CURRENT_PC_SUBJECT_HANDLE,
        claim_kind: "scalar",
        exact_excerpt: stateExcerpt,
        source_effect_id: null,
        reason: "测试只锁定 accepted-review 到 finalize 的精确文本绑定。",
      }],
    };
    const h = harness(compiler, {
      async callTool(_name, params) {
        if (params.operation === "narration.review") {
          return {
            ok: true,
            tool: "narration.review",
            data: {
              review_id: "narration-review-v1:semantic-span-fixture",
              turn_id: "turn-gateway-1",
              source_digest: "sha256:source-gateway-1",
              revision: 1,
              draft_sha256: canonicalDigest(params.arguments.draft_text),
              findings: [],
              agency_gate: "clear",
              state_authority_review: params.arguments.state_authority_review,
              state_authority_gate: "clear",
              recommendation: "no_revision_suggested",
            },
          };
        }
        if (params.operation === "turn.finalize") {
          const renderedText = "宿主精确绑定的结算文本。";
          return {
            ok: true,
            tool: "turn.finalize",
            data: {
              schema_version: 1,
              status: "finalized",
              accepted_revision: 1,
              rendered_text: renderedText,
              rendered_text_sha256: canonicalDigest(renderedText),
            },
          };
        }
        return undefined;
      },
    });
    await initialize(h);
    await invoke(h, "context-semantic-spans", "turn.output_context", {});
    const review = await h.tools.get("coc_narration_review").execute(
      "review-semantic-spans",
      { draft_text: draft, findings: [], state_authority_review: stateReview },
      undefined,
      undefined,
      h.ctx,
    );
    const reviewVisible = JSON.parse(review.content[0].text);
    assert.equal(reviewVisible.ok, true, JSON.stringify(reviewVisible));
    assert.equal(
      reviewVisible.data.finalize_agency_binding.mode,
      "semantic_reviewed_spans",
    );
    assert.ok(
      reviewVisible.data.finalize_agency_binding.reviewed_spans
        .includes("reviewed-state-claim:1"),
    );
    assert.equal(
      JSON.stringify(reviewVisible.data.finalize_agency_binding).includes(stateExcerpt),
      false,
      "model-visible binding contains semantic ordinals, never exact excerpts",
    );

    const finalizeTool = h.tools.get("coc_turn_finalize");
    assert.equal(Object.hasOwn(finalizeTool.parameters.properties, "draft"), false);
    assert.equal(
      JSON.stringify(finalizeTool.parameters.properties.agency_claims)
        .includes("exact_excerpt"),
      false,
    );
    const modelArguments = {
      coverage: [],
      agency_claims: [
        {
          reviewed_span: "reviewed-sentence:paragraph-1:1",
          claim_type: "voluntary_action",
          authority: "current-player-input",
        },
        {
          reviewed_span: "reviewed-state-claim:1",
          claim_type: "involuntary_physiology",
          authority: "involuntary-physiology",
        },
      ],
    };
    assert.equal(JSON.stringify(modelArguments).includes("抡起"), false);
    assert.equal(JSON.stringify(modelArguments).includes("淌"), false);
    const finalized = await invoke(
      h,
      "finalize-semantic-spans",
      "turn.finalize",
      modelArguments,
    );
    const finalizedVisible = JSON.parse(finalized.content[0].text);
    assert.equal(finalizedVisible.ok, true, JSON.stringify(finalizedVisible));
    const transported = h.clientCalls.filter(
      (call) => call.params.operation === "turn.finalize",
    ).at(-1).params.arguments;
    assert.equal(transported.draft, draft);
    assert.equal(
      transported.agency_claims[0].exact_excerpt,
      "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。",
    );
    assert.equal(transported.agency_claims[1].exact_excerpt, stateExcerpt);
    assert.equal(transported.agency_claims[0].source_ref, "player_input:journal-gateway-1");
    assert.equal(
      transported.agency_claims[1].source_ref,
      "narration_contract:involuntary_physiology",
    );
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
    // Host-owned settle identity is gateway-bound; the model payload carries
    // only the model-owned review shape.
    const {
      turn_id: _t, source_digest: _s, revision: _r, decision_id: _d,
      ...modelOwnedReviewArgs
    } = baseReview;
    const result = await invoke(h, "review-missing", "narration.review", modelOwnedReviewArgs);
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
    const result = await invoke(h, "review-malformed", "narration.review", modelOwnedReview);
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
      ...modelOwnedReview,
      state_claim_compilation: forged,
    });
    // A forged caller compilation is HOST-owned identity: the registered
    // schema rejects it before the compiler retries and before transport.
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "unknown_model_argument");
    assert.equal(inferCalls, 0);
    assert.equal(
      h.clientCalls.filter((call) => call.params.operation === "narration.review")
        .length,
      0,
      "the forged receipt never reaches transport",
    );
    assert.equal(
      JSON.stringify(envelope).includes("forged"),
      false,
      "the forged receipt is never echoed",
    );

    // The model-owned retry still recovers through the compiler with the
    // host receipt attached by provenance.
    const retry = await invoke(h, "review-retry-clean", "narration.review", {
      ...modelOwnedReview,
    });
    const retryEnvelope = JSON.parse(retry.content[0].text);
    assert.equal(retryEnvelope.ok, true, JSON.stringify(retryEnvelope));
    assert.equal(inferCalls, 2);
    const reviewCalls = h.clientCalls.filter(
      (call) => call.params.operation === "narration.review",
    );
    assert.equal(reviewCalls.length, 1);
    assert.equal(
      reviewCalls[0].params.arguments.state_claim_compilation.marker,
      hostReceiptMarker,
    );
    assert.equal(Object.hasOwn(retryEnvelope.data, "state_claim_compilation"), false);
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
    const result = await invoke(h, "review-timeout", "narration.review", modelOwnedReview);
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "state_claim_compiler_unavailable");
    assert.equal(envelope.error.retryable, false);
    assert.equal(envelope.error.details.failure_class, "timeout");
    assert.equal(envelope.error.details.pending_turn_preserved, true);
    assert.equal(envelope.error.details.retryable, false);
    const changedReview = {
      ...modelOwnedReview,
      draft_text: "诺特把钥匙交给你；这把钥匙现在归你保管。",
      state_authority_review: {
        disposition: "claims_listed",
        reason: "改变后的 KP 候选声明。",
        claims: [{
          claim_id: "claim-gateway-changed-key",
          // Semantic current-PC handle only; the host restores the exact ref.
          subject_ref: CURRENT_PC_SUBJECT_HANDLE,
          claim_kind: "item",
          exact_excerpt: "这把钥匙现在归你保管",
          source_effect_id: "narration_contract:changed-key",
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
      (await invoke(h, "review-before-reregister", "narration.review", modelOwnedReview))
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
      (await invoke(h, "review-after-reregister", "narration.review", modelOwnedReview))
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

test("setup-role ACL rejects before any semantic-registry access (spy)", async () => {
  const previousRole = process.env.COC_PI_SESSION_ROLE;
  try {
    // Counting wrapper around the REAL registry factory: every registry
    // method call is recorded. Production never passes this override — it
    // exists so regressions can prove the ACL boundary directly.
    const { createSemanticIdentityRegistry } = await import(path.join(
      root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
    ));
    const makeCounting = () => {
      const real = createSemanticIdentityRegistry();
      const calls = Object.fromEntries(
        [...Object.keys(real)].map((key) => [key, 0]),
      );
      const wrapped = Object.fromEntries(
        [...Object.keys(real)].map((key) => [
          key,
          (...args) => {
            calls[key] += 1;
            return real[key](...args);
          },
        ]),
      );
      return { registry: wrapped, calls };
    };

    // Forbidden operation in the setup role: the established ACL error is
    // thrown with ZERO registry calls or side effects.
    process.env.COC_PI_SESSION_ROLE = "setup";
    const setup = makeCounting();
    const setupHarness = harness(
      {
        clear() {},
        beginExternalTurn() {},
        observeOutputContext() {
          throw new Error("state_claim_observer_must_not_run");
        },
        async compileReview() {
          throw new Error("state_claim_compiler_must_not_run");
        },
      },
      { createSemanticIdentityRegistry: () => setup.registry },
    );
    await initialize(setupHarness);
    let rejected = null;
    // Zero the counters after the legitimate setup resume: the assertion is
    // about the ACL-rejected call itself, not the accepted flow before it.
    for (const key of Object.keys(setup.calls)) setup.calls[key] = 0;
    try {
      await invoke(setupHarness, "context-spy-setup", "turn.output_context", {});
    } catch (error) {
      rejected = String(error?.message || error);
    }
    assert.ok(
      rejected !== null && /not allowed|unavailable/.test(rejected),
      "setup-role output_context must reject at the ACL: "
        + JSON.stringify(rejected ?? "<no rejection>"),
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(setup.calls).filter(([, count]) => count !== 0),
      ),
      {},
      "zero registry calls for the ACL-rejected operation",
    );

    // Positive control: the SAME spy observes real registry work during an
    // accepted play-role flow, proving the wrapper is live on this surface.
    process.env.COC_PI_SESSION_ROLE = "play";
    const play = makeCounting();
    const playHarness = harness(
      {
        clear() {},
        beginExternalTurn() {},
        observeOutputContext() {},
        async compileReview() {
          throw new Error("state_claim_compiler_not_expected");
        },
      },
      { createSemanticIdentityRegistry: () => play.registry },
    );
    await initialize(playHarness);
    const playContext = await invoke(
      playHarness, "context-spy-play", "turn.output_context", {},
    );
    assert.equal(JSON.parse(playContext.content[0].text).ok, true);
    assert.equal(
      Object.values(play.calls).some((count) => count > 0),
      true,
      "the counting wrapper observes registry access in play",
    );
  } finally {
    if (previousRole === undefined) delete process.env.COC_PI_SESSION_ROLE;
    else process.env.COC_PI_SESSION_ROLE = previousRole;
  }
});
