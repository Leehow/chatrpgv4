#!/usr/bin/env node
/**
 * Campaign 09 regression (`rulegraph-r3-haunting-09`, turn-p-8e4de4ef3724):
 * with zero presented obligations the model authored a coverage row with
 * obligation_id "none"; the raw grammar gate answered a non-actionable
 * opaque_identity_grammar four times until the turn timed out. Pins the
 * point-of-use contract:
 * - the sentinel still fails closed (never normalized into omission),
 * - the correction is actionable (copy handles verbatim from
 *   turn.output_context; no obligations ⇒ `coverage: []`) and never
 *   echoes the supplied sentinel value,
 * - canonical absence (`coverage: []`) passes the grammar gate,
 * - a real handle stays grammar-valid; binding stays canonical (fail-closed
 *   on unknown/missing rows in coc_turn_finalization.validate_coverage),
 * - the presented turn.finalize schema names the structural empty form.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const typed = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);

const SENTINEL_ROW = {
  obligation_id: "none",
  realization: "fictional_beat",
  action_realization: "调查员走进停尸房并说明来意",
  response: "档案员抬眼打量，没有让开",
  causal_explanation: "初见反应和社交结果决定对方是否让路",
  persona_fit: "符合调查员先礼后兵的作风",
  player_input_handling: "specific_preserved",
  exact_excerpt: "档案员抬眼看了他一下，没有让开。",
  exceptional_beat: "",
};

test("campaign 09 sentinel coverage row fails closed with an actionable, non-echoing correction", () => {
  const rejected = typed.validateRawModelIdentityPayload({
    coverage: [SENTINEL_ROW],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.field, "obligation_id");
  const spec = typed.closedIdentityGrammarSpec("obligation_id");
  assert.ok(spec, "obligation_id must keep a closed grammar spec");
  assert.ok(
    rejected.message.includes(spec.acceptedForm),
    `error missing accepted form: ${rejected.message}`,
  );
  assert.ok(rejected.message.includes("turn.output_context"));
  assert.ok(rejected.message.includes("empty array"));
  assert.ok(
    !rejected.message.includes("none"),
    "rejected sentinel value must not be echoed as acceptable",
  );
});

test("canonical zero-obligation coverage passes the grammar gate", () => {
  assert.deepEqual(
    typed.validateRawModelIdentityPayload({ coverage: [] }),
    { ok: true },
  );
});

test("a real presented handle stays grammar-valid; binding stays canonical", () => {
  const accepted = typed.validateRawModelIdentityPayload({
    coverage: [{ ...SENTINEL_ROW, obligation_id: "roll:example-slug" }],
  });
  assert.deepEqual(accepted, { ok: true });
});

test("presented turn.finalize schema names the structural no-obligation form", () => {
  const finalize = typed.defaultTypedToolCatalog().byOperation.get("turn.finalize");
  assert.ok(finalize, "turn.finalize must be a presented typed tool");
  const coverage = finalize.parameters.properties.coverage;
  assert.ok(coverage, "coverage must stay model-owned on the presented schema");
  assert.match(coverage.description, /empty array/);
  assert.match(coverage.description, /turn\.output_context/);
  const obligationId = coverage.items?.properties?.obligation_id;
  assert.ok(obligationId, "coverage row obligation_id must stay presented");
  assert.match(obligationId.description, /Closed obligation_id grammar/);
  assert.match(obligationId.description, /empty array/);
  assert.match(obligationId.description, /turn\.output_context/);
});
