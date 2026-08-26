#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const typed = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);

const catalog = typed.defaultTypedToolCatalog();

function assertProjectionError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof typed.ToolContractProjectionError);
    assert.equal(error.code, code);
    return true;
  });
}

function independentCurrent(binding) {
  return structuredClone(binding);
}

test("unarmed catalog keeps newly host-bindable fields model-visible", () => {
  const journal = catalog.byOperation.get("state.journal").parameters;
  assert.ok(journal.required.includes("campaign"));
  assert.ok(journal.required.includes("player_text"));
  assert.ok(journal.required.includes("decision_id"));
  assert.ok(journal.properties.root);
  assert.ok(journal.properties.run_id);

  const finalize = catalog.byOperation.get("turn.finalize").parameters;
  assert.ok(finalize.required.includes("campaign"));
  assert.ok(finalize.required.includes("decision_id"));
  assert.ok(finalize.required.includes("revision"));
  assert.ok(finalize.properties.narration_review_id);
  assert.ok(finalize.properties.repair_finalization_id);
});

test("state.journal binding hides transport/player identity but preserves KP semantics", () => {
  const revision = "turn:allan-ward:17:acting";
  const binding = {
    schema_version: 1,
    operation: "state.journal",
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    player_text: "我先检查地板，再慢慢靠近那扇门。",
    decision_id: "journal:allan-ward:turn-17:revision-1",
    run_id: "run:the-haunting:allan-ward",
  };
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    independentCurrent(binding),
  );
  for (const field of [
    "root",
    "campaign",
    "player_text",
    "decision_id",
    "run_id",
  ]) {
    assert.ok(!Object.hasOwn(schema.properties, field), field);
    assert.ok(!schema.required.includes(field), field);
  }
  for (const field of [
    "summary",
    "intent_class",
    "player_action",
    "continuation",
    "tension",
  ]) {
    assert.ok(Object.hasOwn(schema.properties, field), field);
  }
  assert.ok(schema.required.includes("summary"));

  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      summary: "艾伦检查了门边地板，并保持谨慎。",
      intent_class: "investigate",
      player_action: "检查地板后靠近门",
      continuation: { unresolved_intent: "确认门后动静" },
    },
    binding,
    independentCurrent(binding),
  );
  assert.equal(bound.player_text, binding.player_text);
  assert.equal(bound.decision_id, binding.decision_id);
  assert.equal(bound.summary, "艾伦检查了门边地板，并保持谨慎。");
  assert.deepEqual(bound.continuation, { unresolved_intent: "确认门后动静" });

  const wrapped = typed.wrapTypedToolInvokeParams("coc_state_journal", bound);
  assert.equal(wrapped.root, binding.root);
  assert.equal(wrapped.campaign, binding.campaign);
  assert.ok(!Object.hasOwn(wrapped.arguments, "campaign"));
  assert.equal(wrapped.arguments.player_text, binding.player_text);
  assert.equal(wrapped.arguments.decision_id, binding.decision_id);
  assert.ok(!Object.hasOwn(wrapped.arguments, "root"));
});

test("caller-forged host fields are rejected even when byte-equal", () => {
  const revision = "turn:allan-ward:17:journaled";
  const binding = {
    schema_version: 1,
    operation: "state.journal",
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    player_text: "原文",
    decision_id: "journal:allan-ward:turn-17:revision-1",
  };
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { summary: "结果", campaign: binding.campaign },
    binding,
    independentCurrent(binding),
  ), "forged_host_argument");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { summary: "结果", decision_id: binding.decision_id },
    binding,
    independentCurrent(binding),
  ), "forged_host_argument");
});

