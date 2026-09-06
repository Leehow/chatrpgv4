/**
 * The PDF ingest job (contract §20.2): classify, extract, OCR the pages that need it, pack, bind,
 * then the unattended build of §14.5.
 *
 * The seam is the real one. The job runs inside the module extension, started by the same bus
 * request a front end would send (contract §20.4), and talks to three replaceable adapters
 * (`PI_COC_EXTRACT`, `PI_COC_OCR_CMD`, `PI_COC_BUNDLE_CMD`) which are pointed at the fixtures beside
 * this file — the same trick as `PI_COC_KERNEL_CMD` and `PI_COC_READER_CMD`. No PDF is committed to
 * this repository and nothing here parses one: what the fake extractor answers is what `FAKE_PDF` says.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { execPath } from "node:process";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { FAKE_BUNDLE, FAKE_EXTRACT, FAKE_OCR, openTable, waitFor } from "./harness.mjs";

const MODULE_ID = "amaranthine-desire";
/** A credential that must never show up in an argument list, a log line or an artefact. */
const TOKEN = "secret-token-do-not-log-4f21";

function bookBytes() {
	return `%PDF-1.4\nfake book bytes for ${MODULE_ID}\n`;
}

function shaOf(text) {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * A table with the three adapters pointed at the fixtures, a fake book on a scratch directory of its
 * own, and one log per adapter. The logs go through the harness's environment, which is what the
 * extension hands its child processes.
 */
async function openIngest(t, { pdf = {}, env = {}, sections = [{ id: "front", title: "front matter", priority: 100 }] } = {}) {
	const scratch = mkdtempSync(join(tmpdir(), "pi-coc-book-"));
	t.after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
	const book = join(scratch, "book.pdf");
	writeFileSync(book, bookBytes(), "utf8");
	const logs = {
		extract: join(scratch, "extract-runs.jsonl"),
		ocr: join(scratch, "ocr-runs.jsonl"),
		bundle: join(scratch, "bundle-runs.jsonl"),
	};
	const table = await openTable({
		mode: "setup",
		campaign: null,
		responses: [fauxAssistantMessage("reading.")],
		env: {
			PI_COC_EXTRACT: JSON.stringify([execPath, FAKE_EXTRACT]),
			PI_COC_OCR_CMD: JSON.stringify([execPath, FAKE_OCR]),
			PI_COC_BUNDLE_CMD: JSON.stringify([execPath, FAKE_BUNDLE]),
			BAIDUOCR_TOKEN: TOKEN,
			FAKE_EXTRACT_LOG: logs.extract,
			FAKE_OCR_LOG: logs.ocr,
			FAKE_BUNDLE_LOG: logs.bundle,
			FAKE_PDF: JSON.stringify({ page_count: 4, pages_needing_ocr: [0, 3], pdf_type: "Mixed", ...pdf }),
			FAKE_KERNEL_MODULE: JSON.stringify({ module_id: MODULE_ID, sections, opening_after: 1 }),
			...env,
		},
	});
	t.after(() => table.dispose());
	// The work directory is keyed by the file's own digest (contract §20.2's reentrancy).
	const workDir = join(table.workspace, ".coc", "ingest", shaOf(bookBytes()));
	return { table, book, workDir, logs };
}

function jsonl(path) {
	return existsSync(path)
		? readFileSync(path, "utf8")
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => JSON.parse(line))
		: [];
}

function ingestRows(table) {
	return table.entries("coc-telemetry").filter((row) => row.lane === "ingest");
}

