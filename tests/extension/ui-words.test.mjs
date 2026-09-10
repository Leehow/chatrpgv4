/**
 * UI words as data, projected per tag (contract §23, 2026-09-09).
 *
 * The open-language ruling: `content/ui/<source>/` is the only authored set of captions, the tag
 * set is open, and every other tag reaches words through a shipped seed or through the projection
 * the lane caches under the home. These tests pin the loader that settles all three, and they pin
 * the two guards the ruling named: every shipped seed carries exactly the authored keys, and
 * `content/languages.json` holds no registry of languages.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	PLAY_LANGUAGE_TAG, loadPlayLanguages, loadPlayLanguagesSync, playLanguageTag, playLanguageTagSync,
	resolveUiWords, resolveUiWordsSync, uiWordsCachePath, uiWordsDigest, uiWordsDigestSync,
} from "../../runtime/ui-words.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A content root of this build's own shape with two invented tags: `aa` is the authored source,
 * `bb` ships a seed, and `cc` ships nothing at all. No test here can pass by accident on a tag the
 * product happens to ship.
 */
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "ui-words-"));
	await writeFile(join(root, "languages.json"), JSON.stringify({ source: "aa", default: "aa", suggested: ["aa", "bb"] }));
	await mkdir(join(root, "ui/aa"), { recursive: true });
	await mkdir(join(root, "ui/bb"), { recursive: true });
	await mkdir(join(root, "setup"), { recursive: true });
	await writeFile(join(root, "ui/aa/sheet.json"), JSON.stringify({ clues: "aa clues", refresh: "aa refresh" }));
	await writeFile(join(root, "ui/aa/errors.json"), JSON.stringify({ unknown: "aa unknown" }));
	await writeFile(join(root, "ui/bb/sheet.json"), JSON.stringify({ clues: "bb clues", stray: 7 }));
	await writeFile(join(root, "setup/ui-presentation.md"), "project the captions");
	return root;
}

/** A home with one cached projection for `tag`, exactly as the lane writes it. */
async function cache(root, tag, texts) {
	const home = await mkdtemp(join(tmpdir(), "ui-words-home-"));
	const digest = await uiWordsDigest(root);
	const path = uiWordsCachePath(home, tag, digest);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({ play_language: tag, digest, texts }));
	return { home, digest, path };
}

test("the declaration is the v2 shape: a source tag, a default and the suggestions -- and a `languages` registry is an error", async () => {
	const root = await fixture();
	assert.deepEqual(await loadPlayLanguages(root), { source: "aa", default: "aa", suggested: ["aa", "bb"] });
	assert.deepEqual(loadPlayLanguagesSync(root), await loadPlayLanguages(root));

	// The v1 file the ruling withdrew. Reading it as v2 would answer with no suggestions and no
	// source at all, so it is named rather than tolerated.
	const old = await mkdtemp(join(tmpdir(), "ui-words-v1-"));
	await writeFile(join(old, "languages.json"), JSON.stringify({ default: "aa", languages: { aa: { autonym: "Aa" } } }));
	await assert.rejects(loadPlayLanguages(old), /coc\.play-languages\.v2.*`languages` registry/s);
	assert.throws(() => loadPlayLanguagesSync(old), /`languages` registry/);

	const sourceless = await mkdtemp(join(tmpdir(), "ui-words-nosource-"));
	await writeFile(join(sourceless, "languages.json"), JSON.stringify({ default: "aa", suggested: [] }));
	await assert.rejects(loadPlayLanguages(sourceless), /`source`/);
});

test("a tag is settled by shape, never by membership: any BCP-47-shaped tag is itself", async () => {
	const root = await fixture();
	for (const tag of ["bb", "cc", "pt-BR", "zh-Hans", "de", "yue-Hant-HK", "en-GB-oxendict"]) {
		assert.ok(PLAY_LANGUAGE_TAG.test(tag), `${tag} is a tag shape`);
		assert.equal(await playLanguageTag(root, tag), tag, `${tag} is itself, declared or not`);
		assert.equal(playLanguageTagSync(root, tag), tag);
	}
	for (const value of ["", "ZH", "a", "abcd", "zh_Hans", "zh-", "zh-Hans-", "-en", "en/../etc", 7, null, undefined, {}]) {
		assert.ok(typeof value !== "string" || !PLAY_LANGUAGE_TAG.test(value), `${String(value)} is not a tag shape`);
		assert.equal(await playLanguageTag(root, value), "aa", `${String(value)} reads as the default`);
		assert.equal(playLanguageTagSync(root, value), "aa");
	}
});

