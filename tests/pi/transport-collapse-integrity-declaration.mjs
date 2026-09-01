#!/usr/bin/env node
/**
 * Structural guard for the bounded wire's identity-collapse path.
 *
 * `_minimal_identity` in plugins/coc-keeper/scripts/coc_mcp_wire.py is the
 * last-resort projection for ANY canonical result that exceeds
 * `MAX_INLINE_BYTES`. It stamps machine integrity onto the collapsed payload
 * that the canonical operation never emitted. If the Pi projection has not
 * declared that transport-authored field, `stripOpaqueModelIdentity` reads it
 * as unknown integrity evidence and the gateway turns the whole envelope into
 * `semantic_identity_unavailable` — the Keeper is told its authoritative
 * result failed when it did not.
 *
 * That is not hypothetical. `rules.context` decision-card payloads for four
 * rule families exceed the cap (sanity 30,199 B; combat 27,797 B; magic
 * 26,046 B; chase 19,331 B), so every call for those families died here, and
 * none of the four ever produced a settlement. `setup.inspect` and
 * `combat.end` had each been patched privately after hitting the same wall.
 *
 * Both axes of this test are DERIVED, never hand-listed, so neither can rot:
 *
 *  1. the operations come from `OPERATION_POLICY`, generated from canonical
 *     OperationSpec facts — a new operation is covered the day it lands;
 *  2. the fields come from the `_minimal_identity` source itself — a new
 *     digest stamped onto the collapse is covered the day it is added.
 *
 * Every operation is checked, with no "can this one really overflow?" filter.
 * The wire's collapse branch is operation-neutral: it excludes only
 * `turn.output_context`, and even that reaches `_minimal_identity` through
 * the final `mcp_wire_budget_exceeded` fallback. Any operation whose result
 * grows past the cap — from a richer card, a longer scene, a bigger
 * settlement — walks this path on its very first overflow, in production,
 * with no prior warning.
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
 * Read back the field names `_minimal_identity` WRITES onto the collapsed
 * payload. Only keys the transport authors count: the names it `_pick`s out
 * of the canonical data are the emitting operation's own evidence, are
 * already present on the un-collapsed result, and stay operation-declared.
 */
function transportAuthoredCollapseFields() {
  const source = fs.readFileSync(WIRE_PATH, "utf8");
  const start = source.indexOf("def _minimal_identity(");
  assert.notEqual(
    start,
    -1,
    "coc_mcp_wire.py no longer defines _minimal_identity; this guard must be "
      + "re-pointed at whatever now collapses an over-cap result",
  );
  const after = source.indexOf("\ndef ", start + 1);
  const body = source.slice(start, after === -1 ? source.length : after);

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
  for (const match of body.matchAll(/projected\["([a-z0-9_]+)"\]\s*=/g)) {
    fields.add(match[1]);
  }
  return [...fields].filter(isIntegrityName).sort();
}

const collapseIntegrityFields = transportAuthoredCollapseFields();
const operations = Object.keys(OPERATION_POLICY).sort();

test("the wire's identity collapse stamps at least one integrity field", () => {
  // A guard that silently found nothing to check is worse than no guard.
  assert.ok(
    collapseIntegrityFields.length > 0,
    "no transport-authored integrity field was recovered from "
      + "_minimal_identity; the parser above has drifted from the wire",
  );
  assert.ok(operations.length > 100, "the generated operation policy is empty");
});

for (const field of collapseIntegrityFields) {
  test(
    `every operation survives an over-cap collapse carrying ${field}`,
    () => {
      const digest = `sha256:${"c".repeat(64)}`;
      const failedClosed = [];
      for (const operation of operations) {
        const diagnostics = { unmapped: [] };
        const visible = projection.projectModelVisibleCanonicalResult(
          operation,
          {
            ok: true,
            tool: operation,
            wire: {
              schema_version: 1,
              profile: "keeper_hot_v1",
              canonical_operation: operation,
              max_inline_bytes: 16384,
              // Over the cap; this is what drove the collapse.
              full_result_bytes: 30199,
              full_result_sha256: `sha256:${"0".repeat(64)}`,
              contract_archive_sha256: `sha256:${"1".repeat(64)}`,
              payload_projected: true,
              identity_only: true,
              measured_inline_bytes: 1125,
            },
            data: {
              schema_version: 1,
              [field]: digest,
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
            },
            warnings: [
              "The canonical result exceeded the bounded coding-host "
                + "projection; use the returned exact typed operation instead "
                + "of reading files.",
            ],
            hints: [],
          },
          null,
          diagnostics,
        );

        if (diagnostics.unmapped.length > 0) {
          failedClosed.push(operation);
          continue;
        }
        // Declared integrity is intentionally details-only: stripped from
        // model content, never echoed anywhere in the visible envelope.
        assert.equal(
          visible.data?.[field],
          undefined,
          `${operation} leaked ${field} into model content`,
        );
        assert.ok(
          !JSON.stringify(visible).includes(digest),
          `${operation} echoed the ${field} value`,
        );
      }

      assert.deepEqual(
        failedClosed,
        [],
        `these operations turn an authoritative over-cap result into `
          + `semantic_identity_unavailable because ${field} — which the wire `
          + `stamps on EVERY collapse — is undeclared. Declare it once in `
          + `TRANSPORT_COLLAPSE_INTEGRITY_FIELDS, not per operation.`,
      );
    },
  );
}
