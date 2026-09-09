/**
 * The words the extensions notify with, as data (contract §23, 2026-09-09).
 *
 * Every line an extension puts on `ctx.ui` reads its caption from
 * `content/ui/<tag>/extension.json` for the campaign's play language: the numbers, names and closed
 * kernel enums inside it are the kernel's and are never rewritten, and the words around them are
 * the campaign's. These tests drive the line builders against a temporary content root with two
 * invented languages, so a caption that had been left in code shows up as the same string in both.
 *
 * The failures an extension hands the host carry a `code` from the contract's list; the message
 * stays English, for the log.
 */

import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { extensionWords, fill } from "../../extensions/ui/words.ts";
import { coded, errorCodeOf } from "../../extensions/ui/errors.ts";
import { describe, directorLine, mechanicsLine, sessionLine, tableLanguage } from "../../extensions/table/index.ts";
import { ingestDoneLine, ingestFailedLine, ingestProgressLine } from "../../extensions/table/commands.ts";
import { progressCounts, progressLine } from "../../extensions/onboarding/steps.ts";
import { verifierSystemPrompt } from "../../extensions/kernel/verifier.ts";
import { acceptedGuidance, prepareCharacterGuidance, validateGuidance } from "../../extensions/module/character-guidance.ts";
import { prepareCharacterPresentation, prepareStandingPresentation, validateFinanceEquipment, validatePresentation } from "../../extensions/module/character-presentation.ts";
import { presentDocument, validateDocumentReading } from "../../extensions/mods/document-presentation.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Two invented languages, so no test here can pass by accident on a tag the product ships. */
const AA = {
	director_beat: "aa-beat {beat}",
	director_beat_override: "aa-beat {beat} / aa-over {override}",
	handout_unnamed: "aa-handout",
	handout_written: "aa-handout {name} @ {path}",
	kernel_table_failed: "aa-broken {detail}",
	kernel_table_open: "aa-table {title} @{turn} ({state}) {scene}",
	mechanics_turn: "aa-t{turn}",
	parse_done: "aa-done {module}",
	parse_failed: "aa-failed {reason}",
	parse_opening_not_ready: "aa-not-ready",
	parse_opening_ready: "aa-ready",
	parse_page: "aa-page {page}/{of}",
	parse_pages: "aa-pages {pages}",
	parse_pages_total: "aa-total {of}",
	parse_reason_unknown: "aa-internal",
	parse_stage: "aa-stage {stage}",
	parse_stage_unknown: "aa-?",
	receipt_cash: "aa-cash {before}>{after}",
	receipt_cash_plain: "aa-cash",
	receipt_change: "aa-{resource} {before}>{after}",
	receipt_change_plain: "aa-change",
	receipt_choice: "aa-choice {option}",
	receipt_choice_plain: "aa-choice",
	receipt_clue: "aa-clue {name}",
	receipt_clue_plain: "aa-clue",
	receipt_dice: "aa-{label} is {total}",
	receipt_dice_plain: "aa-dice",
	receipt_handout: "aa-handout {name}",
	receipt_handout_plain: "aa-handout",
	receipt_item: "aa-item {name}",
	receipt_item_plain: "aa-item",
	receipt_item_quantity: "aa-item {name} *{quantity}",
	receipt_move: "aa-move {scene}",
	receipt_move_plain: "aa-move",
	receipt_roll: "aa-roll {roll}/{target} {outcome}",
	receipt_roll_fail: "aa-fail",
	receipt_roll_pass: "aa-pass",
	receipt_roll_plain: "aa-roll",
	receipt_session: "aa-session {family} {transition}",
	receipt_session_plain: "aa-session",
	receipt_time: "aa-time {minutes}",
	receipt_time_plain: "aa-time",
	receipt_worldline: "aa-{operation} to {line}",
	receipt_worldline_loop: "aa-{operation} to {line} loop {loop}",
	receipt_worldline_plain: "aa-worldline",
	session_defence: "aa-defence {who}",
	session_defence_options: "aa-defence {who} [{options}]",
	session_defender_npc: "aa-npc",
	session_defender_player: "aa-player",
	session_round: "aa-round {round}",
	session_turn: "aa-turn {who}",
	setup_complete: "aa-done, open with {command}",
	setup_guidance_failed: "aa-no-guidance {detail}",
	setup_guidance_review_failed: "aa-review-failed",
	setup_opened: "aa-setup of {total}, next {step}",
	setup_progress: "aa-setup {done}/{total} next {step}",
	setup_progress_ready: "aa-setup {done}/{total} ready",
	table_campaign_unnamed: "aa-no-campaign",
	table_investigator: "aa-{name} HP {hp} SAN {san}",
	table_investigator_unnamed: "aa-nobody",
	table_open: "aa-open {title} @{turn} {scene}",
	table_scene_unknown: "aa-nowhere",
	table_value_unknown: "aa-?",
};

