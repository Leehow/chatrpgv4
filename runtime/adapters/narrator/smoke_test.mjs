#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "run_narration.mjs");

// Importing the bridge must not require provider credentials or start a session.
const {
  buildAllowedAssertionMap,
  validateNarrationSubmission,
} = await import("./run_narration.mjs");

const groundingEnvelope = {
  scene_anchor: {
    scene_id: "study",
    display_name: "书房",
    sensory_anchors: ["雨点敲窗"],
    location_tags: ["interior"],
  },
  approved_reveals: {
    clue_ids: ["clue-ledger"],
    clues: [{
      clue_id: "clue-ledger",
      player_safe_summary: "账本边缘有新鲜水痕",
    }],
  },
  must_not_reveal: [{ id: "secret-owner", category: "keeper" }],
};
const allowedAssertionMap = buildAllowedAssertionMap(groundingEnvelope);
const anchorRef = "envelope:/scene_anchor/sensory_anchors/0";
const clueRef = "envelope:/approved_reveals/clues/0/player_safe_summary";
assert.equal(allowedAssertionMap[anchorRef].value, "雨点敲窗");
assert.equal(allowedAssertionMap[clueRef].value, "账本边缘有新鲜水痕");
assert.equal(
  Object.keys(allowedAssertionMap).some((ref) => ref.includes("must_not_reveal")),
  false,
);

const legalSubmission = validateNarrationSubmission({
  final_text: "雨点敲着书房的窗，账本边缘留着新鲜水痕。",
  asserted_fact_refs: [anchorRef, clueRef],
  semantic_audit: [
    { asserted_ref: anchorRef, forbidden_ref: "secret-owner",
      decision: "different_fact", reason: "scene observation is not ownership" },
    { asserted_ref: clueRef, forbidden_ref: "secret-owner",
      decision: "different_fact", reason: "visible water mark is not ownership" },
  ],
}, allowedAssertionMap, ["secret-owner"]);
assert.deepEqual(legalSubmission.asserted_fact_refs, [anchorRef, clueRef]);

for (const inventedRef of [
  "sensory:rain_proximity",
  "sensory:desk_dampness",
  "location:interior_study",
]) {
  assert.throws(
    () => validateNarrationSubmission({
      final_text: "invented",
      asserted_fact_refs: [inventedRef],
      semantic_audit: [{
        asserted_ref: inventedRef,
        forbidden_ref: "secret-owner",
        decision: "different_fact",
        reason: "invented grounding ref",
      }],
    }, allowedAssertionMap, ["secret-owner"]),
    /allowed assertion ref/,
  );
}

for (const semanticAudit of [
  [],
  [
    { asserted_ref: anchorRef, forbidden_ref: "secret-owner",
      decision: "different_fact", reason: "one" },
    { asserted_ref: anchorRef, forbidden_ref: "secret-owner",
      decision: "different_fact", reason: "duplicate" },
  ],
  [{ asserted_ref: anchorRef, forbidden_ref: "secret-other",
    decision: "different_fact", reason: "extra pair" }],
  [{ asserted_ref: anchorRef, forbidden_ref: "secret-owner",
    decision: "uncertain", reason: "uncertain is unsafe" }],
]) {
  assert.throws(
    () => validateNarrationSubmission({
      final_text: "rain",
      asserted_fact_refs: [anchorRef],
      semantic_audit: semanticAudit,
    }, allowedAssertionMap, ["secret-owner"]),
    /semantic audit/,
  );
}

// A malformed server envelope must still produce one bounded JSONL error frame,
// without reaching model/provider initialization.
const child = spawn(process.execPath, [runner, "--server"], {
  cwd: here,
  env: {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.stdin.end('{"request_id":7}\n');
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
assert.equal(exitCode, 0, stderr);
const lines = stdout.trim().split("\n");
assert.equal(lines.length, 1, stdout);
const frame = JSON.parse(lines[0]);
assert.equal(frame.request_id, 7);
assert.equal(frame.ok, false);
assert.match(frame.error, /request_id/);
