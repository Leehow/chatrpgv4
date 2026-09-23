/**
 * The UI-words presenter is handed the game's context with every request (contract §23.2).
 *
 * Projected with nothing but the English captions, a lane re-reads "Psychology" as mind reading and
 * "Surprised" as startled, and each re-run rewords a third of a surface. So each request now carries
 * two blocks the product already has for the tag: `established_terms`, the rules glossary the kernel
 * projects (the same `glossaryOf` visitor as `playerGlossary`), and `established_words`, the words the
 * build ships for that tag. These tests read the request the lane is actually handed.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { prepareUiWords, uiCaptions, uiPresentationContext } from "../../extensions/module/ui-presentation.ts";
import { resolveUiWords } from "../../runtime/ui-words.ts";

const root = resolve(import.meta.dirname, "../..");
const CONTENT = join(root, "content");
const seedOf = tag => Object.fromEntries(readdirSync(join(CONTENT, "ui", tag)).filter(name => name.endsWith(".json")).sort()
	.map(name => [name.slice(0, -5), JSON.parse(readFileSync(join(CONTENT, "ui", tag, name), "utf8"))]));

test("for zh-Hans the context carries the rules glossary and exactly the shipped seed", async () => {
	const authored = await resolveUiWords({ contentRoot: CONTENT, tag: "en" });
	const context = await uiPresentationContext(CONTENT, "zh-Hans", uiCaptions(authored.words));
	assert.ok(Object.keys(context.established_terms).length > 0, "the zh-Hans glossary block is empty");
	assert.equal(context.established_terms.Fighting, "格斗", "generic combat checks need a first-draw rule term");
	for (const [term, word] of Object.entries(context.established_terms)) {
		assert.equal(typeof term, "string");
		assert.ok(typeof word === "string" && word.trim(), `${term} has no established word`);
	}
	assert.deepEqual(context.established_words, seedOf("zh-Hans"), "the established words are not the shipped seed");
});

test("a tag with no glossary rows and no seed is handed two empty blocks, not invented ones", async () => {
	const authored = await resolveUiWords({ contentRoot: CONTENT, tag: "en" });
	assert.deepEqual(await uiPresentationContext(CONTENT, "yy", uiCaptions(authored.words)),
		{ established_terms: {}, established_words: {} });
});

test("the request file the lane reads carries both blocks beside the captions", async t => {
	// A content root of this build's own shape whose zh-Hans seed has one gap, so the lane must run.
	const base = mkdtempSync(join(tmpdir(), "ui-presentation-context-"));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const content = join(base, "content"), home = join(base, "home");
	mkdirSync(join(content, "ui"), { recursive: true });
	for (const entry of readdirSync(CONTENT)) if (entry !== "ui") symlinkSync(join(CONTENT, entry), join(content, entry));
	cpSync(join(CONTENT, "ui", "en"), join(content, "ui", "en"), { recursive: true });
	cpSync(join(CONTENT, "ui", "zh-Hans"), join(content, "ui", "zh-Hans"), { recursive: true });
	const seed = seedOf("zh-Hans");
	const [dropped] = Object.keys(seed.mechanics);
	delete seed.mechanics[dropped];
	writeFileSync(join(content, "ui", "zh-Hans", "mechanics.json"), JSON.stringify(seed.mechanics, null, 2));

	const requests = [];
	await assert.rejects(prepareUiWords({ home, contentRoot: content, play_language: "zh-Hans",
		runner: async request => {
			requests.push(JSON.parse(readFileSync(join(request.cwd, "texts.json"), "utf8")));
			return { ok: false, stderr: "the fixture answers nothing" };
		} }));
	assert.ok(requests.length > 0, "the lane never ran");
	const packet = requests[0];
	assert.ok(Array.isArray(packet.captions) && packet.captions.length > 0);
	assert.ok(Object.keys(packet.established_terms).length > 0, "the request carries no glossary");
	assert.deepEqual(packet.established_words, seed, "the request's established words are not the shipped seed");
	assert.equal(packet.established_words.mechanics[dropped], undefined, "a gap is asked fresh, not given a word");
});
