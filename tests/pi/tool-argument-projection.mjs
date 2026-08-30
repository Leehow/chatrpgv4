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

test("registered catalog projects host-owned fields out of model schemas", () => {
  // The REGISTERED model schemas are the projected model-owned views: the
  // host-owned settle identity is absent (never merely exempted), and the
  // model-owned semantics stay.
  const journal = catalog.byOperation.get("state.journal").parameters;
  for (const field of [
    "campaign", "player_text", "decision_id", "root", "run_id",
  ]) {
    assert.ok(!Object.hasOwn(journal.properties, field), field);
    assert.ok(!journal.required.includes(field), field);
  }
  assert.ok(journal.required.includes("summary"));

  const finalize = catalog.byOperation.get("turn.finalize").parameters;
  for (const field of [
    "campaign", "decision_id", "revision",
    "narration_review_id", "repair_finalization_id",
  ]) {
    assert.ok(!Object.hasOwn(finalize.properties, field), field);
    assert.ok(!finalize.required.includes(field), field);
  }
  assert.ok(finalize.required.includes("draft"));
  assert.ok(finalize.required.includes("coverage"));
  const canonicalClaimTypes = catalog.contracts.operations.get("turn.finalize")
    .inputSchema.properties.agency_claims.items.properties.claim_type.enum;
  assert.deepEqual(
    [...typed.REVIEWED_AGENCY_CLAIM_TYPES].sort(),
    [...canonicalClaimTypes].sort(),
    "semantic reviewed-claim choices must track the canonical claim types",
  );
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

test("accepted review binds frozen draft and exact agency evidence from semantic spans", () => {
  const draft = (
    "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。"
    + "硬木棱反复撞上骨节，直到指节的皮裂开，血顺着拳面往下淌。\n\n"
    + "诺特没有退，也没有叫人。"
  );
  const binding = {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: "turn:thomas-hayes:1:review-accepted-1",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-thomas-hayes",
    decision_id: "finalize:thomas-hayes:turn-1:revision-1",
    revision: 1,
    turn_id: "turn:thomas-hayes:1",
    source_digest: `sha256:${"c".repeat(64)}`,
    narration_review_id: "review:thomas-hayes:turn-1:revision-1",
    reviewed_agency_binding: {
      schema_version: 1,
      review_id: "review:thomas-hayes:turn-1:revision-1",
      revision: 1,
      draft_sha256: `sha256:${"d".repeat(64)}`,
      draft,
      spans: [
        {
          reviewed_span: "reviewed-sentence:paragraph-1:1",
          exact_excerpt: "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。",
        },
        {
          reviewed_span: "reviewed-state-claim:1",
          exact_excerpt: "直到指节的皮裂开，血顺着拳面往下淌。",
        },
      ],
      authorities: [
        {
          authority: "current-player-input",
          claim_types: [
            "voluntary_action", "voluntary_speech", "voluntary_plan",
            "voluntary_belief", "voluntary_trust",
            "voluntary_active_emotion",
          ],
          subject_ref: "pc:thomas-hayes",
          source_ref: "player_input:journal-thomas-hayes-turn-1",
          override_id: null,
        },
        {
          authority: "involuntary-physiology",
          claim_types: ["involuntary_physiology"],
          subject_ref: "pc:thomas-hayes",
          source_ref: "narration_contract:involuntary_physiology",
          override_id: null,
        },
      ],
      coverage_obligations: [],
      mechanics_placement: {
        mode: "host_safe_default",
        public_check_count: 0,
        state_delta_count: 0,
        exceptional_effect_count: 0,
      },
    },
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );

  assert.ok(!Object.hasOwn(schema.properties, "draft"));
  assert.ok(!schema.required.includes("draft"));
  assert.ok(schema.required.includes("coverage"));
  assert.ok(schema.required.includes("agency_claims"));
  const agencySchemaText = JSON.stringify(schema.properties.agency_claims);
  assert.ok(!agencySchemaText.includes("exact_excerpt"));
  assert.ok(!agencySchemaText.includes("subject_ref"));
  assert.ok(!agencySchemaText.includes("source_ref"));
  assert.ok(!agencySchemaText.includes("override_id"));
  assert.ok(agencySchemaText.includes("reviewed-sentence:paragraph-1:1"));
  assert.ok(agencySchemaText.includes("reviewed-state-claim:1"));
  assert.ok(agencySchemaText.includes("voluntary_trust"));
  assert.ok(agencySchemaText.includes("voluntary_active_emotion"));
  assert.ok(!agencySchemaText.includes('"voluntary_emotion"'));

  const bound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
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
    },
    binding,
    current,
  );
  assert.equal(bound.draft, draft);
  assert.deepEqual(bound.agency_claims, [
    {
      claim_id: "agency-reviewed:reviewed-sentence-paragraph-1-1:voluntary-action",
      claim_type: "voluntary_action",
      exact_excerpt: "你当着他的面抡起右拳，空着手，对着桌角一下一下砸下去。",
      override_id: null,
      source_ref: "player_input:journal-thomas-hayes-turn-1",
      subject_ref: "pc:thomas-hayes",
    },
    {
      claim_id: "agency-reviewed:reviewed-state-claim-1:involuntary-physiology",
      claim_type: "involuntary_physiology",
      exact_excerpt: "直到指节的皮裂开，血顺着拳面往下淌。",
      override_id: null,
      source_ref: "narration_contract:involuntary_physiology",
      subject_ref: "pc:thomas-hayes",
    },
  ]);

  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      draft,
      coverage: [],
      agency_claims: [],
    },
    binding,
    current,
  ), "forged_host_argument");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      coverage: [],
      agency_claims: [{
        reviewed_span: "reviewed-sentence:paragraph-1:99",
        claim_type: "voluntary_action",
        authority: "current-player-input",
      }],
    },
    binding,
    current,
  ), "reviewed_agency_claim_stale");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      coverage: [],
      agency_claims: [{
        reviewed_span: "reviewed-state-claim:1",
        claim_type: "forced_behavior",
        authority: "involuntary-physiology",
      }],
    },
    binding,
    current,
  ), "reviewed_agency_authority_mismatch");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    {
      coverage: [],
      agency_claims: [{
        claim_id: "agency-forged-exact-claim",
        claim_type: "voluntary_action",
        exact_excerpt: draft.replace("抡起", "抢起"),
        override_id: null,
        source_ref: "player_input:current",
        subject_ref: "pc:current-investigator",
      }],
    },
    binding,
    current,
  ), "reviewed_agency_claim_invalid");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { coverage: [], agency_claims: [] },
    binding,
    {
      ...current,
      reviewed_agency_binding: {
        ...current.reviewed_agency_binding,
        draft: current.reviewed_agency_binding.draft.replace("抡起", "抢起"),
        spans: current.reviewed_agency_binding.spans.map((row) => ({
          ...row,
          exact_excerpt: row.exact_excerpt.replace("抡起", "抢起"),
        })),
      },
    },
  ), "binding_context_stale");
});

