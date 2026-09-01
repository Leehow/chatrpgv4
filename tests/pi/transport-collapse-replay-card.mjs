#!/usr/bin/env node
/**
 * Structural guard: the wire's collapse stub must reach the Keeper WITH the
 * card that is the whole point of collapsing.
 *
 * When a canonical result exceeds `MAX_INLINE_BYTES`, `coc_mcp_wire.py`
 * replaces `data` with `_minimal_identity(operation, data)` — identity fields
 * plus `replay_operation`, the card that tells the Keeper to re-run the exact
 * typed operation "instead of reading files". The wire's own warning says so.
 * Without that card the envelope is `ok: true` carrying nothing the Keeper can
 * act on: not an error it can recover from, just a dead end mid-turn.
 *
 * `projectModelVisibleCanonicalResult` routes ~8 operations to bespoke
 * projectors. Each is a whitelist over the CANONICAL payload's field names, so
 * handed a stub instead it copies whichever one or two names happen to overlap
 * and drops the card:
 *
 *   state.deliver_handout        -> {}                    (nothing at all)
 *   npc.reaction                 -> schema_version
 *   state.record_npc_engagement  -> schema_version
 *   chase.context                -> active/snapshot/pending_choice_count
 *   chase.execute                -> schema_version/results
 *   narration.review             -> schema_version
 *   state.end_session            -> scene_id
 *   turn.finalize                -> schema_version/status/accepted_revision
 *
 * turn.finalize is the sharpest one: a long accepted narration is exactly what
 * pushes a finalize receipt over the cap, and Rule 4 makes that receipt the
 * sole release path for player output.
 *
 * This is the sibling of transport-collapse-integrity-declaration.mjs. That
 * one guards the fields the collapse stamps FOR the host; this one guards the
 * field it stamps FOR the model. Both axes are DERIVED, never hand-listed:
 *
 *  1. operations come from `OPERATION_POLICY`, generated from canonical
 *     OperationSpec facts — a new operation is covered the day it lands;
 *  2. the guarded field names come from `_minimal_identity`'s own dict
 *     literal, and the collapse markers come from the wire branches that
 *     install that stub — a second card, or a third collapse branch, is
 *     covered the day it is added.
 *
 * No "can this operation really overflow?" filter, deliberately. Every one of
 * these has an unbounded string or list in its canonical payload (handout
 * text, chase location/action cross product, per-skill development
 * settlements, review findings, rendered narration), and gating on the
 * question is how the last hole in this path stayed open: an operation earned
 * its fix only after production had already lost a turn to it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());

const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href
);
const { OPERATION_POLICY } = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/operation-policy.generated.ts"),
  ).href
);

const WIRE_PATH = path.join(
  root,
  "plugins/coc-keeper/scripts/coc_mcp_wire.py",
);
const WIRE_SOURCE = fs.readFileSync(WIRE_PATH, "utf8");

/** Same integrity-name rule the projection uses to classify a field name. */
const INTEGRITY_NAME_TOKENS = ["sha256", "digest", "hash"];
const isIntegrityName = (name) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) =>
      INTEGRITY_NAME_TOKENS.some((integrity) => token.startsWith(integrity))
    );

/**
 * The names `_minimal_identity` unconditionally authors onto EVERY collapse,
 * read back from its `projected` dict literal. Only the unconditional literal
 * counts: the later `projected[...] =` additions are gated on a specific
 * operation family and are that family's own contract.
 *
 * Integrity names are dropped here — they are deliberately details-only and
 * are already guarded by transport-collapse-integrity-declaration.mjs. What
 * remains is what the MODEL is supposed to receive.
 */
function transportAuthoredModelFields() {
  const start = WIRE_SOURCE.indexOf("def _minimal_identity(");
  assert.notEqual(
    start,
    -1,
    "coc_mcp_wire.py no longer defines _minimal_identity; this guard must be "
      + "re-pointed at whatever now collapses an over-cap result",
  );
  const after = WIRE_SOURCE.indexOf("\ndef ", start + 1);
  const body = WIRE_SOURCE.slice(
    start,
    after === -1 ? WIRE_SOURCE.length : after,
  );

  const literalStart = body.indexOf("projected = {");
  assert.notEqual(
    literalStart,
    -1,
    "_minimal_identity no longer builds a `projected` dict literal",
  );
  const literalEnd = body.indexOf("\n    }", literalStart);
  assert.notEqual(literalEnd, -1, "unterminated `projected` dict literal");
  const literal = body.slice(literalStart, literalEnd);

  const fields = new Set();
  for (const match of literal.matchAll(/"([a-z0-9_]+)"\s*:/g)) {
    fields.add(match[1]);
  }
  return [...fields].filter((name) => !isIntegrityName(name)).sort();
}

/**
 * The wire markers that DECLARE "this data is a collapse stub".
 *
 * Derived, not listed: find every branch that installs
 * `_minimal_identity(...)` as the envelope's data, take the enclosing
 * top-level statement of `project_envelope`, and keep the `True` wire flags
 * those branches set that are set NOWHERE else in the wire. `payload_projected`
 * is stamped by a dozen ordinary bounded projections, so it drops out on its
 * own; `identity_only` and `projection_failed` are written only here.
 */
