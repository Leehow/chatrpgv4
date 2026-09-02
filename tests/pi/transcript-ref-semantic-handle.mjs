#!/usr/bin/env node
/**
 * A transcript row must be nameable without leaking machine identity.
 *
 * `transcript_ref` is a locator whose last component is the row's canonical
 * owning decision -- a journal decision id for a player row, a finalization id
 * for a settled Keeper row. That is machine identity by design: it is what
 * makes row identity canonical instead of positional. Declared `semantic`, it
 * could never satisfy the semantic grammar, and one unmapped identity field
 * collapses the WHOLE envelope, so `transcript.locate` returned
 * `semantic_identity_unavailable` to the Keeper.
 *
 * Live evidence: 7 of 9 locate calls in the 2026-09-01 turn, and 4 more in the
 * turn that forked the worldline on 2026-09-02. The colon-escaping that makes
 * the failure visible (`pi-state-journal%3A...`) is deliberate and correct --
 * the locator is colon-delimited -- but `%` is not slug material either, so
 * both spellings of the same id fail the same way.
 *
 * Neither of the other two dispositions fits: `integrity` is a closed universe
 * of digest-named fields a readable coordinate cannot enter, and `hostOnly`
 * strips the field from the model-visible result, leaving the Keeper holding
 * rows it cannot name and making `transcript.read` unreachable outright.
 *
 * So the row is named by a registry handle minted from what it MEANS -- its
 * turn and speaker -- and the canonical locator stays host-side, exactly as
 * rolls, items and routes already work.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const projection = await load("plugins/coc-keeper/pi/lib/tool-contract-projection.ts");
const registryModule = await load("plugins/coc-keeper/pi/lib/semantic-identity-registry.ts");

const CANONICAL =
  "xscript:tl-main:turn-48:player:player_turn:"
  + "pi-state-journal%3Af0fd1ddb%3Aplayer-epoch-2%3Arevision-1";

const locateResult = () => ({
  status: "matched",
  candidates: [{
    transcript_ref: CANONICAL,
    turn: 48,
    role: "player",
    record_kind: "player_turn",
    speaker: "投资者",
  }],
});

// --- the registry mints a handle from the row's meaning ------------------ //
const registry = registryModule.createSemanticIdentityRegistry();
const scope = { sessionEpoch: 1, campaign: "campaign-1", playerTurnEpoch: 2 };
const minted = registry.register({
  domain: "transcript",
  canonicalId: CANONICAL,
  facts: ["turn-48-player", "turn-48", "投资者", "player_turn"],
  scope,
  lifetime: "authoritative",
});
assert.equal(minted.ok, true, "a transcript row must be registrable");
assert.ok(
  minted.handle.startsWith("transcript:"),
  `handle must carry its own namespace, got ${minted.handle}`,
);
assert.ok(
  !minted.handle.includes("%") && !minted.handle.includes("pi-"),
  `handle must not carry escaped or machine material, got ${minted.handle}`,
);

// --- projection replaces the canonical locator, with no diagnostic ------- //
const view = registry.projectAll(scope);
const diagnostics = { unmapped: [] };
const projected = projection.stripOpaqueModelIdentity(
  locateResult(),
  null,
  view,
  diagnostics,
  "transcript.locate",
);
assert.deepEqual(
  diagnostics.unmapped,
  [],
  "a registered row must not report an unmapped identity -- one such entry "
  + "collapses the whole envelope to semantic_identity_unavailable",
);
assert.equal(projected.candidates[0].transcript_ref, minted.handle);
assert.ok(
  !JSON.stringify(projected).includes("pi-state-journal"),
  "the canonical owning decision must not reach the model",
);

// --- the handle round-trips back to the canonical locator on input ------- //
const resolver = {
  resolveRoll: () => null,
  resolveEffect: () => null,
  resolveItem: () => null,
  resolveWeapon: () => null,
  resolveRoute: () => null,
  resolveAffordance: () => null,
  resolveTranscript: (handle) => {
    const result = registry.resolveHandle("transcript", handle, scope);
    return result.ok ? result.canonicalId : null;
  },
};
const restored = projection.restoreSemanticEntityHandles(
  "transcript.read",
  { transcript_ref: minted.handle },
  null,
  resolver,
);
assert.equal(restored.ok, true, restored.message ?? "restore must succeed");
assert.equal(restored.value.transcript_ref, CANONICAL);

// --- nothing was loosened ------------------------------------------------ //
// An unregistered row still fails closed rather than echoing machine identity.
const cold = { unmapped: [] };
const coldProjected = projection.stripOpaqueModelIdentity(
  locateResult(),
  null,
  registryModule.emptySemanticProjectionView(),
  cold,
  "transcript.locate",
);
assert.equal(cold.unmapped.length, 1);
assert.equal(cold.unmapped[0].domain, "transcript");
assert.ok(
  !JSON.stringify(coldProjected).includes("pi-state-journal"),
  "an unregistered row must drop, never echo the canonical locator",
);

// A handle that was never minted does not resolve into some other row.
const bogus = projection.restoreSemanticEntityHandles(
  "transcript.read",
  { transcript_ref: "transcript:turn-99-keeper" },
  null,
  resolver,
);
assert.equal(bogus.ok, false, "an unminted handle must fail closed");

console.log("transcript-ref-semantic-handle ok");
