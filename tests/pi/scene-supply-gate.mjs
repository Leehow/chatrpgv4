#!/usr/bin/env node
/**
 * Deterministic smoke for lib/scene-supply.ts. The gate decides only whether a
 * destination has source-bound material; the property under test is that it
 * always has an exit. A wait that can never end costs the player a turn per
 * attempt and says nothing, which is what a live KP did before this terminal
 * state existed.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const mod = await import(
  pathToFileURL(resolve(root, "plugins/coc-keeper/pi/lib/scene-supply.ts")).href
);

const pending = { enforced: true, ready: false, fallback_available: false };
const withFallback = { enforced: true, ready: false, fallback_available: true };

const ready = mod.decideSceneSupply({ enforced: true, ready: true }, 0);
const unenforced = mod.decideSceneSupply({ enforced: false, ready: false }, 9);
const first = mod.decideSceneSupply(pending, 0);
const second = mod.decideSceneSupply(pending, 1);
const terminal = mod.decideSceneSupply(pending, mod.MAX_SOURCE_WAITS);
const fallback = mod.decideSceneSupply(withFallback, 1);

// Ready or unenforced material never gates play.
const allows = ready.action === "allow" && unenforced.action === "allow";

// A source-bound minimal fallback outranks both waiting and blocking.
const prefersFallback = fallback.action === "retry_with_minimal"
  && mod.decideSceneSupply(withFallback, mod.MAX_SOURCE_WAITS).action === "retry_with_minimal";

// Waits name the exact callable: "dispatch steward-scene" describes an intent
// and leaves the last hop to inference, which a weaker KP never bridges.
const waitsNameTheTool = first.action === "wait"
  && second.action === "wait"
  && first.instruction.includes("coc_dispatch_source_work")
  && first.instruction.includes("state.move_scene")
  && first.playerWaitText === "场景载入中……";

// The terminal state exists and tells the KP to stop repeating the loading
// line, keep the destination unestablished, and offer what is open.
const blocks = terminal.action === "blocked"
  && !("playerWaitText" in terminal)
  && terminal.instruction.includes("unestablished")
  && terminal.instruction.includes("invent nothing");

// Blocking is monotonic in completed waits: more waiting never reopens a wait.
const staysBlocked = mod.decideSceneSupply(pending, mod.MAX_SOURCE_WAITS + 5).action === "blocked";

// Junk supply values must not throw or silently gate ordinary play.
const junk = [null, "x", 42, []].map((value) => mod.decideSceneSupply(value, 0).action);
const junkAllows = junk.every((action) => action === "allow");

process.stdout.write(JSON.stringify({
  ok: true,
  allows,
  prefersFallback,
  waitsNameTheTool,
  blocks,
  staysBlocked,
  junkAllows,
  maxWaits: mod.MAX_SOURCE_WAITS,
}));