function collapseWireMarkers() {
  const fnStart = WIRE_SOURCE.indexOf("def project_envelope(");
  assert.notEqual(fnStart, -1, "coc_mcp_wire.py no longer defines project_envelope");
  const fnAfter = WIRE_SOURCE.indexOf("\ndef ", fnStart + 1);
  const fnBody = WIRE_SOURCE.slice(
    fnStart,
    fnAfter === -1 ? WIRE_SOURCE.length : fnAfter,
  );
  const lines = fnBody.split("\n");
  // A statement of the function body starts at exactly four spaces of indent.
  const isStatementStart = (line) => /^ {4}\S/.test(line);

  const blocks = [];
  lines.forEach((line, index) => {
    if (!line.includes("_minimal_identity(")) return;
    let start = index;
    while (start > 0 && !isStatementStart(lines[start])) start -= 1;
    let end = index + 1;
    while (end < lines.length && !isStatementStart(lines[end])) end += 1;
    blocks.push([start, end]);
  });
  assert.ok(
    blocks.length > 0,
    "project_envelope no longer installs _minimal_identity; this guard must be "
      + "re-pointed at whatever now collapses an over-cap result",
  );

  const inBlock = new Set();
  for (const [start, end] of blocks) {
    for (let index = start; index < end; index += 1) inBlock.add(index);
  }
  // `"name": True` and `result["wire"]["name"] = True` alike.
  const trueFlags = (text) =>
    [...text.matchAll(/"([a-z0-9_]+)"\s*(?::|\]\s*=)\s*True\b/g)]
      .map((match) => match[1]);

  const inside = new Set();
  const elsewhere = new Set();
  lines.forEach((line, index) => {
    for (const flag of trueFlags(line)) {
      (inBlock.has(index) ? inside : elsewhere).add(flag);
    }
  });
  // Flags set outside project_envelope are equally "set elsewhere".
  for (const flag of trueFlags(WIRE_SOURCE.replace(fnBody, ""))) {
    elsewhere.add(flag);
  }
  return [...inside].filter((flag) => !elsewhere.has(flag)).sort();
}

const modelFields = transportAuthoredModelFields();
const markers = collapseWireMarkers();
const operations = Object.keys(OPERATION_POLICY).sort();

test("the collapse stub and its declaring markers are both recoverable", () => {
  // A guard that silently found nothing to check is worse than no guard.
  assert.ok(
    modelFields.length > 0,
    "no model-facing field was recovered from _minimal_identity's `projected` "
      + "literal; the parser above has drifted from the wire",
  );
  assert.ok(
    markers.length > 0,
    "no collapse-exclusive wire marker was recovered from project_envelope; "
      + "the parser above has drifted from the wire",
  );
  assert.ok(operations.length > 100, "the generated operation policy is empty");
});

/**
 * Build the exact envelope the wire emits around a collapse stub. Both
 * dispositions are exercised for every marker rather than pairing each marker
 * with the `ok` it happens to ship with today: the `ok: true` collapse and the
 * `ok: false` `mcp_wire_budget_exceeded` fallback carry the same stub, and two
 * of the bespoke projectors are themselves gated on `ok === true`.
 */
function collapseEnvelope(operation, marker, ok) {
  const data = {
    schema_version: 1,
    decision_id: `${operation.replace(/[._]/g, "-")}-collapse`,
    projection_sha256: `sha256:${"c".repeat(64)}`,
    replay_operation: {
      operation,
      invoke_via: null,
      model_invocable: false,
      prefilled_arguments: {},
      missing_arguments: [],
      authority: "advisory",
      hard_gate: false,
      discovery_required: false,
    },
  };
  const envelope = {
    ok,
    tool: operation,
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      canonical_operation: operation,
      max_inline_bytes: 16384,
      // Over the cap; this is what drove the collapse.
      full_result_bytes: 41888,
      full_result_sha256: `sha256:${"0".repeat(64)}`,
      contract_archive_sha256: `sha256:${"1".repeat(64)}`,
      payload_projected: true,
      [marker]: true,
    },
    data,
    warnings: [],
    hints: [],
  };
  if (!ok) {
    envelope.error = {
      code: "mcp_wire_budget_exceeded",
      message:
        "The canonical operation succeeded, but its safe coding-host "
        + "projection could not fit the transport budget.",
    };
  }
  return envelope;
}

for (const marker of markers) {
  for (const field of modelFields) {
    test(
      `every operation keeps ${field} through a ${marker} collapse`,
      () => {
        const lost = [];
        for (const operation of operations) {
          for (const ok of [true, false]) {
            const visible = projection.projectModelVisibleCanonicalResult(
              operation,
              collapseEnvelope(operation, marker, ok),
              null,
              { unmapped: [] },
            );
            const projected = visible.data?.[field];
            if (projected === undefined || projected === null) {
              lost.push(`${operation} (ok: ${ok})`);
            }
          }
        }
        assert.deepEqual(
          lost,
          [],
          `these operations drop ${field} — the field the wire's collapse `
            + `stamps for the MODEL — leaving an ok envelope with nothing `
            + `actionable in it. A collapse stub is not the operation's `
            + `canonical payload, so it must not be routed through the `
            + `operation's canonical projector.`,
        );
      },
    );
  }

  test(`the ${marker} collapse card still names its own operation`, () => {
    // The card is only actionable if it is THIS operation's replay card;
    // a card copied from some other operation would be worse than none.
    for (const operation of operations) {
      const visible = projection.projectModelVisibleCanonicalResult(
        operation,
        collapseEnvelope(operation, marker, true),
        null,
        { unmapped: [] },
      );
      assert.equal(
        visible.data?.replay_operation?.operation,
        operation,
        `${operation}'s ${marker} collapse card does not name ${operation}`,
      );
    }
  });
}