test("ingest: five stages in order, the packer signs the manifest, bind and the build follow", async (t) => {
	const { table, book, workDir, logs } = await openIngest(t);

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "ingest done" });

	// The progress channel: every stage of contract §20.2, in order.
	const stages = table.bus("coc:module-ingest-progress").map((row) => row.data.stage);
	assert.deepEqual([...new Set(stages)], ["classify", "extract", "ocr", "pack", "bind"], "one stage after another");
	const paged = table.bus("coc:module-ingest-progress").find((row) => row.data.stage === "extract" && row.data.page === 1);
	assert.equal(paged.data.of, 4, "per-page progress says how many there are");

	// The pages: four files, contiguous from 0000, OCR text where the classifier said OCR was needed.
	const pagesDir = join(workDir, "pages");
	for (const index of [0, 1, 2, 3]) assert.ok(existsSync(join(pagesDir, `000${index}.md`)), `page ${index} is on disk`);
	assert.match(readFileSync(join(pagesDir, "0000.md"), "utf8"), /ocr text for page 0/, "an OCR page carries the OCR text");
	assert.match(readFileSync(join(pagesDir, "0001.md"), "utf8"), /native text for page 1/, "a native page carries the native text");
	assert.match(readFileSync(join(pagesDir, "0003.md"), "utf8"), /ocr text for page 3/);

	// The manifest is the packer's, never ours: it carries the packer's own stamp.
	const manifest = JSON.parse(readFileSync(join(workDir, "bundle", "manifest.json"), "utf8"));
	assert.equal(manifest.minted_by, "fake-bundle", "the manifest was minted by the packer, not by the job");
	assert.equal(manifest.producer, "pi-coc-ingest");
	assert.equal(manifest.module_identity.slug, MODULE_ID);
	assert.equal(manifest.module_identity.language, "zh-Hans");
	assert.equal(manifest.source.file_sha256, shaOf(bookBytes()), "the source digest is the file's own");
	assert.equal(manifest.source.page_count, 4);

	// The OCR command was asked for exactly the pages on the classifier's list, by original index.
	const ocrRuns = jsonl(logs.ocr);
	assert.equal(ocrRuns.length, 1, "one OCR round");
	assert.deepEqual(ocrRuns[0].pages, [0, 3], "only the pages that need it");
	assert.equal(ocrRuns[0].has_token, true, "the credential reached the command through the environment");

	// The kernel: bind with the bundle the packer wrote, then the build of contract §14.5.
	const calls = table.kernelRequests().filter((row) => row.method.startsWith("module."));
	const bind = calls.find((row) => row.method === "module.bind");
	assert.equal(bind.params.bundle, join(workDir, "bundle"), "bind is given the packed bundle");
	assert.equal(bind.params.module_id, MODULE_ID);
	const methods = calls.map((row) => row.method);
	assert.ok(methods.indexOf("module.plan") > methods.indexOf("module.bind"), "plan comes after bind");
	assert.ok(methods.includes("module.packet") && methods.includes("module.accept"), "the sections are read");
	assert.equal(methods.at(-1), "module.install", "the job ends at install");

	// The done payload, and the build's own four channels are untouched.
	assert.equal(done.data.module_id, MODULE_ID);
	assert.equal(done.data.page_count, 4);
	assert.deepEqual(done.data.ocr_pages, [0, 3]);
	assert.deepEqual(done.data.ocr_missing, []);
	assert.equal(done.data.installed, true);
	assert.equal(done.data.opening_ready, true);
	assert.equal(table.bus("coc:module-build-done").length, 1, "the build reported on its own channel");

	// Telemetry: lane "ingest", one row per stage, in the session record and in the job's own log.
	const rows = ingestRows(table);
	assert.deepEqual(
		rows.map((row) => row.stage),
		["classify", "extract", "ocr", "pack", "bind"],
		"one row per stage",
	);
	assert.ok(rows.every((row) => row.ok === true));
	assert.equal(rows[0].page_count, 4);
	assert.equal(rows[0].pages_needing_ocr, 2);
	assert.deepEqual(
		jsonl(join(workDir, "ingest.jsonl")).map((row) => row.stage),
		["classify", "extract", "ocr", "pack", "bind"],
		"the same rows land beside the work",
	);

	// The credential is nowhere: not in an argument list, not in telemetry, not in an artefact.
	const written = [
		JSON.stringify(jsonl(logs.ocr)),
		JSON.stringify(jsonl(logs.extract)),
		JSON.stringify(jsonl(logs.bundle)),
		JSON.stringify(rows),
		readFileSync(join(workDir, "ingest.jsonl"), "utf8"),
		readFileSync(join(workDir, "state.json"), "utf8"),
		readFileSync(join(workDir, "bundle", "manifest.json"), "utf8"),
	];
	for (const blob of written) assert.ok(!blob.includes(TOKEN), "the OCR token never leaves the environment");
});

test("ingest: a second run of the same file reuses its pages and calls the OCR service zero times", async (t) => {
	const { table, book, workDir, logs } = await openIngest(t);

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	await waitFor(() => table.bus("coc:module-ingest-done").length === 1, { label: "first ingest" });
	assert.equal(jsonl(logs.ocr).length, 1, "the first run pays for OCR");

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const second = await waitFor(() => table.bus("coc:module-ingest-done")[1], { label: "second ingest" });

	assert.equal(jsonl(logs.ocr).length, 1, "the second run calls the OCR service not once");
	assert.deepEqual(
		jsonl(logs.extract).filter((row) => row.verb === "extract").length,
		1,
		"and reads no page it already has",
	);
	assert.deepEqual(second.data.reused, [0, 1, 2, 3], "every page came off disk");
	assert.deepEqual(second.data.ocr_missing, []);
	assert.equal(second.data.installed, true);
	// The work directory is keyed by the file digest, so both runs used the same one.
	assert.equal(second.data.work_dir, workDir);
});

