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
  "npc.reaction",
  "state.cash_grant",
  "state.cash_query",
  "state.cash_spend",
  "state.deliver_handout",
  "state.journal",
  "turn.output_context",
  "turn.finalize",
];

const catalog = typed.defaultTypedToolCatalog();

test("spotlight tool schemas deep-equal archive inputSchema", () => {
  for (const operation of SPOTLIGHT) {
    const tool = catalog.byOperation.get(operation);
    assert.ok(tool, operation);
    assert.deepEqual(tool.parameters, archive.operations[operation].inputSchema);
    assert.ok(!JSON.stringify(tool.parameters).includes('"oneOf"'));
    const required = tool.parameters.required || [];
    assert.ok(Array.isArray(required));
    assert.equal(tool.description, archive.operations[operation].description);
  }
});

test("live play exposes the concealed Psychology window contract as an exact tool", () => {
  const play = domain.activeToolsForPhase("live_turn", "play");
  const psychology = catalog.byOperation.get("rules.psychology_observe");
  assert.ok(psychology);
  assert.ok(play.includes("coc_rules_psychology_observe"));
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
  assert.match(finalize.description, /first call the narration\.review operation/);
  assert.match(finalize.description, /never rerun rules\/state\/journal/);
  assert.match(finalize.description, /Non-agency review findings stay advisory/);
});

test("live play exposes cash and handout state operations as exact typed tools", () => {
  const play = domain.activeToolsForPhase("live_turn", "play");
  for (const operation of [
    "state.cash_grant",
    "state.cash_query",
    "state.cash_spend",
    "state.deliver_handout",
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
  const schema = catalog.byOperation.get("rules.roll").parameters;
  assert.ok((schema.required || []).includes("campaign"));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.campaign);
  assert.ok(!schema.properties.operation);
});

test("setup/play hide generic wrappers; unset role keeps them (legacy)", () => {
  const legacy = domain.activeToolsForPhase("live_turn", null);
  assert.ok(legacy.includes("coc_rules"), "legacy unset role keeps generic wrappers");
  assert.ok(!legacy.includes("coc_discover"));

  const play = domain.activeToolsForPhase("live_turn", "play");
  const setup = domain.activeToolsForPhase("opening", "setup");
  for (const wrapper of domain.DOMAIN_TOOL_NAMES) {
    assert.ok(!play.includes(wrapper), `play must hide ${wrapper}`);
    assert.ok(!setup.includes(wrapper), `setup must hide ${wrapper}`);
  }
  assert.ok(play.includes("coc_rules_roll"));
  assert.ok(play.includes("coc_npc_reaction"));
  assert.ok(!play.includes("coc_turn_finalize"));
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

test("exact typed execute wraps the one operation without a second guess", () => {
  const wrapped = typed.wrapTypedToolInvokeParams("coc_rules_roll", {
    campaign: "c1",
    root: "/tmp/ws",
    skill: "Spot Hidden",
    difficulty: "regular",
  });
  assert.deepEqual(wrapped, {
    operation: "rules.roll",
    root: "/tmp/ws",
    campaign: "c1",
    arguments: { skill: "Spot Hidden", difficulty: "regular" },
  });
  const allowed = domain.evaluateExecuteAcl({
    toolName: "coc_rules_roll",
    operation: "rules.roll",
    phase: "live_turn",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.canonical_operation, "rules.roll");
  assert.equal(
    domain.evaluateExecuteAcl({
      toolName: "coc_rules_roll",
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
    const tool = catalog.byOperation.get(operation);
    assert.ok(tool, operation);
    const schema = tool.parameters;
    assert.equal(schema.additionalProperties, false, operation);
    const required = schema.required || [];
    assert.ok(required.includes("campaign"), operation);
    const missing = { root: "/tmp/ws" };
    assert.equal(topLevelSchemaError(schema, missing), "missing:campaign", operation);
    const extra = { campaign: "c1", not_a_contract_field: true };
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
  assert.equal(wrap("coc_rules_roll", {
    campaign: "c1",
    skill: "Spot Hidden",
    difficulty: "regular",
  }).operation, "rules.roll");
  assert.equal(wrapCalls, 1);
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
      archive.operations[operation].inputSchema,
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
      archive.operations[operation].inputSchema,
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
  assert.ok(live.includes("coc_rules_roll"));
  assert.ok(live.includes("coc_rules_social_adjudicate"));
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
