/**
 * UI words as data (contract §23, 2026-09-09): the chrome a player reads comes from
 * `content/ui/<tag>/<surface>.json`, keyed by the play languages `content/languages.json`
 * declares. No renderer, host or extension keeps a per-language table in code.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPlayLanguages, loadPlayLanguagesSync, loadUiWords, loadUiWordsSync, playLanguageTag } from "../../runtime/ui-words.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "ui-words-"));
	await writeFile(join(root, "languages.json"), JSON.stringify({ default: "aa", languages: { aa: { autonym: "Aa", script: "cjk" }, bb: { autonym: "Bb" } } }));
	await mkdir(join(root, "ui/aa"), { recursive: true });
	await mkdir(join(root, "ui/bb"), { recursive: true });
	await writeFile(join(root, "ui/aa/sheet.json"), JSON.stringify({ clues: "aa clues", refresh: "aa refresh" }));
	await writeFile(join(root, "ui/aa/errors.json"), JSON.stringify({ unknown: "aa unknown" }));
	await writeFile(join(root, "ui/bb/sheet.json"), JSON.stringify({ clues: "bb clues", stray: 7 }));
	return root;
}

test("languages are read as data, with the default tag and each language's script obligation", async () => {
	const root = await fixture();
	const known = await loadPlayLanguages(root);
	assert.deepEqual(known, { default: "aa", languages: { aa: { autonym: "Aa", script: "cjk" }, bb: { autonym: "Bb" } } });
	assert.equal(await playLanguageTag(root, "bb"), "bb");
	assert.equal(await playLanguageTag(root, "zz"), "aa");
	assert.equal(await playLanguageTag(root, undefined), "aa");
});

test("a language's words are its own surfaces over the default's, key by key; an unknown tag reads as the default", async () => {
	const root = await fixture();
	assert.deepEqual(await loadUiWords(root, "aa"), { tag: "aa", words: { sheet: { clues: "aa clues", refresh: "aa refresh" }, errors: { unknown: "aa unknown" } } });
	const bb = await loadUiWords(root, "bb");
	assert.equal(bb.tag, "bb");
	assert.equal(bb.words.sheet.clues, "bb clues");
	assert.equal(bb.words.sheet.refresh, "aa refresh", "a key the language lacks falls back to the default language's word");
	assert.equal(bb.words.errors.unknown, "aa unknown", "a surface the language lacks falls back whole");
	assert.equal(bb.words.sheet.stray, undefined, "only strings are words");
	assert.deepEqual(await loadUiWords(root, "zz"), await loadUiWords(root, "aa"));
});

test("the shipped languages each carry every surface and every key the default language has", async () => {
	const content = join(REPO, "content");
	const known = await loadPlayLanguages(content);
	assert.ok(known.languages["zh-Hans"] && known.languages.en, "zh-Hans and en are the two languages the kernel accepts today");
	const base = await loadUiWords(content, known.default);
	for (const tag of Object.keys(known.languages)) {
		const folder = join(content, "ui", tag);
		const files = (await readdir(folder)).filter(name => name.endsWith(".json")).sort();
		const baseFiles = (await readdir(join(content, "ui", known.default))).filter(name => name.endsWith(".json")).sort();
		assert.deepEqual(files, baseFiles, `content/ui/${tag} has the same surfaces as content/ui/${known.default}`);
		for (const name of files) {
			const own = JSON.parse(await readFile(join(folder, name), "utf8"));
			const surface = name.slice(0, -5);
			assert.deepEqual(Object.keys(own).sort(), Object.keys(base.words[surface] ?? {}).sort(), `content/ui/${tag}/${name} has the default language's keys`);
			for (const [key, value] of Object.entries(own)) assert.ok(typeof value === "string" && value.trim(), `content/ui/${tag}/${name}: ${key} is a word`);
		}
	}
});

test("the synchronous reader answers exactly what the asynchronous one does, for a caller inside a bus event", async () => {
	const root = await fixture();
	assert.deepEqual(loadPlayLanguagesSync(root), await loadPlayLanguages(root));
	for (const tag of ["aa", "bb", "zz", undefined]) assert.deepEqual(loadUiWordsSync(root, tag), await loadUiWords(root, tag), `tag ${tag}`);
	assert.throws(() => loadUiWordsSync(join(root, "absent"), "aa"), /ENOENT/, "a content root without languages.json is an error, not an empty answer");
});
