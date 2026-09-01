// The first player turn after a host restart must arrive with its journal
// binding armed.
//
// `state.journal` declares `player_text` and `decision_id` host-owned, so the
// model never sees them and the host must supply them. The ordinary path arms
// the binding at message start, but that path is skipped while the startup
// resume gate is still pending — which is exactly the case when the player's
// message reaches a freshly restarted process. On a live table (2026-09-01,
// campaign amaranthine-run3) the resume classified `awaiting_player`, the gate
// cleared without arming, and the Keeper spent eight minutes cycling
// missing_param → nonretryable_repeat_blocked while the player received an
// empty reply. The turn only recovered because the Keeper eventually opened a
// turn and the open_turn_recovery path adopted the live message.
//
// The gateway branch itself is not reachable from a synthetic session (the
// startup resume classification needs a real campaign and transcript), so this
// pins the invariant at the source: the accepted-resume gate clear must arm the
// journal binding for a live player message that owns the turn. Its live
// acceptance is recorded in
// docs/status/module-pipeline-unification-stage-b.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const source = readFileSync(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"),
  "utf8",
);
const projection = readFileSync(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  "utf8",
);

test("state.journal still owns player_text and decision_id on the host", () => {
  // If either field ever became model-owned this whole binding would be moot,
  // and a stale arming path would be dead weight rather than a fix.
  const table = /"state\.journal":\s*\[(?<fields>[^\]]*)\]/.exec(projection);
  assert.ok(table, "state.journal has no HOST_OWNED_FIELDS entry");
  const fields = [...table.groups.fields.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(fields.includes("player_text"), "player_text is no longer host-owned");
  assert.ok(fields.includes("decision_id"), "decision_id is no longer host-owned");
});

test("the accepted startup resume arms the journal binding it owes", () => {
  // Look at the accepted branch that clears the gate, not the file at large:
  // the open_turn_recovery path arms too, and it is a different repair.
  const clear = source.indexOf("          startupResumeGate = null;\n"
    + "          if (startupGateOrigin === \"role_null_handoff\") {");
  assert.notEqual(clear, -1, "accepted startup-resume gate clear not found");
  const window = source.slice(Math.max(0, clear - 1200), clear);
  assert.match(
    window,
    /armJournalBinding\(/,
    "the accepted startup resume clears the gate without arming state.journal; "
      + "the first player turn after a restart will fail on missing_param",
  );
  assert.match(
    window,
    /livePlayerMessageForOpenTurn\b/,
    "arming must be conditioned on the live player message that owns the turn",
  );
  assert.match(
    window,
    /startupSilentResumeQuarantine === null/,
    "a quarantined resume has no player turn to journal; arming must be gated "
      + "on the quarantine staying disarmed",
  );
  assert.match(
    window,
    /playerTurnEpoch\s*\n?\s*===\s*canonicalProgress\.playerTurnEpoch/,
    "a message from an earlier epoch must not arm this turn's binding",
  );
});

test("arming requires a player text the host actually holds", () => {
  // armJournalBinding reads currentExternalPlayerText, so a caller that arms
  // without setting it produces a silently unarmed binding rather than a fault.
  const arm = /const armJournalBinding = \([^)]*\): void => \{(?<body>[\s\S]*?)\n  \};/
    .exec(source);
  assert.ok(arm, "armJournalBinding not found");
  assert.match(
    arm.groups.body,
    /currentExternalPlayerText/,
    "armJournalBinding no longer reads the host's player text",
  );
});
