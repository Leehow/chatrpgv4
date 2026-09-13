import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import readerPdf from "../../extensions/module/reader-pdf.ts";

function pdf() {
	const stream="0.2 0.4 0.8 rg 0 0 200 100 re f";
	const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
	let text="%PDF-1.7\n";const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
	const xref=Buffer.byteLength(text);text+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return text;
}

test("the private pdf tool keeps info, overview and exact evidence as three distinct modes",async t=>{
	const root=await mkdtemp(join(tmpdir(),"reader-pdf-"));t.after(()=>rm(root,{recursive:true,force:true}));
	const source=join(root,"source.pdf"),cache=join(root,"pages");await writeFile(source,pdf());
	const previous=process.env.PI_COC_READER_SOURCE;process.env.PI_COC_READER_SOURCE=JSON.stringify({pdf:source,cache});
	t.after(()=>{if(previous===undefined)delete process.env.PI_COC_READER_SOURCE;else process.env.PI_COC_READER_SOURCE=previous;});
	let tool,shutdown;readerPdf({on(name,handler){if(name==="session_shutdown")shutdown=handler;},registerTool(value){tool=value;}});
	const signal=new AbortController().signal,info=await tool.execute("info",{},signal);
	assert.equal(info.details.kind,"source_info");
	const overview=await tool.execute("overview",{overview:{first_page:1,last_page:1}},signal);
	assert.equal(overview.details.kind,"source_overview");assert.equal("observations" in overview.details,false);
	assert.deepEqual(overview.details.manifest.tiles.map(tile=>tile.page),[1]);
	assert.match(overview.content[0].text,/not source evidence/);assert.equal(overview.content[1].mimeType,"image/jpeg");
	const exact=await tool.execute("page",{pages:[1]},signal);
	assert.equal(exact.details.kind,"source_pages");assert.deepEqual(exact.details.observations.map(row=>row.page),[1]);
	for(const params of [{pages:[1],overview:{first_page:1,last_page:1}},{box:[0,0,1,1]}])
		await assert.rejects(tool.execute("mixed",params,signal),/exactly one PDF mode/);
	await shutdown();
});
