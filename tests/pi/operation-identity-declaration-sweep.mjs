#!/usr/bin/env node
// A canonical result that names an identity-shaped field this operation never
// declared fails CLOSED: `projectModelVisibleCanonicalResult` reports it in
// `diagnostics.unmapped`, and the Pi extension replaces the whole `ok:true`
// envelope with `semantic_identity_unavailable`. The Keeper is told its tool
// failed while the real answer sits in host-only details.
//
// `npc.query` declared `deflect_id` and not its twin `lie_id`, so every NPC
// authored with a lie failed the whole result closed -- unnoticed for as long
// as the oversize collapse stripped the options before this projection saw
// them. Nothing was watching the class, so the gap was only ever found one
// field at a time, by accident.
//
// This is that watch. The corpus is real envelopes captured from the repo's
// own operation-cell suites, projected exactly as the host projects them. The
// outstanding-gap file is a debt ledger, not a permission slip: an operation
// may only ever LOSE entries. A new one fails this test on the day it appears.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href,
);
const registry = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts"),
  ).href,
);

const fixture = (name) => JSON.parse(
  fs.readFileSync(path.join(root, "tests/pi/fixtures", name), "utf8"),
);
const corpus = fixture("operation-identity-corpus.json");
const outstanding = fixture("operation-identity-outstanding.json");

// Registry-domain fields resolve against the LIVE semantic registry, which a
// static sweep cannot reproduce. They report their own domain, so they stay
// separable from a genuine declaration gap and are not this test's subject.
const REGISTRY_DOMAINS = new Set([
  "roll", "effect", "item", "weapon", "route", "affordance", "evidence",
  // A transcript row is named by a registry handle minted from its turn and
  // speaker; with no live registration it drops like any registry domain,
  // which is the designed fail-closed path and not a declaration gap.
  "transcript",
]);

/** Declaration gaps this corpus exhibits right now, by operation. */
function observedGaps() {
  const observed = new Map();
  for (const { operation, envelope } of corpus) {
    const diagnostics = { unmapped: [] };
    projection.projectModelVisibleCanonicalResult(
      operation,
      envelope,
      registry.emptySemanticProjectionView(),
      diagnostics,
    );
    for (const entry of diagnostics.unmapped) {
      if (REGISTRY_DOMAINS.has(entry.domain) || !entry.field) continue;
      if (!observed.has(operation)) observed.set(operation, new Set());
      observed.get(operation).add(entry.field);
    }
  }
  return observed;
}

test("the corpus covers a broad slice of the KP-reachable tool surface", () => {
  const operations = new Set(corpus.map((row) => row.operation));
  assert.ok(
    operations.size >= 50,
    `corpus must keep broad coverage, got ${operations.size} operations`,
  );
  // Every fix in this sweep must stay covered by the corpus that proves it.
  for (const operation of [
    "state.npc_update",
    "session.resume",
    "setup.investigator_contract",
    "npc.query",
  ]) {
    assert.ok(operations.has(operation), `corpus must exercise ${operation}`);
  }
});

test("no operation fails closed on a field outside the outstanding ledger", () => {
  const observed = observedGaps();
  const added = [];
  for (const [operation, fields] of observed) {
    const known = new Set(outstanding[operation] ?? []);
    for (const field of fields) {
      if (!known.has(field)) added.push(`${operation}.${field}`);
    }
  }
  assert.deepEqual(
    added,
    [],
    "these identity fields are undeclared, so their whole canonical result "
      + "reaches the Keeper as semantic_identity_unavailable. Give each a "
      + "disposition in OPERATION_IDENTITY_DECLARATIONS (semantic for an "
      + "authored meaning-bearing slug, hostOnly for a digest-derived machine "
      + "handle, integrity for a digest — which must also be in "
      + "CLASSIFIED_INTEGRITY_FIELDS): " + added.join(", "),
  );
});

