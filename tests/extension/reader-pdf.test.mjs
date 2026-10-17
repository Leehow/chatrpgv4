import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import readerPdf from "../../extensions/module/reader-pdf.ts";

function pdf(nativeText="") {
	const stream="0.2 0.4 0.8 rg 0 0 200 100 re f"+(nativeText?` BT /F1 12 Tf 10 50 Td (${nativeText}) Tj ET`:"");
	const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	let text="%PDF-1.7\n";const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
	const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}

test("the private pdf tool keeps info, search, overview and exact evidence as four distinct modes",async t=>{
	const root=await mkdtemp(join(tmpdir(),"reader-pdf-"));t.after(()=>rm(root,{recursive:true,force:true}));
	const source=join(root,"source.pdf"),cache=join(root,"pages");await writeFile(source,pdf());
	const previous=process.env.PI_COC_READER_SOURCE;process.env.PI_COC_READER_SOURCE=JSON.stringify({pdf:source,cache});
	t.after(()=>{if(previous===undefined)delete process.env.PI_COC_READER_SOURCE;else process.env.PI_COC_READER_SOURCE=previous;});
	let tool,shutdown;readerPdf({on(name,handler){if(name==="session_shutdown")shutdown=handler;},registerTool(value){tool=value;}});
	assert.equal(tool.parameters.type,"object");assert.equal(Object.hasOwn(tool.parameters,"anyOf"),false);assert.equal(tool.parameters.required,undefined);
	const signal=new AbortController().signal,info=await tool.execute("info",{},signal);
	assert.equal(info.details.kind,"source_info");
	const search=await tool.execute("search",{search:{query:"Harbor"}},signal);
	assert.equal(search.details.kind,"source_search");assert.equal(search.details.navigation_only,true);
	assert.equal("observations" in search.details,false);assert.ok(search.content.every(block=>block.type==="text"));
	assert.deepEqual(search.details.text_availability.empty_pages,[1]);
	assert.equal(JSON.parse(search.content[0].text).navigation_only,true);
	await assert.rejects(readFile(join(cache,"requests.jsonl")),error=>error.code==="ENOENT");
	const overview=await tool.execute("overview",{overview:{first_page:1,last_page:1}},signal);
	assert.equal(overview.details.kind,"source_overview");assert.equal("observations" in overview.details,false);
	assert.deepEqual(overview.details.manifest.tiles.map(tile=>tile.page),[1]);
	assert.match(overview.content[0].text,/not source evidence/);assert.equal(overview.content[1].mimeType,"image/jpeg");
	const exact=await tool.execute("page",{pages:[1]},signal);
	assert.equal(exact.details.kind,"source_pages");assert.deepEqual(exact.details.observations.map(row=>row.page),[1]);
	for(const params of [{pages:[1],overview:{first_page:1,last_page:1}},{box:[0,0,1,1]},
		{pages:[1],search:{query:"Harbor"}},{overview:{first_page:1,last_page:1},search:{query:"Harbor"}},
		{box:[0,0,1,1],search:{query:"Harbor"}}])
		await assert.rejects(tool.execute("mixed",params,signal),/exactly one PDF mode/);
	await assert.rejects(tool.execute("mixed",{info:true,search:{query:"Harbor"}},signal),/Unknown PDF mode/);
	await assert.rejects(tool.execute("invalid",{search:{query:""}},signal),/search query/);
	await assert.rejects(tool.execute("cancelled",{search:{query:"Harbor"}},AbortSignal.abort()),/cancelled/);
	await shutdown();
});

test('exact crops retain original images and separately label whole-page native text',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reader-pdf-text-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.pdf');await writeFile(source,pdf('Native page anchor'));
 const previous=process.env.PI_COC_READER_SOURCE;process.env.PI_COC_READER_SOURCE=JSON.stringify({pdf:source,cache:join(root,'pages')});
 t.after(()=>{if(previous===undefined)delete process.env.PI_COC_READER_SOURCE;else process.env.PI_COC_READER_SOURCE=previous;});
 let tool,shutdown;readerPdf({on(n,h){if(n==='session_shutdown')shutdown=h;},registerTool(t){tool=t;}});
 const result=await tool.execute('crop',{pages:[1],box:[0,0,0.5,0.5]},new AbortController().signal);
 const navigation=result.content.filter(b=>b.type==='text').map(b=>{try{return JSON.parse(b.text);}catch{return null;}}).find(b=>b?.kind==='native_page_navigation');
 assert.equal(navigation.page,1);assert.match(navigation.text,/Native page anchor/);assert.match(navigation.note,/whole-page.*not cropped/);
 assert.equal(result.content.filter(b=>b.type==='image').length,1);assert.equal(result.details.kind,'source_pages');assert.deepEqual(result.details.observations[0].box,[0,0,0.5,0.5]);await shutdown();
});
