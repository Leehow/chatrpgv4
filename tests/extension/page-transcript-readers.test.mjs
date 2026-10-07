/**
 * Contract §191.7 (PT-03): the readers read page transcripts.
 *
 * A page with a stored transcript is read in it, every other page in its native text at once, and nothing waits for a
 * transcript. These cases travel the real entries over a real PDF and the real store (records made by the real assembly
 * and published by `TranscriptStore.put`, which refuses anything but a permutation of the page's native lines): the host
 * operation `sourcePageText` and the transcript-aware search through `createRuntime` and its source worker, the reading
 * service's landing text and read-ahead, the module extension's transcript queue, the Keeper prescreen's consultation
 * catalog and checkpoint (`preparePrescreenSources`), the window-places lane and the Jev source driver. The kernel is the
 * emitted one (`build/kernel/rpc.mjs`); decisions are fake ports, so no model is called.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeSourceDocuments, sourceInfo, sourceLines, sourceSearch, sourceText, sourceTextVersion } from "../../extensions/module/source.ts";
import { assembleLayout } from "../../extensions/module/page-transcript.ts";
import { TRANSCRIPT_RECORD_SCHEMA, TranscriptStore } from "../../extensions/module/transcript-store.ts";
import { layerRevision, readSourcePageText } from "../../extensions/module/source-page-text.ts";
import { ReadingService, windowPlacePages } from "../../extensions/module/reading-service.ts";
import moduleExtension from "../../extensions/module/index.ts";
import { createRuntime } from "../../runtime/host.ts";
import { firstLines, runWindowPlaces } from "../../runtime/jev/window-places.ts";
import { createSourceReaderDriver } from "../../runtime/jev/source-reader-driver.ts";
import { checkPrescreenSourceCheckpoint, preparePrescreenSources } from "../../runtime/jev/prescreen-source-provider.ts";
import { waitFor } from "./wait.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTENT = join(ROOT, "content");
const sha = value => createHash("sha256").update(value).digest("hex");
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const until = (check, label) => waitFor(() => check(), { label });

/** A PDF whose pages carry the given native lines (PDF.js ends each with a line break); an empty list is a page without text. */
function linesPdf(pages) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [i, lines] of pages.entries()) {
		const stream = lines.length ? `BT /F1 8 Tf 10 TL 10 780 Td ${lines.map(line => `(${line}) Tj T*`).join(" ")} ET` : "";
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
			`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	}
	let text = "%PDF-1.7\n";
	const offsets = [];
	for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

/**
 * Four pages. Page 2 is printed in drawing order -- the right column's line first -- and its transcript puts the left column
 * first and reads a plan's label off the pixels; page 4 has no text layer and its transcript holds only image text.
 */
const BOOK = [
	["Harbor notes", "The dock smells of tar."],
	["Right column first line", "Left column begins here", "and continues below."],
	["Below the tower", "a cellar floods at high tide."],
	[],
];
const LAYOUTS = {
	2: "## {L2-L3}\n\n{L1}\n\n<!-- image-text -->\nTOWER PLAN\n<!-- /image-text -->",
	4: "<!-- image-text -->\nCELLAR MAP KEY\n<!-- /image-text -->\n\n> [figure] A cellar plan",
	1: "# {L1}\n\n{L2}",
	3: "{L1-L2}",
};

/** A transcript made by the real assembly over the page's own native lines and published through the real store. */
async function transcribe(store, pdf, page, { layout = LAYOUTS[page], extractionVersion } = {}) {
	const lines = await sourceLines(pdf, { pages: [page] }), row = lines.pages[0], assembly = assembleLayout(layout, row.lines);
	const record = { schema: TRANSCRIPT_RECORD_SCHEMA, transcript_version: "transcript-v1", file_sha256: lines.file_sha256, page, pdf_label: row.pdf_label,
		native: { extraction_version: extractionVersion ?? lines.extraction_version, text_sha256: row.native_sha256, line_count: row.lines.length },
		text: assembly.text, text_sha256: sha(assembly.text), markdown: assembly.markdown, image_text: assembly.image_text, figures: assembly.figures,
		dropped: assembly.dropped, unplaced: assembly.unplaced, free_removed: assembly.free_removed, attempts: 1, model: "fixture/vision", thinking: "low",
		at: new Date().toISOString() };
	assert.equal(await store.put(record, row.lines), "stored");
	return record;
}

async function book(t, prefix, pages = BOOK) {
	const home = await mkdtemp(join(tmpdir(), prefix));
	const pdf = join(home, "book.pdf");
	await writeFile(pdf, linesPdf(pages));
	const bytes = await readFile(pdf);
	t.after(async () => { await closeSourceDocuments(); await rm(home, { recursive: true, force: true }); });
	return { home, pdf, sha: sha(bytes), store: new TranscriptStore({ home, contentRoot: CONTENT, extractionVersion: sourceTextVersion }) };
}
async function hosted(t, prefix, pages) {
	const b = await book(t, prefix, pages);
	const runtime = createRuntime({ owner: "preparation", home: b.home }, { resourceRoot: ROOT, nodeExecutable: process.execPath });
	t.after(() => runtime.close());
	return { ...b, runtime };
}
const nativeOf = async (pdf, page) => (await sourceText(pdf, { pages: [page] })).snapshots[0].text;

// ---------------------------------------------------------------------------------------------------------------------
// The host operation and the search

test("§191.7 sourcePageText: preferred reads a stored transcript, every other page and the native layer read native text", async t => {
	const h = await hosted(t, "page-text-host-");
	const record = await transcribe(h.store, h.pdf, 2);
	const preferred = await h.runtime.sourcePageText({ pdf: h.pdf, pages: [2, 1], expected_file_sha256: h.sha });
	assert.deepEqual(preferred.pages.map(row => [row.page, row.layer, row.extraction_version]), [[2, "transcript", "transcript-v1"], [1, "native", sourceTextVersion]]);
	const [transcript, native] = preferred.pages;
	assert.equal(transcript.text, record.text, "the exact layer");
	assert.equal(transcript.text, "Left column begins here\nand continues below.\n\nRight column first line", "in the reading order, with every native line");
	assert.equal(transcript.markdown, record.markdown);
	assert.match(transcript.markdown, /^## Left column begins here and continues below\./);
	assert.deepEqual(transcript.image_text, ["TOWER PLAN"]);
	assert.equal(transcript.revision, layerRevision("transcript-v1", h.sha, 2, record.text_sha256), "a revision over the transcript version");
	assert.equal(native.text, await nativeOf(h.pdf, 1));
	assert.equal(native.markdown, undefined);
	assert.deepEqual([preferred.file_sha256, preferred.page_count, preferred.native_extraction_version], [h.sha, 4, sourceTextVersion]);

	const layerNative = await h.runtime.sourcePageText({ pdf: h.pdf, pages: [2], expected_file_sha256: h.sha, layer: "native" });
	assert.deepEqual(layerNative.pages.map(row => [row.layer, row.text]), [["native", await nativeOf(h.pdf, 2)]], "the native layer ignores the store");
	const digested = await h.runtime.sourcePageText({ pdf: h.pdf, pages: [2] });
	assert.deepEqual([digested.file_sha256, digested.pages[0].layer, digested.page_count], [h.sha, "transcript", undefined],
		"without a digest the host names the bytes itself; a page with a record does not open the PDF");
	await transcribe(h.store, h.pdf, 3, { extractionVersion: "pdfjs-0.0.1:native-text-v1" });
	assert.equal((await h.runtime.sourcePageText({ pdf: h.pdf, pages: [3], expected_file_sha256: h.sha })).pages[0].layer, "native",
		"a record made over another native extraction is not read");
	await assert.rejects(h.runtime.sourcePageText({ pdf: h.pdf, pages: [2], layer: "markdown" }), /layer is preferred or native/);
});

test("§191.7 search: a transcribed page is searched in its exact layer and its image text, labelled; through the source worker too", async t => {
	const h = await hosted(t, "page-text-search-");
	await transcribe(h.store, h.pdf, 2);
	await transcribe(h.store, h.pdf, 4);
	const image = await sourceSearch(h.pdf, { query: "tower plan" }, undefined, h.store);
	assert.deepEqual(image.matches.map(row => [row.page, row.layer, row.image_text]), [[2, "transcript", true]], "a phrase only the image text holds");
	assert.match(image.matches[0].snippet, /TOWER PLAN/);
	assert.deepEqual(image.text_availability.transcript_pages, [2, 4]);
	assert.deepEqual(image.text_availability.pages_with_text, [1, 2, 3, 4], "a page without a text layer has its image text searched");
	assert.match(image.guidance, /image_text/);
	const exact = await sourceSearch(h.pdf, { query: "Left column begins here and continues" }, undefined, h.store);
	assert.deepEqual(exact.matches.map(row => [row.page, row.layer, row.image_text]), [[2, "transcript", undefined]], "the exact layer is searched on a transcribed page");
	const native = await sourceSearch(h.pdf, { query: "cellar floods" }, undefined, h.store);
	assert.deepEqual(native.matches.map(row => [row.page, row.layer]), [[3, "native"]]);
	assert.deepEqual((await sourceSearch(h.pdf, { query: "cellar map key" })).matches, [], "without the store the image text is not there");
	const worker = await h.runtime.sourceSearch({ pdf: h.pdf, query: "cellar map key" });
	assert.deepEqual(worker.matches.map(row => [row.page, row.layer, row.image_text]), [[4, "transcript", true]], "the source worker reads the owner's store");
});

// ---------------------------------------------------------------------------------------------------------------------
// The reading service

test("§191.7 landing text: the transcript's reading version where one exists, native text elsewhere, with no wait and a foreground ensure for the rest", async t => {
	const h = await hosted(t, "page-text-landing-");
	const record = await transcribe(h.store, h.pdf, 2);
	const client = h.runtime.openKernel();
	const { module_id } = await client.call("module.source.bind", { source: { path: h.pdf, page_count: BOOK.length, file_sha256: h.sha } });
	const snapshot = await client.call("module.source.snapshot", { module_id });
	const ensures = [];
	const service = new ReadingService({ home: h.home, runtime: h.runtime, call: (method, params) => client.call(method, params),
		model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {},
		// A queue that never finishes: the landing must not wait for it.
		transcripts: { ensure(request) { ensures.push(request); return new Promise(() => {}); } } });
	t.after(() => service.close());
	const pages = await service.sourcePages(module_id, [2, 3]);
	assert.deepEqual(pages.map(page => [page.page, page.layer]), [[2, "transcript"], [3, "native"]]);
	assert.equal(pages[0].text, record.markdown, "the landing reads the reading version");
	assert.equal(pages[1].text, await nativeOf(h.pdf, 3));
	await until(() => ensures.length === 1, "the foreground ensure");
	assert.deepEqual(ensures, [{ pdf: snapshot.pdf, file_sha256: h.sha, pages: [3], priority: "foreground" }], "only the page without a transcript is queued, first");
	const cast = await service.sourcePages(module_id, [1, 3], { transcribe: false });
	assert.deepEqual(cast.map(page => page.layer), ["native", "native"]);
	await tick();
	assert.equal(ensures.length, 1, "the cast reads the whole book and queues none of it");
});

test("§191.6 read-ahead: every read-ahead queues the window's transcript pages in priority order; one window row per change", async t => {
	const directory = await mkdtemp(join(tmpdir(), "page-text-ahead-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const rows = [], ensures = [], town = { mode: "chapters", first: 41, last: 48, chapters: ["The town", "The mine"] };
	const windows = [{ ...town, transcript: [[41, 44], [91, 92]] }, { ...town, transcript: [[41, 44], [91, 92]] }, { ...town, transcript: [[45, 48]] }];
	let pass = 0;
	const reading = new ReadingService({ home: directory, model: () => ({}), progress() {}, record: row => rows.push(row), campaign: () => "table",
		runtime: { sourceInfo: async () => { throw new Error("sourceInfo was not expected"); } },
		transcripts: { async ensure(request) { ensures.push(request); return { state: "queued", queued: request.pages.slice(0, 2), reused: { home: [], seed: [] }, skipped: [] }; } },
		async call(method) {
			if (method === "module.read.ahead") return { queued: [], window: windows[pass++] };
			if (method === "module.source.snapshot") return { pdf: "/books/one.pdf", file_sha256: "a".repeat(64) };
			throw new Error(`unexpected ${method}`);
		} });
	t.after(() => reading.close());
	for (let index = 0; index < windows.length; index++) {
		await reading["readAhead"]({ module_id: "book-1" }, "table");
		await until(() => ensures.length === index + 1, `ensure ${index + 1}`);
		await tick();
	}
	assert.deepEqual(ensures.map(row => [row.pages, row.priority, row.file_sha256, row.pdf]), [
		[[41, 42, 43, 44, 91, 92], "background", "a".repeat(64), "/books/one.pdf"],
		[[41, 42, 43, 44, 91, 92], "background", "a".repeat(64), "/books/one.pdf"],
		[[45, 46, 47, 48], "background", "a".repeat(64), "/books/one.pdf"]]);
	assert.deepEqual(rows.filter(row => row.lane === "transcript").map(({ event, module_id, campaign, file_sha256, ranges, queued }) => ({ event, module_id, campaign, file_sha256, ranges, queued })), [
		{ event: "window", module_id: "book-1", campaign: "table", file_sha256: "a".repeat(64), ranges: [[41, 44], [91, 92]], queued: [41, 42] },
		{ event: "window", module_id: "book-1", campaign: "table", file_sha256: "a".repeat(64), ranges: [[45, 48]], queued: [45, 46] }]);
	assert.equal(rows.filter(row => row.event === "read_window").length, 1, "the reading window itself did not change");
});

test("§191.6 the module extension hands pages another reader wanted to the transcript queue, which makes them", async t => {
	const home = await mkdtemp(join(tmpdir(), "page-text-wanted-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const events = new EventEmitter(), hooks = new Map(), runs = [];
	moduleExtension({ events, on(name, fn) { hooks.set(name, fn); }, appendEntry() {}, getThinkingLevel() { return "low"; } });
	const ctx = { model: { provider: "fixture", id: "reader" }, modelRegistry: { find() { return { input: ["text", "image"], contextWindow: 200000 }; } } };
	const runtime = { home, contentRoot: CONTENT, readerModel: "fixture/reader",
		async sourceLines({ pages, expected_file_sha256 }) {
			return { file_sha256: expected_file_sha256, extraction_version: sourceTextVersion, page_count: 9,
				pages: pages.map(page => ({ page, pdf_label: null, native_sha256: sha("Only line"), lines: ["Only line"] })), errors: [] };
		},
		async sourcePage({ cache, page }) { await mkdir(cache, { recursive: true }); const path = join(cache, `p${page}.png`); await writeFile(path, "png"); return { path, page }; },
		async runTask(task) { runs.push(task.request); await writeFile(join(task.request.cwd, "layout.md"), "{L1}"); return { ok: true, code: 0, timedOut: false, ms: 1, stderr: "", command: [] }; } };
	events.emit("coc:kernel-bridge", { campaign: "camp", runtime, async call() { return {}; } });
	await hooks.get("session_start")({}, ctx);
	events.emit("coc:transcript-wanted", { pdf: "modules/book/source.pdf", file_sha256: "b".repeat(64), pages: [7] });
	await until(() => runs.length === 1, "the layout child");
	assert.equal(runs[0].cwd, join(home, ".coc", "source-transcripts", "b".repeat(64), "work", "p0007-1"));
	const store = new TranscriptStore({ home, contentRoot: CONTENT, extractionVersion: sourceTextVersion });
	const made = await waitFor(() => store.read("b".repeat(64), 7), { label: "the wanted page's record" });
	assert.equal(made.record.text, "Only line", "the wanted page was made");
	await hooks.get("session_shutdown")();
});

// ---------------------------------------------------------------------------------------------------------------------
// The Keeper prescreen's consultation units

async function prescreen(t, prefix) {
	const h = await hosted(t, prefix);
	const client = h.runtime.openKernel(), call = (method, params = {}) => client.call(method, params);
	const { module_id } = await call("module.source.bind", { module_id: "source-book", source: { path: h.pdf, file_sha256: h.sha, page_count: BOOK.length } });
	const wants = [];
	// The host's own §191.7 reader over the real store, and the native extraction in process.
	const source = { home: h.home,
		sourceInfo: ({ pdf }) => sourceInfo(pdf),
		sourceSearch: ({ pdf, ...options }, signal) => sourceSearch(pdf, options, signal, h.store),
		sourceText: ({ pdf, ...options }, signal) => sourceText(pdf, options, signal),
		sourcePageText: ({ pdf, ...options }, signal) => readSourcePageText({ pdf, options, store: h.store, nativeText: ({ pdf: file, ...native }, cancel) => sourceText(file, native, cancel),
			digest: async () => h.sha }, signal),
		wantTranscripts: request => wants.push(request) };
	const scope = { owner: "campaign:c1", campaign: "c1", worldline: "main", loop: 0, audience: "keeper" };
	const run = async query => preparePrescreenSources({ call, campaign: "c1", moduleId: module_id, scope, query, capsule: {}, source,
		signal: new AbortController().signal, budget: { deadlineAt: Date.now() + 10000, candidateBytes: 64 * 1024, materialBytes: 32 * 1024, maxNativePages: 4 },
		snapshot: await call("module.source.materials.snapshot", { campaign: "c1", module_id, answer_limit: 8 }) });
	return { ...h, call, module_id, source, scope, wants, run };
}
const resourceOf = candidate => candidate.refs[0].resource;

test("§191.7 consultation units: transcribed pages are units of their exact layer with layer-tagged resources; search counts its layers", async t => {
	const p = await prescreen(t, "page-text-prescreen-");
	const record = await transcribe(p.store, p.pdf, 2);
	const result = await p.run("tower plan");
	const units = result.candidates.filter(row => row.authority === "native_text");
	const second = units.filter(row => row.data.page === 2), first = units.filter(row => row.data.page === 1);
	assert.ok(second.length && second.every(row => resourceOf(row) === `pdf:${p.sha}:page:2:transcript:transcript-v1`), JSON.stringify(second.map(resourceOf)));
	assert.ok(second.every(row => record.text.includes(row.body)), "the exact layer, never the reading version");
	assert.ok(second.some(row => row.body.startsWith("Left column begins here")), "in the transcript's order");
	assert.ok(first.length && first.every(row => resourceOf(row) === `pdf:${p.sha}:page:1:native:${sourceTextVersion}`), "a native page stays native");
	assert.deepEqual(result.coverage.native.transcript_pages, [2]);
	assert.deepEqual(result.coverage.native.search_layers, { transcript: 1, native: 0, image_text: 1 });
	assert.deepEqual(result.checkpoint.extraction.layer, "native", "the check re-reads a native page when there is one");
	assert.deepEqual(result.readSet.filter(row => row.kind === "extraction").map(row => [row.resource, row.revision]),
		[[`pdf:${p.sha}:native`, sourceTextVersion], [`pdf:${p.sha}:transcript`, "transcript-v1"]]);
	assert.deepEqual(await result.check(), { status: "current", readSet: result.readSet });
});

test("§191.7 a checkpoint names its layer: taken on the transcript layer it stays current; a page that gains a transcript keeps an earlier one", async t => {
	const p = await prescreen(t, "page-text-checkpoint-");
	const earlier = await p.run("harbor");
	assert.deepEqual(earlier.checkpoint.extraction, { version: sourceTextVersion, page: earlier.checkpoint.extraction.page, layer: "native" });
	for (const page of [1, 2, 3, 4]) await transcribe(p.store, p.pdf, page);
	const later = await p.run("harbor");
	assert.deepEqual(later.coverage.native.transcript_pages, [1, 2, 3, 4]);
	assert.equal(later.checkpoint.extraction.layer, "transcript");
	assert.equal(later.checkpoint.extraction.version, "transcript-v1");
	const check = checkpoint => checkPrescreenSourceCheckpoint({ call: p.call, source: p.source, scope: p.scope, signal: new AbortController().signal,
		deadlineAt: Date.now() + 10000, checkpoint: structuredClone(checkpoint) });
	assert.deepEqual(await check(later.checkpoint), { status: "current", readSet: later.readSet }, "re-read in the transcript layer");
	assert.deepEqual(await check(earlier.checkpoint), { status: "current", readSet: earlier.readSet }, "every page gained a transcript; the earlier checkpoint re-reads its native page");
});

test("§191.7 a qualified consultation re-reads each selected part in its own layer; its native pages go to the front of the transcript queue", async t => {
	const p = await prescreen(t, "page-text-qualify-");
	await transcribe(p.store, p.pdf, 2);
	const result = await p.run("Where does the left column begin?");
	const transcript = result.candidates.find(row => row.authority === "native_text" && row.data.page === 2);
	const native = result.candidates.find(row => row.authority === "native_text" && row.data.page === 3);
	assert.ok(transcript && native);
	const decide = async ({ key, batch }) => ({ batchId: key, status: "complete", issues: [], coverage: { required: batch.questions.map(row => row.key),
		answered: batch.questions.map(row => row.key), unknown: [] }, answers: Object.fromEntries(batch.questions.map(question => [question.key, { status: "answered",
			type: "choice", choice: question.key === "route" ? "plaintext" : question.key === "coverage" ? "sufficient" : /^p[23]_/.test(question.key) ? "evidence" : "irrelevant" }])) });
	const qualified = await result.qualifyNative([transcript.key, native.key], decide);
	assert.equal(qualified.status, "qualified", JSON.stringify(qualified));
	assert.deepEqual([...new Set(qualified.candidate.refs.map(ref => ref.resource))].sort(),
		[`pdf:${p.sha}:page:2:transcript:transcript-v1`, `pdf:${p.sha}:page:3:native:${sourceTextVersion}`].sort());
	assert.match(qualified.candidate.body, /Left column begins here\nand continues below\./, "the transcript part is the exact layer, re-read");
	assert.deepEqual(p.wants.map(row => row.pages), [[3]], "the selected native page is wanted; the transcribed one is not");
});

// ---------------------------------------------------------------------------------------------------------------------
// Window places and the Jev source driver

test("§191.7 window places: the place question reads the transcript's first lines; the minted excerpt stays native", async t => {
	const h = await book(t, "page-text-places-");
	const record = await transcribe(h.store, h.pdf, 2);
	const native = await nativeOf(h.pdf, 2);
	const runtime = {
		sourcePageText: ({ pdf, ...options }, signal) => readSourcePageText({ pdf, options, store: h.store, nativeText: ({ pdf: file, ...rest }, cancel) => sourceText(file, rest, cancel),
			digest: async () => h.sha }, signal),
		sourceText: ({ pdf, ...options }, signal) => sourceText(pdf, options, signal) };
	const read = await windowPlacePages(runtime, h.pdf, h.sha, [2, 3]);
	assert.deepEqual(read.map(row => [row.page, row.text, row.reading]), [[2, native, record.markdown], [3, await nativeOf(h.pdf, 3), undefined]],
		"native text for the excerpt, and the reading version only where a transcript exists");

	const states = [], materialized = [];
	const rows = await runWindowPlaces({ campaign: "c1", moduleId: "book", window: { mode: "chapters", first: 1, last: 4 },
		budget: { mode: "on", placeMin: 0.8, timeoutMs: 5000, maxEntries: 8 },
		async call(method, params) {
			if (method === "module.source.snapshot") return { pdf: h.pdf, file_sha256: h.sha, page_count: 4 };
			if (method === "module.reference.status") return { cited_places: [] };
			if (method === "module.reference.materialize") { materialized.push(JSON.parse(await readFile(join(params.work_dir, "source-reference.json"), "utf8"))); return { state: "ready", scene: "scene-x" }; }
			throw new Error(`unexpected ${method}`);
		},
		bookmarks: async () => ({ file_sha256: h.sha, bookmarks: [{ name: "Left column begins here", page: 2, children: [] }] }),
		pages: (pdf, sourceSha, pages) => windowPlacePages(runtime, pdf, sourceSha, pages),
		decision: { async decide(batch) { states.push(batch.state); return { batchId: batch.id, status: "complete", issues: [], coverage: { required: [], answered: [], unknown: [] },
			answers: Object.fromEntries(batch.questions.map(question => [question.key, { status: "answered", type: "noul", noul: 0.95 }])) }; } },
		record() {}, extractionVersion: sourceTextVersion });
	assert.deepEqual(rows.map(row => row.outcome), ["minted"]);
	assert.equal(states[0].book_headings.e0.text_there, firstLines(record.markdown, "Left column begins here"), "the question reads the reading version");
	assert.match(states[0].book_headings.e0.text_there, /Left column begins here and continues below\./);
	assert.equal(materialized[0].excerpts[0].text, native.slice(materialized[0].excerpts[0].start, materialized[0].excerpts[0].end), "the excerpt is the page's own native bytes");
});

/** Sixty pages; page 50 is the need's lead and page 12 the entity's accepted page (the need read of §187.7). */
const DRIVER_PAGES = Array.from({ length: 60 }, (_, index) => [`Page heading ${index + 1}`, `Body of page ${index + 1}.`]);
DRIVER_PAGES[49] = ["Right sidebar note", "Appendix A: later profiles", "Lena STR 60 CON 55 DEX 70"];
DRIVER_PAGES[11] = ["Harbor office", "Lena keeps the ledgers at the dock.", "Second paragraph."];
const NEED = "Any later appendix combat profile for Lena if printed separately";

async function driverRun(t, { cwd, pdf, sha: fileSha, cache, env }) {
	await writeFile(join(cwd, "task.json"), JSON.stringify({ purpose: "detail", module_id: "book", focus: "lena", question: NEED, pages: [40], source: { page_count: 60 },
		known_nodes: [{ node_id: "npc-lena", node_kind: "npc", name: "Lena", summary: "A harbor clerk.", source_refs: [{ page: 12 }, { page: 41 }], ready: true }], known_claims: [],
		source_need: { key: "need-key", kind: "deferred", node_id: "npc-lena", focus: "lena", question: NEED, reason: "Not printed here.", trigger: "If a fight starts.",
			source_refs: [{ page: 12 }], accepted_pages: [12], material_digest: "d".repeat(64), unread_units: [] } }));
	const batches = [];
	const port = { async decide(batch) {
		batches.push(batch);
		const answers = Object.fromEntries(batch.questions.map(question => {
			if (batch.family === "source-need-answered") return [question.key, { status: "answered", type: "noul", noul: 0.1 }];
			const lead = /^p50_source_need$/.test(question.key) ? 0.9 : 0.05;
			return [question.key, question.type === "noul" ? { status: "answered", type: "noul", noul: lead }
				: { status: "answered", type: "choice", choice: "none_of_the_above", confidence: 0.9, probabilities: { none_of_the_above: 1 } }];
		}));
		return { batchId: batch.id, status: "complete", answers, coverage: { required: [], answered: Object.keys(answers), unknown: [] }, issues: [], usage: { inputTokens: 1, outputTokens: 0 } };
	} };
	const driver = await createSourceReaderDriver({ cwd, env, source: { pdf, cache, file_sha256: fileSha }, adapter: port });
	const { policy, ports } = await driver.prepare({ runId: "transcript-driver", inputRevision: "v1", rawInput: "Read the source", session: {} });
	const signal = AbortSignal.timeout(30000);
	let state = policy.initial({});
	for (let steps = 0; steps < 12; steps++) {
		const next = policy.next({ policyState: state, pendingProposals: [], steps });
		if (next.kind === "operate" && next.proposals[0].operation === "source.project") {
			await ports.operations.execute(next.proposals[0], { signal });
			const [message] = ports.projection.project();
			const trace = (await readFile(join(cwd, "source-driver.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
			return { navigation: JSON.parse(message.content[0].text), batches, trace };
		}
		if (next.kind === "finish" || next.kind === "infer") throw new Error("the need read did not reach projection: " + next.reason);
		if (next.kind === "decide") { const outcome = await ports.decision.decide({ question: next.question, signal });
			state = policy.reduce(state, { kind: "decide", status: outcome.status, artifact: outcome.artifact }, {}); continue; }
		const outcome = await ports.operations.execute(next.proposals[0], { signal });
		state = policy.reduce(state, { kind: "operate", origin: "policy", status: outcome.status, outcomes: [outcome] }, {});
	}
	throw new Error("the source policy did not settle");
}
const leadState = (batches, page) => batches.filter(batch => batch.family === "source-page-lead").flatMap(batch => batch.state.pages).find(row => row.page === page);

test("§191.7 the Jev driver's page leads, need text and navigation read transcripts; its caches never serve stale native text once a page has one", async t => {
	const root = await mkdtemp(join(tmpdir(), "page-text-driver-"));
	t.after(async () => { await closeSourceDocuments(); await rm(root, { recursive: true, force: true }); });
	const pdf = join(root, "source.pdf"), cache = join(root, "module", "cache", "pages");
	await writeFile(pdf, linesPdf(DRIVER_PAGES));
	const fileSha = sha(await readFile(pdf));
	const store = new TranscriptStore({ home: root, contentRoot: CONTENT, extractionVersion: sourceTextVersion });
	const env = { PI_COC_HOME: root, PI_COC_CONTENT_ROOT: CONTENT };
	const run = async name => { const cwd = join(root, name); await mkdir(cwd, { recursive: true }); return driverRun(t, { cwd, pdf, sha: fileSha, cache, env }); };

	const before = await run("first");
	assert.equal(leadState(before.batches, 50).text, await nativeOf(pdf, 50), "no transcript yet: native text");
	assert.equal(before.navigation.pages.find(row => row.page === 50).layer, undefined);

	const lead = await transcribe(store, pdf, 50, { layout: "## {L2}\n\n{L3}\n\n> {L1}" });
	const accepted = await transcribe(store, pdf, 12, { layout: "# {L1}\n\n{L2}\n\n{L3}" });
	const after = await run("second");
	const navigationCatalog = after.trace.find(row => row.kind === "source_catalog");
	assert.deepEqual([navigationCatalog.reused, navigationCatalog.transcript_pages], [true, 2], "the native cache is reused and the transcripts are laid over it");
	assert.equal(after.trace.find(row => row.kind === "source_located").cached ?? false, false, "the located leads are ranked again over the new transcripts");
	assert.equal(leadState(after.batches, 50).text, lead.markdown, "page-lead decisions read the reading version");
	assert.equal(leadState(after.batches, 12).text, accepted.markdown);
	const navigation = Object.fromEntries(after.navigation.pages.map(row => [row.page, row]));
	assert.deepEqual([navigation[50].text, navigation[50].lead, navigation[50].layer], [lead.markdown, true, "transcript"], "the need's lead page is projected in its reading version");
	assert.deepEqual([navigation[12].text, navigation[12].lead], ["# Harbor office", false], "another candidate's title line is the transcript's");
	const nativeCache = JSON.parse(await readFile(join(dirname(cache), "native-navigation-v2.json"), "utf8"));
	assert.equal(nativeCache.pages.find(row => row.page === 50).text, await nativeOf(pdf, 50), "the native cache stays native");
	assert.equal(nativeCache.pages.find(row => row.page === 50).reading, undefined);
	const again = await run("third");
	assert.equal(again.trace.find(row => row.kind === "source_located").cached, true, "with the same transcribed pages the located leads are reused");
	assert.equal(Object.fromEntries(again.navigation.pages.map(row => [row.page, row]))[50].text, lead.markdown);
	assert.deepEqual((await readdir(join(root, ".coc", "source-transcripts", fileSha))).filter(name => name.endsWith(".claim")), [], "the driver only reads the store");
});

test("§191.6 a need read's located pages go to the front of the transcript queue once its receipt names them", async t => {
	const home = await mkdtemp(join(tmpdir(), "page-text-need-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cwd = join(home, "work", "read-9", "attempt-1"), fileSha = "e".repeat(64), ensures = [];
	await mkdir(cwd, { recursive: true });
	const receiptOf = (digest, disposition) => ({ version: 1, run_id: "run-1", task_sha256: digest, source_sha256: fileSha, key: "need-key", disposition,
		material_digest: "d".repeat(64), evidence: { need_leads: [{ page: 3, score: 0.9 }], accepted_pages: [1], candidates: [3, 1] } });
	const run = async disposition => {
		ensures.length = 0;
		const runtime = { contentRoot: CONTENT,
			async runTask({ request }) {
				const bytes = await readFile(join(request.cwd, "task.json"));
				await writeFile(join(request.cwd, "need-disposition.json"), JSON.stringify(receiptOf(sha(bytes), disposition)));
				return { ok: true, code: 0, timedOut: false, ms: 3, stderr: "", command: [process.execPath, join(ROOT, "runtime", "pi-source-reader.mjs")] };
			},
			async check() { return { ok: true }; }, async sourceInfo() { throw new Error("not a guidance job"); } };
		const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }), progress() {}, record() {},
			transcripts: { ensure(request) { ensures.push(request); return new Promise(() => {}); } },
			async call(_method, params) { return params.outcome === "settled" ? { state: "settled" } : { replayed: true }; } });
		t.after(() => service.close());
		const job = { job_id: "read-9", module_id: "book", purpose: "detail", focus: "lena", question: "Any later profile?", foreground: false, lease: "lease-9",
			work_dir: cwd, pages: [], source: { path: join(home, "source.pdf"), page_count: 4, file_sha256: fileSha }, index: [], known_nodes: [], known_claims: [],
			vocabulary: {}, coverage_domains: [], source_need: { key: "need-key", kind: "deferred", node_id: "npc-lena", focus: "lena", question: "Any later profile?",
				reason: "r", trigger: "t", source_refs: [{ page: 3 }], accepted_pages: [1], material_digest: "d".repeat(64), unread_units: [] } };
		await service.runJob(job, new AbortController().signal, undefined);
		await tick();
		return [...ensures];
	};
	const read = await run("read");
	assert.ok(read.length >= 1, "the need read's pages were handed to the queue");
	assert.ok(read.every(row => JSON.stringify(row) === JSON.stringify({ pdf: join(home, "source.pdf"), file_sha256: fileSha, pages: [3, 1], priority: "foreground" })),
		JSON.stringify(read));
	assert.deepEqual(await run("unlocated"), [], "a need settled without reading wants no page");
});