test("ingest: a page OCR could not read is retried on the next run, and only that page", async (t) => {
	// The first run has no credential, so the two OCR pages stay missing (contract §20.6's offline case);
	// the second one has it, and asks for exactly those two pages and no other.
	const { table, book, workDir, logs } = await openIngest(t, { env: { BAIDUOCR_TOKEN: undefined } });

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const first = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "the offline run" });
	assert.deepEqual(first.data.ocr_missing, [0, 3]);

	process.env.BAIDUOCR_TOKEN = TOKEN;
	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const second = await waitFor(() => table.bus("coc:module-ingest-done")[1], { label: "the run with a credential" });

	const ocrRuns = jsonl(logs.ocr);
	assert.equal(ocrRuns.length, 1, "the OCR service is called once in all, on the run that could");
	assert.deepEqual(ocrRuns[0].pages, [0, 3], "and only for the pages that were still missing");
	assert.deepEqual(second.data.ocr_missing, [], "nothing is missing any more");
	assert.equal(second.data.ocr_reason, undefined);
	assert.match(readFileSync(join(workDir, "pages", "0003.md"), "utf8"), /ocr text for page 3/, "the page was filled in, in place");
});

test("ingest: no extractor is `no_extractor`, and it says a bundle can still be bound by hand", async (t) => {
	const { table, book } = await openIngest(t, { env: { PI_COC_EXTRACT: "none" } });

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const failed = await waitFor(() => table.bus("coc:module-ingest-failed")[0], { label: "no_extractor" });

	assert.equal(failed.data.reason, "no_extractor");
	assert.match(failed.data.detail, /PI_COC_EXTRACT|extractor/);
	assert.equal(table.bus("coc:module-ingest-done").length, 0);
	const row = ingestRows(table).at(-1);
	assert.equal(row.reason, "no_extractor");
	assert.equal(row.ok, false);
});

test("ingest: no token is `ocr_unavailable` — the OCR pages stay missing and the book still assembles", async (t) => {
	const { table, book, workDir, logs } = await openIngest(t, { env: { BAIDUOCR_TOKEN: undefined } });

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "ingest done" });

	assert.equal(jsonl(logs.ocr).length, 0, "with no credential nothing is spawned, so nothing is paid for");
	assert.equal(done.data.ocr_reason, "ocr_unavailable");
	assert.match(done.data.ocr_detail, /BAIDUOCR_TOKEN/);
	assert.deepEqual(done.data.ocr_missing, [0, 3], "the pages that need OCR are named");
	assert.equal(done.data.installed, true, "the job does not fail: the rest of the book is a book");
	assert.equal(done.data.page_count, 4);
	// Those pages exist all the same, empty, so the bundle stays contiguous.
	assert.equal(readFileSync(join(workDir, "pages", "0000.md"), "utf8"), "");
	const ocrRow = ingestRows(table).find((row) => row.stage === "ocr");
	assert.equal(ocrRow.ok, false);
	assert.equal(ocrRow.reason, "ocr_unavailable");
	assert.equal(ocrRow.missing, 2);
});

test("ingest: an OCR command that fails is `ocr_failed`, and the job still finishes", async (t) => {
	const { table, book } = await openIngest(t, { env: { FAKE_OCR_FAIL: "1" } });

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "ingest done" });

	assert.equal(done.data.ocr_reason, "ocr_failed");
	assert.deepEqual(done.data.ocr_missing, [0, 3]);
	assert.equal(done.data.installed, true);
	assert.equal(ingestRows(table).find((row) => row.stage === "ocr").reason, "ocr_failed");
});

test("ingest: a file that is not there is `bad_pdf`, a packer that refuses is `pack_failed`", async (t) => {
	const { table, book } = await openIngest(t, { env: { FAKE_BUNDLE_FAIL: "1" } });

	table.emit("coc:module-ingest", { pdf: join(book, "..", "no-such-book.pdf"), module_id: MODULE_ID, language: "zh-Hans" });
	const missing = await waitFor(() => table.bus("coc:module-ingest-failed")[0], { label: "bad_pdf" });
	assert.equal(missing.data.reason, "bad_pdf");

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const packFailed = await waitFor(() => table.bus("coc:module-ingest-failed")[1], { label: "pack_failed" });
	assert.equal(packFailed.data.reason, "pack_failed");
	assert.equal(packFailed.data.stage, "pack");
	assert.equal(table.bus("coc:module-ingest-done").length, 0, "nothing was bound");
});

