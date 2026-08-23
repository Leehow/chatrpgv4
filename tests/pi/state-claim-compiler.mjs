#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const moduleUrl = pathToFileURL(path.join(
  root, "plugins/coc-keeper/pi/lib/state-claim-compiler.ts",
)).href;
const {
  PiStateClaimCompiler, canonicalDigest, draftParagraphs,
} = await import(moduleUrl);

const campaignId = "compiler-fixture";
const subjectRef = "pc:thomas-hayes";
const contextEnvelope = (revision = 1) => ({
  ok: true,
  tool: "turn.output_context",
  data: {
    turn_id: "turn-1",
    source_digest: "sha256:source-1",
    settlement_snapshot_id: "turn-settlement-v1:snapshot-1",
    mechanics_bundle_sha256: "sha256:mechanics-1",
    contract_projection: {
      agency_authority: { pc_subject_refs: [subjectRef] },
    },
    agency_review_operation: {
      prefilled_arguments: { revision },
    },
  },
});

const reviewArguments = (draft, claims = [], revision = 1) => ({
  turn_id: "turn-1",
  source_digest: "sha256:source-1",
  revision,
  draft_text: draft,
  state_authority_review: {
    disposition: claims.length > 0
      ? "claims_listed" : "no_player_state_change_claimed",
    reason: claims.length > 0 ? "KP listed claims." : "KP found no claims.",
    claims,
  },
});

const resultFor = (input, claims) => {
  const paragraphs = draftParagraphs(input.draft_text);
  return {
    schema_version: 1,
    contract_id: "coc.pi-state-claim-compiler-result.v1",
    disposition: claims.length > 0 ? "claims_detected" : "no_claims_detected",
    reason: "Every paragraph was semantically reviewed.",
    claims,
    paragraph_coverage: paragraphs.map((text, paragraph_index) => ({
      paragraph_index,
      paragraph_sha256: canonicalDigest(text),
      claim_indices: claims.flatMap((claim, index) => (
        text.includes(claim.exact_excerpt) ? [index] : []
      )),
    })),
  };
};

const runtime = {
  campaignId,
  ctx: {
    model: { provider: "requested", id: "keeper", api: "openai-responses" },
  },
  sessionEpoch: 7,
  isCurrent: (epoch) => epoch === 7,
};

test("compiler sees only exact draft, PC refs, and effect-free KP candidates", async () => {
  let observedInput;
  const compiler = new PiStateClaimCompiler(async (input, schema) => {
    observedInput = input;
    assert.deepEqual(schema.properties.claims.items.properties.subject_ref.enum, [subjectRef]);
    return {
      result: resultFor(input, [{
        subject_ref: subjectRef,
        claim_kind: "cash",
        exact_excerpt: "twenty dollars into your hand",
        matched_review_claim_id: "kp-cash",
        reason: "The draft asserts possession of the cash now.",
      }]),
      responseModel: {
        provider: "actual-provider", id: "actual-model", api: "actual-api",
      },
    };
  });
  compiler.observeOutputContext(campaignId, contextEnvelope());
  const draft = "Knott presses twenty dollars into your hand.";
  const receipt = await compiler.compileReview({
    ...runtime,
    arguments: reviewArguments(draft, [{
      claim_id: "kp-cash",
      subject_ref: subjectRef,
      claim_kind: "cash",
      exact_excerpt: "twenty dollars into your hand",
      source_effect_id: "turn-effect-v1:cash-1",
      reason: "Grounded cash receipt.",
    }]),
  });

  assert.equal(JSON.stringify(observedInput).includes("source_effect_id"), false);
  assert.equal(JSON.stringify(observedInput).includes("turn-effect-v1"), false);
  assert.deepEqual(receipt.response_model, {
    provider: "actual-provider", id: "actual-model", api: "actual-api",
  });
  assert.deepEqual(receipt.binding, {
    turn_id: "turn-1",
    source_digest: "sha256:source-1",
    revision: 1,
    draft_sha256: canonicalDigest(draft),
    kp_review_digest: canonicalDigest(reviewArguments(draft, [{
      claim_id: "kp-cash",
      subject_ref: subjectRef,
      claim_kind: "cash",
      exact_excerpt: "twenty dollars into your hand",
      source_effect_id: "turn-effect-v1:cash-1",
      reason: "Grounded cash receipt.",
    }]).state_authority_review),
    settlement_snapshot_id: "turn-settlement-v1:snapshot-1",
    mechanics_bundle_sha256: "sha256:mechanics-1",
  });
});

