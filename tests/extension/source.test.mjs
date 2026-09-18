import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { sourceAsset, sourceInfo, sourceOverview, sourcePage, sourceSearch, closeSourceDocuments } from "../../extensions/module/source.ts";

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

function labelledPdf(marker = "a") {
	const count=4,pageObjects=[];
	for(let index=0;index<count;index++) {
		const page=4+index*2,content=page+1,color=((marker.charCodeAt(0)+index*37)%200)/255;
		const stream=`${color.toFixed(3)} 0 ${(1-color).toFixed(3)} rg 0 0 200 120 re f`;
		pageObjects.push({page,content,pageBody:`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120]${index===1?" /Rotate 90":""} /Resources << >> /Contents ${content} 0 R >>`,
			contentBody:`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`});
	}
	const objects=["<< /Type /Catalog /Pages 2 0 R /PageLabels 3 0 R >>",
		`<< /Type /Pages /Kids [${pageObjects.map(row=>`${row.page} 0 R`).join(" ")}] /Count ${count} >>`,
		"<< /Nums [0 << /S /r >> 2 << /P (A-) /S /D /St 5 >>] >>",
		...pageObjects.flatMap(row=>[row.pageBody,row.contentBody])];
	let text=`%PDF-1.7\n% ${marker}\n`;const offsets=[0];
	for(let index=0;index<objects.length;index++){offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
	const xref=Buffer.byteLength(text),size=objects.length+1;
	text+=`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}

function textPdf(streams, brokenPage = -1) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /P (Leaf-) /S /D /St 7 >>] >> >>",
		`<< /Type /Pages /Kids [${streams.map((_, i) => `${i === brokenPage ? 999 : 4 + i * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [i, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = "%PDF-1.7\n";
	const offsets = [0];
	for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const textStream = text => `BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;

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

test("private source redactions are painted into the derivative", async t => {
	const { file, cache } = await fixture(t);
	const output = join(cache, "redacted.png");
	const asset = await sourceAsset(file, cache, [{ page: 1, redactions: [[.25, .25, .75, .75]] }], output);
	const image = await loadImage(asset.path), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	assert.deepEqual(Array.from(ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data), [255, 255, 255, 255]);
});

test("reader JPEGs and revealable PNGs have separate verified caches", async t => {
  const {file, cache} = await fixture(t);
  const jpeg = await sourcePage(file, cache, 1, {pixels:512,format:'jpeg'});
  const png = await sourcePage(file, cache, 1, {pixels:512});
  assert.notEqual(jpeg.path,png.path);
  assert.deepEqual([...(await readFile(jpeg.path)).subarray(0,2)],[255,216]);
  assert.deepEqual([...(await readFile(png.path)).subarray(0,4)],[137,80,78,71]);
  assert.equal((await sourcePage(file,cache,1,{pixels:512,format:'jpeg'})).reused,true);
});

test('concurrent page-cache publication never exposes partial image bytes', async t => {
 const {file,cache}=await fixture(t);
 const {createHash}=await import('node:crypto');
 await Promise.all(Array.from({length:40},async()=>{
   const page=await sourcePage(file,cache,1,{pixels:512,format:'jpeg'});
   const bytes=await readFile(page.path);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),page.image_sha256);
 }));
});

test('concurrent identical source pages share rendering and changed file identity invalidates reuse',async t=>{
 const {file,cache}=await fixture(t);
 const pages=await Promise.all(Array.from({length:8},()=>sourcePage(file,cache,1,{pixels:512})));
 assert.equal(pages.filter(page=>!page.reused).length,1);
 assert.equal(new Set(pages.map(page=>page.image_sha256)).size,1);
 const first=await sourceInfo(file);
 await writeFile(file,pdf(90));
 const changed=await sourceInfo(file);assert.notEqual(changed.file_sha256,first.file_sha256);
 const fresh=await sourcePage(file,cache,1,{pixels:512});assert.equal(fresh.reused,false);
 assert.notEqual(fresh.image_sha256,pages[0].image_sha256);
 const {closeSourceDocuments}=await import('../../extensions/module/source.ts');await closeSourceDocuments();
 const again=await sourcePage(file,cache,1,{pixels:512});assert.equal(again.reused,true);assert.equal(again.image_sha256,fresh.image_sha256);
 await closeSourceDocuments();
});

test("a labelled contact sheet has stable tiles, a separate cache log and byte-identity invalidation",async t=>{
	const root=await mkdtemp(join(tmpdir(),"coc-overview-"));t.after(()=>rm(root,{recursive:true,force:true}));
	const file=join(root,"source.pdf"),cache=join(root,"pages");await writeFile(file,labelledPdf("a"));
	const first=await sourceOverview(file,cache,1,4),second=await sourceOverview(file,cache,1,4);
	assert.equal(first.reused,false);assert.equal(second.reused,true);assert.equal(first.path,second.path);
	assert.deepEqual(first.tiles,second.tiles);
	assert.deepEqual(first.tiles.map(tile=>[tile.page,tile.pdf_label,tile.row,tile.column]),[[1,"i",0,0],[2,"ii",0,1],[3,"A-5",0,2],[4,"A-6",0,3]]);
	assert.equal(first.width,1600);assert.ok(first.height>250);
	const image=await loadImage(first.path),canvas=createCanvas(image.width,image.height),context=canvas.getContext("2d");context.drawImage(image,0,0);
	for(const tile of first.tiles){const [x,y,width,height]=tile.tile,pixels=context.getImageData(x+6,y+height-56,width-12,50).data;
		let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100)dark++;assert.ok(dark>20,`page ${tile.page} label is visible`);}
	await assert.rejects(readFile(join(cache,"requests.jsonl")),error=>error.code==="ENOENT");
	assert.equal((await readFile(join(cache,"overviews.jsonl"),"utf8")).trim().split("\n").length,2);
	const oldPath=first.path,oldSource=first.file_sha256;await writeFile(file,labelledPdf("b"));
	const changed=await sourceOverview(file,cache,1,4);assert.equal(changed.reused,false);assert.notEqual(changed.path,oldPath);assert.notEqual(changed.file_sha256,oldSource);
});

test("native search normalizes literal text across items and whitespace, preserving physical pages and snippets", async t => {
	const {file, cache} = await fixture(t);
	await writeFile(file, textPdf(["", "BT /F1 12 Tf 20 160 Td (Har) Tj /F1 14 Tf (bor) Tj 0 -20 Td (Gate) Tj ET", textStream("Elsewhere")]));
	const result = await sourceSearch(file, {query: "  ＨＡＲＢＯＲ\t\n gate  "});
	assert.equal(result.navigation_only, true);
	assert.deepEqual(result.matches.map(row => [row.page, row.pdf_label]), [[2, "Leaf-8"]]);
	assert.match(result.matches[0].snippet, /Harbor\s+Gate/);
	assert.ok(result.matches[0].snippet.length <= 240);
	assert.deepEqual(result.scope, {first_page:1,last_page:3,searched_first_page:1,searched_last_page:3,complete:true});
	assert.deepEqual(result.text_availability, {scope:"searched_pages",pages_with_text:[2,3],empty_pages:[1],extraction_errors:[]});
	assert.equal(result.next_cursor, null);
	await assert.rejects(readFile(join(cache, "requests.jsonl")), error => error.code === "ENOENT");
	const miss = await sourceSearch(file, {query:"Absent",first_page:2,last_page:3});
	assert.deepEqual(miss.matches, []); assert.deepEqual(miss.text_availability.pages_with_text, [2,3]);
	const empty = await sourceSearch(file, {query:"Absent",first_page:1,last_page:1});
	assert.deepEqual(empty.matches, []); assert.deepEqual(empty.text_availability.pages_with_text, []);
	assert.deepEqual(empty.text_availability.empty_pages, [1]);
});

test("native search bounds candidate pages and scan work, with source/query/range-bound continuation", async t => {
	const {file} = await fixture(t);
	await writeFile(file, textPdf(Array.from({length:53}, () => textStream("A Harbor " + "long context ".repeat(40)))));
	const first = await sourceSearch(file, {query:"Harbor",limit:2});
	assert.deepEqual(first.matches.map(row => row.page), [1,2]);
	assert.equal(first.truncated, true); assert.equal(first.scope.complete, false);
	assert.ok(first.matches.every(row => row.snippet.length <= 240));
	const next = await sourceSearch(file, {query:"Harbor",limit:2,cursor:first.next_cursor});
	assert.deepEqual(next.matches.map(row => row.page), [3,4]);
	assert.equal(next.scope.searched_first_page, 3);
	assert.equal((await sourceSearch(file, {query:"Harbor"})).matches.length, 8);
	const miss = await sourceSearch(file, {query:"Absent"});
	assert.equal(miss.scope.searched_last_page, 50); assert.equal(miss.truncated, true);
	const end = await sourceSearch(file, {query:"Absent",cursor:miss.next_cursor});
	assert.equal(end.scope.searched_first_page, 51); assert.equal(end.scope.searched_last_page, 53);
	assert.equal(end.truncated, false); assert.equal(end.next_cursor, null);
	// A continuation is not a claim that this call inspected the earlier pages.
	assert.equal(end.scope.complete, false);
	for (const options of [{query:"Other",cursor:first.next_cursor},{query:"Harbor",last_page:52,cursor:first.next_cursor},
		{query:"Harbor",cursor:"invalid"}]) await assert.rejects(sourceSearch(file, options), /cursor/);
});

test("native search invalidates page text and cursors when source identity changes", async t => {
	const {file} = await fixture(t);
	await writeFile(file, textPdf([textStream("Old Harbor"), textStream("Old Harbor")]));
	const old = await sourceSearch(file, {query:"Old",limit:1});
	await writeFile(file, textPdf([textStream("New Harbor"), textStream("New Harbor")]));
	assert.deepEqual((await sourceSearch(file, {query:"Old"})).matches, []);
	assert.equal((await sourceSearch(file, {query:"New"})).matches.length, 2);
	await assert.rejects(sourceSearch(file, {query:"Old",cursor:old.next_cursor}), /cursor/);
});

test("native search reports extraction errors separately from empty pages and missing matches", async t => {
	const {file} = await fixture(t);
	await writeFile(file, textPdf([textStream("Harbor"), "", ""], 2));
	const result = await sourceSearch(file, {query:"Absent"});
	assert.deepEqual(result.matches, []);
	assert.deepEqual(result.text_availability.pages_with_text, [1]);
	assert.deepEqual(result.text_availability.empty_pages, [2]);
	assert.deepEqual(result.text_availability.extraction_errors.map(row => row.page), [3]);
	assert.equal(result.scope.complete, false); assert.equal(result.truncated, false);
});

test("native search validates selectors and cancellation preserves concurrent document owners", async t => {
	const {file, cache} = await fixture(t);
	await writeFile(file, textPdf(Array.from({length:4}, () => textStream("Harbor"))));
	for (const options of [null, [], {query:""}, {query:" \n\t "}, {query:"x".repeat(257)}, {query:1},
		{query:"Harbor",limit:0},{query:"Harbor",limit:21},{query:"Harbor",limit:1.5},
		{query:"Harbor",first_page:0},{query:"Harbor",first_page:2,last_page:1},
		{query:"Harbor",last_page:5},{query:"Harbor",first_page:1.5},{query:"Harbor",bbox:true}])
		await assert.rejects(sourceSearch(file, options), /search/);
	await assert.rejects(sourceSearch(file, {query:"Harbor"}, AbortSignal.abort()), /cancelled/);
	await sourceSearch(file, {query:"Harbor"});
	const controller = new AbortController();
	const interrupted = sourceSearch(file, {query:"Harbor"}, controller.signal);
	const rejection = assert.rejects(interrupted, /cancelled/);
	const peer = sourceSearch(file, {query:"Harbor"});
	setImmediate(() => controller.abort());
	const [result, page] = await Promise.all([peer, sourcePage(file,cache,1,{pixels:512}), rejection]);
	assert.equal(result.matches.length, 4); assert.equal(page.page, 1);
	await closeSourceDocuments();
	assert.equal((await sourceSearch(file, {query:"Harbor"})).matches.length, 4);
	await closeSourceDocuments();
});

test("contact-sheet ranges fail before page rendering and cancellation stays bounded",async t=>{
	const root=await mkdtemp(join(tmpdir(),"coc-overview-range-"));t.after(()=>rm(root,{recursive:true,force:true}));
	const file=join(root,"source.pdf"),cache=join(root,"pages");await writeFile(file,labelledPdf());
	for(const [first,last] of [[0,1],[2,1],[1.5,2],[1,2.5],[1,21]])await assert.rejects(sourceOverview(file,cache,first,last),/overview/);
	await assert.rejects(sourceOverview(file,cache,1,5),/outside this PDF/);
	await assert.rejects(sourceOverview(file,cache,1,4,AbortSignal.abort()),/cancelled/);
	await assert.rejects(readFile(join(cache,"overviews.jsonl")),error=>error.code==="ENOENT");
});