test("narration.review binds frozen source identity and leaves the draft/review semantic", () => {
  const revision = "turn:allan-ward:17:output-context-1";
  const compilation = {
    contract_id: "coc.pi-state-claim-compilation.v1",
    draft_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const binding = {
    schema_version: 1,
    operation: "narration.review",
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "review:allan-ward:turn-17:revision-1",
    turn_id: "turn:allan-ward:17",
    source_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    revision: 1,
    state_claim_compilation: compilation,
  };
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.contracts.operations.get(binding.operation).inputSchema,
    binding,
    independentCurrent(binding),
  );
  for (const field of [
    "root",
    "campaign",
    "decision_id",
    "turn_id",
    "source_digest",
    "revision",
    "state_claim_compilation",
  ]) {
    assert.ok(!Object.hasOwn(schema.properties, field), field);
  }
  for (const field of ["draft_text", "state_authority_review", "findings", "investigator"]) {
    assert.ok(Object.hasOwn(schema.properties, field), field);
  }
  assert.deepEqual(schema.required, ["draft_text", "state_authority_review"]);

  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      draft_text: "门后的木板发出低沉的呻吟。",
      state_authority_review: {
        disposition: "no_player_state_change_claimed",
        reason: "只描述环境",
        claims: [],
      },
      findings: [],
    },
    binding,
    independentCurrent(binding),
  );
  assert.equal(bound.source_digest, binding.source_digest);
  assert.equal(bound.turn_id, binding.turn_id);
  assert.equal(bound.revision, 1);
  assert.deepEqual(bound.state_claim_compilation, compilation);
  assert.notEqual(bound.state_claim_compilation, compilation);
  assert.equal(bound.draft_text, "门后的木板发出低沉的呻吟。");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      draft_text: "门后的木板发出低沉的呻吟。",
      state_authority_review: {
        disposition: "no_player_state_change_claimed",
        reason: "只描述环境",
        claims: [],
      },
      source_digest: binding.source_digest,
    },
    binding,
    independentCurrent(binding),
  ), "forged_host_argument");
});

test("turn.finalize binds review identity while coverage and prose stay model-owned", () => {
  const revision = "turn:allan-ward:17:review-accepted-1";
  const binding = {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "finalize:allan-ward:turn-17:revision-1",
    revision: 1,
    turn_id: "turn:allan-ward:17",
    source_digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    narration_review_id: "review:allan-ward:turn-17:revision-1",
  };
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    independentCurrent(binding),
  );
  for (const field of [
    "root",
    "campaign",
    "decision_id",
    "revision",
    "narration_review_id",
    "repair_finalization_id",
  ]) {
    assert.ok(!Object.hasOwn(schema.properties, field), field);
  }
  for (const field of [
    "draft",
    "coverage",
    "agency_claims",
    "mechanics_placements",
    "advisory_uptake",
  ]) {
    assert.ok(Object.hasOwn(schema.properties, field), field);
  }

  const coverage = [{
    obligation_id: "obligation:door-floor:1",
    action_realization: "检查留下了可见刮痕",
    causal_explanation: "手电斜光显出痕迹",
    exact_excerpt: "斜光里浮出数道新鲜刮痕。",
    exceptional_beat: null,
    persona_fit: null,
    player_input_handling: "specific_preserved",
    realization: "fictional_beat",
    response: "斜光里浮出数道新鲜刮痕。",
  }];
  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { draft: "斜光里浮出数道新鲜刮痕。", coverage, agency_claims: [] },
    binding,
    independentCurrent(binding),
  );
  assert.equal(bound.narration_review_id, binding.narration_review_id);
  assert.ok(!Object.hasOwn(bound, "repair_finalization_id"));
  assert.deepEqual(bound.coverage, coverage);
  assert.equal(bound.draft, "斜光里浮出数道新鲜刮痕。");
});