test("accepted review binds semantic coverage spans and host-owned safe placement", () => {
  const draft = (
    "海斯抡起右拳，对准桌角砸了下去。\n\n"
    + "硬木棱撞上骨节，指节裂开，血顺着拳面淌下。诺特盯着那只手，没有退让。\n\n"
    + "疼痛和对方冷硬的目光一起留在房间里。"
  );
  const coverageBindingFacts = {
    schema_version: 1,
    contract_id: "coc.reviewed-coverage-binding-facts.v1",
    settlement_snapshot_id: `turn-effect-v1:${"a".repeat(32)}`,
    mechanics_bundle_sha256: `sha256:${"b".repeat(64)}`,
    obligations: [
      {
        obligation_id: "first-impression:first-impression-receipt-v1:steven-knott",
        source_kind: "first_impression",
        source_id: "first-impression-receipt-v1:steven-knott",
        npc_display_name: "史蒂文·诺特",
        visibility: "context_effect",
        skill: null,
        goal: "realize the NPC's first observable response",
        outcome: null,
        required_level: null,
        achieved_level: null,
        passed: null,
        surplus_levels: null,
        exceptional_required: false,
        substantive_effect_required: false,
        substantive_effect_direction: null,
        substantive_effect_ids: [],
        substantive_effect_status: "not_required",
      },
      {
        obligation_id: "roll:roll-first-impression-steven-knott",
        source_kind: "check",
        source_id: "roll-first-impression-steven-knott",
        npc_display_name: "史蒂文·诺特",
        visibility: "public",
        skill: "APP",
        goal: "resolve the first material meeting",
        outcome: "failure",
        required_level: "regular",
        achieved_level: "failure",
        passed: false,
        surplus_levels: -1,
        exceptional_required: false,
        substantive_effect_required: false,
        substantive_effect_direction: null,
        substantive_effect_ids: [],
        substantive_effect_status: "not_required",
      },
    ],
    public_check_source_ids: ["roll-first-impression-steven-knott"],
    state_delta_source_ids: ["effect-hp-delta-right-knuckles"],
    exceptional_effect_source_ids: [],
  };
  const reviewed = typed.buildReviewedAgencyBinding({
    review_id: "review:thomas-hayes:turn-1:revision-1",
    revision: 1,
    draft_sha256: `sha256:${"c".repeat(64)}`,
    draft,
    state_authority_review: {
      disposition: "claims_listed",
      reason: "HP变化已绑定到当前伤害效果。",
      claims: [{
        claim_id: "state-claim-hp-right-knuckles",
        subject_ref: "pc:thomas-hayes",
        claim_kind: "scalar",
        exact_excerpt: "指节裂开，血顺着拳面淌下",
        source_effect_id: "effect-hp-delta-right-knuckles",
        reason: "伤害结算导致HP下降。",
      }],
    },
    player_input_source_ref: "player_input:journal-thomas-hayes-turn-1",
    agency_authority: {
      pc_subject_refs: ["pc:thomas-hayes"],
      involuntary_physiology_sources: [{
        source_ref: "narration_contract:involuntary_physiology",
        source_type: "ownership_contract",
      }],
    },
    control_overrides: [],
    coverage_binding_facts: coverageBindingFacts,
    semantic_obligation_refs: [
      {
        obligation_id: "first-impression:first-impression-receipt-v1:steven-knott",
        obligation_ref: "roll:史蒂文-诺特-2",
      },
      {
        obligation_id: "roll:roll-first-impression-steven-knott",
        obligation_ref: "roll:史蒂文-诺特",
      },
    ],
  });
  assert.equal(reviewed.coverage_obligations.length, 2);
  assert.deepEqual(
    reviewed.coverage_obligations.find(
      (row) => row.obligation_ref === "roll:史蒂文-诺特",
    ).allowed_reviewed_spans,
    [
      "reviewed-state-claim:1",
      "reviewed-sentence:paragraph-2:1",
      "reviewed-sentence:paragraph-2:2",
      "reviewed-paragraph:2",
      "reviewed-sentence:paragraph-3:1",
      "reviewed-paragraph:3",
    ],
    "public checks may select only exact reviewed spans with a safe preceding paragraph",
  );

  const binding = {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: "turn:thomas-hayes:1:review-accepted-1",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-thomas-hayes",
    decision_id: "finalize:thomas-hayes:turn-1:revision-1",
    revision: 1,
    turn_id: "turn:thomas-hayes:1",
    source_digest: `sha256:${"d".repeat(64)}`,
    narration_review_id: reviewed.review_id,
    reviewed_agency_binding: reviewed,
  };
  const schema = typed.projectBoundTypedToolParameters(
    "turn.finalize",
    catalog.byOperation.get("turn.finalize").parameters,
    binding,
    independentCurrent(binding),
  );
  const coverageSchemaText = JSON.stringify(schema.properties.coverage);
  assert.equal(coverageSchemaText.includes("exact_excerpt"), false);
  assert.equal(coverageSchemaText.includes(draft), false);
  assert.equal(coverageSchemaText.includes("指节裂开"), false);
  assert.equal(coverageSchemaText.includes("roll:史蒂文-诺特"), true);
  assert.equal(coverageSchemaText.includes("roll:史蒂文-诺特-2"), true);
  assert.equal(Object.hasOwn(schema.properties, "mechanics_placements"), false);

  const bound = typed.bindRetainedTypedToolArguments(
    "turn.finalize",
    {
      coverage: [
        {
          obligation_ref: "roll:史蒂文-诺特",
          reviewed_span: "reviewed-sentence:paragraph-2:1",
          realization: "fictional_beat",
          action_realization: "海斯以拳击打桌角。",
          response: "伤势和失败的第一印象在场景中同时显现。",
          causal_explanation: "公开检定未通过，诺特没有因此退让。",
          persona_fit: "诺特保持冷硬克制。",
          player_input_handling: "specific_preserved",
          exceptional_beat: null,
        },
        {
          obligation_ref: "roll:史蒂文-诺特-2",
          reviewed_span: "reviewed-sentence:paragraph-2:2",
          realization: "fictional_beat",
          action_realization: "诺特看见海斯自伤。",
          response: "诺特盯着那只手，没有退让。",
          causal_explanation: "第一次实质接触形成冷硬回应。",
          persona_fit: "回应符合诺特的职责与克制。",
          player_input_handling: "specific_preserved",
          exceptional_beat: null,
        },
      ],
      agency_claims: [{
        reviewed_span: "reviewed-sentence:paragraph-1:1",
        claim_type: "voluntary_action",
        authority: "current-player-input",
      }],
    },
    binding,
    independentCurrent(binding),
  );
  assert.equal(bound.draft, draft);
  assert.equal(Object.hasOwn(bound, "mechanics_placements"), false);
  assert.deepEqual(
    bound.coverage.map((row) => ({
      obligation_id: row.obligation_id,
      exact_excerpt: row.exact_excerpt,
    })),
    [
      {
        obligation_id: "first-impression:first-impression-receipt-v1:steven-knott",
        exact_excerpt: "诺特盯着那只手，没有退让。",
      },
      {
        obligation_id: "roll:roll-first-impression-steven-knott",
        exact_excerpt: "硬木棱撞上骨节，指节裂开，血顺着拳面淌下。",
      },
    ],
  );
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    "turn.finalize",
    {
      coverage: [{
        obligation_ref: "roll:史蒂文-诺特",
        reviewed_span: "reviewed-sentence:paragraph-1:1",
        realization: "fictional_beat",
        action_realization: "伪造",
        response: "伪造",
        causal_explanation: "伪造",
        persona_fit: "伪造",
        player_input_handling: "specific_preserved",
        exceptional_beat: null,
      }, {
        obligation_ref: "roll:史蒂文-诺特-2",
        reviewed_span: "reviewed-sentence:paragraph-2:2",
        realization: "fictional_beat",
        action_realization: "诺特看见海斯自伤。",
        response: "诺特没有退让。",
        causal_explanation: "第一次实质接触形成冷硬回应。",
        persona_fit: "诺特保持克制。",
        player_input_handling: "specific_preserved",
        exceptional_beat: null,
      }],
      agency_claims: [],
    },
    binding,
    independentCurrent(binding),
  ), "reviewed_coverage_span_stale");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    "turn.finalize",
    {
      coverage: [{
        obligation_ref: "roll:史蒂文-诺特",
        reviewed_span: "reviewed-sentence:paragraph-2:1",
        exact_excerpt: "史蒂文·诺特",
        realization: "fictional_beat",
        action_realization: "伪造",
        response: "伪造",
        causal_explanation: "伪造",
        persona_fit: "伪造",
        player_input_handling: "specific_preserved",
        exceptional_beat: null,
      }],
      agency_claims: [],
    },
    binding,
    independentCurrent(binding),
  ), "reviewed_coverage_invalid");
});

