#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const projection = await import(
  pathToFileURL(
    path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts"),
  ).href
);

test("oversized combat.end card keeps replay semantics and hides integrity", () => {
  const digest = `sha256:${"9a2699552c8af853".padEnd(64, "f")}`;
  const canonical = {
    ok: true,
    tool: "combat.end",
    wire: {
      schema_version: 1,
      profile: "keeper_hot_v1",
      canonical_operation: "combat.end",
      max_inline_bytes: 16384,
      full_result_bytes: 50656,
      full_result_sha256: `sha256:${"0".repeat(64)}`,
      contract_archive_sha256: `sha256:${"1".repeat(64)}`,
      payload_projected: true,
      identity_only: true,
      measured_inline_bytes: 1068,
    },
    data: {
      projection_sha256: digest,
      // Post ten-family cutover `combat.end` is `kp_surface: "none"` and
      // outside the coc_invoke compatibility set, so the host emits a card
      // that names the operation without inviting a call the ACL refuses.
      replay_operation: {
        operation: "combat.end",
        invoke_via: null,
        model_invocable: false,
        prefilled_arguments: {},
        missing_arguments: [],
        authority: "advisory",
        hard_gate: false,
        contract_ref: "combat.end@4646cc703297402e",
        discovery_required: false,
      },
    },
    warnings: [
      "The canonical result exceeded the bounded coding-host projection.",
    ],
    hints: [],
  };
  const diagnostics = { unmapped: [] };

  const visible = projection.projectModelVisibleCanonicalResult(
    "combat.end",
    canonical,
    null,
    diagnostics,
  );

  assert.deepEqual(diagnostics.unmapped, []);
  assert.equal(visible.ok, true);
  assert.equal(visible.data.projection_sha256, undefined);
  assert.deepEqual(visible.data.replay_operation, {
    operation: "combat.end",
    invoke_via: null,
    model_invocable: false,
    prefilled_arguments: {},
    missing_arguments: [],
    authority: "advisory",
    hard_gate: false,
    discovery_required: false,
  });
  assert.ok(!JSON.stringify(visible).includes(digest));
  assert.ok(!Object.hasOwn(visible, "wire"));
});