test("missing, mismatched, invalid, and stale retained contexts fail closed", () => {
  const revision = "turn:allan-ward:17:journaled";
  const binding = {
    schema_version: 1,
    operation: "state.journal",
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    player_text: "原文",
    decision_id: "journal:allan-ward:turn-17:revision-1",
  };
  const schema = catalog.byOperation.get("state.journal").parameters;
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "state.journal", schema, null, independentCurrent(binding),
  ), "binding_context_missing");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "state.journal", schema, binding, null,
  ), "current_host_context_missing");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "state.journal",
    schema,
    binding,
    { ...independentCurrent(binding), binding_revision: "turn:allan-ward:18:acting" },
  ), "binding_context_stale");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "turn.finalize",
    catalog.byOperation.get("turn.finalize").parameters,
    binding,
    independentCurrent(binding),
  ), "binding_context_mismatch");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    "state.journal",
    { summary: "结果" },
    { ...binding, player_text: "" },
    independentCurrent(binding),
  ), "binding_context_invalid");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "state.journal", schema, binding, binding,
  ), "current_host_context_not_independent");
});

test("same revision cannot mask retained campaign/turn/source/review identity mutation", () => {
  const reviewBinding = {
    schema_version: 1,
    operation: "narration.review",
    binding_revision: "turn:allan-ward:17:output-context-1",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "review:allan-ward:turn-17:revision-1",
    turn_id: "turn:allan-ward:17",
    source_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    revision: 1,
    state_claim_compilation: {
      contract_id: "coc.pi-state-claim-compilation.v1",
      draft_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };
  const currentReview = independentCurrent(reviewBinding);
  const mutations = [
    { campaign: "wrong-campaign" },
    { decision_id: "review:allan-ward:turn-99:revision-1" },
    { turn_id: "turn:allan-ward:99" },
    { source_digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    { revision: 2 },
    { state_claim_compilation: { contract_id: "unrelated" } },
  ];
  for (const mutation of mutations) {
    assertProjectionError(() => typed.projectBoundTypedToolParameters(
      reviewBinding.operation,
      catalog.contracts.operations.get(reviewBinding.operation).inputSchema,
      { ...reviewBinding, ...mutation },
      currentReview,
    ), "binding_context_stale");
  }

  const finalizeBinding = {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: "turn:allan-ward:17:review-accepted-1",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "finalize:allan-ward:turn-17:revision-1",
    revision: 1,
    turn_id: "turn:allan-ward:17",
    source_digest: reviewBinding.source_digest,
    narration_review_id: "review:allan-ward:turn-17:revision-1",
  };
  const currentFinalize = independentCurrent(finalizeBinding);
  for (const mutation of [
    { turn_id: "turn:allan-ward:99" },
    { source_digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
    { narration_review_id: "review:allan-ward:turn-17:revision-2" },
  ]) {
    assertProjectionError(() => typed.bindRetainedTypedToolArguments(
      finalizeBinding.operation,
      { draft: "draft", coverage: [] },
      { ...finalizeBinding, ...mutation },
      currentFinalize,
    ), "binding_context_stale");
  }
});

test("state.move_scene projects retained semantic routes and host-binds exact travel", () => {
  const binding = {
    schema_version: 1,
    operation: "state.move_scene",
    binding_revision: "scene:central-library:revision-7",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "move:allan-ward:turn-3:revision-1",
    source_revision: "scene-context:central-library:revision-7",
    source_digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    candidates: [
      { scene_id: "newspaper-morgue", travel_minutes: 45 },
      { scene_id: "neighborhood-gossip", travel_minutes: 25 },
    ],
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );
  assert.deepEqual(schema.properties.scene_id.enum, [
    "newspaper-morgue",
    "neighborhood-gossip",
  ]);
  for (const field of ["root", "campaign", "decision_id", "travel_minutes"]) {
    assert.ok(!Object.hasOwn(schema.properties, field), field);
  }
  assert.ok(Object.hasOwn(schema.properties, "reason"));
  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "newspaper-morgue", reason: "去报馆查旧闻" },
    binding,
    current,
  );
  assert.equal(bound.travel_minutes, 45);
  assert.equal(bound.scene_id, "newspaper-morgue");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "newspaper-morgue", reason: "去报馆", travel_minutes: 40 },
    binding,
    current,
  ), "forged_host_argument");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "unretained-scene", reason: "猜一个地点" },
    binding,
    current,
  ), "semantic_candidate_stale");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    {
      ...binding,
      candidates: [{ scene_id: "newspaper-morgue", travel_minutes: 40 }],
    },
    current,
  ), "binding_context_stale");
});

