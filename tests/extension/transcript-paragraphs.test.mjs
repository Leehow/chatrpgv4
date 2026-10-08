/**
 * Contract §196.1-196.3 (PU-01, PU-02): a stored page transcript's paragraphs, recovered by aligning its `markdown` to its
 * `text` with §191.3's join rule. The records here are real: eight Cold Harvest pages copied from the TR-F home store
 * (`fixtures/transcript-paragraphs/cold-harvest-pages.json`) and the seventeen shipped Haunting seeds, read from `content/`.
 * The prescreen path that carries these units to Jev and the Keeper is `prescreen-paragraph-units.test.mjs`.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { joinRun } from "../../extensions/module/page-transcript.ts";
import { PARAGRAPH_UNIT_CAP, carriedPath, continuesAcross, endsSentence, pageHeadings, pageParagraphs, paragraphSlices,
	transcriptBlocks } from "../../extensions/module/transcript-paragraphs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEEDS = join(ROOT, "content/source-transcripts/31e36f72d0ac9a3654b61a09b1f071d3d82f25d78641e5069bfe343e44c5c7db");
const cold = JSON.parse(await readFile(join(ROOT, "tests/extension/fixtures/transcript-paragraphs/cold-harvest-pages.json"), "utf8"));
const page = number => cold.pages.find(row => row.page === number);
const seeds = await Promise.all((await readdir(SEEDS)).filter(name => /^page-\d{4}\.json$/.test(name)).sort()
	.map(async name => JSON.parse(await readFile(join(SEEDS, name), "utf8"))));

/** Every block is a run of consecutive `text` lines: whole blank-line stretches, in order, disjoint, covering the page. */
function assertContiguous(record, blocks) {
	const stretches = record.text ? record.text.split("\n\n") : [];
	let covered = 0, cursor = 0;
	for (const block of blocks) {
		assert.ok(block.start >= cursor && block.end > block.start, `page ${record.page}: ordered, disjoint`);
		assert.ok(block.start === 0 || record.text.slice(block.start - 2, block.start) === "\n\n", `page ${record.page}: a block starts at a stretch`);
		const pieces = record.text.slice(block.start, block.end).split("\n\n");
		assert.equal(pieces.length, block.runs, `page ${record.page}: runs counted`);
		for (const piece of pieces) assert.equal(piece, stretches[covered++], `page ${record.page}: stretch ${covered - 1}`);
		cursor = block.end;
	}
	assert.equal(covered, stretches.length, `page ${record.page}: every line is in a block`);
}
function outline(record) {
	const aligned = transcriptBlocks(record);
	assert.ok(aligned.ok, `page ${record.page}: ${JSON.stringify(aligned)}`);
	return { record, blocks: aligned.blocks, headings: pageHeadings(aligned.blocks), merged: aligned.merged };
}
const units = (current, ...earlier) => pageParagraphs(current.blocks, current.record.text, carriedPath(earlier.map(value => value.headings)));
const textOf = (current, unit) => current.record.text.slice(unit.start, unit.end);

test("§196.1 every real page aligns: each block of the Markdown is a run of consecutive text lines", () => {
	for (const record of [...cold.pages, ...seeds]) {
		const found = outline(record);
		assertContiguous(record, found.blocks);
		assert.equal(found.merged, 0, `page ${record.page}: no run stands in two places`);
	}
});

