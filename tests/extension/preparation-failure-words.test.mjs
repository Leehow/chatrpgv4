/**
 * A preparation failure reaches the player as a registered caption, never as host prose (§46).
 *
 * BUG-039, twice on real tables: the onboarding host handed the overlay `{code: "needs"}` -- a
 * kernel RPC code nothing registers a caption for -- together with a sentence the host wrote
 * itself. The player, playing in zh-Hans, read `errors.unknown` over a paragraph of English, and
 * the diagnostic the reading service had actually reported was thrown away to make room for it.
 *
 * Two guards, because the defect had two halves. The first is static and is the half a behaviour
 * test cannot see: a code only reaches a caption if something registered it, and the registry is
 * `content/ui/<source>/errors.json` itself. The second is the prose: the host's player-facing
 * failure text is the caption, so the host has no sentence of its own to write.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const read = path => readFileSync(join(REPO, path), "utf8");
const json = path => JSON.parse(read(path));

/** The authored surface is the registry; the tag comes from the data, so no language is named. */
const SOURCE = json("content/languages.json").source;
const registered = new Set(Object.keys(json(`content/ui/${SOURCE}/errors.json`)));

/** The hosts that put a failure in front of a player by its code. */
const HOSTS = ["Electron/packages/pi-backend/src/coc-onboarding.ts"];

test("every failure code these hosts refuse with has a caption registered for it", () => {
	const unregistered = [];
	for (const path of HOSTS) {
		const text = read(path);
		// `refuse('<code>', …)` is how this host mints one, and the second argument of `refusal`/
		// `captioned` is the code it falls back to when a caught failure carries none.
		for (const [, code] of text.matchAll(/\brefuse\(\s*'([a-z_]+)'/g))
			if (!registered.has(code)) unregistered.push(`${path}: refuse('${code}')`);
		for (const [, code] of text.matchAll(/\b(?:refusal|captioned)\([^)]*?,\s*'([a-z_]+)'\)/g))
			if (!registered.has(code)) unregistered.push(`${path}: fallback '${code}'`);
	}
	assert.deepEqual(unregistered, [], `these codes reach a player with no caption to show:\n${unregistered.join("\n")}`);
});

test("the guard is reading real code and a missing caption would actually be caught", () => {
	// Mutation: point HOSTS at nothing, or let the pattern match nothing, and the test above passes
	// vacuously. Both are checked here, together with the registry being a real one.
	const found = HOSTS.flatMap(path => [...read(path).matchAll(/\brefuse\(\s*'([a-z_]+)'/g)].map(m => m[1]));
	assert.ok(found.length >= 5, `the pattern found ${found.length} codes; it has stopped matching`);
	assert.ok(found.includes("unknown_import"), "a code this host is known to refuse with");
	assert.ok(registered.has("preparation_failed") && !registered.has("needs"),
		"`needs` is a kernel code, not a caption: settling it to a registered one is the point");
});

test("the onboarding host writes no player-facing sentence of its own for a failure", () => {
	const text = read(HOSTS[0]);
	// The sentence that shipped. It was neither a caption nor a diagnostic: it restated
	// `errors.preparation_failed` in the system language and displaced the real reason.
	assert.ok(!/Source preparation could not finish/.test(text));
	// What replaced it: the stored diagnostic travels as the message, and the code carries meaning.
	assert.ok(/message:typeof saved\.error==='string'\?saved\.error:''/.test(text),
		"the phase's error message must be the diagnostic the failure reported");
});