test("reviewed authority candidates bind one active control override and ignore inactive ones", () => {
  const draft = "海斯失去意识，身体软倒在门边。";
  const reviewed = typed.buildReviewedAgencyBinding({
    review_id: "review:thomas-hayes:turn-2:revision-1",
    revision: 1,
    draft_sha256: `sha256:${"e".repeat(64)}`,
    draft,
    state_authority_review: {
      disposition: "no_player_state_change_claimed",
      reason: "无新增状态声称。",
      claims: [],
    },
    player_input_source_ref: "player_input:journal-thomas-hayes-turn-2",
    agency_authority: {
      pc_subject_refs: ["pc:thomas-hayes"],
      involuntary_physiology_sources: [{
        source_ref: "narration_contract:involuntary_physiology",
        source_type: "ownership_contract",
      }],
    },
    control_overrides: [
      {
        override_id: "control-override-v1:active-unconscious",
        subject_ref: "pc:thomas-hayes",
        override_type: "unconscious",
        source_ref: "investigator_state:thomas-hayes:condition:unconscious",
        active: true,
      },
      {
        override_id: "control-override-v1:expired-mania",
        subject_ref: "pc:thomas-hayes",
        override_type: "mania",
        source_ref: "sanity:expired-mania",
        active: false,
      },
    ],
    coverage_binding_facts: {
      schema_version: 1,
      contract_id: "coc.reviewed-coverage-binding-facts.v1",
      settlement_snapshot_id: `turn-effect-v1:${"f".repeat(32)}`,
      mechanics_bundle_sha256: `sha256:${"a".repeat(64)}`,
      obligations: [],
      public_check_source_ids: [],
      state_delta_source_ids: [],
      exceptional_effect_source_ids: [],
    },
    semantic_obligation_refs: [],
  });
  assert.ok(
    reviewed.authorities.some(
      (row) => row.authority === "control-override:unconscious:1",
    ),
  );
  assert.ok(
    reviewed.authorities.every(
      (row) => !row.authority.includes("mania"),
    ),
  );
  const binding = {
    schema_version: 1,
    operation: "turn.finalize",
    binding_revision: "turn:thomas-hayes:2:review-accepted-1",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-thomas-hayes",
    decision_id: "finalize:thomas-hayes:turn-2:revision-1",
    revision: 1,
    turn_id: "turn:thomas-hayes:2",
    source_digest: `sha256:${"f".repeat(64)}`,
    narration_review_id: reviewed.review_id,
    reviewed_agency_binding: reviewed,
  };
  const bound = typed.bindRetainedTypedToolArguments(
    "turn.finalize",
    {
      coverage: [],
      agency_claims: [{
        reviewed_span: "reviewed-sentence:paragraph-1:1",
        claim_type: "forced_behavior",
        authority: "control-override:unconscious:1",
      }],
    },
    binding,
    independentCurrent(binding),
  );
  assert.deepEqual(bound.agency_claims[0], {
    claim_id: "agency-reviewed:reviewed-sentence-paragraph-1-1:forced-behavior",
    claim_type: "forced_behavior",
    exact_excerpt: draft,
    override_id: "control-override-v1:active-unconscious",
    source_ref: "investigator_state:thomas-hayes:condition:unconscious",
    subject_ref: "pc:thomas-hayes",
  });
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
    { revision: 2 },
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
    selection_mode: "current_candidates",
    candidates: [
      {
        candidate_id: "scene-route:newspaper-morgue:travel:1",
        scene_id: "newspaper-morgue",
        travel_minutes: 45,
      },
      {
        candidate_id: "scene-route:neighborhood-gossip:travel:1",
        scene_id: "neighborhood-gossip",
        travel_minutes: 25,
      },
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
      candidates: [{
        candidate_id: "scene-route:newspaper-morgue:travel:1",
        scene_id: "newspaper-morgue",
        travel_minutes: 40,
      }],
    },
    current,
  ), "binding_context_stale");
  const missingSelectionMode = { ...binding };
  delete missingSelectionMode.selection_mode;
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    missingSelectionMode,
    independentCurrent(missingSelectionMode),
  ), "binding_context_invalid");
});

