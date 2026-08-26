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
    revision,
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
    revision,
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
    revision,
  ), "forged_host_argument");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    binding.operation,
    { summary: "结果", decision_id: binding.decision_id },
    binding,
    revision,
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
    revision,
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
    revision,
  );
  assert.equal(bound.source_digest, binding.source_digest);
  assert.equal(bound.turn_id, binding.turn_id);
  assert.equal(bound.revision, 1);
  assert.deepEqual(bound.state_claim_compilation, compilation);
  assert.notEqual(bound.state_claim_compilation, compilation);
  assert.equal(bound.draft_text, "门后的木板发出低沉的呻吟。");
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
    narration_review_id: "review:allan-ward:turn-17:revision-1",
  };
  const schema = typed.projectBoundTypedToolParameters(
    binding.operation,
    catalog.byOperation.get(binding.operation).parameters,
    binding,
    revision,
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
    revision,
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
    "state.journal", schema, null, revision,
  ), "binding_context_missing");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "state.journal", schema, binding, "turn:allan-ward:18:acting",
  ), "binding_context_stale");
  assertProjectionError(() => typed.projectBoundTypedToolParameters(
    "turn.finalize", catalog.byOperation.get("turn.finalize").parameters, binding, revision,
  ), "binding_context_mismatch");
  assertProjectionError(() => typed.bindRetainedTypedToolArguments(
    "state.journal", { summary: "结果" }, { ...binding, player_text: "" }, revision,
  ), "binding_context_invalid");
});

test("Pi failure projection classifies recovery ownership without replacing canonical details", () => {
  const cases = [
    {
      operation: "state.journal",
      code: "missing_param",
      expectedClass: "schema_validation",
      recoverableBy: "model_next_action",
      nextOperation: "state.journal",
    },
    {
      operation: "combat.resolve",
      code: "unknown_combat_target",
      expectedClass: "dynamic_candidate",
      recoverableBy: "model_next_action",
      nextOperation: "combat.context",
    },
    {
      operation: "state.move_scene",
      code: "invalid_param",
      expectedClass: "dynamic_candidate",
      recoverableBy: "model_next_action",
      nextOperation: "scene.context",
    },
    {
      operation: "state.advance_time",
      code: "invalid_request",
      expectedClass: "schema_validation",
      recoverableBy: "model_next_action",
      nextOperation: "state.advance_time",
    },
    {
      operation: "turn.output_context",
      code: "no_unfinalized_journal",
      expectedClass: "business_precondition",
      recoverableBy: "model_next_action",
      nextOperation: "state.journal",
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
        details: { retained: true },
        violations: [{ field: "campaign", reason: "required" }],
      },
    };
    const projected = typed.projectPiToolFailure(visible, row.operation);
    assert.equal(projected.error.class, row.expectedClass, row.code);
    assert.equal(projected.error.recoverable_by, row.recoverableBy, row.code);
    assert.deepEqual(projected.error.details, { retained: true }, row.code);
    assert.deepEqual(projected.error.violations, [
      { field: "campaign", reason: "required" },
    ], row.code);
    assert.deepEqual(projected.hints, ["canonical hint"], row.code);
    assert.equal(projected.isError, true, row.code);
    if (row.nextOperation) {
      assert.equal(projected.error.allowed_next_actions[0].operation, row.nextOperation);
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
    current_binding_revision: bindingRevision,
  });
  for (const field of ["root", "campaign", "player_text", "decision_id", "run_id"]) {
    assert.ok(!Object.hasOwn(armed.error.expected_schema.properties, field), field);
  }
  assert.ok(Object.hasOwn(armed.error.expected_schema.properties, "summary"));
  assertProjectionError(() => typed.attachExpectedSchema(
    visible,
    "state.journal",
    catalog,
    { binding, current_binding_revision: "turn:allan-ward:18:acting" },
  ), "binding_context_stale");
});
