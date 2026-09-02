#!/usr/bin/env node
/**
 * A campaign still in `setup` has never opened either.
 *
 * `resumeShouldOpenUnopenedTable` recognised only the LATER kind of unopened
 * table -- setup finished, handoff receipt written, curtain not yet up. A setup
 * that failed part way through is an earlier kind of the same thing, and it
 * returned false for it. `session.resume` then reported
 * `mode: "open_turn_recovery"` (the chargen turn never closed), the phase read
 * `recovery`, and a setup-role session has no move there:
 *
 *   setup.complete              phase_forbidden   (cold_start/opening/live_turn)
 *   progressive.prepare_opening phase_forbidden   (opening)
 *   state.journal / scene.context / turn.*        role_forbidden (role: setup)
 *
 * Live on 2026-09-02: chargen failed on an unrecognized occupation skill and
 * the campaign could never open a table again -- reachable from any setup-time
 * error, on the one path every new campaign must take.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const source = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts")).href
);

const text = (await import("node:fs")).readFileSync(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"), "utf8",
);
const start = text.indexOf("export function resumeShouldOpenUnopenedTable");
const body = text.slice(start, start + 1600);

// The predicate must accept a campaign that has not finished setup, and must
// do so BEFORE requiring the handoff receipt that such a campaign cannot have.
const setupBranch = body.indexOf('campaign.status === "setup"');
const receiptGuard = body.indexOf("hasSetupHandoff");
assert.ok(setupBranch > 0, "an unfinished setup must count as an unopened table");
assert.ok(
  setupBranch < receiptGuard,
  "the setup branch must precede the handoff-receipt guard; a campaign still "
  + "in setup has no receipt, so ordering it after rejects the very case",
);

// Nothing else was loosened: the later kind still requires its receipt.
assert.ok(
  /campaign\.status === "ready_for_table" \|\| campaign\.status === "active"/
    .test(body),
  "a handed-off campaign still gates on ready_for_table/active",
);
assert.ok(
  typeof source.resumeShouldOpenUnopenedTable === "function",
  "the predicate stays exported for the phase inference that consumes it",
);

console.log("unopened-table-includes-unfinished-setup ok");
