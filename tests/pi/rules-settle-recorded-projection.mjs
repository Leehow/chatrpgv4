#!/usr/bin/env node
/**
 * Every `rules.settle` payload the host has actually committed in a real
 * Gate 9 RPC run must produce a model view.
 *
 * When this projection fails, the canonical settlement has already happened:
 * the host keeps the exact result internally and hands the Keeper
 * `semantic_identity_unavailable` instead. The Keeper cannot see the D100 it
 * just caused, so it re-settles — which is how one decision turns into four
 * tool round trips and a turn runs out its budget. Both recorded projection
 * failures (`push-luck:pushed-roll`, `psychology:observe-concealed`) happened
 * that way.
 *
 * Fixtures are verbatim canonical payloads; `index.json` records which run
 * each came from. A family with no fixture here has never produced a
 * recorded settlement, and its projection is therefore unproven.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { projectModelVisibleCanonicalResult } = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));

const dir = path.join(root, "tests/fixtures/rules-settle-recorded");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
assert.ok(index.payloads.length > 0, "the recorded corpus is not empty");

const failures = [];
for (const row of index.payloads) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, row.file), "utf8"));
  assert.equal(data.decision_ref, row.decision_ref, row.file);
  const diagnostics = { unmapped: [] };
  const visible = projectModelVisibleCanonicalResult(
    "rules.settle",
    { ok: true, tool: "rules.settle", data, warnings: [], hints: [] },
    null,
    diagnostics,
  );
  assert.equal(visible.ok, true, `${row.file}: envelope must stay ok`);
  for (const unmapped of diagnostics.unmapped) {
    failures.push(`${row.decision_ref}  ${unmapped.domain}  ${unmapped.path}`);
  }
  // A settled result must still carry its settlement to the Keeper.
  assert.ok(
    visible.data?.settlement,
    `${row.file}: the settlement must survive projection`,
  );
}

assert.deepEqual(
  failures,
  [],
  "every recorded canonical settlement must project with no unmapped identity",
);

// No projected model view may relay machine identity or integrity material.
for (const row of index.payloads) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, row.file), "utf8"));
  const visible = projectModelVisibleCanonicalResult(
    "rules.settle",
    { ok: true, tool: "rules.settle", data, warnings: [], hints: [] },
    null,
    { unmapped: [] },
  );
  const rendered = JSON.stringify(visible);
  for (const forbidden of ["toolbox-", "integrity_digest", "record_digest"]) {
    assert.equal(
      rendered.includes(forbidden),
      false,
      `${row.file}: ${forbidden} must not reach the model view`,
    );
  }
}

console.log(
  `rules.settle recorded projection: ${index.payloads.length} payloads ok`,
);