/** The same keys, different words: what a second language must change without a line of code moving. */
const BB = Object.fromEntries(Object.entries(AA).map(([key, value]) => [key, value.replaceAll("aa-", "bb-")]));

async function surfaces() {
	const root = await mkdtemp(join(tmpdir(), "extension-words-"));
	await writeFile(join(root, "languages.json"), JSON.stringify({ default: "aa", languages: { aa: { autonym: "Aa" }, bb: { autonym: "Bb" } } }));
	for (const [tag, words] of [["aa", AA], ["bb", BB]]) {
		await mkdir(join(root, "ui", tag), { recursive: true });
		await writeFile(join(root, "ui", tag, "extension.json"), JSON.stringify(words));
	}
	return { root, aa: await extensionWords("aa", root), bb: await extensionWords("bb", root) };
}

/** Both languages draw the same row; the words differ and the values are the same in both. */
function bothWays(draw, ...values) {
	return async () => {
		const { aa, bb } = await surfaces();
		const first = draw(aa);
		const second = draw(bb);
		assert.notEqual(first, second, "a second language draws the row with its own words");
		assert.equal(first.replaceAll("aa-", ""), second.replaceAll("bb-", ""), "only the words differ, never the values");
		for (const value of values) assert.ok(String(first).includes(String(value)), `the row still carries ${value}`);
		return { first, second, aa, bb };
	};
}

test("fill puts values into a template and leaves a value it was not given standing", () => {
	assert.equal(fill("turn {turn} of {total}", { turn: 3, total: 7 }), "turn 3 of 7");
	assert.equal(fill("{a}{a}", { a: "x" }), "xx", "a placeholder used twice is filled twice");
	assert.equal(fill("turn {turn}", {}), "turn {turn}", "a hole nobody filled is named, never silently dropped");
	assert.equal(fill("no placeholders"), "no placeholders");
});

test("a key no shipped language declares renders as the key: an identifier and a visible gap", async () => {
	const { aa } = await surfaces();
	assert.equal(aa.word("a_key_nobody_wrote"), "a_key_nobody_wrote");
	assert.equal(aa.line("a_key_nobody_wrote", { x: 1 }), "a_key_nobody_wrote");
});

test("an unknown tag reads as the language content/languages.json defaults to", async () => {
	const { root, aa } = await surfaces();
	const unknown = await extensionWords("zz", root);
	assert.equal(unknown.tag, "aa");
	assert.equal(unknown.word("table_open"), aa.word("table_open"));
	assert.equal((await extensionWords(undefined, root)).tag, "aa");
});

test("the table's open line: the campaign's words around the kernel's title, scene and numbers", async () => {
	const payload = {
		campaign: "camp",
		open: {
			campaign: { title: "The Corbitt House", play_language: "bb" },
			turn: { number: 4 },
			scene: { display_name: "Front yard" },
			investigators: [{ name: "Thomas", hp: 12, san: 55 }],
		},
	};
	const { first } = await bothWays((words) => describe(payload, words), "The Corbitt House", "Front yard", "Thomas", 12, 55, 4)();
	assert.ok(first.includes("\n"), "the investigators go on their own line");
	assert.equal(tableLanguage(payload), "bb", "the campaign's play language comes off table.open");
	assert.equal(tableLanguage({ open: { campaign: {} } }), undefined, "a campaign that names none reads as the default");
});

test("the table's open line names the missing pieces in the campaign's words too", async () => {
	const { aa, bb } = await surfaces();
	const bare = { open: { investigators: [{}] } };
	assert.equal(describe(bare, aa), "aa-open aa-no-campaign @0 aa-nowhere\naa-aa-nobody HP aa-? SAN aa-?");
	assert.equal(describe(bare, bb), "bb-open bb-no-campaign @0 bb-nowhere\nbb-bb-nobody HP bb-? SAN bb-?");
});

