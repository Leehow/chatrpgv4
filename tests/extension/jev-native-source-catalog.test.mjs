import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeSourceDocuments, sourceText } from "../../extensions/module/source.ts";
import { ContractError } from "../../runtime/jev/value-contracts.ts";
import { nativeSourceCatalog } from "../../runtime/jev/native-source-catalog.ts";
import { resolveSourceRef } from "../../runtime/jev/source-ref.ts";

const scope = { owner: "session:test", campaign: "campaign", worldline: "main", loop: 2, audience: "keeper" };

function textPdf(streams, brokenPage = -1) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
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
const clone = value => structuredClone(value);

async function bundle(t, broken = false) {
	const root = await mkdtemp(join(tmpdir(), "jev-native-catalog-"));
	const file = join(root, "source.pdf");
	const streams = broken ? [textStream("Echo.Echo."), "", textStream("Broken")]
		: [textStream("Echo.Echo."), "", textStream("Omitted"), textStream("Also omitted")];
	await writeFile(file, textPdf(streams, broken ? 2 : -1));
	t.after(async () => { await closeSourceDocuments(); await rm(root, { recursive: true, force: true }); });
	const value = await sourceText(file, { pages: broken ? [1, 2, 3] : [1, 2] });
	return { file, value };
}

function invalid(action) {
	assert.throws(action, error => error instanceof ContractError && error.code === "invalid_native_source_snapshot");
}

test("actual native text becomes exact raw refs with recomputed revisions and explicit coverage only", async t => {
	const { value } = await bundle(t);
	const catalog = nativeSourceCatalog(scope, value, value.file_sha256);

	assert.equal(catalog.fileSha256, value.file_sha256);
	assert.equal(catalog.extractionVersion, value.extraction_version);
	assert.equal(catalog.pageCount, 4);
	assert.deepEqual(catalog.coverage, { textPages: [1], emptyPages: [2], errorPages: [], omittedPages: [3, 4] });
	assert.deepEqual(catalog.snapshots.map(snapshot => [snapshot.resource, snapshot.revision, snapshot.sourceType, snapshot.text]), [
		[`pdf:${value.file_sha256}:page:1:native:${value.extraction_version}`, value.snapshots[0].revision, "native_text", "Echo.Echo."],
		[`pdf:${value.file_sha256}:page:2:native:${value.extraction_version}`, value.snapshots[1].revision, "native_text", ""],
	]);
	assert.deepEqual(catalog.units.map(unit => [unit.alias, unit.text, unit.ref.selector]), [
		["page:1:span:0", "Echo.", { kind: "utf16", start: 0, end: 5 }],
		["page:1:span:1", "Echo.", { kind: "utf16", start: 5, end: 10 }],
	]);
	assert.notDeepEqual(catalog.units[0].ref.selector, catalog.units[1].ref.selector,
		"duplicate source strings retain their distinct exact occurrences");
	assert.ok(catalog.units.every(unit => JSON.stringify(unit.ref.scope) === JSON.stringify(scope)
		&& unit.ref.revision === value.snapshots[0].revision));
	const access = {
		scope,
		mode: "active",
		currentRevision: resource => catalog.snapshots.find(snapshot => snapshot.resource === resource)?.revision,
		read: (resource, revision) => catalog.snapshots.find(snapshot => snapshot.resource === resource && snapshot.revision === revision),
	};
	for (const unit of catalog.units) assert.equal(resolveSourceRef(unit.ref, access), unit.text);
	assert.equal(JSON.stringify(catalog).includes("supported"), false);
	assert.equal(JSON.stringify(catalog).includes("ready"), false);
	assert.equal(JSON.stringify(catalog).includes("proof"), false);

	const failed = (await bundle(t, true)).value;
	assert.deepEqual(nativeSourceCatalog(scope, failed, failed.file_sha256).coverage,
		{ textPages: [1], emptyPages: [2], errorPages: [3], omittedPages: [] });
});

test("stale, tampered, hash, page, and scope mismatches fail at their owning boundary", async t => {
	const { value } = await bundle(t, true);
	const catalog = nativeSourceCatalog(scope, value, value.file_sha256);
	const staleAccess = {
		scope,
		mode: "active",
		currentRevision: () => "f".repeat(64),
		read: () => catalog.snapshots[0],
	};
	assert.throws(() => resolveSourceRef(catalog.units[0].ref, staleAccess),
		error => error instanceof ContractError && error.code === "stale_source_ref");

	for (const changed of [
		() => { const copy = clone(value); copy.snapshots[0].text = "tampered"; return copy; },
		() => { const copy = clone(value); copy.snapshots[0].text_sha256 = "0".repeat(64); return copy; },
		() => { const copy = clone(value); copy.snapshots[0].revision = "0".repeat(64); return copy; },
		() => { const copy = clone(value); copy.snapshots[0].availability = "empty"; return copy; },
		() => { const copy = clone(value); copy.errors[0].page = 1; return copy; },
		() => { const copy = clone(value); copy.snapshots[0].page = 0; return copy; },
		() => { const copy = clone(value); copy.snapshots[0].page = 5; return copy; },
	]) invalid(() => nativeSourceCatalog(scope, changed(), value.file_sha256));
	invalid(() => nativeSourceCatalog(scope, value, "0".repeat(64)));
	invalid(() => nativeSourceCatalog(scope, value, "bad-hash"));
	for (const badScope of [
		{ ...scope, owner: "" },
		{ ...scope, audience: "private" },
		{ ...scope, loop: -1 },
	]) assert.throws(() => nativeSourceCatalog(badScope, value, value.file_sha256),
		error => error instanceof ContractError && error.code === "invalid_source_ref");
});