test("state.move_scene manual binding hides host fields and never invents travel", () => {
  const binding = {
    schema_version: 1,
    operation: "state.move_scene",
    binding_revision: "scene:commission-briefing:revision-8",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "move:allan-ward:turn-4:revision-1",
    source_revision: "scene-context:commission-briefing:revision-8",
    source_digest: "sha256:1313131313131313131313131313131313131313131313131313131313131313",
    selection_mode: "manual_scene",
    candidates: [
      {
        candidate_id: "scene-route:newspaper-morgue:unlock:1",
        scene_id: "newspaper-morgue",
      },
      {
        candidate_id: "scene-route:central-library:unlock:1",
        scene_id: "central-library",
        travel_minutes: 35,
      },
    ],
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );
  for (const field of ["root", "campaign", "decision_id", "travel_minutes"]) {
    assert.equal(Object.hasOwn(schema.properties, field), false, field);
  }
  assert.equal(Object.hasOwn(schema.properties, "candidate_id"), false);
  assert.equal(Object.hasOwn(schema.properties.scene_id, "enum"), false);

  const untimed = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "newspaper-morgue", reason: "去报馆" },
    binding,
    current,
  );
  assert.equal(untimed.scene_id, "newspaper-morgue");
  assert.equal(Object.hasOwn(untimed, "travel_minutes"), false);
  const timed = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "central-library", reason: "去图书馆" },
    binding,
    current,
  );
  assert.equal(timed.travel_minutes, 35);
  const improvised = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "improvised-cafe", reason: "先去咖啡馆" },
    binding,
    current,
  );
  assert.equal(improvised.scene_id, "improvised-cafe");
  assert.equal(Object.hasOwn(improvised, "travel_minutes"), false);
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "newspaper-morgue", reason: "猜耗时", travel_minutes: 35 },
    binding,
    current,
  ), "forged_host_argument");

  const ambiguous = {
    ...binding,
    candidates: [
      {
        candidate_id: "scene-route:archive:travel:1",
        scene_id: "archive",
        travel_minutes: 5,
      },
      {
        candidate_id: "scene-route:archive:travel:2",
        scene_id: "archive",
        travel_minutes: 10,
      },
    ],
  };
  const ambiguousBound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "archive", reason: "路线不明确" },
    ambiguous,
    independentCurrent(ambiguous),
  );
  assert.equal(ambiguousBound.scene_id, "archive");
  assert.equal(Object.hasOwn(ambiguousBound, "travel_minutes"), false);

  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { scene_id: "newspaper-morgue", reason: "旧收据" },
    binding,
    { ...current, source_revision: "scene-context:newer" },
  ), "binding_context_stale");
});