test("the digest covers every authored caption and the lane's instruction, so an edit re-projects", async () => {
	const root = await fixture();
	const first = await uiWordsDigest(root);
	assert.match(first, /^[0-9a-f]{64}$/);
	assert.equal(uiWordsDigestSync(root), first, "both readers agree");
	assert.equal(await uiWordsDigest(root), first, "and it is stable");

	await writeFile(join(root, "ui/aa/sheet.json"), JSON.stringify({ clues: "aa CLUES", refresh: "aa refresh" }));
	const edited = await uiWordsDigest(root);
	assert.notEqual(edited, first, "an edited caption changes the digest");

	await writeFile(join(root, "setup/ui-presentation.md"), "project the captions, but differently");
	assert.notEqual(await uiWordsDigest(root), edited, "an edited instruction changes it too");

	// A seed is not part of what a projection is made from: only the authored source is.
	const before = await uiWordsDigest(root);
	await writeFile(join(root, "ui/bb/sheet.json"), JSON.stringify({ clues: "bb CLUES" }));
	assert.equal(await uiWordsDigest(root), before, "another tag's seed does not invalidate the caches");
});

test("the words resolve seed, then cache, then the authored source -- and say which answered", async () => {
	const root = await fixture();
	const home = (await cache(root, "cc", { sheet: { clues: "cc clues" } })).home;

	// The authored tag is its own projection: there is nothing to project it from.
	const authored = await resolveUiWords({ contentRoot: root, home, tag: "aa" });
	assert.deepEqual(authored, { tag: "aa", projected: true, source: "seed",
		words: { sheet: { clues: "aa clues", refresh: "aa refresh" }, errors: { unknown: "aa unknown" } } });

	const seeded = await resolveUiWords({ contentRoot: root, home, tag: "bb" });
	assert.equal(seeded.source, "seed");
	assert.equal(seeded.projected, false, "a partial seed must schedule the missing captions");
	assert.equal(seeded.words.sheet.clues, "bb clues");
	assert.equal(seeded.words.sheet.refresh, "aa refresh", "a key the seed lacks falls back to the authored word");
	assert.equal(seeded.words.errors.unknown, "aa unknown", "a surface the seed lacks falls back whole");
	assert.equal(seeded.words.sheet.stray, undefined, "only strings are words");

	const cached = await resolveUiWords({ contentRoot: root, home, tag: "cc" });
	assert.equal(cached.source, "cache");
	assert.equal(cached.projected, false, "a partial cache must not claim full coverage");
	assert.equal(cached.words.sheet.clues, "cc clues");
	assert.equal(cached.words.sheet.refresh, "aa refresh", "a key the cache lacks falls back too");

	// A seed wins over a cache: the product shipped it, and it cost no model call.
	const shadowed = await cache(root, "bb", { sheet: { clues: "cached bb" } });
	assert.equal((await resolveUiWords({ contentRoot: root, home: shadowed.home, tag: "bb" })).words.sheet.clues, "bb clues");

	// Neither: the authored words at once, and the tag the caller asked for, so the host knows
	// which projection to start.
	const none = await resolveUiWords({ contentRoot: root, home, tag: "dd" });
	assert.deepEqual({ tag: none.tag, projected: none.projected, source: none.source },
		{ tag: "dd", projected: false, source: "default" });
	assert.equal(none.words.sheet.clues, "aa clues");
	// Without a home there is nowhere for a cache to be, so the same tag reads unprojected.
	assert.equal((await resolveUiWords({ contentRoot: root, tag: "cc" })).projected, false);
});

test("a cache written for another digest or another tag is not read", async () => {
	const root = await fixture();
	const { home, digest, path } = await cache(root, "cc", { sheet: { clues: "cc clues" } });
	assert.equal((await resolveUiWords({ contentRoot: root, home, tag: "cc" })).source, "cache");

	await writeFile(path, JSON.stringify({ play_language: "dd", digest, texts: { sheet: { clues: "cc clues" } } }));
	assert.equal((await resolveUiWords({ contentRoot: root, home, tag: "cc" })).projected, false, "a cache for another tag is not this tag's");

	await writeFile(path, JSON.stringify({ play_language: "cc", digest: createHash("sha256").update("other").digest("hex"), texts: { sheet: { clues: "stale" } } }));
	assert.equal((await resolveUiWords({ contentRoot: root, home, tag: "cc" })).projected, false, "a cache made from other captions is stale");

	await writeFile(path, "{not json");
	assert.equal((await resolveUiWords({ contentRoot: root, home, tag: "cc" })).projected, false, "an unreadable cache is no cache");

	// The digest is in the file name, so an edited caption never reads the old projection at all.
	await writeFile(path, JSON.stringify({ play_language: "cc", digest, texts: { sheet: { clues: "cc clues" } } }));
	await writeFile(join(root, "ui/aa/sheet.json"), JSON.stringify({ clues: "aa clues!", refresh: "aa refresh" }));
	assert.equal((await resolveUiWords({ contentRoot: root, home, tag: "cc" })).projected, false, "an edited caption re-projects");
});