test("precise clock hides day_phase_after while imprecise clock leaves the semantic choice", () => {
  const precise = {
    schema_version: 1,
    operation: "state.advance_time",
    binding_revision: "clock:turn-3:revision-2",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "time:allan-ward:turn-3:revision-1",
    clock_revision: "clock:elapsed-150",
    clock_digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    clock_precision: "precise",
  };
  const preciseSchema = typed.projectBoundTypedToolParameters(
    precise.operation,
    catalog.byOperation.get(precise.operation).parameters,
    precise,
    independentCurrent(precise),
  );
  assert.ok(!Object.hasOwn(preciseSchema.properties, "day_phase_after"));
  assert.ok(!Object.hasOwn(preciseSchema.properties, "display_after"));
  assert.ok(Object.hasOwn(preciseSchema.properties, "minutes"));
  assert.ok(Object.hasOwn(preciseSchema.properties, "reason"));
  const bound = typed.bindRetainedTypedToolArguments(
    precise.operation,
    { minutes: 40, reason: "前往报馆" },
    precise,
    independentCurrent(precise),
  );
  assert.ok(!Object.hasOwn(bound, "day_phase_after"));
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    precise.operation,
    {
      minutes: 40,
      reason: "前往报馆",
      day_phase_after: "morning",
      display_after: "上午十点",
    },
    precise,
    independentCurrent(precise),
  ), "forged_host_argument");

  const imprecise = { ...precise, clock_precision: "imprecise" };
  const impreciseSchema = typed.projectBoundTypedToolParameters(
    imprecise.operation,
    catalog.byOperation.get(imprecise.operation).parameters,
    imprecise,
    independentCurrent(imprecise),
  );
  assert.ok(Object.hasOwn(impreciseSchema.properties, "day_phase_after"));
  const impreciseBound = typed.bindRetainedTypedToolArguments(
    imprecise.operation,
    { minutes: 40, reason: "模糊推进", day_phase_after: "evening" },
    imprecise,
    independentCurrent(imprecise),
  );
  assert.equal(impreciseBound.day_phase_after, "evening");
});

test("social motive overlay encodes the intensity/evidence cross-field contract", () => {
  const schema = catalog.byOperation.get("rules.social_adjudicate").parameters;
  const motive = schema.properties.motive;
  assert.equal(motive.oneOf.length, 2);
  const zero = motive.oneOf.find((branch) => branch.properties.intensity.const === 0);
  const evidenced = motive.oneOf.find((branch) => Array.isArray(branch.properties.intensity.enum));
  assert.ok(zero);
  assert.ok(evidenced);
  assert.deepEqual(evidenced.properties.intensity.enum, [1, 2]);
  assert.equal(evidenced.properties.evidence_refs.minItems, 1);
  assert.equal(zero.additionalProperties, false);
  assert.equal(evidenced.additionalProperties, false);
  assert.deepEqual(evidenced.required, ["direction", "intensity", "evidence_refs"]);
});