test("same-destination scene routes preserve exact optional travel shape", () => {
  const binding = {
    schema_version: 1,
    operation: "state.move_scene",
    binding_revision: "scene:study:revision-8",
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "move:allan-ward:turn-4:revision-1",
    source_revision: "scene-context:study:revision-8",
    source_digest: "sha256:1212121212121212121212121212121212121212121212121212121212121212",
    selection_mode: "current_candidates",
    candidates: [
      {
        candidate_id: "scene-route:archive:door:1",
        scene_id: "archive",
      },
      {
        candidate_id: "scene-route:archive:travel:1",
        scene_id: "archive",
        travel_minutes: 10,
      },
    ],
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );
  assert.equal(Object.hasOwn(schema.properties, "scene_id"), false);
  assert.deepEqual(schema.properties.candidate_id.enum, [
    "scene-route:archive:door:1",
    "scene-route:archive:travel:1",
  ]);
  const untimed = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { candidate_id: "scene-route:archive:door:1", reason: "走侧门" },
    binding,
    current,
  );
  assert.equal(untimed.scene_id, "archive");
  assert.equal(Object.hasOwn(untimed, "travel_minutes"), false);
  assert.equal(Object.hasOwn(untimed, "candidate_id"), false);
  const timed = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { candidate_id: "scene-route:archive:travel:1", reason: "沿长廊前往" },
    binding,
    current,
  );
  assert.equal(timed.scene_id, "archive");
  assert.equal(timed.travel_minutes, 10);
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    {
      ...binding,
      candidates: [binding.candidates[0], { ...binding.candidates[0] }],
    },
    independentCurrent({
      ...binding,
      candidates: [binding.candidates[0], { ...binding.candidates[0] }],
    }),
  ), "binding_context_invalid");
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