test("the session line: closed kernel enums verbatim, the words around them from the surface", async () => {
	const session = { kind: "combat", round: 1, turn_of: "The caretaker", pending_defense: { for: "player", options: ["dodge", "fight_back"] } };
	const { first } = await bothWays((words) => sessionLine(session, words), "combat", "dodge/fight_back", "The caretaker", 1)();
	assert.ok(first.startsWith("combat  "), "the session kind is the kernel's own word, never translated");
	const { aa } = await surfaces();
	assert.equal(sessionLine({ kind: "combat", ended: true }, aa), undefined, "an ended session takes the line down");
	assert.equal(sessionLine(undefined, aa), undefined);
});

test("the Director line: the beat and the hard rule verbatim, the caption from the surface", async () => {
	await bothWays((words) => directorLine({ beat: "REVEAL" }, words), "REVEAL")();
	await bothWays((words) => directorLine({ beat: "SUBSYSTEM", override: "session-active" }, words), "SUBSYSTEM", "session-active")();
	const { aa } = await surfaces();
	assert.equal(directorLine({ beat: "   " }, aa), undefined, "no beat, no line");
	assert.equal(directorLine(null, aa), undefined);
});

test("the receipt line: every kind the contract names draws its words from the surface", async () => {
	const event = {
		turn: 7,
		mechanics: [
			{ kind: "roll", roll: 42, target: 55, passed: true },
			{ kind: "cash", before: 30, after: 12 },
			{ kind: "scene", to: "Front yard" },
			{ kind: "clue", label: "Scratches" },
			{ kind: "time", minutes: 10 },
			{ kind: "item", name: "Lantern", quantity: 2 },
			{ kind: "session", family: "combat", transition: "start" },
			{ kind: "handout", name: "The letter" },
			{ kind: "choice", option: "push" },
		],
	};
	const { first } = await bothWays(
		(words) => mechanicsLine(event, words),
		42, 55, 30, 12, "Front yard", "Scratches", 10, "Lantern", 2, "combat", "The letter", "push", 7,
	)();
	assert.equal(
		first,
		[
			"aa-t7",
			"aa-roll 42/55 aa-pass",
			"aa-cash 30>12",
			"aa-move Front yard",
			"aa-clue Scratches",
			"aa-time 10",
			"aa-item Lantern *2",
			"aa-session combat start",
			"aa-handout The letter",
			"aa-choice push",
		].join("  "),
		"every fragment is the surface's template with the kernel's values in it",
	);
	const { aa } = await surfaces();
	assert.equal(mechanicsLine({ mechanics: [] }, aa), undefined, "nothing to say, no line");
	assert.equal(mechanicsLine({ mechanics: [{ kind: "roll" }] }, aa), "aa-roll", "a roll with no numbers is still the campaign's word");
	assert.equal(mechanicsLine({ turn: 2, mechanics: [{ kind: "item", name: "Lantern" }] }, aa), "aa-t2  aa-item Lantern",
		"one of a thing does not print a quantity");
});

test("the receipt line falls back to the campaign's own plain words, never to English", async () => {
	const { aa, bb } = await surfaces();
	for (const row of [{ kind: "cash" }, { kind: "scene" }, { kind: "clue" }, { kind: "time" }]) {
		const drawn = mechanicsLine({ mechanics: [row] }, aa);
		assert.ok(drawn.startsWith("aa-"), `${row.kind} with nothing in it still speaks the campaign's language: ${drawn}`);
		assert.notEqual(drawn, mechanicsLine({ mechanics: [row] }, bb));
	}
});

test("the handout notice and the parse job's lines are the campaign's words around the job's own values", async () => {
	await bothWays((words) => words.line("handout_written", { name: "The letter", path: "/tmp/a.pdf" }), "The letter", "/tmp/a.pdf")();
	await bothWays((words) => ingestProgressLine({ stage: "index", page: 10, of: 20 }, words), "index", 10, 20)();
	await bothWays((words) => ingestProgressLine({ stage: "index", of: 20 }, words), "index", 20)();
	await bothWays((words) => ingestDoneLine({ module_id: "a-book", page_count: 41, opening_ready: true }, words), "a-book", 41)();
	await bothWays((words) => ingestFailedLine({ reason: "unreadable", detail: "no pages" }, words), "unreadable", "no pages")();
	const { aa } = await surfaces();
	assert.equal(ingestDoneLine({ module_id: "a-book", opening_ready: false }, aa), "aa-done a-book  aa-not-ready",
		"a job with no page count prints no empty column");
	assert.equal(ingestFailedLine({}, aa), "aa-failed aa-internal", "a failure with no reason still says so in the campaign's words");
});