test("the outstanding ledger records no gap that is already closed", () => {
  const observed = observedGaps();
  const stale = [];
  for (const [operation, fields] of Object.entries(outstanding)) {
    const live = observed.get(operation) ?? new Set();
    for (const field of fields) {
      if (!live.has(field)) stale.push(`${operation}.${field}`);
    }
  }
  assert.deepEqual(
    stale,
    [],
    "these are declared now, so delete them from "
      + "tests/pi/fixtures/operation-identity-outstanding.json — the ledger "
      + "must shrink as it is paid down, never drift: " + stale.join(", "),
  );
});

test("the three operations fixed in this sweep stay declared", () => {
  const observed = observedGaps();
  for (const operation of [
    "state.npc_update", "session.resume", "setup.investigator_contract",
  ]) {
    for (const field of observed.get(operation) ?? []) {
      assert.ok(
        (outstanding[operation] ?? []).includes(field),
        `${operation}.${field} regressed: it was declared by this sweep`,
      );
    }
  }
  // npc.query's `lie_id` is the field this whole sweep started from.
  assert.ok(
    !(observed.get("npc.query") ?? new Set()).has("lie_id"),
    "npc.query lie_id must stay declared",
  );
});

test("the recall and worldline families stay declared", () => {
  // The ledger was 35 operations deep, and two of them reached a live table
  // on 2026-09-01: the Keeper asked memory.recall and transcript.locate what
  // it remembered of the previous loop and got semantic_identity_unavailable
  // for the whole result. A time-loop module is unplayable if the Keeper
  // cannot read its own memory, so these families do not go back on the
  // ledger.
  const observed = observedGaps();
  for (const operation of [
    "memory.recall", "memory.adjudicate", "memory.extraction_settle",
    "memory.extraction_status", "history.diff", "history.query",
    "transcript.locate", "transcript.read", "timeline.fork_request",
    "timeline.fork_confirm", "timeline.confluence_query",
    "timeline.confluence_confirm", "timeline.transfer", "narration.brief",
    "npc.advise", "quest.improvise", "quest.offer", "quest.settle",
    "setup.invoke", "state.set_flag", "state.time_marker",
    "steward.deliveries", "steward.scene_supply", "actions.advise",
    "state.record_clue", "progressive.status", "progressive.follow_mentions",
    "progressive.request_locator_pass", "progressive.request_opening_pack",
    "progressive.opening_bootstrap", "progressive.prepare_opening",
    "progressive.project_opening",
  ]) {
    assert.deepEqual(
      [...(observed.get(operation) ?? [])],
      [],
      `${operation} fails closed again on a field this sweep declared`,
    );
  }
});

test("the ledger's remainder is a fixture artifact, not a declaration gap", () => {
  // What is left is `campaign_id` on three operations, and it is not a
  // missing disposition: all three declare it semantic. The corpus was
  // captured from a campaign literally named "toolbox-test", and `toolbox-`
  // is a RAW_REJECTED_PREFIXES machine prefix, so the VALUE is refused by
  // design. Declaring it differently would not close it — loosening the
  // grammar would, and that is the wrong trade. This test proves the
  // distinction so the remainder is never mistaken for unpaid debt.
  assert.deepEqual(Object.keys(outstanding).sort(), [
    "npc.query", "scene.context", "setup.phase",
  ]);
  for (const [operation, fields] of Object.entries(outstanding)) {
    assert.deepEqual(fields, ["campaign_id"], `${operation} carries a real gap`);
    const diagnostics = { unmapped: [] };
    projection.projectModelVisibleCanonicalResult(
      operation,
      { ok: true, tool: operation, data: { campaign_id: "amaranthine-run3" } },
      registry.emptySemanticProjectionView(),
      diagnostics,
    );
    assert.deepEqual(
      diagnostics.unmapped,
      [],
      `${operation} drops campaign_id for an ordinary campaign name too, so `
        + "this is a genuine declaration gap and not the toolbox- prefix",
    );
  }
});
