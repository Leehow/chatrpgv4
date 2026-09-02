#!/usr/bin/env node
/**
 * `decision:coc7:development:settle-ending` has no production model-view
 * projector, and one cannot honestly be written yet.
 *
 * This is not a claim that the decision is fine. It is a recorded gap:
 *
 * 1. settle-ending is a live declared decision. It appears in the RuleGraph,
 *    in `mcp-operation-contracts.json`, and `coc_operation_kernel.py` has a
 *    dedicated branch that binds its `ending_id` from the persisted ending
 *    receipt. It is reachable; it has simply never been exercised in a run
 *    that got recorded.
 *
 * 2. No recorded settle-ending settlement exists anywhere in the corpus, so
 *    the exact shape of its `rules.settle` envelope is unknown.
 *
 * 3. Without a projector, dispatch falls through to the generic sanitizer,
 *    which rejects the settlement's identity and integrity material. Those
 *    rejections are what the gateway turns into
 *    `semantic_identity_unavailable` — the same failure that made
 *    `push-luck:pushed-roll` and `psychology:observe-concealed` re-settle and
 *    burn their turns. So settle-ending WILL need a closed projector; it
 *    cannot be written against a guessed payload.
 *
 * This test pins the gap so it stays visible, and fails the moment the first
 * real settle-ending payload is vendored — at which point the projector can
 * finally be written against evidence instead of a guess.
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

const SETTLE_ENDING = "decision:coc7:development:settle-ending";
const dir = path.join(root, "tests/fixtures/rules-settle-recorded");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));

// (1) The decision is live, not dead code.
const contracts = fs.readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
);
assert.ok(
  contracts.includes(SETTLE_ENDING),
  "settle-ending must still be a declared operation; if it was retired, delete this test",
);

// (2) Still no recorded settlement. When this fires, the gap is closable.
const recorded = index.payloads.filter((row) => row.decision_ref === SETTLE_ENDING);
assert.deepEqual(
  recorded.map((row) => row.file),
  [],
  "A settle-ending payload now exists. Write its closed projector in "
  + "plugins/coc-keeper/pi/lib/tool-contract-projection.ts, dispatch it from "
  + "projectRulesSettleData, add it to rules-settle-recorded-projection.mjs, "
  + "and delete this gap test.",
);

// (3) Show what the generic sanitizer does to development settlement material.
//     The receipt below is NOT invented: it is copied verbatim out of a
//     recorded end-session settlement, which embeds a real `development.settle`
//     receipt of exactly the kind settle-ending would carry.
const endSession = index.payloads.find(
  (row) => row.decision_ref === "decision:coc7:development:end-session",
);
assert.ok(endSession, "the end-session corpus is the only development evidence there is");
const recordedEndSession = JSON.parse(
  fs.readFileSync(path.join(dir, endSession.file), "utf8"),
);
const receipt =
  recordedEndSession.settlement?.result?.development?.settlements?.[0]?.receipt;
assert.ok(receipt, "recorded end-session must still embed a development.settle receipt");

const diagnostics = { unmapped: [] };
const visible = projectModelVisibleCanonicalResult(
  "rules.settle",
  {
    ok: true,
    tool: "rules.settle",
    data: {
      decision_ref: SETTLE_ENDING,
      family: "development",
      status: "settled",
      investigator_id: recordedEndSession.investigator_id,
      settlement: { existing_result_envelope: true, result: receipt },
    },
    warnings: [],
    hints: [],
  },
  null,
  diagnostics,
);

// The envelope survives and leaks nothing — the generic sanitizer is not
// unsafe, it is lossy.
assert.equal(visible.ok, true);
const rendered = JSON.stringify(visible);
for (const forbidden of ["toolbox-", "integrity_digest", "record_digest"]) {
  assert.equal(
    rendered.includes(forbidden),
    false,
    `${forbidden} must not reach the model view even without a projector`,
  );
}

// ...but it drops the identity a Keeper needs to know which ending settled,
// which is what forces `semantic_identity_unavailable`.
const rejected = new Set(diagnostics.unmapped.map((row) => row.field));
// `event_id` left this list on 2026-09-02: rules.settle now declares it
// host-only, so it is dropped by declaration rather than rejected as unmapped.
// That shrinks the gap without closing it — the three below still collapse a
// settle-ending envelope, and the projector is still owed.
for (const field of ["ending_id", "scene_id", "scenario_id"]) {
  assert.ok(
    rejected.has(field),
    `expected the generic sanitizer to reject ${field}; if it no longer does, `
    + "re-evaluate whether settle-ending still needs its own projector",
  );
}
assert.ok(
  diagnostics.unmapped.some((row) => row.domain === "integrity"),
  "expected integrity material to be rejected too",
);

// (4) Even the inner evidence is thin: every recorded development settlement
//     is an empty retreat, so the parts that matter most for a projector --
//     improvement check rolls, the SAN reward roll -- have never been
//     recorded at all. A projector guessed against these would be guessing
//     exactly where it matters.
const developmentPayloads = index.payloads.filter(
  (row) => row.family === "development",
);
const substantive = developmentPayloads.filter((row) => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, row.file), "utf8"));
  const inner =
    data.settlement?.result?.development?.settlements?.[0]?.receipt?.result;
  return Boolean(
    inner
    && (inner.improvement_checks?.length
      || inner.skills_improved?.length
      || inner.san_reward_roll),
  );
});
assert.deepEqual(
  substantive.map((row) => row.file),
  [],
  "A development settlement with real improvement/SAN mechanics is now "
  + "recorded. That is the evidence a settle-ending projector needs; "
  + "re-evaluate this gap.",
);

console.log(
  `settle-ending projection gap: still unrecorded; generic sanitizer rejects `
  + `${diagnostics.unmapped.length} identity/integrity fields `
  + `(${developmentPayloads.length} development payloads, all empty retreats)`,
);
