import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { sourceAsset, sourceInfo, sourcePage } from "../../extensions/module/source.ts";

function pdf(rotation = 0) {
	const stream = "1 0 0 rg 0 0 100 100 re f 0 0 1 rg 100 0 100 100 re f";
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate ${rotation} /Resources << >> /Contents 4 0 R >>`,
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
	const xref = Buffer.byteLength(text);
	text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}

async function fixture(t, rotation = 0) {
	const root = await mkdtemp(join(tmpdir(), "coc-source-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const file = join(root, "source.pdf");
	await writeFile(file, pdf(rotation));
	return { file, cache: join(root, "pages") };
}

async function center(path) {
	const image = await loadImage(path);
	const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	return Array.from(ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data);
}

test("physical page metadata and full page rendering use original PDF bytes", async t => {
	const { file, cache } = await fixture(t);
	const info = await sourceInfo(file);
	assert.equal(info.page_count, 1);
	assert.deepEqual(info.bookmarks, []);
	const page = await sourcePage(file, cache, 1, { pixels: 512 });
	assert.equal(page.file_sha256, info.file_sha256);
	assert.equal(page.width, 512); assert.equal(page.height, 256);
	assert.match(page.path, /page-1-region-/);
});

test("a crop is rendered from the source region, including PDF page rotation", async t => {
	for (const rotation of [0, 90]) {
		const { file, cache } = await fixture(t, rotation);
		const box = rotation === 0 ? [0, 0, .5, 1] : [0, 0, 1, .5];
		const crop = await sourcePage(file, cache, 1, { box, pixels: 512 });
		assert.deepEqual(await center(crop.path), [255, 0, 0, 255]);
		assert.equal(crop.width, crop.height);
	}
});

test("repeated page access reuses checked cache; damaged cache is repaired", async t => {
	const { file, cache } = await fixture(t);
	const first = await sourcePage(file, cache, 1, { pixels: 512 });
	const second = await sourcePage(file, cache, 1, { pixels: 512 });
	assert.equal(first.reused, false); assert.equal(second.reused, true);
	const rows = (await readFile(join(cache, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows.length, 2);
	// A corrupt view is restored from the verified cache, never delivered to the reader.
	await writeFile(second.path, "broken");
	const repaired = await sourcePage(file, cache, 1, { pixels: 512 });
	assert.equal(repaired.reused, true);
	assert.ok((await readFile(repaired.path)).subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])));
});

test("invalid page selectors, invalid regions and malformed sources fail explicitly", async t => {
	const { file, cache } = await fixture(t);
	for (const page of [0, 2, 1.5]) await assert.rejects(sourcePage(file, cache, page), /page/);
	await assert.rejects(sourcePage(file, cache, 1, { box: [0, 0, 2, 1] }), /box/);
	await writeFile(file, "not a PDF");
    await assert.rejects(sourceInfo(file));
});

test("a handout preserves its explicitly declared source regions in order", async t => {
	const { file, cache } = await fixture(t);
	const output = join(cache, "handout.png");
	const asset = await sourceAsset(file, cache, [{ page: 1, box: [0, 0, .5, 1] }, { page: 1, box: [.5, 0, 1, 1] }], output);
	assert.equal(asset.media_type, "image/png");
	const image = await loadImage(asset.path), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	assert.deepEqual(Array.from(ctx.getImageData(100, 100, 1, 1).data), [255, 0, 0, 255]);
	assert.deepEqual(Array.from(ctx.getImageData(100, image.height - 100, 1, 1).data), [0, 0, 255, 255]);
});
