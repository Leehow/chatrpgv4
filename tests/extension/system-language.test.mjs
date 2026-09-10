/**
 * The system-language guard (contract §16.1, extended by §23 on 2026-09-09).
 *
 * The user's ruling of 2026-09-06: the system language is English. Code, prompts, tool
 * descriptions, host messages and launcher help are English; the words a player reads are written
 * by the Keeper in the campaign's `play_language`, or come from `content/ui/<tag>/`, and never from
 * a literal in code. This guard reads the sources themselves -- comments included -- and fails on
 * any CJK character.
 *
 * §23 added a second obligation: no renderer, host or extension keeps a per-language table in code.
 * A tag is never named in a comparison and never used as an object key, because the tag set is open
 * -- `content/languages.json` names only the authored source, the fallback and the suggestions, and
 * the words are `content/ui/<source>/<surface>.json` projected per tag. That is the second assertion
 * here, and it builds its pattern from those named tags rather than writing one itself.
 *
 * The kernel side (`kernel-ts/**`, `content/setup/*.json`) is guarded by
 * `tests/kernel/test_system_language.py`; module content, the rules glossary and `content/ui/**`
 * are data and are scanned by neither.
 */

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * CJK: symbols and punctuation (including the bracket and full stop forms), kana, hangul jamo and
 * syllables, unified ideographs and extension A, compatibility ideographs, and the full/half width
 * forms (full-width punctuation and full-width ASCII included).
 * `§ — ≤ × →` are not in it and are used freely in code.
 */