for (const fixture of [
  { language: "zh", draft: "诺特把钥匙和地址便签递到你手中。", excerpt: "钥匙和地址便签递到你手中" },
  { language: "en", draft: "Knott leaves the key and address note in your care.", excerpt: "key and address note in your care" },
  { language: "ja", draft: "ノットは鍵と住所のメモをあなたに手渡した。", excerpt: "鍵と住所のメモをあなたに手渡した" },
]) {
  test(`multilingual semantic result is structurally preserved: ${fixture.language}`, async () => {
    const compiler = new PiStateClaimCompiler(async (input) => ({
      result: resultFor(input, [{
        subject_ref: subjectRef,
        claim_kind: "item",
        exact_excerpt: fixture.excerpt,
        matched_review_claim_id: null,
        reason: "The exact paraphrase asserts current possession.",
      }]),
      responseModel: { provider: "p", id: "m", api: "a" },
    }));
    compiler.observeOutputContext(campaignId, contextEnvelope());
    const receipt = await compiler.compileReview({
      ...runtime, arguments: reviewArguments(fixture.draft),
    });
    assert.equal(receipt.result.claims[0].exact_excerpt, fixture.excerpt);
    assert.equal(receipt.result.claims[0].claim_kind, "item");
  });
}

test("malformed paragraph coverage fails closed and is not cached", async () => {
  let calls = 0;
  const compiler = new PiStateClaimCompiler(async (input) => {
    calls += 1;
    const result = resultFor(input, []);
    result.paragraph_coverage = [];
    return {
      result,
      responseModel: { provider: "p", id: "m", api: "a" },
    };
  });
  compiler.observeOutputContext(campaignId, contextEnvelope());
  const options = { ...runtime, arguments: reviewArguments("One paragraph.") };
  await assert.rejects(() => compiler.compileReview(options), /state_claim_coverage_incomplete/);
  await assert.rejects(() => compiler.compileReview(options), /state_claim_coverage_incomplete/);
  assert.equal(calls, 2);
});

test("stale turn identity fails before inference", async () => {
  let calls = 0;
  const compiler = new PiStateClaimCompiler(async () => { calls += 1; });
  compiler.observeOutputContext(campaignId, contextEnvelope());
  await assert.rejects(() => compiler.compileReview({
    ...runtime,
    arguments: { ...reviewArguments("No state change."), source_digest: "sha256:stale" },
  }), /state_claim_compiler_context_missing/);
  assert.equal(calls, 0);
});

test("owned timeout bounds an inference that ignores abort and never caches it", async () => {
  let calls = 0;
  const compiler = new PiStateClaimCompiler(async () => {
    calls += 1;
    return await new Promise(() => {});
  }, 5);
  compiler.observeOutputContext(campaignId, contextEnvelope());
  const options = { ...runtime, arguments: reviewArguments("No state change.") };
  await assert.rejects(() => compiler.compileReview(options), /state_claim_compiler_timeout/);
  await assert.rejects(() => compiler.compileReview(options), /state_claim_compiler_timeout/);
  assert.equal(calls, 2);
});

test("successful identical semantic input is singleflight and cached", async () => {
  let calls = 0;
  const compiler = new PiStateClaimCompiler(async (input) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      result: resultFor(input, []),
      responseModel: { provider: "p", id: "m", api: "a" },
    };
  });
  compiler.observeOutputContext(campaignId, contextEnvelope());
  const options = { ...runtime, arguments: reviewArguments("No state change.") };
  const [left, right] = await Promise.all([
    compiler.compileReview(options), compiler.compileReview(options),
  ]);
  const replay = await compiler.compileReview(options);
  assert.equal(calls, 1);
  assert.equal(left.binding_digest, right.binding_digest);
  assert.equal(left.binding_digest, replay.binding_digest);
});

test("direct model protocol rejects text-only, wrong, and multiple tool calls", async () => {
  const protocolFailures = [
    {
      stopReason: "stop",
      content: [{ type: "text", text: "No claims." }],
    },
    {
      stopReason: "toolUse",
      content: [{ type: "toolCall", name: "wrong_function", arguments: {} }],
    },
    {
      stopReason: "toolUse",
      content: [
        { type: "toolCall", name: "emit_state_claim_compilation", arguments: {} },
        { type: "toolCall", name: "emit_state_claim_compilation", arguments: {} },
      ],
    },
  ];
  for (const failure of protocolFailures) {
    const compiler = new PiStateClaimCompiler();
    compiler.observeOutputContext(campaignId, contextEnvelope());
    const ctx = {
      model: { provider: "requested", id: "keeper", api: "openai-responses" },
      modelRegistry: {
        complete: async () => ({
          ...failure,
          provider: "actual", model: "semantic", api: "responses",
        }),
      },
    };
    await assert.rejects(() => compiler.compileReview({
      ...runtime,
      ctx,
      arguments: reviewArguments("No state change."),
    }), /state_claim_model_protocol_invalid/);
  }
});