test("combat.resolve binds exactly one canonical route, while pending defense binds neither", () => {
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
      {
        candidate_id: "attack-walter-corbitt",
        invocation_mode: "target_npc_id",
        target_npc_id: "walter-corbitt",
      },
      {
        candidate_id: "use-floating-knife-route",
        invocation_mode: "affordance_id",
        affordance_id: "dodge:floating-knife",
      },
    ],
  };
  const current = independentCurrent(binding);
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    current,
  );
  assert.deepEqual(schema.properties.candidate_id.enum, [
    "attack-walter-corbitt",
    "use-floating-knife-route",
  ]);
  assert.ok(!Object.hasOwn(schema.properties, "target_npc_id"));
  assert.ok(!Object.hasOwn(schema.properties, "affordance_id"));
  assert.ok(Object.hasOwn(schema.properties, "weapon_id"));
  const targetBound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { candidate_id: "attack-walter-corbitt", weapon_id: "ritual-dagger" },
    binding,
    current,
  );
  assert.equal(targetBound.target_npc_id, "walter-corbitt");
  assert.ok(!Object.hasOwn(targetBound, "affordance_id"));
  assert.ok(!Object.hasOwn(targetBound, "candidate_id"));
  assert.equal(targetBound.weapon_id, "ritual-dagger");
  const affordanceBound = typed.bindRetainedTypedToolArguments(
    binding.operation,
    { candidate_id: "use-floating-knife-route", weapon_id: "ritual-dagger" },
    binding,
    current,
  );
  assert.equal(affordanceBound.affordance_id, "dodge:floating-knife");
  assert.ok(!Object.hasOwn(affordanceBound, "target_npc_id"));
  assert.ok(!Object.hasOwn(affordanceBound, "candidate_id"));

  // Exact precondition at coc_operation_combat.py:284-295: a non-pending
  // invocation must contain one and only one of target_npc_id/affordance_id.
  const satisfiesCanonicalCombatPrecondition = (args, pendingDefense = false) => {
    const hasTarget = typeof args.target_npc_id === "string" && args.target_npc_id.length > 0;
    const hasAffordance = typeof args.affordance_id === "string" && args.affordance_id.length > 0;
    return pendingDefense
      ? !hasTarget && !hasAffordance
      : hasTarget !== hasAffordance;
  };
  assert.equal(satisfiesCanonicalCombatPrecondition(targetBound), true);
  assert.equal(satisfiesCanonicalCombatPrecondition(affordanceBound), true);
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { candidate_id: "unknown-route" },
    binding,
    current,
  ), "semantic_candidate_stale");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    {
      ...binding,
      candidates: [{
        candidate_id: "attack-walter-corbitt",
        invocation_mode: "affordance_id",
        affordance_id: "changed-route",
      }],
    },
    current,
  ), "binding_context_stale");
  const invalidXorCard = {
    ...binding,
    candidates: [{
      candidate_id: "invalid-double-bound-route",
      invocation_mode: "target_npc_id",
      target_npc_id: "walter-corbitt",
      affordance_id: "dodge:floating-knife",
    }],
  };
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    invalidXorCard.operation,
    catalog.byOperation.get(invalidXorCard.operation).parameters,
    invalidXorCard,
    independentCurrent(invalidXorCard),
  ), "binding_context_invalid");

  const single = { ...binding, candidates: [binding.candidates[0]] };
  const singleSchema = typed.projectBoundTypedToolParameters(
    single.operation,
    catalog.byOperation.get(single.operation).parameters,
    single,
    independentCurrent(single),
  );
  assert.ok(!Object.hasOwn(singleSchema.properties, "candidate_id"));
  assert.ok(!Object.hasOwn(singleSchema.properties, "target_npc_id"));
  assert.ok(!Object.hasOwn(singleSchema.properties, "affordance_id"));
  const singleBound = typed.bindRetainedTypedToolArguments(
    single.operation,
    { weapon_id: "ritual-dagger" },
    single,
    independentCurrent(single),
  );
  assert.equal(singleBound.target_npc_id, "walter-corbitt");
  assert.ok(!Object.hasOwn(singleBound, "affordance_id"));
  assert.equal(satisfiesCanonicalCombatPrecondition(singleBound), true);

  const pendingDefense = {
    ...binding,
    binding_revision: "combat:corbitt:pending-defense-1",
    combat_revision: "combat-context:corbitt:pending-defense-1",
    combat_digest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    candidates: [{
      candidate_id: "defend-pending-floating-knife",
      invocation_mode: "pending_defense",
    }],
  };
  const pendingBound = typed.bindRetainedTypedToolArguments(
    pendingDefense.operation,
    { defense_kind: "dodge" },
    pendingDefense,
    independentCurrent(pendingDefense),
  );
  assert.equal(pendingBound.defense_kind, "dodge");
  assert.ok(!Object.hasOwn(pendingBound, "target_npc_id"));
  assert.ok(!Object.hasOwn(pendingBound, "affordance_id"));
  assert.equal(satisfiesCanonicalCombatPrecondition(pendingBound, true), true);
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    pendingDefense.operation,
    { defense_kind: "dodge", target_npc_id: "walter-corbitt" },
    pendingDefense,
    independentCurrent(pendingDefense),
  ), "forged_host_argument");
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
  // One row per preserved failure in the Allan Ward terminal playtest. Source
  // anchors are line numbers in that campaign's logs/toolbox-calls.jsonl.
  const actualFailures = [
    { sourceLine: 22, ts: "2026-08-25T15:10:32.466829+00:00", operation: "turn.output_context", code: "no_unfinalized_journal", expectedClass: "business_precondition", nextOperation: "state.journal", nextAction: "journal_current_turn" },
    { sourceLine: 45, ts: "2026-08-25T15:30:23.801375+00:00", operation: "state.journal", code: "idempotency_conflict", expectedClass: "idempotency_conflict", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 47, ts: "2026-08-25T15:30:34.069789+00:00", operation: "turn.finalize", code: "narration_review_required", expectedClass: "business_precondition", nextOperation: "narration.review", nextAction: "review_retained_draft" },
    { sourceLine: 52, ts: "2026-08-25T15:34:14.311729+00:00", operation: "state.journal", code: "idempotency_conflict", expectedClass: "idempotency_conflict", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 58, ts: "2026-08-25T15:41:27.137644+00:00", operation: "state.journal", code: "turn_finalization_pending", expectedClass: "business_precondition", nextOperation: "turn.output_context", nextAction: "resume_pending_settlement" },
    { sourceLine: 71, ts: "2026-08-25T16:20:36.134764+00:00", operation: "state.move_scene", code: "invalid_param", expectedClass: "schema_validation", nextOperation: "state.move_scene", nextAction: "correct_model_arguments" },
    { sourceLine: 81, ts: "2026-08-25T16:21:41.474096+00:00", operation: "state.advance_time", code: "invalid_request", expectedClass: "schema_validation", nextOperation: "state.advance_time", nextAction: "correct_model_arguments" },
    { sourceLine: 91, ts: "2026-08-25T16:25:25.880066+00:00", operation: "rules.social_adjudicate", code: "invalid_param", expectedClass: "schema_validation", nextOperation: "rules.social_adjudicate", nextAction: "correct_model_arguments" },
    { sourceLine: 103, ts: "2026-08-25T16:27:15.195096+00:00", operation: "turn.finalize", code: "default_mechanics_placement_unavailable", expectedClass: "business_precondition", nextOperation: "turn.finalize", nextAction: "split_action_and_consequence_paragraphs" },
    { sourceLine: 144, ts: "2026-08-25T16:43:37.788876+00:00", operation: "narration.review", code: "idempotency_conflict", expectedClass: "idempotency_conflict", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 172, ts: "2026-08-25T16:47:41.334801+00:00", operation: "turn.finalize", code: "default_mechanics_placement_unavailable", expectedClass: "business_precondition", nextOperation: "turn.finalize", nextAction: "split_action_and_consequence_paragraphs" },
    { sourceLine: 237, ts: "2026-08-25T17:06:12.487415+00:00", operation: "turn.finalize", code: "default_mechanics_placement_unavailable", expectedClass: "business_precondition", nextOperation: "turn.finalize", nextAction: "split_action_and_consequence_paragraphs" },
    { sourceLine: 294, ts: "2026-08-25T17:33:25.284381+00:00", operation: "turn.output_context", code: "no_unfinalized_journal", expectedClass: "business_precondition", nextOperation: "state.journal", nextAction: "journal_current_turn" },
    { sourceLine: 312, ts: "2026-08-26T00:41:58.845113+00:00", operation: "combat.resolve", code: "unknown_combat_target", expectedClass: "dynamic_candidate", nextOperation: "combat.context", nextAction: "refresh_semantic_candidates" },
    { sourceLine: 321, ts: "2026-08-26T00:43:11.699174+00:00", operation: "combat.resolve", code: "unknown_combat_target", expectedClass: "dynamic_candidate", nextOperation: "combat.context", nextAction: "refresh_semantic_candidates" },
    { sourceLine: 329, ts: "2026-08-26T00:45:04.117565+00:00", operation: "turn.finalize", code: "default_mechanics_placement_unavailable", expectedClass: "business_precondition", nextOperation: "turn.finalize", nextAction: "split_action_and_consequence_paragraphs" },
    { sourceLine: 330, ts: "2026-08-26T00:46:15.966686+00:00", operation: "narration.review", code: "idempotency_conflict", expectedClass: "idempotency_conflict", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 351, ts: "2026-08-26T00:59:59.034650+00:00", operation: "turn.finalize", code: "narration_review_mismatch", expectedClass: "business_precondition", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 352, ts: "2026-08-26T01:00:34.987971+00:00", operation: "state.journal", code: "idempotency_conflict", expectedClass: "idempotency_conflict", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 354, ts: "2026-08-26T01:01:05.020847+00:00", operation: "turn.finalize", code: "state_authority_review_blocked", expectedClass: "business_precondition", nextOperation: "narration.review", nextAction: "revise_narration_only" },
    { sourceLine: 355, ts: "2026-08-26T01:01:36.470932+00:00", operation: "turn.finalize", code: "narration_review_mismatch", expectedClass: "business_precondition", automaticAction: "refresh_retained_binding_or_fault" },
    { sourceLine: 356, ts: "2026-08-26T01:02:48.667935+00:00", operation: "turn.finalize", code: "state_authority_review_blocked", expectedClass: "business_precondition", nextOperation: "narration.review", nextAction: "revise_narration_only" },
    { sourceLine: 359, ts: "2026-08-26T01:08:32.393702+00:00", operation: "turn.finalize", code: "narration_review_required", expectedClass: "business_precondition", nextOperation: "narration.review", nextAction: "review_retained_draft" },
    { sourceLine: 366, ts: "2026-08-26T01:34:20.568381+00:00", operation: "turn.finalize", code: "default_mechanics_placement_unavailable", expectedClass: "business_precondition", nextOperation: "turn.finalize", nextAction: "split_action_and_consequence_paragraphs" },
  ];
  assert.equal(actualFailures.length, 24);
  assert.equal(new Set(actualFailures.map((row) => row.sourceLine)).size, 24);
  assert.deepEqual(actualFailures.map((row) => row.sourceLine), [
    22, 45, 47, 52, 58, 71, 81, 91, 103, 144, 172, 237,
    294, 312, 321, 329, 330, 351, 352, 354, 355, 356, 359, 366,
  ]);
  const distribution = actualFailures.reduce((counts, row) => {
    counts[row.expectedClass] = (counts[row.expectedClass] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(distribution, {
    business_precondition: 14,
    idempotency_conflict: 5,
    schema_validation: 3,
    dynamic_candidate: 2,
  });
  for (const row of actualFailures) {
    const projected = typed.projectPiToolFailure({
      ok: false,
      isError: true,
      tool: row.operation,
      error: { code: row.code, message: `recorded failure at ${row.ts}` },
    }, row.operation);
    const label = `logs/toolbox-calls.jsonl#${row.sourceLine}`;
    assert.equal(projected.error.class, row.expectedClass, label);
    if (row.nextOperation) {
      assert.equal(projected.error.allowed_next_actions[0].operation, row.nextOperation, label);
      assert.equal(projected.error.allowed_next_actions[0].action, row.nextAction, label);
    } else {
      assert.deepEqual(projected.error.allowed_next_actions, [], label);
    }
    assert.equal(projected.error.automatic_action, row.automaticAction, label);
    assert.ok(
      projected.error.allowed_next_actions.length > 0 || projected.error.automatic_action,
      label,
    );
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
  // expected_schema is the REGISTERED model-owned view (host-owned fields
  // projected out), matching what the model actually fills.
  assert.deepEqual(
    projected.error.expected_schema,
    catalog.byOperation.get("state.journal").parameters,
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

// ---- separate model-call projection, derived from the actual typed schemas ----

/** Minimal schema execution check: args satisfy the schema's required set,
 * contain no property outside the schema (no aliases), and match types. */
function assertArgsExecuteSchema(schema, args, label) {
  for (const field of schema.required ?? []) {
    assert.ok(Object.hasOwn(args, field), `${label}: missing required ${field}`);
  }
  for (const [field, value] of Object.entries(args)) {
    assert.ok(
      Object.hasOwn(schema.properties ?? {}, field),
      `${label}: ${field} is not a typed schema property (alias)`,
    );
    const property = schema.properties[field];
    if (property?.type === "string") {
      assert.equal(typeof value, "string", `${label}: ${field} must be a string`);
    }
  }
}

test("model-call projection derives review arguments from the actual narration.review schema", () => {
  const operation = "narration.review";
  const archiveSchema = catalog.contracts.operations.get(operation).inputSchema;
  const projection = typed.projectModelCallArguments(
    operation,
    "coc_narration_review",
    archiveSchema,
  );
  // Derived split, not a hand allowlist: model-owned = schema minus host-bound.
  const modelOwned = [
    ...projection.model_owned_required_arguments,
    ...projection.model_owned_optional_arguments,
  ];
  const schemaProperties = Object.keys(archiveSchema.properties);
  assert.deepEqual(
    [...modelOwned, ...projection.host_bound_auto_attached_arguments].sort(),
    [...schemaProperties].sort(),
    "every typed schema field must be classified exactly once",
  );
  for (const field of projection.model_owned_required_arguments) {
    assert.ok(archiveSchema.required.includes(field), field);
  }
  for (const field of projection.host_bound_auto_attached_arguments) {
    assert.ok(!projection.model_owned_required_arguments.includes(field), field);
    assert.ok(!projection.model_owned_optional_arguments.includes(field), field);
  }
  // The exact typed parameter name for the draft, and no host-owned echo.
  assert.ok(projection.model_owned_required_arguments.includes("draft_text"));
  for (const hostField of [
    "decision_id", "turn_id", "source_digest", "revision",
    "state_claim_compilation", "root", "campaign",
  ]) {
    assert.ok(
      projection.host_bound_auto_attached_arguments.includes(hostField),
      hostField,
    );
    assert.ok(!modelOwned.includes(hostField), hostField);
  }
  assert.equal(projection.invoke_via, "coc_narration_review");
  assert.equal(projection.contract_source, "mcp_operation_contracts.inputSchema");

  // The projected model-owned arguments execute the real schema: binding the
  // model input yields a complete typed argument object with no alias and no
  // forged host-owned field.
  const revision = "turn:allan-ward:17:output-context-1";
  const binding = {
    schema_version: 1,
    operation,
    binding_revision: revision,
    root: "/tmp/coc-workspace",
    campaign: "the-haunting-allan-ward",
    decision_id: "review:allan-ward:turn-17:revision-1",
    turn_id: "turn:allan-ward:17",
    source_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    revision: 1,
    state_claim_compilation: {
      contract_id: "coc.pi-state-claim-compilation.v1",
      draft_sha256: `sha256:${"a".repeat(64)}`,
    },
  };
  const modelInput = {
    draft_text: "门后的木板发出低沉的呻吟。",
    state_authority_review: {
      disposition: "no_player_state_change_claimed",
      reason: "只描述环境",
      claims: [],
    },
    findings: [],
    investigator: "allan-ward",
  };
  const projectedSchema = typed.projectBoundTypedToolParameters(
    operation,
    archiveSchema,
    binding,
    independentCurrent(binding),
  );
  assertArgsExecuteSchema(projectedSchema, modelInput, "model input");
  const bound = typed.bindRetainedTypedToolArguments(
    operation,
    modelInput,
    binding,
    independentCurrent(binding),
  );
  assertArgsExecuteSchema(archiveSchema, bound, "bound arguments");
  assert.equal(bound.draft_text, modelInput.draft_text);
  assert.equal(bound.turn_id, binding.turn_id);
  assert.equal(bound.decision_id, binding.decision_id);
  assert.deepEqual(bound.state_claim_compilation, binding.state_claim_compilation);
  // Forging any host-owned field stays rejected even at the projection level.
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    operation,
    { ...modelInput, decision_id: binding.decision_id },
    binding,
    independentCurrent(binding),
  ), "forged_host_argument");
  // Unknown operations fail closed instead of guessing a split.
  assertProjectionError(() => typed.projectModelCallArguments(
    "narration.does_not_exist",
    "coc_invoke",
    archiveSchema,
  ), "model_call_projection_unavailable");
});

test("model-call finalize projection supports both canonical invoke_via surfaces", () => {
  const operation = "turn.finalize";
  const archiveSchema = catalog.contracts.operations.get(operation).inputSchema;
  for (const invokeVia of ["coc_turn_finalize", "coc_invoke"]) {
    const projection = typed.projectModelCallArguments(
      operation,
      invokeVia,
      archiveSchema,
    );
    assert.equal(projection.operation, operation);
    assert.equal(projection.invoke_via, invokeVia);
    assert.deepEqual(projection.model_owned_required_arguments, [
      "coverage",
      "draft",
    ]);
    assert.deepEqual(
      [...projection.model_owned_optional_arguments].sort(),
      ["advisory_uptake", "agency_claims", "mechanics_placements", "validate_only"],
    );
    assert.deepEqual(
      [...projection.host_bound_auto_attached_arguments].sort(),
      ["campaign", "decision_id", "narration_review_id", "repair_finalization_id", "revision", "root"],
    );
    // The card-owned draft parameter name is `draft`, never the review alias.
    assert.ok(!projection.model_owned_required_arguments.includes("draft_text"));
  }
  const finalizeViaInvoke = typed.projectModelCallArguments(
    operation,
    "coc_invoke",
    archiveSchema,
  );
  const finalizeViaTyped = typed.projectModelCallArguments(
    operation,
    "coc_turn_finalize",
    archiveSchema,
  );
  // The generic gateway surface is projected as the real invocation shape:
  // a nested {operation, arguments} envelope, never flat typed arguments.
  assert.equal(finalizeViaInvoke.invocation_shape, "generic_envelope");
  assert.equal(finalizeViaInvoke.envelope_operation, operation);
  assert.equal(finalizeViaTyped.invocation_shape, "typed_flat");
  assert.equal(finalizeViaTyped.envelope_operation, undefined);
  assert.deepEqual(
    {
      ...finalizeViaInvoke,
      invoke_via: finalizeViaTyped.invoke_via,
      invocation_shape: finalizeViaTyped.invocation_shape,
    },
    { ...finalizeViaTyped, envelope_operation: finalizeViaInvoke.envelope_operation },
    "only the exact card invoke_via and its real invocation shape may differ between the two surfaces",
  );
});
