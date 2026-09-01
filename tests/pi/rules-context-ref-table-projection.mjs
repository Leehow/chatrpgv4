#!/usr/bin/env node
// The Keeper reaches rule/source refs only through what the Pi identity
// projection lets out. Sibling cards in one family repeat nearly identical ref
// arrays, so `rules.context` hoists the distinct refs into one `ref_table` and
// leaves zero-based indexes on each card. That saves the bytes only if the
// table itself still survives projection -- a dropped table would silently
// strip every ref from every card, which is worse than the oversize it fixes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href
);

/** Build the real combat card block from the production coc7 rule graph. */
function productionCombatBlock() {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "plugins/coc-keeper/scripts"))})
import coc_rules_runtime as R
g = json.load(open(${JSON.stringify(path.join(root, "plugins/coc-keeper/rulesets/coc7/rule-graph.json"))}))
m = json.load(open(${JSON.stringify(path.join(root, "plugins/coc-keeper/rulesets/coc7/rule-graph-manifest.json"))}))
rt = R.RulesRuntime(g, graph_manifest=m, campaign_id="proj", facts_provider=lambda: {})
raw = [R.public_card_projection(rt._card(str(n["node_id"]), {}))
       for n in rt.decision_nodes("combat")]
cards, ref_table = R.hoist_card_ref_table(raw)
print(json.dumps({"schema_version": 1, "status": "ok", "family": "combat",
                  "cards": cards, "ref_table": ref_table}))
`;
  const out = execFileSync(
    "uv",
    ["run", "--frozen", "--project", root, "python", "-c", script],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

test("hoisted rules.context ref table survives the Pi identity projection", () => {
  const data = productionCombatBlock();
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    "rules.context",
    { ok: true, tool: "rules.context", data, warnings: [], hints: [] },
    null,
    diagnostics,
  );

  const table = visible.data?.ref_table;
  assert.ok(table, "ref_table must survive projection");
  assert.deepEqual(
    table.rule_refs,
    data.ref_table.rule_refs,
    "every hoisted rule ref must reach the Keeper",
  );
  assert.deepEqual(
    table.source_refs,
    data.ref_table.source_refs,
    "every hoisted source ref must reach the Keeper",
  );
  assert.equal(typeof table.resolution, "string");
  assert.ok(table.resolution.length > 0, "the table must say how to resolve it");

  // Every card index must still resolve inside this same projected payload.
  assert.equal(visible.data.cards.length, data.cards.length);
  for (const [i, card] of visible.data.cards.entries()) {
    const original = data.cards[i];
    assert.deepEqual(card.rule_ref_ids, original.rule_ref_ids);
    assert.deepEqual(card.source_ref_ids, original.source_ref_ids);
    for (const id of card.rule_ref_ids) {
      assert.ok(
        typeof table.rule_refs[id] === "string",
        `card ${card.decision_ref} rule_ref_ids[${id}] must resolve`,
      );
    }
    for (const id of card.source_ref_ids) {
      assert.ok(
        typeof table.source_refs[id] === "string",
        `card ${card.decision_ref} source_ref_ids[${id}] must resolve`,
      );
    }
  }
});

test("the hoisted combat family fits the wire inline cap that collapsed it", () => {
  const data = productionCombatBlock();
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  // Live evidence (pi-coc-gate9-depth-20260901, turn-p-e4f26b8a71f2) recorded
  // full_result_bytes 27131 against max_inline_bytes 16384: the Keeper called
  // rules.context{family:"combat"} and got semantic_identity_unavailable.
  assert.ok(
    bytes < 16384,
    `combat family card set must fit the 16384-byte inline cap, got ${bytes}`,
  );
});
