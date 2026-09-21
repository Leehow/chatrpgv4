import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeSourceDocuments, sourceText, sourceTextVersion } from "../../extensions/module/source.ts";

function textPdf(streams, brokenPage = -1) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /P (Leaf-) /S /D /St 7 >>] >> >>",
		`<< /Type /Pages /Kids [${streams.map((_, index) => `${index === brokenPage ? 999 : 4 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(text));
		text += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const textStream = text => `BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;

async function fixture(t, streams, brokenPage = -1) {
	const root = await mkdtemp(join(tmpdir(), "jev-source-text-"));
	const file = join(root, "source.pdf");
	await writeFile(file, textPdf(streams, brokenPage));
	t.after(async () => { await closeSourceDocuments(); await rm(root, { recursive: true, force: true }); });
	return { root, file };
}

const sha256 = value => createHash("sha256").update(value).digest("hex");

test("native snapshots preserve requested order, raw PDF.js text, labels, and exact digest bindings", async t => {
	const { file } = await fixture(t, [textStream("Raw  text"), "", textStream("Cafe text")]);
	const sourceBytes = await readFile(file), fileDigest = sha256(sourceBytes);
	const result = await sourceText(file, { pages: [3, 1, 2], expected_file_sha256: fileDigest });

	assert.match(sourceTextVersion, /^pdfjs-.+:native-text-v1$/);
	assert.equal(result.file_sha256, fileDigest);
	assert.equal(result.extraction_version, sourceTextVersion);
	assert.equal(result.page_count, 3);
	assert.deepEqual(result.snapshots.map(row => row.page), [3, 1, 2]);
	assert.deepEqual(result.snapshots.map(row => row.pdf_label), ["Leaf-9", "Leaf-7", "Leaf-8"]);
	assert.deepEqual(result.snapshots.map(row => row.text), ["Cafe text", "Raw text", ""],
		"the helper returns PDF.js item strings exactly and applies no additional normalization");
	assert.deepEqual(result.snapshots.map(row => row.availability), ["text", "text", "empty"]);
	assert.deepEqual(result.errors, []);
	for (const snapshot of result.snapshots) {
		assert.equal(snapshot.text_sha256, sha256(Buffer.from(snapshot.text, "utf8")));
		assert.equal(snapshot.revision, sha256(JSON.stringify([
			sourceTextVersion,
			fileDigest,
			snapshot.page,
			snapshot.text_sha256,
		])));
		assert.deepEqual(Object.keys(snapshot), ["page", "pdf_label", "text", "text_sha256", "revision", "availability"]);
	}
	for (const forbidden of ["proof", "supported", "ready", "observations", "image_sha256"])
		assert.equal(JSON.stringify(result).includes(`\"${forbidden}\"`), false);
});

test("empty native text and per-page extraction failure are distinct and preserve successful page order", async t => {
	const { file } = await fixture(t, [textStream("Available"), "", textStream("Broken")], 2);
	const result = await sourceText(file, { pages: [3, 2, 1] });

	assert.deepEqual(result.snapshots.map(row => [row.page, row.availability, row.text]), [
		[2, "empty", ""],
		[1, "text", "Available"],
	]);
	assert.deepEqual(result.errors, [{ page: 3, code: "native_extraction_unavailable" }]);
});

test("native text options reject unknown, duplicate, malformed, oversized, and out-of-range selections", async t => {
	const { file } = await fixture(t, [textStream("One"), textStream("Two")]);
	let getterCalls = 0;
	const accessor = {};
	Object.defineProperty(accessor, "pages", { enumerable: true, get() { getterCalls++; return [1]; } });
	const hidden = { pages: [1] };
	Object.defineProperty(hidden, "expected_file_sha256", { value: "a".repeat(64), enumerable: false });
	for (const options of [
		null,
		[],
		{},
		{ pages: [] },
		{ pages: new Array(1) },
		{ pages: [1, 1] },
		{ pages: [0] },
		{ pages: [1.5] },
		{ pages: Array.from({ length: 33 }, (_, index) => index + 1) },
		{ pages: [1], extra: true },
		{ pages: [1], [Symbol("extra")]: true },
		{ pages: [1], expected_file_sha256: "A".repeat(64) },
		{ pages: [1], expected_file_sha256: "a".repeat(63) },
		accessor,
		hidden,
	]) await assert.rejects(sourceText(file, options), /source text|pages|SHA-256/);
	assert.equal(getterCalls, 0, "validation rejects an accessor without executing it");
	await assert.rejects(sourceText(file, { pages: [3] }), /outside this PDF/);
	await assert.rejects(sourceText(file, { pages: [1] }, AbortSignal.abort()), /cancelled/);
});

test("caller mutation after invocation cannot change the validated page order or expected source identity", async t => {
	const { file } = await fixture(t, [textStream("First"), textStream("Second"), textStream("Third")]);
	const expected = sha256(await readFile(file));
	const options = { pages: [3, 1], expected_file_sha256: expected };
	const reading = sourceText(file, options);
	options.pages.splice(0, options.pages.length, 2);
	options.expected_file_sha256 = "0".repeat(64);
	const result = await reading;

	assert.equal(result.file_sha256, expected);
	assert.deepEqual(result.snapshots.map(snapshot => [snapshot.page, snapshot.text]), [[3, "Third"], [1, "First"]]);
});

test("source identity changes invalidate native snapshots and an expected old SHA fails closed", async t => {
	const { file } = await fixture(t, [textStream("Old native text")]);
	const old = await sourceText(file, { pages: [1] });
	await writeFile(file, textPdf([textStream("New native text")]) + "% changed bytes\n");
	const current = await sourceText(file, { pages: [1] });

	assert.notEqual(current.file_sha256, old.file_sha256);
	assert.notEqual(current.snapshots[0].revision, old.snapshots[0].revision);
	assert.equal(current.snapshots[0].text, "New native text");
	await assert.rejects(sourceText(file, { pages: [1], expected_file_sha256: old.file_sha256 }), /expected_file_sha256/);
});

test("mutation during extraction is rejected against the opening source stamp", async t => {
	const pages = Array.from({ length: 32 }, (_, index) => textStream(`Original-${index}-` + "native ".repeat(2_000)));
	const { file, root } = await fixture(t, pages);
	const replacement = join(root, "replacement.pdf");
	await writeFile(replacement, textPdf(Array.from({ length: 32 }, (_, index) => textStream(`Changed-${index}`))));
	const reading = sourceText(file, { pages: Array.from({ length: 32 }, (_, index) => index + 1) });
	const rejection = assert.rejects(reading, /changed/);
	await new Promise(resolve => setImmediate(resolve));
	await rename(replacement, file);
	await rejection;
});

test("cancelling one native-text waiter does not cancel or destroy a peer document lease", async t => {
	const pages = Array.from({ length: 32 }, (_, index) => textStream(`Peer-${index}-` + "text ".repeat(1_000)));
	const { file } = await fixture(t, pages);
	const requested = Array.from({ length: 32 }, (_, index) => index + 1);
	const controller = new AbortController();
	const cancelled = sourceText(file, { pages: requested }, controller.signal);
	const peer = sourceText(file, { pages: requested });
	setImmediate(() => controller.abort());

	await assert.rejects(cancelled, /cancelled/);
	const result = await peer;
	assert.equal(result.snapshots.length, 32);
	assert.deepEqual(result.errors, []);
	await closeSourceDocuments();
	assert.equal((await sourceText(file, { pages: [1] })).snapshots[0].text.startsWith("Peer-0-"), true);
});