test("the setup progress line: one set of counts, English for the model and the surface for the player", async () => {
	const steps = [{ id: "one", needs: {} }, { id: "two", needs: {} }, { id: "three", needs: {} }];
	const state = { completed: new Set(["one"]) };
	const counts = progressCounts(steps, state);
	assert.deepEqual({ done: counts.done, total: counts.total, next: counts.next.id }, { done: 1, total: 3, next: "two" });
	assert.equal(progressLine(steps, state), "setup 1/3  next two", "the tool's own progress is read by the model and stays English");
	const { aa, bb } = await surfaces();
	const drawn = (words) => words.line("setup_progress", { done: counts.done, total: counts.total, step: counts.next.id });
	assert.equal(drawn(aa), "aa-setup 1/3 next two");
	assert.notEqual(drawn(aa), drawn(bb), "the player's line follows the campaign's language, the model's does not");
	assert.equal(progressCounts([], state), undefined, "a lane with no applicable step draws nothing");
});

test("the verifier always names the language it wants its findings in", async () => {
	const named = await verifierSystemPrompt("en");
	assert.ok(named.includes("Write why in en."), named.slice(-80));
	const declared = JSON.parse(await readFile(join(REPO, "content/languages.json"), "utf8"));
	const fallback = await verifierSystemPrompt(undefined);
	assert.ok(fallback.includes(`Write why in ${declared.default}.`), "a kernel that named no language gets the data default, not silence");
	const unknown = await verifierSystemPrompt("zz");
	assert.ok(unknown.includes(`Write why in ${declared.default}.`), "a tag this build does not play in reads as the default");
});

