/**
 * The surfaces the renderers read, and the tables they no longer keep (contract §23, 2026-09-09).
 *
 * `ui-words.test.mjs` pins the loader and the key parity between languages. This pins the other
 * half of the same ruling: that each player-facing surface exists for every declared language, that
 * `errors.json` has a caption for every code the contract lists, and that the renderers themselves
 * hold no word table and no character of a language they are not supposed to name. The last part is
 * a grep on purpose -- the behaviour tests in `Electron/packages/ui` prove the words arrive, and
 * this proves nobody quietly put a second copy back in code beside them.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPlayLanguages } from "../../runtime/ui-words.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The surfaces a player reads, one file per language. `extension` is the extensions' own. */
const SURFACES = ["choices", "errors", "mechanics", "mods", "onboarding", "paper", "preparation", "sheet", "timeline", "transcript"];

/** The failure codes the contract puts in front of a player, plus the two the renderers add. */
const CODES = [
	"runtime_unavailable", "campaign_unbound", "document_unavailable", "invalid_params", "stale_choice",
	"no_session", "pack_unreachable", "pack_silent", "table_not_open", "campaign_not_open",
	"preparation_paused", "preparation_failed", "upload_too_large", "model_without_images",
	"unknown_import", "import_other_session", "operation_in_progress", "upload_chunk_invalid",
	"upload_size_mismatch", "upload_incomplete", "upload_retry", "guidance_not_ready",
	"guidance_unavailable", "opening_bound", "preparation_pause_first", "scenario_not_ready",
	"name_and_occupation_required", "unknown_action", "presentation_timeout", "interrupted",
	"kernel_error", "unknown", "details",
];

/** The renderers and components whose words are data now. Each is read whole. */
const RENDERERS = [
	"pipicoc/panel.js", "pipicoc/mechanics.js", "pipicoc/choices.js", "pipicoc/mods-panel.js",
	"pipicoc/preparation.js",
	"Electron/packages/ui/src/CocOnboarding.tsx", "Electron/packages/ui/src/CocCharacterDraft.tsx",
];

/** Same ranges as the system-language guard: CJK symbols, kana, hangul, ideographs, full-width. */
const CJK = /[ᄀ-ᇿ　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

const read = (path) => readFileSync(join(REPO, path), "utf8");
const surface = (tag, name) => JSON.parse(read(`content/ui/${tag}/${name}.json`));

test("every declared play language ships every player-facing surface", () => {
	const { languages } = JSON.parse(read("content/languages.json"));
	assert.ok(Object.keys(languages).length >= 2, "more than one language, or this proves nothing");
	for (const tag of Object.keys(languages)) {
		for (const name of SURFACES) {
			const words = surface(tag, name);
			assert.ok(Object.keys(words).length > 0, `content/ui/${tag}/${name}.json is empty`);
		}
	}
});

test("the languages the loader knows are exactly the ones with a directory", async () => {
	const known = await loadPlayLanguages(join(REPO, "content"));
	for (const tag of Object.keys(known.languages)) assert.doesNotThrow(() => surface(tag, "sheet"));
});

test("every failure code the contract shows a player has a caption in every language", () => {
	const { languages } = JSON.parse(read("content/languages.json"));
	for (const tag of Object.keys(languages)) {
		const errors = surface(tag, "errors");
		for (const code of CODES) {
			assert.equal(typeof errors[code], "string", `content/ui/${tag}/errors.json has no caption for ${code}`);
			assert.ok(errors[code].trim(), `content/ui/${tag}/errors.json: ${code} is blank`);
		}
	}
});

test("no renderer keeps a word table of its own", () => {
	const offences = [];
	for (const path of RENDERERS) {
		const text = read(path);
		for (const [index, line] of text.split("\n").entries()) {
			// The declarations, not the word in prose: a comment may still explain what was removed.
			if (/(const|let|var)\s+(LABELS|WORDS|PAPER_WORDS)\b/.test(line) || /\b(LABELS|PAPER_WORDS)\s*\[/.test(line))
				offences.push(`${path}:${index + 1}  ${line.trim().slice(0, 80)}`);
		}
	}
	assert.deepEqual(offences, [], `these lines are a per-language table in code again:\n${offences.join("\n")}`);
});

test("no renderer names a play language or writes a player's words in one", () => {
	const offences = [];
	for (const path of RENDERERS) {
		const text = read(path);
		for (const [index, line] of text.split("\n").entries()) {
			if (CJK.test(line)) offences.push(`${path}:${index + 1}  CJK  ${line.trim().slice(0, 70)}`);
			if (line.includes("zh-Hans")) offences.push(`${path}:${index + 1}  tag  ${line.trim().slice(0, 70)}`);
		}
	}
	assert.deepEqual(offences, [], `a renderer names a language again:\n${offences.join("\n")}`);
});

/**
 * The transcript is host chrome apart from one COC caption, so only that component is pinned here;
 * the rest of the file is another slice's to move.
 */
test("the transcript's presentation entry draws no words of its own", () => {
	const text = read("Electron/packages/ui/src/Transcript.tsx");
	const start = text.indexOf("function PresentationEntry(");
	assert.ok(start > 0, "PresentationEntry moved; this guard is pointed at nothing");
	const body = text.slice(start, text.indexOf("\nexport function CompactionDivider", start));
	assert.ok(body.includes("presentationWord("), "the loading caption must come from the presentation's ui");
	assert.ok(!CJK.test(body), `PresentationEntry writes a player's words in code:\n${body}`);
});

test("the guard reads the files it claims to, and its CJK test is not a no-op", () => {
	// Mutation: point RENDERERS at nothing, or widen CJK to match nothing, and the tests above stop
	// being able to fail. Both are checked here so neither can rot quietly.
	for (const path of RENDERERS) assert.ok(read(path).length > 200, `${path} is not the file it used to be`);
	for (const sample of ["【明骰】", "回合已关闭", "カタカナ", "한글", "、"]) assert.ok(CJK.test(sample), sample);
	for (const sample of ["contract §23", "roll 44/55", "a -> b", "…", "▸", "→", "×"]) assert.ok(!CJK.test(sample), sample);
});