test("combat.resolve projects retained semantic targets and binds exact affordances", () => {
  const binding = {
    schema_version: 1,
    operation: "combat.resolve",
    binding_revision: "combat:corbitt:round-2",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "combat:allan-ward:round-2:revision-1",
    combat_revision: "combat-context:corbitt:round-2",
    combat_digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    candidates: [
      { target_npc_id: "walter-corbitt", affordance_id: "melee:ritual-dagger" },
      { target_npc_id: "floating-knife", affordance_id: "dodge:floating-knife" },
    ],
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );
  assert.deepEqual(schema.properties.target_npc_id.enum, [
    "walter-corbitt",
    "floating-knife",
  ]);
  assert.ok(!Object.hasOwn(schema.properties, "affordance_id"));
  assert.ok(Object.hasOwn(schema.properties, "weapon_id"));
  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { target_npc_id: "walter-corbitt", weapon_id: "ritual-dagger" },
    binding,
    current,
  );
  assert.equal(bound.affordance_id, "melee:ritual-dagger");
  assert.equal(bound.weapon_id, "ritual-dagger");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { target_npc_id: "unknown-target" },
    binding,
    current,
  ), "semantic_candidate_stale");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    {
      ...binding,
      candidates: [{ target_npc_id: "walter-corbitt", affordance_id: "changed" }],
    },
    current,
  ), "binding_context_stale");

  const single = { ...binding, candidates: [binding.candidates[0]] };
  const singleSchema = typed.projectBoundTypedToolParameters(
    single.operation,
    catalog.byOperation.get(single.operation).parameters,
    single,
    independentCurrent(single),
  );
  assert.ok(!Object.hasOwn(singleSchema.properties, "target_npc_id"));
  const singleBound = typed.bindRetainedTypedToolArguments(
    single.operation,
    { weapon_id: "ritual-dagger" },
    single,
    independentCurrent(single),
  );
  assert.equal(singleBound.target_npc_id, "walter-corbitt");
  assert.equal(singleBound.affordance_id, "melee:ritual-dagger");
});

test("Pi failure projection classifies recovery ownership without replacing canonical details", () => {
  const cases = [
    {
      operation: "state.journal",
      code: "missing_param",
      expectedClass: "schema_validation",
      recoverableBy: "model_next_action",
      nextOperation: "state.journal",
      nextAction: "correct_model_arguments",
    },
    {
      operation: "combat.resolve",
      code: "unknown_combat_target",
      expectedClass: "dynamic_candidate",
      recoverableBy: "model_next_action",
      nextOperation: "combat.context",
      nextAction: "refresh_semantic_candidates",
    },
    {
      operation: "state.move_scene",
      code: "invalid_param",
      expectedClass: "schema_validation",
      recoverableBy: "model_next_action",
      nextOperation: "state.move_scene",
      nextAction: "correct_model_arguments",
      details: { field: "defer_initial_progressive_on_enter" },
    },
    {
      operation: "state.move_scene",
      code: "invalid_param",
      expectedClass: "dynamic_candidate",
      recoverableBy: "model_next_action",
      nextOperation: "scene.context",
      nextAction: "refresh_semantic_candidates",
      details: { allowed_scene_ids: ["newspaper-morgue"] },
    },
    {
      operation: "state.advance_time",
      code: "invalid_request",
      expectedClass: "schema_validation",
      recoverableBy: "model_next_action",
      nextOperation: "state.advance_time",
      nextAction: "correct_model_arguments",
    },
    {
      operation: "turn.output_context",
      code: "no_unfinalized_journal",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "state.journal",
      nextAction: "journal_current_turn",
    },
    {
      operation: "turn.finalize",
      code: "agency_review_blocked",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "narration.review",
      nextAction: "revise_narration_only",
    },
    {
      operation: "turn.finalize",
      code: "roll_after_consequence",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "turn.finalize",
      nextAction: "move_roll_before_consequence",
    },
    {
      operation: "turn.finalize",
      code: "excerpt_mismatch",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "turn.finalize",
      nextAction: "copy_verbatim_excerpt",
    },
    {
      operation: "turn.finalize",
      code: "exceptional_beat_required",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "turn.finalize",
      nextAction: "add_source_bound_exceptional_beat",
    },
    {
      operation: "turn.finalize",
      code: "agency_source_invalid",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "turn.finalize",
      nextAction: "correct_agency_claims",
    },
    {
      operation: "turn.finalize",
      code: "substantive_exceptional_effect_required",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "state.exceptional_effect",
      nextAction: "apply_source_bound_exceptional_effect",
    },
    {
      operation: "turn.finalize",
      code: "invalid_param",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "turn.finalize",
      nextAction: "move_roll_before_consequence",
      violations: [{
        code: "roll_after_consequence",
        stage: "roll_after_consequence",
        source_id: "roll:turn-17:door-floor",
      }],
    },
    {
      operation: "state.journal",
      code: "idempotency_conflict",
      expectedClass: "idempotency_conflict",
      recoverableBy: "host_binding_refresh",
      automaticAction: "refresh_retained_binding_or_fault",
    },
    {
      operation: "turn.finalize",
      code: "narration_review_mismatch",
      expectedClass: "business_precondition",
      recoverableBy: "host_binding_refresh",
      automaticAction: "refresh_retained_binding_or_fault",
    },
    {
      operation: "state.journal",
      code: "campaign_busy",
      expectedClass: "transient_transport",
      recoverableBy: "host_internal_retry",
      automaticAction: "respect_existing_bounded_runtime_retry",
    },
    {
      operation: "state.deliver_handout",
      code: "secret_boundary_violation",
      expectedClass: "invariant_terminal",
      recoverableBy: "none",
    },
  ];

  for (const row of cases) {
    const visible = {
      ok: false,
      isError: true,
      tool: row.operation,
      hints: ["canonical hint"],
      error: {
        code: row.code,
        message: "canonical message",
        retryable: row.code === "campaign_busy",
        details: row.details ?? { retained: true },
        violations: row.violations ?? [{ field: "campaign", reason: "required" }],
      },
    };
    const projected = typed.projectPiToolFailure(visible, row.operation);
    assert.equal(projected.error.class, row.expectedClass, row.code);
    assert.equal(projected.error.recoverable_by, row.recoverableBy, row.code);
    assert.deepEqual(projected.error.details, row.details ?? { retained: true }, row.code);
    assert.deepEqual(
      projected.error.violations,
      row.violations ?? [{ field: "campaign", reason: "required" }],
      row.code,
    );
    assert.deepEqual(projected.hints, ["canonical hint"], row.code);
    assert.equal(projected.isError, true, row.code);
    if (row.nextOperation) {
      assert.equal(projected.error.allowed_next_actions[0].operation, row.nextOperation);
      assert.equal(projected.error.allowed_next_actions[0].action, row.nextAction);
    } else {
      assert.deepEqual(projected.error.allowed_next_actions, []);
    }
    if (row.automaticAction) {
      assert.equal(projected.error.automatic_action, row.automaticAction);
    } else {
      assert.ok(!Object.hasOwn(projected.error, "automatic_action"));
    }
  }
});