test("ingest: a bundle the kernel refuses is `bind_rejected`", async (t) => {
	const { table, book } = await openIngest(t, {
		env: {
			FAKE_KERNEL_ERRORS: JSON.stringify({
				"module.bind": { code: "invalid_params", message: "page 0002 does not match its sha256" },
			}),
		},
	});

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "zh-Hans" });
	const failed = await waitFor(() => table.bus("coc:module-ingest-failed")[0], { label: "bind_rejected" });

	assert.equal(failed.data.reason, "bind_rejected");
	assert.match(failed.data.detail, /sha256/, "the kernel's own complaint is carried through");
	assert.equal(ingestRows(table).find((row) => row.stage === "bind").reason, "bind_rejected");
});

test("ingest: a book whose language nobody declared stops before it costs anything", async (t) => {
	const { table, book, logs } = await openIngest(t);

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID });
	const failed = await waitFor(() => table.bus("coc:module-ingest-failed")[0], { label: "identity_incomplete" });

	assert.equal(failed.data.reason, "identity_incomplete");
	assert.match(failed.data.detail, /--language/, "it says how to declare one");
	assert.equal(jsonl(logs.extract).length, 0, "not a page was read");
});

test("ingest with the repository's own packer: the manifest it signs verifies against the bytes on disk", async (t) => {
	// No `PI_COC_BUNDLE_CMD` here, so the real `bin/coc-bundle` runs. That is the point of the
	// boundary (contract §20.1): the job hands over page files and the packer alone mints the
	// manifest, so `module.bind`'s byte check is a check on this job's output.
	const { table, book, workDir } = await openIngest(t, {
		pdf: { page_count: 3, pages_needing_ocr: [] },
		env: { PI_COC_BUNDLE_CMD: undefined, PI_COC_OCR_CMD: "none" },
	});

	table.emit("coc:module-ingest", { pdf: book, module_id: MODULE_ID, language: "en" });
	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "ingest done", timeoutMs: 30_000 });

	const manifest = JSON.parse(readFileSync(join(workDir, "bundle", "manifest.json"), "utf8"));
	assert.equal(manifest.contract, "coc.pdf-bundle.v1");
	assert.equal(manifest.minted_by, undefined, "this is the real packer's manifest, not a fixture's");
	assert.equal(manifest.producer, "pi-coc-ingest");
	assert.equal(manifest.pages.length, 3);
	assert.equal(done.data.installed, true);

	// The packer's own verifier re-derives every checkable fact from the bytes; the kernel does the same.
	execFileSync(join(process.cwd(), "bin", "coc-bundle"), ["--verify", "--out", join(workDir, "bundle")], { stdio: "pipe" });
});

test("ingest end to end on a real book, when the machine has one and the extractor is installed", async (t) => {
	// No PDF lives in this repository (contract §20.1's boundary is about adapters, not fixtures), so
	// this reads the user's own copy and skips when it, or the optional native extractor, is absent.
	const real = join(homedir(), "Documents", "TRPG", "克苏鲁的呼唤", "[COC模组翻译]不息的渴望-An Amaranthine Desire.pdf");
	const haveLibrary = await import("@firecrawl/pdf-inspector").then(
		() => true,
		() => false,
	);
	if (!existsSync(real) || !haveLibrary) {
		t.skip(`no book at ${real}, or @firecrawl/pdf-inspector is not installed (it is an optionalDependency)`);
		return;
	}
	// The real library and the real packer; OCR is off, so the pages that need it stay empty and named.
	const { table, workDir } = await openIngest(t, {
		env: { PI_COC_EXTRACT: undefined, PI_COC_BUNDLE_CMD: undefined, PI_COC_OCR_CMD: "none" },
	});

	table.emit("coc:module-ingest", { pdf: real, module_id: "an-amaranthine-desire", language: "zh-Hans" });
	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0] ?? table.bus("coc:module-ingest-failed")[0], {
		label: "the real book",
		timeoutMs: 120_000,
	});

	assert.equal(done.channel, "coc:module-ingest-done", `the job failed: ${JSON.stringify(done.data)}`);
	assert.equal(done.data.page_count, 41, "the classifier counts the book's pages");
	assert.ok(done.data.ocr_pages.includes(0) && done.data.ocr_pages.includes(1), "and names the pages it could not read natively");
	assert.equal(done.data.ocr_reason, "ocr_unavailable", "with OCR switched off those pages are missing, by name");
	const pages = readFileSync(join(done.data.work_dir ?? workDir, "pages", "0002.md"), "utf8");
	assert.ok(pages.length > 500, "page 2 is the table of contents and comes out natively");
	execFileSync(join(process.cwd(), "bin", "coc-bundle"), ["--verify", "--out", join(done.data.work_dir, "bundle")], { stdio: "pipe" });
});
