#!/usr/bin/env node
// A failed exact lookup must point somewhere.
//
// `coc_discover` answered a miss with `unknown_operation` and nothing else, so
// a Keeper one synonym away from the real name had no way back. Live on
// 2026-09-01 that cost the same stat change twice. The Keeper needed to record
// a POW drain, guessed `state.characteristic_adjust` -- the operation is
// `state.characteristic_delta` -- got a bare miss, and recorded the drain as
// HP damage it then had to undo. An earlier turn burned four guesses
// (`state.characteristic_adjust`, `state.adjust_characteristic`,
// `rules.characteristic_damage`, `state.resource_adjust`) and narrated nine
// points of STR torn away while the sheet still read 40. Listing the namespace
// is not a fallback: the busy ones are over the discovery budget.
//
// The matching is structural -- shared name tokens -- so there is no synonym
// table to keep current and no guess about what the Keeper meant.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const workingSet = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/tool-working-set.ts")).href
);
const catalogModule = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);

const SNAPSHOT = { role: "play", phase: "live_turn", stage: "acting", playerTurnEpoch: 1 };
const catalog = catalogModule.defaultTypedToolCatalog();
const nearest = (operation) =>
  workingSet.nearestLoadableOperations(operation, SNAPSHOT, catalog);

test("the miss that cost a stat change now names the real operation", () => {
  assert.ok(
    nearest("state.characteristic_adjust").includes("state.characteristic_delta"),
    `got ${JSON.stringify(nearest("state.characteristic_adjust"))}`,
  );
});

test("the other guesses from that session land too", () => {
  for (const guess of [
    "state.adjust_characteristic",
    "rules.characteristic_damage",
  ]) {
    assert.ok(
      nearest(guess).includes("state.characteristic_delta"),
      `${guess} -> ${JSON.stringify(nearest(guess))}`,
    );
  }
});

test("a distinctive token outranks a shared namespace", () => {
  // Dozens of operations start with `state.`; the token after it is what
  // identifies one, so a namespace-only match must not crowd out a real hit.
  const rows = nearest("state.characteristic_adjust");
  assert.equal(rows[0], "state.characteristic_delta");
  assert.ok(rows.length <= 3, `too many suggestions: ${JSON.stringify(rows)}`);
});

test("a namespace-only miss still gets something rather than nothing", () => {
  const rows = nearest("state.utterly_unrelated_thing");
  assert.ok(rows.length > 0 && rows.every((row) => row.startsWith("state.")));
});

test("a miss sharing nothing suggests nothing", () => {
  assert.deepEqual(nearest("zzz.qqq"), []);
  assert.deepEqual(nearest(""), []);
});

test("only operations this session could actually load are offered", () => {
  // `rules.roll` is real but off the KP surface; suggesting it would send the
  // Keeper into a policy_forbidden round trip.
  for (const row of nearest("rules.roll_characteristic")) {
    assert.notEqual(row, "rules.roll");
  }
});