test("§196.1-196.2 a page's units are its body blocks with the heading path above them; headings and page furniture are not units", () => {
	const four = outline(page(4)), five = outline(page(5)), found = units(five, four);
	assert.ok(found.every(unit => unit.kind !== "heading" && unit.kind !== "dropped"));
	assert.ok(!found.some(unit => textOf(five, unit) === "5"), "the dropped page number is no unit");
	assert.deepEqual(found.map(unit => unit.kind), ["paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "quote", "paragraph"]);
	// The page's top paragraphs sit under the path the previous page left open.
	assert.deepEqual(found[0].section, ["COLD HARVEST", "1. 给守密人的信息(KEEPER’S BACKGOUND)", "1.1 1937 年 10 月(OCTOBER 1937)"]);
	assert.match(textOf(five, found[0]), /^1935 年，响应苏联农业集体化号召/);
	// The quoted box is one unit: its title run and its body run together.
	const box = found.find(unit => unit.kind === "quote");
	assert.match(textOf(five, box), /^守密人小窍门\n\n帮助玩家把每个 NPC/);
	assert.deepEqual(box.section, ["COLD HARVEST", "1.2 主要 NPC 角色(KEY NON-PLAYER CHARACTERS)"]);
	assert.deepEqual(found.at(-1).section, ["COLD HARVEST", "1.2 主要 NPC 角色(KEY NON-PLAYER CHARACTERS)",
		"格里戈里·帕维洛维奇·阿加宁Grigori Pavelovich Aganin"], "a heading's own lines joined by §191.3's rule");
	assert.match(textOf(five, found.at(-1)), /^阿加宁是苏共官员/);
	assert.deepEqual(units(five).map(unit => unit.section.length ? unit.section : null)[0], null, "without the previous page nothing is carried");
});

test("§196.2 a carried path keeps only the ancestors: the fold of every heading before the page", () => {
	const A = { level: 1, text: "A" }, B = { level: 2, text: "B" }, X = { level: 3, text: "X" }, C = { level: 2, text: "C" };
	assert.deepEqual(carriedPath([[C], [A, B, X]]), [A, C], "nearest page first");
	assert.deepEqual(carriedPath([[X], [B]]), [B, X]);
	assert.deepEqual(carriedPath([[], [A], [{ level: 1, text: "older" }]]), [A], "a first-level heading ends the walk");
});

test("§196.3 a paragraph broken by a page break: the last body block not at a Sentence_Terminal, the next page's first block of the same kind", () => {
	const eight = outline(page(8)), nine = outline(page(9));
	const before = units(eight), after = units(nine), open = before.find(unit => unit.open), head = after.find(unit => unit.head);
	assert.equal(open, before.at(-1));
	assert.match(textOf(eight, open), /她对特派员$/u);
	assert.match(textOf(nine, head), /^们表现出极大尊敬/u);
	assert.equal(continuesAcross(before, after), true);
	assert.equal(continuesAcross(units(outline(page(41))), units(outline(page(42)))), true, "a list group broken by the page: list to list");
	assert.equal(continuesAcross(units(outline(page(4))), units(outline(page(5)))), false, "page 4 ends at a full stop");
	assert.equal(continuesAcross(units(outline(page(5))), units(outline(page(6)))), false);
	// Not the same kind: an open paragraph followed by a list is not one paragraph.
	assert.equal(continuesAcross([{ ...open }], [{ ...head, kind: "list" }]), false);
	// A page whose only text is its page number (a handout read off pixels) has no unit to continue.
	const handout = outline(page(44));
	assert.deepEqual(units(handout), []);
	assert.deepEqual(handout.blocks.map(block => block.kind), ["dropped"]);
});

test("§196.3 a sentence end is the Unicode property, after closing punctuation: no list of characters", () => {
	for (const closed of ["The bell rang.", "他说：“走吧。”", "Wait!)", "क्या यह सच है।", "هل هذا صحيح؟", "Really‼", "縦書き︒", "Done.  "])
		assert.equal(endsSentence(closed), true, closed);
	for (const open of ["影响极大", "the keeper of the bell is", "如下：", "a word broken by a hyphen-", "Chapter 1.2"])
		assert.equal(endsSentence(open), false, open);
});

test("§196.1 a record made before the hyphen amendment still aligns: its runs were joined with a space after a line-end hyphen", () => {
	const kitchen = seeds.find(record => record.page === 8), lines = ["A conventional kitchen, with icebox, wood-", "fed stove and oven, plus a meager larder."];
	assert.ok(kitchen.text.includes(lines.join("\n")));
	assert.ok(!kitchen.markdown.includes(joinRun(lines)) && kitchen.markdown.includes(joinRun(lines, false)), "the seed has the earlier join");
	assertContiguous(kitchen, outline(kitchen).blocks);
});

test("§196.1 a run whose words also stand earlier in a figure note is bracketed: the blocks between its places become one unit", () => {
	const record = { text: "Alpha\n\nBeta", markdown: "Alpha\n\n> [figure] Beta in a drawing\n\nBeta", dropped: [], unplaced: [] };
	const aligned = transcriptBlocks(record);
	assert.ok(aligned.ok);
	assert.equal(aligned.merged, 1);
	assert.deepEqual(aligned.blocks.map(block => [block.kind, record.text.slice(block.start, block.end)]), [["paragraph", "Alpha"], ["paragraph", "Beta"]],
		"Beta's unit is the merged figure-and-paragraph group, read as body text");
	assert.deepEqual(transcriptBlocks({ ...record, markdown: "Alpha\n\nGamma" }), { ok: false, reason: "run_not_in_markdown", run: 1 });
	assert.deepEqual(transcriptBlocks({ ...record, dropped: [1, 2] }), { ok: false, reason: "dropped_lines_not_last" });
});

test("§196.1 a block longer than the cap is split inside itself at sentence ends, pieces in order and whole", () => {
	const sentence = "调查员们在农场里四处走访，询问每一户人家的收成与失踪者的下落。";
	const text = Array.from({ length: 60 }, () => sentence).join("");
	const pieces = paragraphSlices(text, 0, text.length);
	assert.ok(text.length > PARAGRAPH_UNIT_CAP && pieces.length > 1);
	assert.equal(pieces.map(piece => text.slice(piece.start, piece.end)).join(""), text);
	assert.ok(pieces.every(piece => piece.end - piece.start <= PARAGRAPH_UNIT_CAP));
	assert.ok(pieces.slice(0, -1).every(piece => endsSentence(text.slice(piece.start, piece.end))), "every cut at a sentence end");
	assert.deepEqual(paragraphSlices("short", 0, 5), [{ start: 0, end: 5 }]);
	const numbers = "Version 3.5 of 12.25 parts " .repeat(40);
	assert.ok(paragraphSlices(numbers, 0, numbers.length, 100).every(piece => !/\d\.$/.test(numbers.slice(piece.start, piece.end))),
		"a full stop between two digits is no sentence end");
});