const CJK = /[ᄀ-ᇿ　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

/** Whole directories are walked; single files are read on their own. */
const SCOPE = [
	"extensions",
	"runtime",
	"bin",
	"prompts",
	"scripts",
	"pipicoc/agent.ts",
	"pipicoc/sheet.ts",
	"pipicoc/host-bridge.ts",
	"pipicoc/rpc.mjs",
];

/**
 * The scope §23 adds: the pack renderers and both halves of the Electron host. Their words are
 * `content/ui/<tag>/` now, so no source of theirs has a reason to hold a CJK character.
 */
const ADDED_SCOPE = ["pipicoc", "Electron/packages/ui/src", "Electron/packages/pi-backend/src"];

/** Where a per-language table would sit if one were left behind. `content/ui/**` is data and is not read. */
const TABLE_SCOPE = ["pipicoc", "extensions", "Electron/packages/ui/src"];

const TEST_FILE = /(^|[./])(test|spec)\.[cm]?[jt]sx?$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__(\/|$)/;
const SOURCE_FILE = /\.([cm]?[jt]sx?|mjs|cjs|py|md)$/;

/** Caches and compiled bytes are not sources: a `.pyc` holds no line anyone wrote. */
const SKIPPED_DIRS = new Set(["__pycache__", "node_modules", ".pytest_cache"]);
const COMPILED_FILE = /\.(pyc|pyo)$/;

function walk(path) {
	const stats = statSync(path);
	if (!stats.isDirectory()) return COMPILED_FILE.test(path) ? [] : [path];
	return readdirSync(path).filter((entry) => !SKIPPED_DIRS.has(entry)).flatMap((entry) => walk(join(path, entry)));
}

/** Sources only, and never a test: a fixture may carry any language, and this guard is about shipped code. */
function sourcesUnder(entry) {
	const path = join(REPO, entry);
	if (!existsSync(path)) return [];
	return walk(path).filter((file) => {
		const rel = relative(REPO, file);
		return !TEST_FILE.test(rel) && !rel.includes("__tests__") && !rel.includes("node_modules") && SOURCE_FILE.test(rel);
	});
}

function offences(path, pattern = CJK) {
	const rows = [];
	const text = readFileSync(path, "utf8");
	for (const [index, line] of text.split("\n").entries()) {
		if (pattern.test(line)) rows.push(`${relative(REPO, path)}:${index + 1}  ${line.trim().slice(0, 80)}`);
	}
	return rows;
}

/**
 * The tags `content/languages.json` names, as data. The guard writes no tag of its own: it asks the
 * file which tags it names -- the authored source, the fallback, the picker's suggestions -- and
 * then looks for any of them written into code. The set of play languages is open (§23), so this is
 * not a registry to check membership against; it is the list of tags most likely to be hardcoded.
 */
function declaredTags() {
	const raw = JSON.parse(readFileSync(join(REPO, "content", "languages.json"), "utf8"));
	assert.equal(raw?.languages, undefined, "content/languages.json registers no languages (§23)");
	const tags = [...new Set([raw?.source, raw?.default, ...(Array.isArray(raw?.suggested) ? raw.suggested : [])]
		.filter((tag) => typeof tag === "string" && tag))];
	assert.ok(tags.length > 0, "content/languages.json names at least one tag");
	return tags;
}

/**
 * A per-language table in code: a quoted tag used as an object key (`"zh-Hans": {…}`) or compared
 * against (`lang === "zh-Hans"`). Both are the shape §23 withdrew; a tag that only ever travels as
 * a value (`resolveUiWords({contentRoot, home, tag})`) matches neither.
 */
function languageTablePattern(tags) {
	const alternatives = tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|");
	return new RegExp(
		`(["'\`])(?:${alternatives})\\1\\s*:` +
			`|[!=]==?\\s*(["'\`])(?:${alternatives})\\2` +
			`|(["'\`])(?:${alternatives})\\3\\s*[!=]==?`,
	);
}

test("system language: not one CJK character in extensions, runtime, bin, prompts or scripts (contract §16.1)", () => {
	const files = SCOPE.flatMap((entry) => walk(join(REPO, entry)));
	assert.ok(files.length >= 15, `too few files scanned (${files.length}); a path is probably wrong`);
	const found = files.flatMap((file) => offences(file));
	assert.deepEqual(found, [], `these lines are still not English (the system language is English):\n${found.join("\n")}`);
});

test("TypeScript kernel production sources preserve the English system-language boundary", () => {
	const root = join(REPO, "kernel-ts");
	const files = walk(root).filter((path) => path.endsWith(".ts") && !relative(root, path).startsWith("testing/"));
	assert.ok(files.length > 0, "The TypeScript kernel sources must be present");
	assert.deepEqual(files.flatMap((file) => offences(file)), []);
});

// The pack renderers and the Electron host's COC files draw their words from `content/ui/<tag>/`
// under §23, so their sources have no reason left to hold a CJK character. The rest of the Electron
// application is the PipiUI host's own chrome, written in its own language by another product, and
// is not this guard's business: only the COC files under `Electron/` are scanned.
const COC_HOST_FILE = /(^|\/)(Coc[A-Za-z]*|coc-[a-z-]+)\.[cm]?[jt]sx?$/;
test("system language: the pack renderers and the Electron host's COC files hold no CJK either (contract §23)", () => {
	const files = ADDED_SCOPE.flatMap(sourcesUnder).filter((file) => !file.includes("/Electron/") || COC_HOST_FILE.test(file));
	assert.ok(files.length >= 15, `too few files scanned (${files.length}); a path is probably wrong`);
	// One row per file rather than per line: this scope still holds thousands of lines, and a wall
	// of them says nothing a count does not.
	const found = files
		.map((file) => ({ file: relative(REPO, file), lines: offences(file).length }))
		.filter((row) => row.lines > 0)
		.map((row) => `${row.file}  ${row.lines}`);
	assert.deepEqual(found, [], `${found.length} files still hold CJK:\n${found.join("\n")}`);
});

// A table keyed by a play language, or a comparison against one, is the shape §23 removed: the
// authored words live in `content/ui/<source>/` and every other tag is projected into a cache.
test("no per-language table survives in a renderer, an extension or a Coc component (contract §23)", () => {
	const pattern = languageTablePattern(declaredTags());
	const files = TABLE_SCOPE.flatMap(sourcesUnder).filter((file) => !/\/Electron\/packages\/ui\/src\/(?!Coc)/.test(file));
	assert.ok(files.length >= 15, `too few files scanned (${files.length}); a path is probably wrong`);
	const found = files.flatMap((file) => offences(file, pattern));
	assert.deepEqual(found, [], `a play language is still written into code here:\n${found.join("\n")}`);
});

test("the guard's own patterns are not decoration: they still catch what they are for", () => {
	// Mutation test: turn either pattern into something that always fails to match and the tests
	// above stop killing anything at all.
	for (const sample of ["【明骰】", "回合已关闭", "カタカナ", "한글", "全角ＡＢＣ", "、"]) {
		assert.ok(CJK.test(sample), `should match: ${sample}`);
	}
	for (const sample of ["contract §16.1", "roll 44/55 pass", "difficulty <= 55", "a -> b", "café"]) {
		assert.ok(!CJK.test(sample), `should not match: ${sample}`);
	}
	const tags = declaredTags();
	const pattern = languageTablePattern(tags);
	for (const tag of tags) {
		assert.ok(pattern.test(`const WORDS = {"${tag}": {clues: "..."}};`), `an object keyed by ${tag} is a table`);
		assert.ok(pattern.test(`  '${tag}': {title: 'x'},`), `a single-quoted ${tag} key is a table`);
		assert.ok(pattern.test(`const zh = details.play_language === '${tag}';`), `a comparison against ${tag} is a table`);
		assert.ok(pattern.test(`if (tag !== "${tag}") return;`), `a negative comparison against ${tag} is a table`);
		assert.ok(pattern.test(`if ("${tag}" === tag) return;`), `a reversed comparison against ${tag} is a table`);
		assert.ok(!pattern.test(`const words = await resolveUiWords({contentRoot, home, tag: "${tag}"});`), `passing ${tag} as a value is not a table`);
		assert.ok(!pattern.test(`// the campaign was created with ${tag} long ago`), `naming ${tag} in prose is not a table`);
	}
});