test("replay-corpus failure codes retain conservative or actionable dispositions", () => {
  const replayCounts = [5, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1];
  assert.equal(replayCounts.reduce((total, count) => total + count, 0), 24);
  const actualFailures = [
    ["turn.finalize", "default_mechanics_placement_unavailable", "business_precondition", "turn.finalize", "split_action_and_consequence_paragraphs"],
    ["state.journal", "idempotency_conflict", "idempotency_conflict", null, null],
    ["turn.output_context", "no_unfinalized_journal", "business_precondition", "state.journal", "journal_current_turn"],
    ["turn.finalize", "state_authority_review_blocked", "business_precondition", "narration.review", "revise_narration_only"],
    ["turn.finalize", "narration_review_required", "business_precondition", "narration.review", "review_retained_draft"],
    ["turn.finalize", "narration_review_mismatch", "business_precondition", null, null],
    ["narration.review", "idempotency_conflict", "idempotency_conflict", null, null],
    ["combat.resolve", "unknown_combat_target", "dynamic_candidate", "combat.context", "refresh_semantic_candidates"],
    ["state.move_scene", "invalid_param", "schema_validation", "state.move_scene", "correct_model_arguments"],
    ["state.journal", "turn_finalization_pending", "business_precondition", "turn.output_context", "resume_pending_settlement"],
    ["state.advance_time", "invalid_request", "schema_validation", "state.advance_time", "correct_model_arguments"],
    ["rules.social_adjudicate", "invalid_param", "schema_validation", "rules.social_adjudicate", "correct_model_arguments"],
  ];
  assert.equal(replayCounts.length, actualFailures.length);
  for (const [operation, code, expectedClass, nextOperation, nextAction] of actualFailures) {
    const projected = typed.projectPiToolFailure({
      ok: false,
      isError: true,
      tool: operation,
      error: { code, message: "recorded replay failure" },
    }, operation);
    assert.equal(projected.error.class, expectedClass, `${operation}/${code}`);
    if (nextOperation) {
      assert.equal(projected.error.allowed_next_actions[0].operation, nextOperation);
      assert.equal(projected.error.allowed_next_actions[0].action, nextAction);
    } else {
      assert.deepEqual(projected.error.allowed_next_actions, []);
    }
  }
});