test("the shipped languages declare exactly the keys the extensions ask for", () => {
	const asked = new Set();
	const walk = (path) => (statSync(path).isDirectory() ? readdirSync(path).flatMap((entry) => walk(join(path, entry))) : [path]);
	for (const file of walk(join(REPO, "extensions")).filter((path) => path.endsWith(".ts"))) {
		// Every quoted identifier inside a `.word(...)` / `.line(...)` call, so a key chosen by a
		// ternary (`words.word(passed ? "…" : "…")`) counts as asked for exactly like a plain one.
		for (const [, call] of readFileSync(file, "utf8").matchAll(/\.(?:word|line)\(([^)]*)\)/g))
			for (const [, key] of call.matchAll(/["']([a-z][a-z0-9_]*)["']/g)) asked.add(key);
	}
	assert.ok(asked.size >= 30, `the extensions ask for ${asked.size} captions; the scan is probably wrong`);
	const shipped = JSON.parse(readFileSync(join(REPO, "content/ui/en/extension.json"), "utf8"));
	const missing = [...asked].filter((key) => !(key in shipped)).sort();
	assert.deepEqual(missing, [], `these captions have no word in content/ui/en/extension.json:\n${missing.join("\n")}`);
	const unused = Object.keys(shipped).filter((key) => !asked.has(key)).sort();
	assert.deepEqual(unused, [], `these captions are shipped but nothing asks for them:\n${unused.join("\n")}`);
});

test("coded errors carry the code a renderer looks its word up by, and keep the English message", () => {
	const error = coded("guidance_not_ready", "Guidance has not been accepted");
	assert.ok(error instanceof Error);
	assert.equal(error.code, "guidance_not_ready");
	assert.equal(error.message, "Guidance has not been accepted");
	assert.equal(errorCodeOf(error), "guidance_not_ready");
	assert.equal(errorCodeOf(new Error("no code")), undefined);
	assert.equal(errorCodeOf(null), undefined);
	assert.equal(errorCodeOf({ code: "" }), undefined, "an empty code is no code");
});

test("every code these extensions throw is one the contract lists", async () => {
	const contract = await readFile(join(REPO, "docs/kernel-rpc.md"), "utf8");
	const section = contract.slice(contract.indexOf("**Errors carry codes.**"));
	const listed = new Set([...section.slice(0, 1400).matchAll(/`([a-z][a-z_]+)`/g)].map(([, code]) => code));
	const walk = (path) => (statSync(path).isDirectory() ? readdirSync(path).flatMap((entry) => walk(join(path, entry))) : [path]);
	const thrown = new Set();
	for (const file of walk(join(REPO, "extensions")).filter((path) => path.endsWith(".ts"))) {
		// The first argument of every `coded(...)`, ternaries included; the message after it is prose.
		for (const [, first] of readFileSync(file, "utf8").matchAll(/\bcoded\(\s*([^,]+),/g))
			for (const [, code] of first.matchAll(/["']([a-z][a-z_]*)["']/g)) thrown.add(code);
	}
	assert.ok(thrown.size >= 5, `only ${thrown.size} codes found; the scan is probably wrong`);
	const strangers = [...thrown].filter((code) => !listed.has(code)).sort();
	assert.deepEqual(strangers, [], `these codes are thrown but the contract's list does not hold them:\n${strangers.join("\n")}`);
});

test("character guidance refuses with invalid_params and reports readiness with guidance_not_ready", async () => {
	const home = await mkdtemp(join(tmpdir(), "guidance-codes-"));
	const folder = join(home, ".coc/modules/story");
	await mkdir(folder, { recursive: true });
	await writeFile(join(folder, "module.json"), JSON.stringify({ id: "story" }));
	await writeFile(join(folder, "module-graph.json"), JSON.stringify({ nodes: [] }));
	const options = { home, module_id: "story", play_language: "en", occupations: [], runner: async () => ({ ok: true }) };
	await assert.rejects(prepareCharacterGuidance({ ...options, module_id: "Not An Id" }), (error) => error.code === "invalid_params");
	await assert.rejects(prepareCharacterGuidance({ ...options, play_language: "zz" }), (error) => error.code === "invalid_params");
	await assert.rejects(acceptedGuidance(home, "story", "not-a-fingerprint"), (error) => error.code === "invalid_params");
	await writeFile(join(folder, "module.json"), JSON.stringify({ id: "story", bundled_guidance_required: true }));
	await assert.rejects(prepareCharacterGuidance(options), (error) => error.code === "guidance_not_ready");
	assert.equal(errorCodeOf(rejectionOf(() => validateGuidance(null))), "guidance_unavailable");
});

test("the card and the document refuse with invalid_params and fail preparation with preparation_failed", async () => {
	const home = await mkdtemp(join(tmpdir(), "presentation-codes-"));
	const card = { home, campaign: "camp", revision: 1, play_language: "zz", runner: async () => ({ ok: true }) };
	await assert.rejects(prepareCharacterPresentation(card), (error) => error.code === "invalid_params");
	await assert.rejects(prepareCharacterPresentation({ ...card, play_language: "en", campaign: "not a campaign" }),
		(error) => error.code === "invalid_params");
	await assert.rejects(prepareStandingPresentation({ ...card, play_language: "en", view: { play_language: "en" }, campaign: "not a campaign" }),
		(error) => error.code === "invalid_params");
	await assert.rejects(prepareStandingPresentation({ ...card, play_language: "en", view: { play_language: "zz" } }),
		(error) => error.code === "invalid_params");
	assert.equal(errorCodeOf(rejectionOf(() => validatePresentation({ texts: {} }, ["one"]))), "preparation_failed");
	assert.equal(errorCodeOf(rejectionOf(() => validateFinanceEquipment({ finance_equipment: ["nothing"] }, []))), "preparation_failed");
	await assert.rejects(presentDocument({ home }, { play_language: "zz", name: "a", text: "", original: "" }),
		(error) => error.code === "invalid_params");
	await assert.rejects(presentDocument({ home }, { play_language: "en", name: "", text: "", original: "" }),
		(error) => error.code === "invalid_params");
	assert.equal(errorCodeOf(rejectionOf(() => validateDocumentReading({ title: "", text: "" }, { text: "" }))), "preparation_failed");
});

/** The error a synchronous call threw, for asserting on its code. */
function rejectionOf(run) {
	try {
		run();
	} catch (error) {
		return error;
	}
	assert.fail("the call was supposed to refuse");
}

test("the two shipped languages agree on the extension surface's keys", async () => {
	const read = async (tag) => JSON.parse(await readFile(join(REPO, "content/ui", tag, "extension.json"), "utf8"));
	const declared = JSON.parse(await readFile(join(REPO, "content/languages.json"), "utf8"));
	const base = await read(declared.default);
	for (const tag of Object.keys(declared.languages)) {
		const own = await read(tag);
		assert.deepEqual(Object.keys(own).sort(), Object.keys(base).sort(), `content/ui/${tag}/extension.json holds the default's keys`);
		for (const [key, value] of Object.entries(own)) {
			assert.ok(typeof value === "string" && value.trim(), `content/ui/${tag}/extension.json: ${key} is a word`);
			const holes = [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(([, name]) => name).sort();
			assert.deepEqual(holes, [...base[key].matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(([, name]) => name).sort(),
				`content/ui/${tag}/extension.json: ${key} takes the same values as the default's`);
		}
	}
	assert.ok(relative(REPO, join(REPO, "content/ui")) === join("content", "ui"), "the surfaces live under content/ui");
});
