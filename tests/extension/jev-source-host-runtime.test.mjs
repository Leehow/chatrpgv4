import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createRuntime } from "../../runtime/host.ts";

const ROOT = resolve(import.meta.dirname, "../..");

function textPdf(streams) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
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

async function fixture(t, streams) {
	const home = await mkdtemp(join(tmpdir(), "jev-source-runtime-"));
	await writeFile(join(home, "source.pdf"), textPdf(streams));
	const env = { ...process.env, PI_COC_LAYOUT: "source", PI_COC_RESOURCE_ROOT: ROOT,
		PI_COC_NODE_EXECUTABLE: process.execPath, PI_OFFLINE: "1" };
	const runtime = createRuntime({ owner: "check", home }, { resourceRoot: ROOT, nodeExecutable: process.execPath, env });
	t.after(async () => { await runtime.close(); await rm(home, { recursive: true, force: true }); });
	return { home, runtime };
}

test("HostRuntime reaches native search and text through the spawned source worker", async t => {
	const { runtime } = await fixture(t, [textStream("First Needle"), textStream("Second page")]);
	const search = await runtime.sourceSearch({ pdf: "source.pdf", query: "Needle" });
	const text = await runtime.sourceText({ pdf: "source.pdf", pages: [2, 1] });

	assert.equal(search.navigation_only, true);
	assert.deepEqual(search.matches.map(row => [row.page, row.snippet]), [[1, "First Needle"]]);
	assert.deepEqual(text.snapshots.map(row => [row.page, row.text]), [[2, "Second page"], [1, "First Needle"]]);
	assert.equal(text.errors.length, 0);
	assert.match(text.file_sha256, /^[a-f0-9]{64}$/);
	assert.match(text.extraction_version, /^pdfjs-.+:native-text-v1$/);
});

test("cancelling a native source worker call leaves its HostRuntime owner usable", async t => {
	const pages = Array.from({ length: 32 }, (_, index) => textStream(`Page-${index}-` + "native ".repeat(2_000)));
	const { runtime } = await fixture(t, pages);
	const controller = new AbortController();
	const pending = runtime.sourceText({ pdf: "source.pdf", pages: Array.from({ length: 32 }, (_, index) => index + 1) }, controller.signal);
	setTimeout(() => controller.abort(), 20);

	await assert.rejects(pending, /closed|cancelled|signal|ended/i);
	const retry = await runtime.sourceText({ pdf: "source.pdf", pages: [1] });
	assert.equal(retry.snapshots[0].text.startsWith("Page-0-"), true);
});
