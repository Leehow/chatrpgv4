#!/usr/bin/env node
/**
 * Typed operation tools: archive inputSchema is the model-visible schema.
 * Generic wrappers stay on the legacy unset-role path only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const archive = JSON.parse(readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
));
const domain = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);
const typed = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);
const runtime = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/runtime.ts")).href
);

const SPOTLIGHT = [
  "rules.roll",
  "rules.psychology_observe",
  "rules.social_adjudicate",
  "magic.cast",
  "magic.learn",
  "npc.reaction",
  "state.cash_grant",
  "state.cash_query",
  "state.cash_spend",
  "state.deliver_handout",
  "state.replay_handout",
  "state.journal",
  "turn.output_context",
  "turn.finalize",
];

const catalog = typed.defaultTypedToolCatalog();
const LEGACY_GRAPH_HIDDEN = new Set([
  "rules.roll", "rules.opposed", "rules.push", "rules.luck_spend",
  "rules.social_adjudicate", "rules.psychology_observe",
  "combat.context", "combat.resolve", "combat.end",
  "chase.context", "chase.execute", "rules.sanity_check", "sanity.context",
  "sanity.execute", "magic.cast", "magic.learn", "development.settle",
  "state.end_session",
]);

function hostProjectedTool(operation) {
  const contract = catalog.contracts.operations.get(operation);
  assert.ok(contract, operation);
  return {
    description: contract.description,
    parameters: typed.projectModelOwnedSchema(
      operation,
      typed.presentedTypedToolParameters(operation, contract.inputSchema),
    ),
  };
}

test("spotlight tool schemas match the archive except explicit Pi presentation overlays", () => {
  for (const operation of SPOTLIGHT) {
    const modelTool = catalog.byOperation.get(operation);
    if (LEGACY_GRAPH_HIDDEN.has(operation)) assert.equal(modelTool, undefined, operation);
    const tool = modelTool ?? hostProjectedTool(operation);
    if (operation === "rules.social_adjudicate") {
      assert.notDeepEqual(tool.parameters, archive.operations[operation].inputSchema);
      assert.equal(tool.parameters.properties.motive.oneOf.length, 2);
      const evidenced = tool.parameters.properties.motive.oneOf.find(
        (branch) => Array.isArray(branch.properties.intensity.enum),
      );
      assert.deepEqual(evidenced.properties.intensity.enum, [1, 2]);
      assert.equal(evidenced.properties.evidence_refs.minItems, 1);
    } else {
      // Catalog parameters must equal the REGISTERED model-owned view:
      // canonical Pi presentation overlays (semantic entity handles) plus
      // host-owned and never-model-authored field projection — never a
      // hand-shaped variant.
      assert.deepEqual(
        tool.parameters,
        typed.projectModelOwnedSchema(
          operation,
          typed.presentedTypedToolParameters(operation, archive.operations[operation].inputSchema),
        ),
      );
      assert.ok(!JSON.stringify(tool.parameters).includes('"oneOf"'));
    }
    const required = tool.parameters.required || [];
    assert.ok(Array.isArray(required));
    assert.equal(tool.description, archive.operations[operation].description);
  }
});

test("setup.quick_start typed schema makes pregen_id optional", () => {
  const tool = catalog.byOperation.get("setup.quick_start");
  assert.ok(tool);
  assert.deepEqual(
    tool.parameters,
    typed.projectModelOwnedSchema(
      "setup.quick_start",
      typed.presentedTypedToolParameters(
        "setup.quick_start",
        archive.operations["setup.quick_start"].inputSchema,
      ),
    ),
  );
  assert.deepEqual(tool.parameters.required, ["scenario_id"]);
  assert.ok(tool.parameters.properties.pregen_id);
  assert.ok(!tool.parameters.required.includes("pregen_id"));
  const wrapped = typed.wrapTypedToolInvokeParams("coc_setup_quick_start", {
    campaign_id: "memory-white-war-20260824-02",
    scenario_id: "the-white-war",
  });
  assert.equal(wrapped.operation, "setup.quick_start");
  assert.deepEqual(wrapped.arguments, {
    campaign_id: "memory-white-war-20260824-02",
    scenario_id: "the-white-war",
  });
  assert.ok(!Object.hasOwn(wrapped.arguments, "pregen_id"));
});

test("live play hides legacy Psychology while preserving its host schema", () => {
  const play = domain.activeToolsForPhase("live_turn", "play");
  const psychology = hostProjectedTool("rules.psychology_observe");
  assert.ok(!play.includes("coc_rules_psychology_observe"));
  assert.ok(play.includes("coc_rules_context"));
  assert.ok(play.includes("coc_rules_settle"));
  assert.match(psychology.description, /Keeper-concealed Psychology observation/);
  assert.match(psychology.description, /settle once per explicit observer\/NPC\/conversation\/revision window/i);
  assert.match(psychology.description, /player-safe realization/);
  assert.match(psychology.description, /npc_fact:<npc_id>\/<fact_id>/);
  assert.match(psychology.description, /npc\.query/);
  assert.match(psychology.description, /Bare ids are invalid/);
});

test("live play exposes the agency review then finalize contract", () => {
  const play = domain.activeToolsForPhase("pending_finalization", "play");
  const review = catalog.byOperation.get("narration.review");
  const finalize = catalog.byOperation.get("turn.finalize");
  assert.ok(play.includes("coc_narration_review"));
  assert.ok(play.includes("coc_turn_finalize"));
  assert.match(review.description, /agency_violation/);
  assert.match(review.description, /revision 2/);
  assert.match(review.description, /same frozen settlement/);
  assert.match(review.description, /state_authority_review/);
  assert.match(review.description, /current frozen mechanics effect/);
  assert.ok(review.parameters.required.includes("state_authority_review"));
  assert.ok(!review.parameters.required.includes("state_claim_compilation"));
  assert.ok(!Object.hasOwn(review.parameters.properties, "state_claim_compilation"));
  const stateReview = review.parameters.properties.state_authority_review;
  assert.equal(stateReview.additionalProperties, false);
  assert.deepEqual(
    new Set(stateReview.required),
    new Set(["disposition", "reason", "claims"]),
  );
  assert.equal(stateReview.properties.claims.items.additionalProperties, false);
  assert.ok(stateReview.properties.claims.items.required.includes("source_effect_id"));
  // a23254aa: the normal Pi-play path is a direct single draft, so finalize
  // must say review is not offered unless agency_review_required is true —
  // instructing an unconditional narration.review named a step the host
  // retired.
  assert.match(
    finalize.description,
    /the normal Pi-play path — draft once and call this operation directly/,
  );
  assert.match(finalize.description, /narration\.review is not offered/);
  assert.match(
    finalize.description,
    /Only when it is true, first call the agency_review_operation/,
  );
  assert.match(finalize.description, /[Nn]ever rerun rules\/state\/journal/);
  assert.match(finalize.description, /Prose-quality review findings stay advisory/);
});

test("live play exposes cash and handout state operations as exact typed tools", () => {
  const play = domain.activeToolsForPhase("live_turn", "play");
  for (const operation of [
    "state.cash_grant",
    "state.cash_query",
    "state.cash_spend",
    "state.deliver_handout",
    "state.replay_handout",
  ]) {
    const tool = catalog.byOperation.get(operation);
    assert.ok(tool, operation);
    assert.ok(play.includes(typed.typedToolNameForOperation(operation)), operation);
  }
});

test("derived names are deterministic and fail closed on collision", () => {
  assert.equal(typed.typedToolNameForOperation("rules.roll"), "coc_rules_roll");
  assert.equal(typed.typedToolNameForOperation("turn.output_context"), "coc_turn_output_context");
  assert.throws(() => typed.typedToolNameForOperation("Rules.Roll"), (err) => {
    assert.equal(err.code, "illegal_tool_name");
    return true;
  });
  const names = typed.listTypedOperationTools().map((row) => row.name);
  assert.equal(new Set(names).size, names.length);
  for (const reserved of typed.RESERVED_HOST_TOOL_NAMES) {
    assert.ok(!names.includes(reserved), reserved);
  }
});

test("missing required / extra field are visible on the model schema", () => {
  const schema = hostProjectedTool("rules.roll").parameters;
  assert.ok((schema.required || []).includes("campaign"));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.campaign);
  assert.ok(!schema.properties.operation);
});

test("rules.roll exposes one closed semantic combined-target mode", () => {
  const schema = hostProjectedTool("rules.roll").parameters;
  const targets = schema.properties.combined_targets;
  assert.equal(targets.type, "array");
  assert.equal(targets.minItems, 2);
  assert.equal(targets.maxItems, 8);
  assert.equal(targets.items.type, "object");
  assert.equal(targets.items.additionalProperties, false);
  assert.deepEqual(targets.items.required, ["label", "value"]);
  assert.equal(targets.items.properties.label.type, "string");
  assert.equal(targets.items.properties.value.type, "integer");
  assert.equal(schema.properties.helper_count, undefined);
  assert.deepEqual(schema.properties.combined_mode.enum, ["any", "all"]);
  assert.ok(!(schema.required || []).includes("combined_targets"));
});

test("utility-level explicit null preserves legacy wrappers while typed roles hide them", () => {
  const legacy = domain.activeToolsForPhase("live_turn", null);
  assert.ok(legacy.includes("coc_rules"), "legacy unset role keeps generic wrappers");
  assert.ok(!legacy.includes("coc_discover"));

  const play = domain.activeToolsForPhase("live_turn", "play");
  const setup = domain.activeToolsForPhase("opening", "setup");
  for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
    assert.ok(!play.includes(wrapper), `play must hide ${wrapper}`);
    assert.ok(!setup.includes(wrapper), `setup must hide ${wrapper}`);
  }
  assert.ok(!play.includes("coc_rules_roll"));
  assert.ok(play.includes("coc_rules_context"));
  assert.ok(play.includes("coc_rules_settle"));
  assert.ok(play.includes("coc_npc_reaction"));
  assert.ok(play.includes("coc_turn_finalize"));
  assert.ok(play.includes("coc_state_journal"));
  assert.ok(!play.includes("coc_setup_complete"));
  assert.ok(setup.includes("coc_setup_inspect"));
  assert.ok(setup.includes("coc_rules_roll_dice"));
  assert.ok(!setup.includes("coc_rules_roll"));
  assert.ok(!setup.includes("coc_npc_reaction"));
});

test("setup role exposes the complete canonical opening handoff chain", () => {
  const openingSetup = domain.activeToolsForPhase("opening", "setup");
  for (const name of [
    "coc_progressive_prepare_opening",
    "coc_progressive_opening_bootstrap",
    "coc_evidence_table_opening",
    "coc_setup_complete",
  ]) assert.ok(openingSetup.includes(name), name);
  assert.deepEqual(
    catalog.byOperation.get("progressive.prepare_opening").parameters.required,
    [],
  );
});

test("recovery play surface is closure-only", () => {
  const recovery = domain.activeToolsForPhase("recovery", "play");
  assert.ok(recovery.includes("coc_session_resume"));
  assert.ok(recovery.includes("coc_turn_finalize"));
  assert.ok(recovery.includes("coc_state_journal") || recovery.includes("coc_turn_output_context"));
  assert.ok(!recovery.includes("coc_rules_roll"));
  assert.ok(!recovery.includes("coc_npc_reaction"));
});

test("adopt_source_facts presents campaign_id-only and fills retained facts", () => {
  const archiveRequired = archive.operations["setup.adopt_source_facts"].inputSchema.required;
  assert.deepEqual(archiveRequired, ["campaign_id", "facts"]);
  const tool = catalog.byOperation.get("setup.adopt_source_facts");
  assert.ok(tool);
  assert.deepEqual(tool.parameters.required, ["campaign_id"]);
  assert.ok(tool.parameters.properties.facts);
  const wrapped = typed.wrapTypedToolInvokeParams("coc_setup_adopt_source_facts", {
    campaign_id: "c1",
  });
  assert.deepEqual(wrapped, {
    operation: "setup.adopt_source_facts",
    campaign: "c1",
    arguments: { campaign_id: "c1" },
  });
  const retained = { schema_version: 1, contract_id: "coc.opening-fast-facts.v1" };
  const filled = typed.applyRetainedAdoptSourceFacts(wrapped, retained);
  assert.deepEqual(filled.arguments.facts, retained);
  const already = typed.applyRetainedAdoptSourceFacts({
    ...wrapped,
    arguments: { campaign_id: "c1", facts: { keep: true } },
  }, retained);
  assert.deepEqual(already.arguments.facts, { keep: true });
});

test("graph cutover exposes settle and keeps legacy roll host-only", () => {
  assert.equal(catalog.byOperation.has("rules.roll"), false);
  assert.ok(hostProjectedTool("rules.roll").parameters.properties.skill);
  assert.equal(catalog.byOperation.has("rules.settle"), true);
  const allowed = domain.evaluateExecuteAcl({
    toolName: "coc_rules_settle",
    operation: "rules.settle",
    phase: "live_turn",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.canonical_operation, "rules.settle");
  assert.equal(
    domain.evaluateExecuteAcl({
      toolName: "coc_setup_quick_start",
      operation: "setup.quick_start",
      phase: "cold_start",
      role: "play",
    }).code,
    "role_forbidden",
    "the host-local effective role must close stale setup tools even when env role is null",
  );
  assert.equal(
    domain.evaluateExecuteAcl({
      toolName: "coc_rules_settle",
      operation: "turn.finalize",
      phase: "live_turn",
    }).code,
    "domain_mismatch",
  );
});

function topLevelSchemaError(schema, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "not_object";
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return `missing:${key}`;
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) return `extra:${key}`;
    }
  }
  return null;
}

test("missing/extra fields fail the model schema before wrap/gateway", () => {
  let wrapCalls = 0;
  const wrap = (name, params) => {
    wrapCalls += 1;
    return typed.wrapTypedToolInvokeParams(name, params);
  };
  for (const operation of SPOTLIGHT) {
    const tool = catalog.byOperation.get(operation) ?? hostProjectedTool(operation);
    assert.ok(tool, operation);
    const schema = tool.parameters;
    assert.equal(schema.additionalProperties, false, operation);
    const required = schema.required || [];
    // campaign is host-owned for the settle-path operations and is projected
    // out of their model-owned schemas; other ops keep it required.
    const campaignProjected = (schema.properties ?? {}).campaign !== undefined;
    if (campaignProjected) {
      assert.ok(required.includes("campaign"), operation);
      const missingCampaign = { root: "/tmp/ws" };
      assert.equal(
        topLevelSchemaError(schema, missingCampaign),
        "missing:campaign",
        operation,
      );
    }
    // campaign only rides the envelope for ops where it stays model-owned.
    const extra = { not_a_contract_field: true };
    if (campaignProjected) extra.campaign = "c1";
    for (const key of required) {
      if (key === "campaign") continue;
      extra[key] = key === "stakes"
        ? { on_success: "ok", on_failure: "fail" }
        : key === "coverage"
          ? []
          : "probe";
    }
    assert.equal(topLevelSchemaError(schema, extra), "extra:not_a_contract_field", operation);
    assert.equal(wrapCalls, 0, `${operation} must not reach wrap/gateway`);
  }
  assert.equal(catalog.byOperation.has("rules.roll"), false);
  assert.equal(wrapCalls, 0);
});

test("structured missing/invalid errors attach expected_schema", () => {
  for (const operation of SPOTLIGHT) {
    const visible = runtime.modelVisibleCanonicalToolResult(new runtime.CanonicalToolError(
      "coc_invoke",
      "missing_param",
      "canonical coc_invoke failed: missing_param",
      { missing_parameters: ["campaign"] },
      {
        ok: false,
        tool: operation,
        error: {
          code: "missing_param",
          message: "required parameter missing",
          retryable: false,
          details: { missing_parameters: ["campaign"] },
        },
      },
    ));
    const attached = typed.attachExpectedSchema(visible, operation);
    assert.deepEqual(attached.error.details.missing_parameters, ["campaign"], operation);
    assert.deepEqual(
      attached.error.expected_schema,
      (catalog.byOperation.get(operation) ?? hostProjectedTool(operation)).parameters,
      operation,
    );
    const invalid = runtime.modelVisibleCanonicalToolResult(new runtime.CanonicalToolError(
      "coc_invoke",
      "invalid_param",
      "canonical coc_invoke failed: invalid_param",
      { field: "operation" },
      {
        ok: false,
        tool: operation,
        error: {
          code: "invalid_param",
          message: "invalid parameter",
          retryable: false,
          details: { field: "operation" },
        },
      },
    ));
    const invalidAttached = typed.attachExpectedSchema(invalid, operation);
    assert.equal(invalidAttached.error.details.field, "operation", operation);
    assert.deepEqual(
      invalidAttached.error.expected_schema,
      (catalog.byOperation.get(operation) ?? hostProjectedTool(operation)).parameters,
      operation,
    );
  }
  const protocol = runtime.modelVisibleCanonicalToolResult(new runtime.CanonicalToolError(
    "coc_invoke",
    "whatever",
    "missing envelope",
    null,
    null,
  ));
  assert.equal(protocol, null);
  assert.equal(typed.attachExpectedSchema(null, "rules.roll"), null);
});

test("table_opening and open_turn_recovery keep typed closure, not generic wrappers", () => {
  const opening = domain.activeToolsForPhase("opening", "play");
  const live = domain.activeToolsForPhase("live_turn", "play");
  const recovery = domain.activeToolsForPhase("recovery", "play");
  for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
    assert.ok(!opening.includes(wrapper), `opening play hides ${wrapper}`);
    assert.ok(!live.includes(wrapper), `live_turn play hides ${wrapper}`);
    assert.ok(!recovery.includes(wrapper), `recovery play hides ${wrapper}`);
  }
  assert.ok(opening.includes("coc_session_resume"));
  assert.ok(!live.includes("coc_rules_roll"));
  assert.ok(!live.includes("coc_rules_social_adjudicate"));
  assert.ok(live.includes("coc_rules_context"));
  assert.ok(live.includes("coc_rules_settle"));
  assert.ok(recovery.includes("coc_session_resume"));
  assert.ok(recovery.includes("coc_turn_finalize"));
  assert.ok(recovery.includes("coc_state_journal"));
  assert.ok(recovery.includes("coc_turn_output_context"));
  assert.ok(!recovery.includes("coc_rules_roll"));
  const unsetOpening = domain.activeToolsForPhase("opening", null);
  assert.ok(unsetOpening.includes("coc_setup"));
  assert.ok(unsetOpening.includes("coc_rules"));
  assert.ok(!unsetOpening.includes("coc_rules_roll"));
});

test("session.delivery_text replay surface is semantic-only (attempt-05 schema)", () => {
  const operation = "session.delivery_text";
  const tool = catalog.byOperation.get(operation);
  assert.ok(tool, operation);
  const presented = JSON.stringify(tool.parameters);
  // Model-visible schema hides every machine-owned delivery identity and
  // chunk transport field (Identifier Law: never model-relayed).
  for (const opaque of [
    "finalization_id",
    "rendered_sha256",
    "text_offset",
    "text_limit",
  ]) {
    assert.equal(
      Object.hasOwn(tool.parameters.properties, opaque),
      false,
      `model surface must hide ${opaque}`,
    );
    assert.equal(presented.includes(`"${opaque}"`), false, opaque);
  }
  // Replay is the only exposed mode; the archive keeps context mode
  // backward-compatible for non-typed canonical consumers.
  assert.deepEqual(tool.parameters.properties.mode.enum, ["replay"]);
  // Exact surface pin: semantic mode ONLY. Campaign (and every delivery
  // identity/chunk field) is host-bound — the model authors nothing else.
  assert.deepEqual(
    Object.keys(tool.parameters.properties).sort(),
    ["mode"],
  );
  assert.deepEqual(tool.parameters.required, ["mode"]);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.equal(tool.parameters.properties.root, undefined);
  assert.equal(tool.parameters.properties.campaign, undefined);
  assert.equal(tool.parameters.type, "object");
  assert.notDeepEqual(tool.parameters, archive.operations[operation].inputSchema);

  // Host wrapper forwards the semantic mode argument; the host binds the
  // campaign envelope from current session state when the model cannot.
  const wrapped = typed.wrapTypedToolInvokeParams("coc_session_delivery_text", {
    mode: "replay",
  });
  assert.equal(wrapped.operation, operation);
  assert.equal(wrapped.campaign, undefined);
  assert.deepEqual(wrapped.arguments, { mode: "replay" });

  // Play-role live_turn surface exposes the replay tool by its typed name.
  assert.ok(
    domain.activeToolsForPhase("live_turn", "play").includes("coc_session_delivery_text"),
  );
});
