#!/usr/bin/env node
// An oversize `npc.query` cast now ships as a roster: every NPC keeps its
// identity and the deep dossiers demote behind one exact re-query card. That
// only helps if the roster survives the Pi identity projection -- a dropped
// card or a deleted binding field would leave the Keeper with a cast it cannot
// act on, which is no better than the identity-only collapse it replaced.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href,
);

/** Project a `count`-NPC cast through the real wire, reusing the wire test's
 *  fixture so the two cannot drift apart. */
function wireProjectedRoster(count) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "tests"))})
import test_mcp_wire_npc_query as F
print(json.dumps(F._project(F._envelope(${count}))))
`;
  const out = execFileSync(
    "uv",
    ["run", "--frozen", "--project", root, "python", "-c", script],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

function project(envelope) {
  const diagnostics = { unmapped: [] };
  const visible = projection.projectModelVisibleCanonicalResult(
    "npc.query",
    envelope,
    null,
    diagnostics,
  );
  return { visible, diagnostics };
}

test("the demoted roster reaches the Keeper whole", () => {
  const wired = wireProjectedRoster(9);
  const { visible, diagnostics } = project(wired);

  assert.deepEqual(
    diagnostics.unmapped,
    [],
    "any unmapped identity fails the whole result closed with "
      + "semantic_identity_unavailable, so the roster must map completely",
  );
  assert.equal(visible.data.npcs.length, 9, "every NPC must reach the Keeper");

  const card = visible.data.dossier_operation;
  assert.ok(card, "the route back to a full dossier must survive projection");
  assert.equal(card.operation, "npc.query");
  assert.equal(card.model_invocable, true);
  assert.deepEqual(card.missing_arguments, ["npc_id"]);

  const demoted = visible.data.npcs.filter((row) => row.dossier_required);
  assert.ok(demoted.length > 0, "the fixture must demote some dossiers");
  for (const row of demoted) {
    // The npc_id is the card's only missing argument, so it must survive on
    // the very rows that need the card.
    assert.equal(typeof row.npc_id, "string");
    assert.ok(row.npc_id.length > 0);
  }
});

test("every projected row keeps the facts the host binds evidence from", () => {
  const wired = wireProjectedRoster(9);
  const { visible } = project(wired);

  // observeNpcInteractionBindingsFromQuery reads facts[].fact_id off every row
  // to offer `npc_fact:<npc_id>/<fact_id>`; the Keeper forms the same ref for
  // rules.psychology_observe. Demotion must not quietly drop the grammar.
  for (const row of visible.data.npcs) {
    const factIds = (row.facts ?? []).map((fact) => fact.fact_id);
    assert.equal(factIds.length, 3, `${row.npc_id} must keep its facts`);
    for (const factId of factIds) {
      assert.equal(typeof factId, "string");
      assert.ok(factId.length > 0);
    }
    assert.ok(row.psych, `${row.npc_id} must keep its relationship state`);
  }
});

test("an authored lie no longer fails the whole result closed", () => {
  // `lie_id` is the counterpart of the long-declared `deflect_id`. While the
  // oversize cast collapsed before projection, no npc.query result ever
  // carried a lie this far, so the missing declaration stayed invisible.
  const wired = wireProjectedRoster(9);
  const { visible, diagnostics } = project(wired);

  assert.deepEqual(diagnostics.unmapped, []);
  const withLie = visible.data.npcs.find((row) => (row.lie_options ?? []).length);
  assert.ok(withLie, "a full dossier must still carry its authored lie");
  assert.equal(typeof withLie.lie_options[0].lie_id, "string");
  const nestedLie = withLie.facts.find((fact) => fact.lie_option);
  assert.ok(nestedLie, "the fact-nested lie option must survive too");
  assert.equal(typeof nestedLie.lie_option.lie_id, "string");
});

test("the contract projection table survives as readable field names", () => {
  const wired = wireProjectedRoster(9);
  const { visible } = project(wired);
  const table = visible.data.identity_contract_projection;

  assert.ok(table, "the elision table must reach the Keeper");
  // `identity_ref` and `profile_revision_ref` are denied identity field NAMES.
  // The table ships them as list VALUES for exactly this reason: keyed by
  // them, the projection would delete the two entries and leave a table that
  // silently under-reports what the record carries.
  assert.ok(table.carried_by_record.includes("identity_ref"));
  assert.ok(table.carried_by_record.includes("profile_revision_ref"));
  assert.deepEqual(
    table.carried_by_record,
    wired.data.identity_contract_projection.carried_by_record,
  );
  assert.deepEqual(
    table.role_carried_by_record,
    wired.data.identity_contract_projection.role_carried_by_record,
  );
  assert.equal(typeof table.resolution, "string");
  assert.ok(table.resolution.length > 0);

  // Every named field must actually be present on each record to resolve to.
  for (const row of visible.data.npcs.filter((entry) => !entry.dossier_required)) {
    for (const field of table.carried_by_record) {
      // The two ref names are denied identity: the host resolves them from
      // its own canonical details, so only the Keeper-facing fields are
      // asserted on the model-visible row.
      if (field === "identity_ref" || field === "profile_revision_ref") continue;
      assert.ok(field in row, `${row.npc_id} must carry ${field}`);
    }
  }
});