test("attachExpectedSchema now adds normalized recovery metadata and preserves the archive schema", () => {
  const visible = {
    ok: false,
    isError: true,
    tool: "state.journal",
    error: {
      code: "invalid_param",
      message: "invalid journal argument",
      details: { field: "summary" },
    },
  };
  const projected = typed.attachExpectedSchema(visible, "state.journal");
  assert.equal(projected.error.class, "schema_validation");
  assert.equal(projected.error.recoverable_by, "model_next_action");
  assert.equal(projected.error.allowed_next_actions[0].operation, "state.journal");
  assert.deepEqual(
    projected.error.expected_schema,
    catalog.contracts.operations.get("state.journal").inputSchema,
  );
  assert.deepEqual(projected.error.details, { field: "summary" });

  const preciseClockFailure = typed.attachExpectedSchema({
    ok: false,
    isError: true,
    tool: "state.advance_time",
    error: {
      code: "invalid_request",
      message: "precise clocks derive phase from local_datetime",
    },
  }, "state.advance_time");
  assert.equal(preciseClockFailure.error.class, "schema_validation");
  assert.equal(preciseClockFailure.error.allowed_next_actions[0].operation, "state.advance_time");
  assert.equal(preciseClockFailure.error.expected_schema.type, "object");

  const preciseClockBinding = {
    schema_version: 1,
    operation: "state.advance_time",
    binding_revision: "clock:turn-17:revision-2",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "time:allan-ward:turn-17:revision-1",
    clock_revision: "clock:elapsed-150",
    clock_digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    clock_precision: "precise",
  };
  const armedClockFailure = typed.attachExpectedSchema(
    preciseClockFailure,
    "state.advance_time",
    catalog,
    {
      binding: preciseClockBinding,
      current_host_context: independentCurrent(preciseClockBinding),
    },
  );
  assert.ok(!Object.hasOwn(
    armedClockFailure.error.expected_schema.properties,
    "day_phase_after",
  ));
  assert.ok(!Object.hasOwn(
    armedClockFailure.error.expected_schema.properties,
    "display_after",
  ));
  assert.ok(Object.hasOwn(armedClockFailure.error.expected_schema.properties, "minutes"));

  const socialFailure = typed.attachExpectedSchema({
    ok: false,
    isError: true,
    tool: "rules.social_adjudicate",
    error: { code: "invalid_param", message: "motive evidence required" },
  }, "rules.social_adjudicate");
  assert.equal(socialFailure.error.expected_schema.properties.motive.oneOf.length, 2);

  const bindingRevision = "turn:allan-ward:17:acting";
  const binding = {
    schema_version: 1,
    operation: "state.journal",
    binding_revision: bindingRevision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    player_text: "原文",
    decision_id: "journal:allan-ward:turn-17:revision-1",
  };
  const armed = typed.attachExpectedSchema(visible, "state.journal", catalog, {
    binding,
    current_host_context: independentCurrent(binding),
  });
  for (const field of ["root", "campaign", "player_text", "decision_id", "run_id"]) {
    assert.ok(!Object.hasOwn(armed.error.expected_schema.properties, field), field);
  }
  assert.ok(Object.hasOwn(armed.error.expected_schema.properties, "summary"));
  assertProjectionError(() => typed.attachExpectedSchema(
    visible,
    "state.journal",
    catalog,
    {
      binding,
      current_host_context: {
        ...independentCurrent(binding),
        binding_revision: "turn:allan-ward:18:acting",
      },
    },
  ), "binding_context_stale");
});
