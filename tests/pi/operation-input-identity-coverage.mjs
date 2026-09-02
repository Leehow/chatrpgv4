#!/usr/bin/env node
// Static companion to operation-identity-declaration-sweep.mjs.
//
// That sweep is exact but only sees operations whose envelopes someone
// captured into the corpus: 59 of the 147 in the contract registry. The other
// 88 are unwatched, and an unwatched operation fails its ENTIRE result closed
// the first time a Keeper reaches it with an identity-bearing field. That is
// not hypothetical — on 2026-09-01 (campaign amaranthine-run3) five of them
// did it in one evening, and state.npc_presence cost a whole scene: the
// Keeper tried to place an NPC, was told the tool had failed, and the social
// roll that followed was refused as `social_candidate_stale` because the
// scene then had nobody in it to talk to.
//
// This closes the coverage gap without capturing 88 more envelopes, by using
// a fact the registry already carries: an operation's result echoes the
// identity-shaped fields of its own input. Every keeper-facing contract's
// inputSchema is projected as if echoed, so a new operation — or a new
// identity input on an existing one — is caught here on the day it is added
// rather than at somebody's table.
//
// It cannot replace the corpus sweep: a result also names fields that were
// never inputs (`active_scene_id`, `lie_id`, `possible_continuations`), and
// only a real envelope shows those.
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
const contracts = JSON.parse(fs.readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
)).operations;

const IDENTITY_NAMED = /(^|_)(id|ids|ref|refs)$/;
// Host-owned transport fields: never model-visible, so never this check's
// subject.
const HOST_TRANSPORT = new Set(["root", "campaign", "decision_id"]);
// Fields that resolve against the LIVE semantic registry, which a static
// probe cannot reproduce. They report their own domain and stay separable
// from a genuine declaration gap — the same exclusion the corpus sweep makes.
const REGISTRY_DOMAINS = new Set([
  "roll", "effect", "item", "weapon", "route", "affordance", "evidence",
]);

function keeperOperations() {
  return Object.entries(contracts).filter(
    ([, contract]) => contract.policy?.audience === "keeper",
  );
}

/** Project one operation's echoed input identity; report undeclared fields. */
function echoedInputGaps(operation, contract, value = "alpha-beta") {
  const properties = contract.inputSchema?.properties ?? {};
  const fields = Object.keys(properties).filter(
    (field) => IDENTITY_NAMED.test(field) && !HOST_TRANSPORT.has(field),
  );
  if (fields.length === 0) return null;
  const data = {};
  for (const field of fields) {
    data[field] = properties[field].type === "array" ? [value] : value;
  }
  const diagnostics = { unmapped: [] };
  projection.projectModelVisibleCanonicalResult(
    operation,
    { ok: true, tool: operation, data },
    registry.emptySemanticProjectionView(),
    diagnostics,
  );
  return [...new Set(
    diagnostics.unmapped
      .filter((entry) => entry.field && !REGISTRY_DOMAINS.has(entry.domain))
      .map((entry) => entry.field),
  )];
}

test("the registry still describes the surface this check depends on", () => {
  assert.ok(
    Object.keys(contracts).length >= 140,
    "operation contract registry shrank unexpectedly",
  );
  const withIdentityInputs = keeperOperations()
    .filter(([operation, contract]) => echoedInputGaps(operation, contract));
  assert.ok(
    withIdentityInputs.length >= 50,
    `expected the keeper surface to carry identity inputs broadly, got `
      + `${withIdentityInputs.length}`,
  );
});

test("no keeper operation fails closed on its own echoed input identity", () => {
  const gaps = [];
  for (const [operation, contract] of keeperOperations()) {
    for (const field of echoedInputGaps(operation, contract) ?? []) {
      gaps.push(`${operation}.${field}`);
    }
  }
  assert.deepEqual(
    gaps,
    [],
    "these operations take an identity field and have no disposition for it, "
      + "so the first Keeper to pass one gets semantic_identity_unavailable "
      + "for the whole result. Add each to OPERATION_IDENTITY_DECLARATIONS "
      + "(semantic for an authored slug the Keeper reads, hostOnly for a "
      + "machine handle or provenance ref): " + gaps.join(", "),
  );
});

test("the declarations accept the value shapes the contracts describe", () => {
  // A declaration is not enough on its own: a declared field whose real value
  // cannot pass the closed grammar still drops. These are the shapes the
  // contract descriptions name for fields this check closed.
  for (const [operation, field, value] of [
    ["state.item_grant", "mechanics_ref", "campaign-item:brass-lantern"],
    ["state.purchase", "mechanics_ref", "module-item:corbitt-diary"],
    ["memory.adjudicate", "subject_id", "subject-party-amaranthine"],
    ["state.npc_presence", "npc_id", "npc-henry-scott"],
    ["state.npc_presence", "scene_id", "scene-into-the-town"],
    ["state.threat_tick", "clock_id", "clock-the-bell"],
    ["quest.activate", "quest_id", "quest-return-the-grave-goods"],
    ["mechanics.ensure", "fallback_archetype_id", "capable_adult"],
  ]) {
    const diagnostics = { unmapped: [] };
    projection.projectModelVisibleCanonicalResult(
      operation,
      { ok: true, tool: operation, data: { [field]: value } },
      registry.emptySemanticProjectionView(),
      diagnostics,
    );
    assert.deepEqual(
      diagnostics.unmapped,
      [],
      `${operation}.${field} is declared but drops its own documented value `
        + `shape (${value})`,
    );
  }
});

test("declaring a field never opens the grammar to machine material", () => {
  // The point of a disposition is to say what a field MEANS, not to wave it
  // through. Entropy and digests must still fail on the fields just declared.
  for (const [operation, field, value] of [
    ["state.npc_presence", "npc_id", "npc-9f2c1ab4d7e6c8a1b2c3d4e5"],
    ["state.threat_tick", "clock_id", "sha256:" + "a".repeat(64)],
    ["quest.activate", "quest_id", "550e8400-e29b-41d4-a716-446655440000"],
  ]) {
    const diagnostics = { unmapped: [] };
    projection.projectModelVisibleCanonicalResult(
      operation,
      { ok: true, tool: operation, data: { [field]: value } },
      registry.emptySemanticProjectionView(),
      diagnostics,
    );
    assert.ok(
      diagnostics.unmapped.length > 0,
      `${operation}.${field} accepted machine material (${value})`,
    );
  }
});
