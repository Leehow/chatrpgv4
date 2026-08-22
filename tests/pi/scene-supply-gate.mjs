#!/usr/bin/env node
/** Deterministic smoke for the host-owned scene-supply lifecycle policy. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(
  pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/scene-supply.ts")).href
);

const pending = { enforced: true, ready: false, fallback_available: false };
const withFallback = { enforced: true, ready: false, fallback_available: true };

const active = { status: "active", dispatchKey: "dispatch-1" };
const unavailable = { status: "unavailable", failureClass: "no-capability" };
const terminalDispatch = { status: "terminal", dispatchKey: "dispatch-1" };
const ready = mod.decideSceneSupply({ enforced: true, ready: true }, unavailable);
const unenforced = mod.decideSceneSupply({ enforced: false, ready: false }, unavailable);
const waiting = mod.decideSceneSupply(pending, active);
const blockedUnavailable = mod.decideSceneSupply(pending, unavailable);
const blockedTerminal = mod.decideSceneSupply(pending, terminalDispatch);
const fallback = mod.decideSceneSupply(withFallback, terminalDispatch);

// Ready or unenforced material never gates play.
const allows = ready.action === "allow" && unenforced.action === "allow";

// A source-bound minimal fallback is permitted only after a real host
// dispatch reached terminal state, never because the KP repeated a move.
const prefersFallback = fallback.action === "retry_with_minimal"
  && mod.decideSceneSupply(withFallback, active).action === "wait"
  && mod.decideSceneSupply(withFallback, unavailable).action === "blocked";

// The host owns dispatch. KP guidance must not expose a callable, a loading
// line, an operational failure, or a promise that a later turn will fix it.
const forbidden = [
  "coc_dispatch_source_work", "steward-scene", "场景载入中", "素材",
  "processing layer", "cannot dispatch", "unable to dispatch",
];
const noModelOwnedDispatch = waiting.action === "wait"
  && forbidden.every((text) => !waiting.instruction.includes(text))
  && waiting.instruction.includes("do not promise");
// Retain the old JSON field until the Python wrapper assertion is renamed;
// its truth now means the historical callable instruction is absent.
const waitsNameTheTool = noModelOwnedDispatch;

// Missing dispatch capability and terminal-without-material block immediately.
const blocks = blockedUnavailable.action === "blocked"
  && blockedTerminal.action === "blocked"
  && !("playerWaitText" in blockedUnavailable)
  && blockedUnavailable.instruction.includes("unestablished")
  && blockedUnavailable.instruction.includes("Do not invent");

// Repeating the move cannot change the lifecycle decision.
const staysBlocked = Array.from({ length: 5 }, () => (
  mod.decideSceneSupply(pending, unavailable).action
)).every((action) => action === "blocked");

// Junk supply values must not throw or silently gate ordinary play.
const junk = [null, "x", 42, []].map((value) => (
  mod.decideSceneSupply(value, unavailable).action
));
const junkAllows = junk.every((action) => action === "allow");

process.stdout.write(JSON.stringify({
  ok: true,
  allows,
  prefersFallback,
  waitsNameTheTool,
  noModelOwnedDispatch,
  blocks,
  staysBlocked,
  junkAllows,
}));
