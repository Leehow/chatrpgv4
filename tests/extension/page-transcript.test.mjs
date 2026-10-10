/**
 * Contract §191.1-§191.4, §191.6, §191.9 (PT-01): the page-transcript producer.
 *
 * The layout is the agent's and the words are the host's: the grammar and normalization table below runs the real
 * assembly; the store refuses a page whose exact layer is not a permutation of its native lines; the service runs one
 * layout child per page through an injected `runTask` (a fake child that leaves what `submit_layout` would: the kept
 * `layout.md` and one `submissions.jsonl` row per submission; the tool itself and a real child are in
 * `layout-submit.test.mjs`), keeps pages by the file's digest across module ids and processes, reads shipped seeds without writing home,
 * makes one child for concurrent requests of one page, and does nothing with `mode: "off"`. Fixtures are synthesized.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleLayout, eastAsianWide, joinRun, linesFile, nativeLines, transcriptPermutationHolds } from "../../extensions/module/page-transcript.ts";
import { TRANSCRIPT_RECORD_SCHEMA, TranscriptRefused, TranscriptStore } from "../../extensions/module/transcript-store.ts";
import { TranscriptService, staleClaimMs } from "../../extensions/module/transcript-service.ts";
import { TRANSCRIPT_FALLBACK, transcriptBudget } from "../../runtime/jev/host-budgets.ts";
import { closeSourceDocuments, sourceLines, sourceText } from "../../extensions/module/source.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sha = value => createHash("sha256").update(value, "utf8").digest("hex");
const FILE = "c".repeat(64);
const EXTRACTION = "pdfjs-fixture:native-text-v1";
const exists = path => access(path).then(() => true, () => false);

async function scratch(t, prefix) {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

// ---------------------------------------------------------------------------------------------------------------------
// §191.3 grammar and normalization

const PAGE = ["Chapter 3", "The Village", "The village sits at", "the end of the road.", "Skills:", "Skills:", "Keeper note one", "Keeper note two", "17"];

const TABLE = [
	{ name: "placeholders, ranges and runs: adjacent placeholders are one run, a blank line starts the next",
		layout: "# {L2}\n\n{L3}{L4}\n\n{L5-L6}\n\n> {L7-L8}\n\n<!-- drop: L1 L9 -->",
		text: "The Village\n\nThe village sits at\nthe end of the road.\n\nSkills:\nSkills:\n\nKeeper note one\nKeeper note two\n\nChapter 3\n17",
		markdown: "# The Village\n\nThe village sits at the end of the road.\n\nSkills: Skills:\n\n> Keeper note one Keeper note two",
		dropped: [1, 9], unplaced: [], free_removed: 0 },
	{ name: "whitespace between placeholders makes two runs on one Markdown line",
		layout: "{L1} {L2}\n{L3-L9}",
		text: "Chapter 3\n\nThe Village\n\nThe village sits at\nthe end of the road.\nSkills:\nSkills:\nKeeper note one\nKeeper note two\n17",
		markdown: "Chapter 3 The Village\nThe village sits at the end of the road. Skills: Skills: Keeper note one Keeper note two 17" },
	{ name: "a drop range; a line both placed and dropped is placed; a second placement is removed (first wins)",
		layout: "{L1-L4}\n\n{L2}\n\n{L5-L9}\n\n<!-- drop: L1-L2 L9 -->",
		order: [1, 2, 3, 4, 5, 6, 7, 8, 9], dropped: [], duplicates: 1 },
	{ name: "numbers outside 1..line_count and a reversed range are ignored and counted",
		layout: "{L1-L9}{L10}\n\n{L0}\n\n{L7-L3}\n\n<!-- drop: L12 L40-L41 -->",
		ignored: 6, unplaced: [] },
	{ name: "typed text equal to an unplaced line is placed there (NFKC, whitespace removed); equal to a placed line is removed uncounted",
		layout: "## The  Village\n\n{L3-L4}\n\n**Ｓｋｉｌｌｓ:**\n\nSkills:\n\nSkills:\n\n{L1}{L7-L9}",
		order: [2, 3, 4, 5, 6, 1, 7, 8, 9], mapped: 3, duplicates: 1, free_removed: 0,
		markdown: "## The Village\n\nThe village sits at the end of the road.\n\n**Skills:**\n\nSkills:\n\nChapter 3 Keeper note one Keeper note two 17" },
	{ name: "other typed text is removed and counted; a heading left without words is dropped",
		layout: "## An Invented Title\n\n{L1-L4} plus retyped words\n\n| Header | {L5} |\n|---|---|\n| {L6}<br>{L7} | {L8} |\n\n{L9}",
		free_removed: 3, unplaced: [],
		markdown: "Chapter 3 The Village The village sits at the end of the road. \n\n|  | Skills: |\n|---|---|\n| Skills:<br>Keeper note one | Keeper note two |\n\n17" },
	{ name: "image text is kept inside its markers and not normalized; figure notes are kept",
		layout: "{L1-L9}\n\n<!-- image-text -->\nMain Courtyard\nThe Village\n<!-- /image-text -->\n\n> [figure] A sketch map of the village",
		image_text: ["Main Courtyard\nThe Village"], figures: ["A sketch map of the village"], free_removed: 0 },
	{ name: "lines left out are unplaced: appended in native order after the placed lines and before the dropped ones",
		layout: "{L2}\n\n{L5}\n\n<!-- drop: L9 -->",
		unplaced: [1, 3, 4, 6, 7, 8], dropped: [9],
		text: "The Village\n\nSkills:\n\nChapter 3\nThe village sits at\nthe end of the road.\nSkills:\nKeeper note one\nKeeper note two\n\n17" },
];

test("§191.3 grammar and normalization table", () => {
	for (const row of TABLE) {
		const result = assembleLayout(row.layout, PAGE);
		for (const field of ["text", "markdown", "dropped", "unplaced", "free_removed", "order", "mapped", "duplicates", "ignored", "image_text", "figures"])
			if (row[field] !== undefined) assert.deepEqual(result[field], row[field], `${row.name}: ${field}`);
		assert.ok(transcriptPermutationHolds(result.text, PAGE), `${row.name}: the exact layer is a permutation of the native lines`);
	}
});

test("§191.3 runs join wide characters without a separator and everything else with one space", () => {
	assert.equal(joinRun(["第一行", "第二行"]), "第一行第二行");
	assert.equal(joinRun(["Plain", "text"]), "Plain text");
	assert.equal(joinRun(["混合", "Latin"]), "混合Latin", "either side wide: no separator");
	assert.equal(joinRun(["ends with space ", "next"]), "ends with space next", "a join never doubles a space");
	assert.equal(joinRun(["ＡＢＣ", "x"]), "ＡＢＣx", "fullwidth forms are F");
	assert.equal(joinRun(["the sce-", "nario"]), "the sce-nario", "a line-end hyphen joins without a space");
	assert.equal(joinRun(["human\u2010", "seeming"]), "human\u2010seeming");
	assert.equal(joinRun(["a dash -", "x"]), "a dash -x");
	assert.equal(eastAsianWide("𠀀".codePointAt(0)), true, "a supplementary-plane ideograph");
	assert.equal(eastAsianWide("é".codePointAt(0)), false);
	const result = assembleLayout("{L1-L2}", ["中文第一行", "中文第二行"]);
	assert.equal(result.markdown, "中文第一行中文第二行");
	assert.equal(result.text, "中文第一行\n中文第二行");
});

test("§191.1 lines drop whitespace-only entries and keep every other one byte for byte; lines.txt numbers them", () => {
	assert.deepEqual(nativeLines("  lead\n \n　\nmid  dle \n\nend"), ["  lead", "mid  dle ", "end"]);
	assert.equal(linesFile(["a", "b"]), "L1: a\nL2: b\n");
	assert.equal(linesFile([]), "(this page has no text layer)\n");
});

test("§191.3 a page with no lines keeps its figure notes and image text; typed words outside them are removed", () => {
	const result = assembleLayout("# Stat block\n\n<!-- image-text -->\nSTR 50 CON 60\n<!-- /image-text -->\n\n> [figure] A creature drawn beside its numbers\n\n{L1}", []);
	assert.equal(result.text, "");
	assert.equal(result.markdown, "<!-- image-text -->\nSTR 50 CON 60\n<!-- /image-text -->\n\n> [figure] A creature drawn beside its numbers");
	assert.deepEqual([result.image_text, result.figures, result.free_removed, result.ignored], [["STR 50 CON 60"], ["A creature drawn beside its numbers"], 1, 1]);
});

// ---------------------------------------------------------------------------------------------------------------------
// §191.4 store

function record(lines, assembly, page = 1, overrides = {}) {
	return { schema: TRANSCRIPT_RECORD_SCHEMA, transcript_version: "transcript-v1", file_sha256: FILE, page, pdf_label: String(page),
		native: { extraction_version: EXTRACTION, text_sha256: sha(lines.join("\n")), line_count: lines.length },
		text: assembly.text, text_sha256: sha(assembly.text), markdown: assembly.markdown, image_text: assembly.image_text, figures: assembly.figures,
		dropped: assembly.dropped, unplaced: assembly.unplaced, free_removed: assembly.free_removed, attempts: 1, model: "fixture/vision", thinking: "low",
		at: "2026-10-07T00:00:00.000Z", ...overrides };
}

test("§191.3 invariant: the store refuses a page whose exact layer loses or duplicates a native line, and writes nothing", async t => {
	const home = await scratch(t, "transcript-store-"), store = new TranscriptStore({ home, contentRoot: home, extractionVersion: EXTRACTION });
	const good = record(PAGE, assembleLayout("{L1-L9}", PAGE));
	const lost = PAGE.slice(0, 8).join("\n"), doubled = [...PAGE, PAGE[2]].join("\n");
	for (const text of [lost, doubled]) {
		const bad = { ...good, text, text_sha256: sha(text) };
		await assert.rejects(store.put(bad, PAGE), error => error instanceof TranscriptRefused && error.reason === "text_is_not_a_permutation_of_the_native_lines");
		assert.equal(await exists(store.recordPath(FILE, 1)), false, "a refused page writes no record");
	}
	assert.equal(await store.put(good, PAGE), "stored");
	assert.equal(await store.put({ ...good, markdown: "a later rewrite" }, PAGE), "exists", "a record is never rewritten");
	assert.equal((await store.read(FILE, 1)).record.markdown, good.markdown);
	assert.deepEqual((await readdir(store.dir(FILE))).filter(name => name.endsWith(".tmp")), [], "no temporary file is left behind");
});

test("§191.4 a record of another extraction version is ignored; a claim is exclusive until stale", async t => {
	const home = await scratch(t, "transcript-claim-");
	const store = new TranscriptStore({ home, contentRoot: home, extractionVersion: EXTRACTION });
	await store.put(record(PAGE, assembleLayout("{L1-L9}", PAGE), 1, { native: { extraction_version: "pdfjs-older:native-text-v1", text_sha256: "x", line_count: PAGE.length } }), PAGE);
	assert.equal(await store.read(FILE, 1), undefined);
	const first = await store.claim(FILE, 2, 1000, 10_000);
	assert.ok(first);
	assert.equal(await store.claim(FILE, 2, 1000, 10_500), null, "a live claim keeps a second producer out");
	assert.equal(await store.claimedElsewhere(FILE, 2, 1000, 10_500), true);
	const taken = await store.claim(FILE, 2, 1000, 12_000);
	assert.ok(taken, "a stale claim may be taken");
	await first.release();
	assert.equal(await store.claimedElsewhere(FILE, 2, 1000, 12_000), true, "an old producer never removes the taker's claim");
	await taken.release();
	assert.equal(await store.claimedElsewhere(FILE, 2, 1000, 12_000), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// §191.2, §191.6 the service, with a fake child

const BUDGET = { ...TRANSCRIPT_FALLBACK };
const VISION = { id: "fixture/vision", vision: true, thinking: "low", contextWindow: 200_000 };

async function harness(t, { pages = { 1: PAGE }, layouts = () => "{L1-L9}", submitted = () => 1, timedOut = () => false, budget = BUDGET, model = VISION, home, content, gate, yieldTo, events } = {}) {
	home ??= await scratch(t, "transcript-home-");
	content ??= await scratch(t, "transcript-content-");
	const runs = [], rows = [], calls = [];
	const runtime = {
		home, contentRoot: content,
		async sourceLines({ pdf, pages: wanted, expected_file_sha256 }) {
			calls.push(["sourceLines", pdf, wanted]);
			return { file_sha256: expected_file_sha256, extraction_version: EXTRACTION, page_count: 40,
				pages: wanted.filter(page => pages[page]).map(page => ({ page, pdf_label: `p${page}`, native_sha256: sha(pages[page].join("\n")), lines: pages[page] })), errors: [] };
		},
		async sourcePage({ cache, page }) {
			calls.push(["sourcePage", page]);
			await mkdir(cache, { recursive: true });
			const path = join(cache, `page-${page}.png`);
			await writeFile(path, `png of page ${page}`);
			return { path, page };
		},
		async runTask(task, signal) {
			const request = task.request, files = await readdir(request.cwd);
			runs.push({ ...request, files, page: Number(/p(\d{4})-\d+$/.exec(request.cwd)[1]) });
			if (gate) await gate(request);
			runs[runs.length - 1].startedAt = Date.now();
			const layout = layouts(request, runs.length, files);
			// What submit_layout leaves behind: the kept layout and one row per submission.
			if (layout !== undefined) {
				await writeFile(join(request.cwd, "layout.md"), layout);
				const count = submitted(request, runs.length);
				await writeFile(join(request.cwd, "submissions.jsonl"), Array.from({ length: count }, (_, index) => JSON.stringify({ submission: index + 1 }) + "\n").join(""));
			}
			if (events) await writeFile(request.eventLog, events(request, runs.length));
			runs[runs.length - 1].endedAt = Date.now();
			const late = timedOut(request, runs.length);
			return { ok: !signal?.aborted && !late, code: late ? null : 0, timedOut: late, ms: 1, stderr: "", command: [],
				usage: { inputTokens: 5000, outputTokens: 600, costUsd: 0.01, actions: 3, unknownCalls: 0 } };
		},
	};
	const service = new TranscriptService({ runtime, model: () => model, record: row => rows.push(row), budget, extractionVersion: EXTRACTION, ...(yieldTo ? { yieldTo } : {}) });
	t.after(() => service.close());
	return { home, content, runtime, service, runs, rows, calls, store: new TranscriptStore({ home, contentRoot: content, extractionVersion: EXTRACTION }) };
}

test('a migrated producer retains earlier work and its own original page input',async t=>{
  const h=await harness(t),old=h.store.workDir(FILE,1,1);
  await mkdir(old,{recursive:true});await writeFile(join(old,'events.jsonl'),'original retained trace\n');
  await h.service.ensure({pdf:'source.pdf',file_sha256:FILE,pages:[1]});await h.service.idle();
  assert.equal(await readFile(join(old,'events.jsonl'),'utf8'),'original retained trace\n');
  assert.equal(h.runs.length,1);assert.notEqual(h.runs[0].cwd,old);
  assert.equal(await readFile(join(h.runs[0].cwd,'page.png'),'utf8'),'png of page 1');
});

test("§191.2 one background child per page, shown the page render and the numbered lines, whose one tool is submit_layout; the page is stored once", async t => {
	const h = await harness(t);
	const result = await h.service.ensure({ pdf: "modules/a/source.pdf", file_sha256: FILE, pages: [1] });
	assert.deepEqual([result.state, result.queued], ["queued", [1]]);
	await h.service.idle();
	assert.equal(h.runs.length, 1);
	const [run] = h.runs;
	assert.deepEqual([run.tools, run.priority, run.model, run.thinking, run.timeoutMs], ["", "background", "fixture/vision", "low", BUDGET.timeoutMs],
		"no built-in tool: the child cannot choose where anything is written");
	assert.deepEqual(run.layout, { submissions: 1 + BUDGET.repairAttempts }, "it mounts submit_layout with its submissions");
	assert.deepEqual(run.attachments, ["page.png", "lines.txt"], "it is shown its inputs instead of reading them");
	assert.equal(run.systemPrompt, join(h.content, "setup", "page-transcript.md"));
	assert.equal(run.cwd, join(h.home, ".coc", "source-transcripts", FILE, "work", "p0001-1"));
	assert.deepEqual(run.files.sort(), ["lines.json", "lines.txt", "page.png"]);
	assert.equal(run.providerBudget.callOutputTokens, BUDGET.outputTokens, "its own lease, sized by the budget");
	assert.equal(run.source, undefined, "no PDF source");
	assert.equal(await readFile(join(run.cwd, "lines.txt"), "utf8"), linesFile(PAGE));
	assert.deepEqual(JSON.parse(await readFile(join(run.cwd, "lines.json"), "utf8")), PAGE, "the tool's own copy of the native lines");
	const stored = await h.store.read(FILE, 1);
	assert.equal(stored.source, "home");
	assert.deepEqual([stored.record.attempts, stored.record.unplaced, stored.record.native.line_count, stored.record.pdf_label], [1, [], 9, "p1"]);
	assert.ok(transcriptPermutationHolds(stored.record.text, PAGE));
	const page = h.rows.find(row => row.event === "page");
	assert.deepEqual([page.lane, page.outcome, page.lines, page.placed, page.unplaced, page.attempts, page.submissions, page.model, page.usage.inputTokens],
		["transcript", "stored", 9, 9, 0, 1, 1, "fixture/vision", 5000]);
	assert.equal(await exists(h.store.renderCache(FILE, 1)), false, "the render is not kept once the page is made");
	assert.equal(await exists(join(run.cwd, "page.png")), true, "the original input image stays as evidence");
	assert.equal(await exists(join(run.cwd, "layout.md")), true, "the layout stays as evidence");
});

test("§191.6 closing while a batch of native lines is read leaves no unhandled rejection for the pages nobody awaits", async t => {
	// TR-F2 gather (2026-10-08): the in-process kernel closed while the service read pages 1-3 in one batch; the read was
	// cancelled and pages 2 and 3, cached for later, rejected with nobody awaiting them.
	const h = await harness(t, { pages: { 1: PAGE, 2: PAGE, 3: PAGE } });
	let reading;
	const started = new Promise(resolve => { reading = resolve; });
	h.runtime.sourceLines = (request, signal) => new Promise((_, reject) => {
		reading(request.pages);
		signal.addEventListener("abort", () => reject(new Error("Runtime operation was cancelled")), { once: true });
	});
	const unhandled = [];
	const listen = reason => unhandled.push(reason);
	process.on("unhandledRejection", listen);
	t.after(() => process.off("unhandledRejection", listen));
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2, 3] });
	assert.deepEqual(await started, [1, 2, 3], "one batch for the queued pages");
	await h.service.close();
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.deepEqual(unhandled.map(String), [], "no page's cached read rejects unhandled");
});

test("§191.3 lines the kept layout still leaves out are unplaced; no second child is started for them", async t => {
	const h = await harness(t, { layouts: () => "{L1-L2}\n\n{L4-L8}\n\n<!-- drop: L9 -->", submitted: () => 2 });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	assert.equal(h.runs.length, 1, "the repair happens inside the child (submit_layout), not in a second child");
	const { record: stored } = await h.store.read(FILE, 1);
	assert.deepEqual([stored.unplaced, stored.dropped, stored.attempts], [[3], [9], 1]);
	assert.ok(stored.text.endsWith("\n\nThe village sits at\n\n17"), "unplaced lines come after the placed ones, dropped lines last");
	assert.ok(transcriptPermutationHolds(stored.text, PAGE));
	const page = h.rows.find(row => row.event === "page");
	assert.deepEqual([page.outcome, page.attempts, page.submissions, page.unplaced], ["unplaced", 1, 2, 1]);
});

test("§191.3 a layout whole after a second submission is stored as repaired", async t => {
	const h = await harness(t, { layouts: () => "{L1-L8}\n\n<!-- drop: L9 -->", submitted: () => 2 });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	assert.equal(h.runs.length, 1);
	assert.deepEqual((await h.store.read(FILE, 1)).record.unplaced, []);
	const page = h.rows.find(row => row.event === "page");
	assert.deepEqual([page.outcome, page.submissions], ["repaired", 2]);
});

test("§191.3 the host assembles the kept layout itself: the stored exact layer holds every native line once", async t => {
	// A layout.md the tool never vetted (a stale or hand-placed file) is assembled from scratch; the exact layer still
	// holds every native line once, so the findings never replace the host's own assembly.
	const h = await harness(t, { layouts: () => "{L1}{L1}\n\nretyped words\n\n<!-- drop: L9 -->" });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	const { record: stored } = await h.store.read(FILE, 1);
	assert.ok(transcriptPermutationHolds(stored.text, PAGE));
	assert.deepEqual([stored.unplaced, stored.free_removed], [[2, 3, 4, 5, 6, 7, 8], 1]);
});

test("§191.4 pages are kept by the file's digest: another module id and another process make no child", async t => {
	const h = await harness(t);
	await h.service.ensure({ pdf: "modules/first/source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	const again = await h.service.ensure({ pdf: "modules/second/source.pdf", file_sha256: FILE, pages: [1] });
	assert.deepEqual([again.queued, again.reused.home], [[], [1]]);
	const later = await harness(t, { home: h.home, content: h.content });
	const reread = await later.service.ensure({ pdf: "campaigns/x/modules/third/source.pdf", file_sha256: FILE, pages: [1] });
	await later.service.idle();
	assert.deepEqual([reread.queued, reread.reused.home, later.runs.length, later.calls.length], [[], [1], 0, 0]);
	assert.deepEqual(later.rows, [{ lane: "transcript", event: "reused", file_sha256: FILE, pages: [1], source: "home" }]);
});

test("§191.4 a shipped seed is read through and nothing is written into home", async t => {
	const content = await scratch(t, "transcript-seed-");
	const seed = record(PAGE, assembleLayout("{L1-L9}", PAGE), 2);
	await mkdir(join(content, "source-transcripts", FILE), { recursive: true });
	await writeFile(join(content, "source-transcripts", FILE, "page-0002.json"), JSON.stringify(seed));
	const h = await harness(t, { content, pages: { 2: PAGE } });
	const result = await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [2] });
	await h.service.idle();
	assert.deepEqual([result.queued, result.reused.seed, h.runs.length], [[], [2], 0]);
	assert.deepEqual(h.rows, [{ lane: "transcript", event: "reused", file_sha256: FILE, pages: [2], source: "seed" }]);
	assert.equal(await exists(join(h.home, ".coc")), false, "nothing is copied into home");
});

test("§191.6 two concurrent ensures of one page make one child", async t => {
	let release;
	const held = new Promise(resolve => { release = resolve; });
	const h = await harness(t, { gate: () => held });
	const [first, second] = await Promise.all([
		h.service.ensure({ pdf: "a.pdf", file_sha256: FILE, pages: [1] }),
		h.service.ensure({ pdf: "b.pdf", file_sha256: FILE, pages: [1], priority: "foreground" })]);
	const third = await h.service.ensure({ pdf: "c.pdf", file_sha256: FILE, pages: [1] });
	release();
	await h.service.idle();
	assert.equal(h.runs.length, 1);
	assert.deepEqual([...first.queued, ...second.queued].length, 1);
	assert.deepEqual(third.skipped, [1]);
});

test("§191.6 foreground pages are served first among queued transcript work", async t => {
	let release;
	const held = new Promise(resolve => { release = resolve; });
	const pages = Object.fromEntries([1, 2, 3, 4].map(page => [page, PAGE]));
	const h = await harness(t, { pages, budget: { ...BUDGET, concurrency: 1 }, gate: request => request.cwd.endsWith("p0001-1") ? held : undefined });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2, 3] });
	await new Promise(resolve => setTimeout(resolve, 20));
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [4], priority: "foreground" });
	release();
	await h.service.idle();
	assert.deepEqual(h.runs.map(run => run.page), [1, 4, 2, 3]);
	const [firstExtraction] = h.calls.filter(([name]) => name === "sourceLines").map(([, , wanted]) => wanted);
	assert.deepEqual(firstExtraction.slice(0, 3), [1, 2, 3], "the queued pages' lines in one extraction");
});

test("§191.2 mode off is a no-op; a model without image input transcribes nothing", async t => {
	const off = await harness(t, { budget: { ...BUDGET, mode: "off" } });
	const result = await off.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2, 3] });
	await off.service.idle();
	assert.deepEqual([result.state, result.queued, off.runs.length, off.calls.length, off.rows.length], ["off", [], 0, 0, 0]);
	assert.equal(await exists(join(off.home, ".coc")), false);

	const blind = await harness(t, { model: { id: "fixture/text-only", vision: false, thinking: "low" } });
	await blind.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await blind.service.idle();
	assert.equal(blind.runs.length, 0);
	assert.equal(await blind.store.read(FILE, 1), undefined);
	assert.equal(blind.rows.find(row => row.event === "page").outcome, "no_vision");
	const again = await blind.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	assert.deepEqual(again.skipped, [1], "a failed page is not tried again in this session");
});

test("§191.3 a page with no text layer stores its image text and figure notes", async t => {
	const h = await harness(t, { pages: { 5: [] }, layouts: () => "<!-- image-text -->\nSTR 50 CON 60 SIZ 65\n<!-- /image-text -->\n\n> [figure] A creature drawn beside its numbers" });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [5] });
	await h.service.idle();
	assert.equal(h.runs.length, 1);
	assert.equal(await readFile(join(h.runs[0].cwd, "lines.txt"), "utf8"), "(this page has no text layer)\n");
	const { record: stored } = await h.store.read(FILE, 5);
	assert.deepEqual([stored.text, stored.image_text, stored.figures, stored.native.line_count],
		["", ["STR 50 CON 60 SIZ 65"], ["A creature drawn beside its numbers"], 0]);
	assert.match(stored.markdown, /<!-- image-text -->\nSTR 50 CON 60 SIZ 65\n<!-- \/image-text -->/);
	const page = h.rows.find(row => row.event === "page");
	assert.deepEqual([page.outcome, page.image_text_chars], ["stored", "STR 50 CON 60 SIZ 65".length]);
});

test("§191.4 a page another producer holds is left to it; a stale claim is taken", async t => {
	const h = await harness(t, { pages: { 1: PAGE, 2: PAGE } });
	await mkdir(h.store.dir(FILE), { recursive: true });
	await writeFile(join(h.store.dir(FILE), "page-0001.claim"), JSON.stringify({ pid: 1, at: new Date().toISOString() }));
	await writeFile(join(h.store.dir(FILE), "page-0002.claim"), JSON.stringify({ pid: 1, at: new Date(Date.now() - staleClaimMs(BUDGET) - 1000).toISOString() }));
	const result = await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2] });
	await h.service.idle();
	assert.deepEqual([result.skipped, result.queued, h.runs.map(run => run.page)], [[1], [2], [2]]);
	assert.ok(await h.store.read(FILE, 2));
	assert.equal(await h.store.claimedElsewhere(FILE, 2, staleClaimMs(BUDGET)), false, "the producer releases the SQL claim it took");
	assert.equal(await exists(join(h.store.dir(FILE), "page-0002.claim")), true, "original legacy evidence is retained");
});

const until = async (condition, ms = 10_000) => {
	const end = Date.now() + ms;
	while (!condition()) { if (Date.now() > end) throw new Error("condition not met in time"); await new Promise(resolve => setTimeout(resolve, 20)); }
};

test("§191.2 the brief names no path: the host decides where the layout goes", async t => {
	const h = await harness(t);
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	const [run] = h.runs;
	for (const name of [run.cwd, h.home, "layout.md", "lines.txt", "page.png"]) assert.equal(run.brief.includes(name), false, `${name} in: ${run.brief}`);
	assert.match(run.brief, /submit_layout/);
});

test("§191.3 a first child that leaves no layout gets one fresh child; with no repair budget the page fails", async t => {
	const h = await harness(t, { layouts: (_request, count) => count === 1 ? undefined : "{L1-L8}\n\n<!-- drop: L9 -->" });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await h.service.idle();
	assert.equal(h.runs.length, 2);
	assert.ok(h.runs[1].cwd.endsWith("p0001-2") && !h.runs[1].files.includes("layout.md"), "a fresh child, not handed the first one's work");
	const { record: stored } = await h.store.read(FILE, 1);
	assert.deepEqual([stored.unplaced, stored.attempts], [[], 2]);
	assert.equal(h.rows.find(row => row.event === "page").outcome, "repaired");
	const none = await harness(t, { layouts: () => undefined, budget: { ...BUDGET, repairAttempts: 0 } });
	await none.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await none.service.idle();
	assert.equal(none.runs.length, 1);
	assert.deepEqual(none.rows.filter(row => row.event === "page").map(row => [row.outcome, row.reason]), [["failed", "no_layout"]]);
});

test("§191.6 no child starts while the table waits on a foreground reading", async t => {
	let waiting = true, asked = 0, released = 0;
	const h = await harness(t, { yieldTo: () => { asked++; return waiting; } });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1] });
	await until(() => asked >= 1);
	assert.equal(h.runs.length, 0, "the queue held while yielding");
	released = Date.now(); waiting = false;
	await h.service.idle();
	assert.equal(h.runs.length, 1);
	assert.ok(h.runs[0].startedAt >= released, "the child started only after the wait ended");
});

test("§191.6 a child that met a provider rate limit starts the cooldown before the next child", async t => {
	const cooldownMs = 600;
	const h = await harness(t, { pages: { 1: PAGE, 2: PAGE }, budget: { ...BUDGET, concurrency: 1, cooldownMs },
		events: (_request, count) => count === 1
			? JSON.stringify({ type: "auto_retry_start", attempt: 1, delayMs: 2000, errorMessage: "flapcode API error (429): rate limit" }) + "\n"
			: JSON.stringify({ type: "agent_settled" }) + "\n" });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2] });
	await h.service.idle();
	assert.equal(h.runs.length, 2);
	assert.ok(h.runs[1].startedAt - h.runs[0].endedAt >= cooldownMs - 50, `gap ${h.runs[1].startedAt - h.runs[0].endedAt} ms`);
	assert.equal(h.rows.filter(row => row.event === "cooldown").length, 1);
});

test("§191.2 the budget is data with coded fallbacks", async t => {
	assert.deepEqual(await transcriptBudget(join(ROOT, "content")), { mode: "on", concurrency: 1, timeoutMs: 240_000, inputTokens: 96_000,
		outputTokens: 16_384, repairAttempts: 1, maxWindowPages: 120, cooldownMs: 60_000 });
	const empty = await scratch(t, "transcript-budget-");
	await mkdir(join(empty, "rulesets", "coc7"), { recursive: true });
	await writeFile(join(empty, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ transcript: { mode: "off", concurrency: 0 } }));
	assert.deepEqual(await transcriptBudget(empty), { ...TRANSCRIPT_FALLBACK, mode: "off" }, "a bad value falls back field by field");
});

// ---------------------------------------------------------------------------------------------------------------------
// §191.1 sourceLines on a real PDF

function textPdf(streams) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test("§191.1 sourceLines splits the native text of sourceText into its lines and binds them to its digest", async t => {
	const dir = await scratch(t, "transcript-lines-");
	const file = join(dir, "source.pdf");
	await writeFile(file, textPdf(["BT /F1 12 Tf 20 160 Td (Right column first) Tj -10 -40 Td (Left column) Tj ET", ""]));
	t.after(() => closeSourceDocuments());
	const native = await sourceText(file, { pages: [1, 2] }), lines = await sourceLines(file, { pages: [2, 1], expected_file_sha256: native.file_sha256 });
	assert.deepEqual([lines.file_sha256, lines.extraction_version, lines.page_count], [native.file_sha256, native.extraction_version, 2]);
	assert.deepEqual(lines.pages.map(row => [row.page, row.lines]), [[2, []], [1, ["Right column first", "Left column"]]]);
	assert.equal(lines.pages[1].native_sha256, native.snapshots[0].text_sha256);
	assert.equal(lines.pages[1].lines.join("\n"), native.snapshots[0].text);
	await assert.rejects(sourceLines(file, { pages: [3] }), /outside this PDF/);
	await assert.rejects(sourceLines(file, { pages: [1], expected_file_sha256: "0".repeat(64) }), /expected_file_sha256/);
});

test("§191.6 a page whose child ran out of time goes to the back of the queue, still in its class; a plain no-layout exit fails at once", async t => {
	const pages = { 1: PAGE, 2: PAGE, 3: PAGE };
	// Page 1's first run times out with no layout; page 3's child exits with none and no timeout.
	const h = await harness(t, { pages, budget: { ...BUDGET, concurrency: 1, repairAttempts: 0 },
		layouts: request => request.cwd.endsWith("p0001-1") || request.cwd.includes("p0003-") ? undefined : "{L1-L8}\n\n<!-- drop: L9 -->",
		timedOut: request => request.cwd.endsWith("p0001-1") });
	await h.service.ensure({ pdf: "source.pdf", file_sha256: FILE, pages: [1, 2, 3] });
	await h.service.idle();
	assert.deepEqual(h.runs.map(run => run.cwd.slice(-7)), ["p0001-1", "p0002-1", "p0003-1", "p0001-2"], "back of the queue, numbered on");
	const rows = h.rows.filter(row => row.event === "page");
	assert.deepEqual(rows.map(row => [row.page, row.outcome, row.reason]),
		[[1, "requeued", "timeout"], [2, "stored", undefined], [3, "failed", "no_layout"], [1, "stored", undefined]]);
});
