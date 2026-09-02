#!/usr/bin/env node
// A diagnostic lane's first prompt is "resume and wait" — a turn with nothing
// in it for the Keeper to do. Measured across five lanes on 2026-09-02 the
// Keeper did it anyway (session.resume, scene.context, state.journal,
// turn.output_context, turn.finalize), burning the lane budget before the
// probe could seed. Strengthening the prompt changed nothing, because a
// prompt IS a turn and the model holds the full Keeper surface while it runs.
// So until the lane sees real player input, session.resume is the only tool
// bound: the Keeper cannot journal or finalize because it has nothing to do
// it with.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const welcome = await import(pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/welcome.ts"),
).href);

// The extension reads the same flag the lane sets.
assert.equal(welcome.debugLaneEnabled({ PI_COC_DEBUG_LANE: "1" }), true);
assert.equal(welcome.debugLaneEnabled({}), false);

const source = await import("node:fs").then((fs) => fs.readFileSync(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"), "utf-8",
));

// The restriction is applied before any role/phase projection can widen it.
const guard = source.indexOf("debugLaneResumeOnlySurface");
assert.ok(guard > 0, "the resume-only surface must exist");
const applied = source.indexOf("const resumeOnly = debugLaneResumeOnlySurface()");
assert.ok(applied > 0, "applyKpActiveTools must consult it");
const roleProjection = source.indexOf("const role = effectiveTypedRole;", applied);
assert.ok(
  applied < roleProjection,
  "the restriction must short-circuit before the normal projection",
);

// Only session.resume is bound, and the release is a real player message.
const body = source.slice(guard, guard + 700);
assert.match(body, /typedToolByOperation\.get\("session\.resume"\)/);
assert.match(body, /debugLaneSawPlayerInput/);
const release = source.indexOf("debugLaneSawPlayerInput = true");
assert.ok(release > 0, "something must release the restriction");
const releaseContext = source.slice(release - 400, release);
assert.match(
  releaseContext,
  /userMessageText\(event\.message\) === null/,
  "the release must be a real player message, not any event",
);

// A real table never gets this: the flag is lane-only.
assert.ok(
  !source.includes("PI_COC_DEBUG_LANE = \"1\""),
  "the extension must read the flag, never set it",
);

process.stdout.write(JSON.stringify({ ok: true }));
