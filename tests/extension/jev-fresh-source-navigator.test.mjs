/** T08 fresh-source navigator integration with a real PDF and controlled typed decisions. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { bindDecisionAnswers } from "../../runtime/jev/contracts.ts";
import { createFreshSourceNavigator } from "../../runtime/jev/fresh-source-navigator.ts";
import { FRESH_SOURCE_ROLES } from "../../runtime/jev/fresh-source-navigation-domain.ts";
import { createRuntime } from "../../runtime/host.ts";

const ROOT = resolve(import.meta.dirname, "../..");

function textPdf(texts) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${texts.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${texts.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, text] of texts.entries()) {
		const stream = `BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
			`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	}
	let pdf = "%PDF-1.7\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(pdf), size = objects.length + 1;
	return pdf + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

function answer(batch, classify = (page, role) => page === 1 && ["contents", "opening"].includes(role)
	|| page === 18 && role === "map" ? "yes" : "no") {
	const pages = new Map(batch.state.parts.map(part => [part.alias, part.page]));
	const raw = {};
	for (const question of batch.questions) {
		const role = FRESH_SOURCE_ROLES.find(value => question.key.endsWith(`:${value}`));
		const alias = question.key.slice("role:".length, -(role.length + 1));
		raw[question.key] = { status: "answered", type: "choice", choice: classify(pages.get(alias), role) };
	}
	return bindDecisionAnswers(batch, raw, { inputTokens: 1, outputTokens: 1, costUsd: 0 });
}

async function fixture(t, pages = 18) {
	const home = await mkdtemp(join(tmpdir(), "jev-fresh-navigator-"));
	const pdf = join(home, "source.pdf"), workRoot = join(home, "work", "read-1");
	await writeFile(pdf, textPdf(Array.from({ length: pages }, (_, index) => index === 0
		? "Contents. Opening at the old house." : index === pages - 1 ? "Keeper map of the cellar." : `Chapter page ${index + 1}.`)));
	await mkdir(workRoot, { recursive: true });
	const env = { ...process.env, PI_COC_LAYOUT: "source", PI_COC_RESOURCE_ROOT: ROOT,
		PI_COC_NODE_EXECUTABLE: process.execPath, PI_OFFLINE: "1" };
	const sourceRuntime = createRuntime({ owner: "check", home }, { resourceRoot: ROOT, nodeExecutable: process.execPath, env });
	const info = await sourceRuntime.sourceInfo({ pdf, cache: home });
	const sourceCalls = [];
	const runtime = {
		home, signal: sourceRuntime.signal,
		async sourceInfo(request, signal) { sourceCalls.push({ method: "info", request: structuredClone(request) }); return sourceRuntime.sourceInfo(request, signal); },
		async sourceText(request, signal) { sourceCalls.push({ method: "text", request: structuredClone(request) }); return sourceRuntime.sourceText(request, signal); },
	};
	t.after(async () => { await sourceRuntime.close(); await rm(home, { recursive: true, force: true }); });
	return { home, pdf, workRoot, info, runtime, sourceCalls };
}

function snapshot(table, revision = "source-r1") {
	return { module_id: "book", pdf: table.pdf, file_sha256: table.info.file_sha256, page_count: table.info.page_count, revision };
}

function request(table) {
	return { moduleId: "book", jobId: "read-1",
		source: { path: table.pdf, file_sha256: table.info.file_sha256, page_count: table.info.page_count } };
}

async function privateRoot(table) {
	const root = join(table.home, ".coc", "task-runtime", "source-navigation"), directories = await readdir(root);
	assert.equal(directories.length, 1);
	return join(root, directories[0]);
}

async function taskRecords(root) {
	const directory = join(root, "tasks"), files = await readdir(directory).catch(() => []);
	return Promise.all(files.filter(file => file.endsWith(".json")).map(async file => JSON.parse(await readFile(join(directory, file), "utf8"))));
}

test("real native PDF navigation crosses page batches, uses canonical owned operations, and caches only exact source/extractor identity", async t => {
	const table = await fixture(t), calls = [], events = [];
	let decisions = 0;
	const navigator = createFreshSourceNavigator({ runtime: table.runtime,
		env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1", TYPESAFE_API_KEY: "dummy-secret-that-must-not-persist" },
		async call(method, params) { calls.push({ method, params: structuredClone(params) }); return snapshot(table); },
		decision: { async decide(batch) { decisions++; return answer(batch); } },
		record: event => events.push(structuredClone(event)),
	});
	assert.equal(typeof navigator, "function");
	const firstWork = join(table.workRoot, "attempt-1");
	await mkdir(firstWork);
	const malicious = join(firstWork, "navigation.json");
	await writeFile(malicious, JSON.stringify({ artifact: { hints: [{ page: 99, roles: ["opening"] }] }, secret: "reader-controlled" }));
	const artifact = await navigator(request(table), new AbortController().signal);
	assert.ok(artifact);
	assert.deepEqual(table.sourceCalls.filter(row => row.method === "text").map(row => row.request.pages), [
		Array.from({ length: 16 }, (_, index) => index + 1), [17, 18],
	]);
	assert.deepEqual(artifact.hints.find(row => row.page === 1).roles, ["contents", "opening"]);
	assert.deepEqual(artifact.hints.find(row => row.page === 18).roles, ["map"]);
	assert.deepEqual(artifact.coverage, { classified_pages: Array.from({ length: 18 }, (_, index) => index + 1), uncertain_pages: [],
		empty_pages: [], error_pages: [], omitted_pages: [] });
	assert.equal(artifact.navigation_only, true);
	assert.ok(calls.length > 2 && calls.every(row => row.method === "module.source.snapshot"));
	assert.deepEqual(calls[0].params, { module_id: "book" }, "the pre-graph source owner needs only the bound module identity");
	assert.equal(calls.some(row => row.method.startsWith("module.read") || row.method.includes("finish") || row.method.includes("opening")), false);
	const privateDirectory = await privateRoot(table), records = await taskRecords(privateDirectory);
	assert.equal(records.length, 1);
	assert.equal(records[0].status, "closed");
	assert.equal(records[0].phase, "terminal");
	assert.equal(records[0].result.status, "complete");
	assert.notEqual(records[0].reason, "delivered", "standalone artifacts never claim Keeper delivery");
	assert.deepEqual(records[0].result.refs, []);
	assert.deepEqual(records[0].result.receipts, []);
	assert.ok(records[0].observations.every(row => row.proposal.operation.startsWith("navigation.")));
	assert.equal(await readFile(malicious, "utf8"), JSON.stringify({ artifact: { hints: [{ page: 99, roles: ["opening"] }] }, secret: "reader-controlled" }),
		"reader-workdir navigation data is ignored and never overwritten");
	assert.deepEqual((await readdir(firstWork)).sort(), ["navigation.json"]);
	const privateCache = join(privateDirectory, "navigation.json");
	const serialized = [await readFile(privateCache, "utf8"), ...records.map(JSON.stringify), JSON.stringify(events)].join("\n");
	assert.equal(serialized.includes("dummy-secret-that-must-not-persist"), false);

	const firstDecisionCount = decisions, beforeCacheText = table.sourceCalls.length;
	const secondWork = join(table.workRoot, "attempt-2");
	await mkdir(secondWork);
	const cached = await navigator(request(table), new AbortController().signal);
	assert.deepEqual(cached, artifact);
	assert.equal(decisions, firstDecisionCount, "an exact cache hit performs zero Jev decisions");
	assert.deepEqual(table.sourceCalls.slice(beforeCacheText).map(row => [row.method, row.request.pages]), [["info", undefined], ["text", [1]]]);
	assert.ok(events.some(row => row.status === "cached"));
	assert.deepEqual(await readdir(secondWork), []);

	const poisoned = createFreshSourceNavigator({ runtime: { ...table.runtime, async sourceText(requestValue, signal) {
		const value = await table.runtime.sourceText(requestValue, signal);
		return requestValue.pages.length === 1 && requestValue.pages[0] === 1 ? { ...value, file_sha256: "0".repeat(64) } : value;
	} }, env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" }, async call() { return snapshot(table); },
		decision: { async decide() { throw new Error("an invalid cache probe must not start Jev"); } } });
	assert.equal(await poisoned(request(table), new AbortController().signal), undefined,
		"a cache probe with the wrong native source identity fails closed");
	assert.equal(decisions, firstDecisionCount);

	const cachePath = privateCache, badDigest = JSON.parse(await readFile(cachePath, "utf8"));
	badDigest.digest = "0".repeat(64);
	await writeFile(cachePath, JSON.stringify(badDigest) + "\n");
	assert.ok(await navigator(request(table), new AbortController().signal));
	assert.ok(decisions > firstDecisionCount, "a private cache with a bad digest is discarded and recomputed");
	const afterDigestRecompute = decisions, tampered = JSON.parse(await readFile(cachePath, "utf8"));
	tampered.artifact.extraction_version = "foreign-extractor";
	tampered.digest = createHash("sha256").update(JSON.stringify(tampered.artifact)).digest("hex");
	await writeFile(cachePath, JSON.stringify(tampered) + "\n");
	const thirdWork = join(table.workRoot, "attempt-3");
	await mkdir(thirdWork);
	assert.ok(await navigator(request(table), new AbortController().signal));
	assert.ok(decisions > afterDigestRecompute, "an extractor-version mismatch recomputes rather than trusting retained hints");
	assert.deepEqual(await readdir(thirdWork), []);
});

test("disabled, unconfigured, stale, tampered, cancelled, and expired navigation never publishes or fabricates proof", async t => {
	const table = await fixture(t, 2), noCalls = async () => { throw new Error("disabled navigator called"); };
	for (const env of [{ PI_COC_JEV_SOURCE: "1", TYPESAFE_API_KEY: "x" },
		{ PI_COC_TASK_RUNTIME: "1", TYPESAFE_API_KEY: "x" }, { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" }])
		assert.equal(createFreshSourceNavigator({ runtime: table.runtime, env, call: noCalls }), undefined);

	let revisions = 0, decisions = 0;
	const stale = createFreshSourceNavigator({ runtime: table.runtime, env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" },
		decision: { async decide(batch) { decisions++; return answer(batch); } },
		async call() { return snapshot(table, ++revisions === 1 ? "source-r1" : "foreign-r2"); } });
	const staleWork = join(table.workRoot, "stale"); await mkdir(staleWork);
	assert.equal(await stale(request(table), new AbortController().signal), undefined);
	assert.equal(decisions, 0);
	assert.equal((await readdir(staleWork)).includes("navigation.json"), false);

	const tamperedWork = join(table.workRoot, "tampered"); await mkdir(tamperedWork);
	const tampered = createFreshSourceNavigator({ runtime: table.runtime, env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" },
		decision: { async decide(batch) { return answer(batch); } }, async call() { return snapshot(table); } });
	assert.equal(await tampered({ ...request(table), source: { ...request(table).source, file_sha256: "0".repeat(64) } },
		new AbortController().signal), undefined);
	assert.equal((await readdir(tamperedWork)).includes("navigation.json"), false);

	for (const mode of ["cancel", "expire"]) {
		const work = join(table.workRoot, mode); await mkdir(work);
		const started = Promise.withResolvers(), controller = new AbortController();
		const navigator = createFreshSourceNavigator({ runtime: table.runtime,
			env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" }, deadlineMs: mode === "expire" ? 10 : 10_000,
			async call() { return snapshot(table); }, decision: { decide(_batch, lease) {
				started.resolve();
				return new Promise((_resolve, reject) => lease.signal.addEventListener("abort", () => reject(lease.signal.reason), { once: true }));
			} } });
		const pending = navigator(request(table), controller.signal);
		if (mode === "cancel") { await started.promise; controller.abort(); }
		assert.equal(await pending, undefined);
		assert.equal((await readdir(work)).includes("navigation.json"), false);
	}
});

test("uncertain typed coverage returns partial semantic hints without refs, hashes, or readiness", async t => {
	const table = await fixture(t, 2), events = [];
	const navigator = createFreshSourceNavigator({ runtime: table.runtime, env: { PI_COC_TASK_RUNTIME: "1", PI_COC_JEV_SOURCE: "1" },
		async call() { return snapshot(table); }, record: event => events.push(event),
		decision: { async decide(batch) { return answer(batch, (page, role) => page === 2 && role === "map" ? "uncertain" : "no"); } } });
	const work = join(table.workRoot, "partial"); await mkdir(work);
	const artifact = await navigator(request(table), new AbortController().signal);
	assert.deepEqual(artifact.coverage, { classified_pages: [1], uncertain_pages: [2], empty_pages: [], error_pages: [], omitted_pages: [] });
	assert.deepEqual(artifact.hints, [{ page: 1, pdf_label: null, roles: [] }, { page: 2, pdf_label: null, roles: [] }]);
	const readerView = { version: artifact.version, navigation_only: artifact.navigation_only, hints: artifact.hints, coverage: artifact.coverage };
	for (const forbidden of ["source_revision", "extraction_version", "file_sha256", "ref", "proof", "ready"])
		assert.equal(JSON.stringify(readerView).includes(forbidden), false);
	assert.ok(events.some(row => row.status === "partial" && row.available === true));
	const records = await taskRecords(await privateRoot(table));
	assert.equal(records.length, 1);
	assert.equal(records[0].status, "closed");
	assert.equal(records[0].phase, "terminal");
	assert.equal(records[0].result.status, "partial");
	assert.notEqual(records[0].reason, "delivered");
});