test("the synchronous reader answers exactly what the asynchronous one does, for a caller inside a bus event", async () => {
	const root = await fixture();
	const { home } = await cache(root, "cc", { sheet: { clues: "cc clues" } });
	for (const tag of ["aa", "bb", "cc", "dd", undefined])
		assert.deepEqual(resolveUiWordsSync({ contentRoot: root, home, tag }), await resolveUiWords({ contentRoot: root, home, tag }), `tag ${tag}`);
	assert.throws(() => resolveUiWordsSync({ contentRoot: join(root, "absent"), tag: "aa" }), /ENOENT/,
		"a content root without languages.json is an error, not an empty answer");
	await assert.rejects(resolveUiWords({ contentRoot: join(root, "absent"), tag: "aa" }), /ENOENT/);
});

test("an empty seed directory is not a seed: the lane still runs for that tag", async () => {
	const root = await fixture();
	await mkdir(join(root, "ui/ee"), { recursive: true });
	assert.equal((await resolveUiWords({ contentRoot: root, tag: "ee" })).projected, false, "an empty directory answers nothing");
	await writeFile(join(root, "ui/ee/sheet.json"), JSON.stringify({}));
	assert.equal((await resolveUiWords({ contentRoot: root, tag: "ee" })).projected, false, "an empty file answers nothing either");
	await rm(join(root, "ui/ee"), { recursive: true, force: true });
});

// ---- The guards the ruling named -------------------------------------------------------------

test("content/languages.json registers no languages: only the source, the default and the suggestions", async () => {
	const raw = JSON.parse(await readFile(join(REPO, "content/languages.json"), "utf8"));
	assert.equal(raw.languages, undefined, "a registry of tags is the hardcoding §23 withdrew");
	assert.equal(raw.contract, "coc.play-languages.v2");
	const known = await loadPlayLanguages(join(REPO, "content"));
	assert.ok(PLAY_LANGUAGE_TAG.test(known.source) && PLAY_LANGUAGE_TAG.test(known.default));
	assert.ok(known.suggested.length > 0, "a picker offers something to start from");
	for (const tag of known.suggested) assert.ok(PLAY_LANGUAGE_TAG.test(tag), `${tag} is a tag`);
});

test("every shipped seed carries exactly the authored keys, so a seed is a cache and never a half-translation", async () => {
	const content = join(REPO, "content");
	const known = await loadPlayLanguages(content);
	const authored = await resolveUiWords({ contentRoot: content, tag: known.source });
	const baseFiles = (await readdir(join(content, "ui", known.source))).filter(name => name.endsWith(".json")).sort();
	assert.ok(baseFiles.length > 0, "the authored source ships its surfaces");
	const seeds = (await readdir(join(content, "ui"), { withFileTypes: true }))
		.filter(entry => entry.isDirectory() && entry.name !== known.source).map(entry => entry.name);
	for (const tag of seeds) {
		assert.ok(PLAY_LANGUAGE_TAG.test(tag), `content/ui/${tag} is named by a tag`);
		const files = (await readdir(join(content, "ui", tag))).filter(name => name.endsWith(".json")).sort();
		assert.deepEqual(files, baseFiles, `content/ui/${tag} has the same surfaces as content/ui/${known.source}`);
		for (const name of files) {
			const own = JSON.parse(await readFile(join(content, "ui", tag, name), "utf8"));
			const surface = name.slice(0, -5);
			assert.deepEqual(Object.keys(own).sort(), Object.keys(authored.words[surface] ?? {}).sort(),
				`content/ui/${tag}/${name} has the authored keys`);
			for (const [key, value] of Object.entries(own)) assert.ok(typeof value === "string" && value.trim(), `content/ui/${tag}/${name}: ${key} is a word`);
		}
	}
});
