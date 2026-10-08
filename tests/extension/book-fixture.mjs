/**
 * A module book for the prescreen's source tests (contract §196, §196.7): a real PDF of plain lines, page transcripts made by
 * the real assembly over each page's own native lines and published by the real store, a module bound to that PDF and read
 * through the kernel's real reader jobs, and a campaign opened on it with one player line. The source runtime is the host's
 * §191.7 reader (`readSourcePageText`) over that store, with the runtime's home and content root as the product's has them.
 *
 * `api` is the caller's bundle; it must export what `bookFixture` uses (see `prescreen-paragraph-units.test.mjs`).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const sha=value=>createHash('sha256').update(value).digest('hex');

/** A PDF whose page `i` prints `pages[i]`, one line each, in order. */
export function linesPdf(pages){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [i,lines] of pages.entries()){
    const stream=`BT /F1 8 Tf 10 TL 10 780 Td ${lines.map(line=>`(${line}) Tj T*`).join(' ')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let text='%PDF-1.7\n';const offsets=[];
  for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(text),size=objects.length+1;
  return text+`xref\n0 ${size}\n0000000000 65535 f \n${offsets.map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const save=(path,value)=>writeFile(path,JSON.stringify(value));

/**
 * `spec`: {pages, layouts:{page:layout}, index:{sections}, opening:{nodes,claims,ready_nodes}, openingPages, text, seed}.
 * Returns {home, mid, call, opened, input, capsule, binding, source, store, content}.
 */
export async function bookFixture(t,api,content,spec){
  const home=await mkdtemp(join(tmpdir(),`${spec.seed}-`)),pdf=join(home,'source.pdf'),bytes=Buffer.from(linesPdf(spec.pages));await writeFile(pdf,bytes);
  const context=await api.createKernelContext({workspace:home,content,seed:spec.seed,
    locks:api.nativeAdvisoryLocks(),env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}),runtime=api.createKernelRuntime(context);
  t.after(async()=>{await runtime.close();await context.git.close();await api.closeSourceDocuments();
    await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const call=(method,params={})=>runtime.handlers[method](params),contract={
    graph:JSON.parse(await readFile(join(content,'modules/module-graph-contract-v3.json'),'utf8')),
    template:JSON.parse(await readFile(join(content,'modules/module-graph-template-v1.json'),'utf8'))};
  // The page transcripts: the real assembly over each page's own native lines, published through the real store.
  const store=new api.TranscriptStore({home,contentRoot:content,extractionVersion:api.sourceTextVersion});
  for(const [page,layout] of Object.entries(spec.layouts)){
    const lines=await api.sourceLines(pdf,{pages:[Number(page)]}),row=lines.pages[0],assembly=api.assembleLayout(layout,row.lines);
    assert.deepEqual(assembly.unplaced,[],`page ${page} places every line`);
    assert.equal(await store.put({schema:api.TRANSCRIPT_RECORD_SCHEMA,transcript_version:'transcript-v1',file_sha256:lines.file_sha256,page:Number(page),
      pdf_label:row.pdf_label,native:{extraction_version:lines.extraction_version,text_sha256:row.native_sha256,line_count:row.lines.length},
      text:assembly.text,text_sha256:sha(assembly.text),markdown:assembly.markdown,image_text:assembly.image_text,figures:assembly.figures,
      dropped:assembly.dropped,unplaced:assembly.unplaced,free_removed:assembly.free_removed,attempts:1,model:'fixture/vision',thinking:'low',
      at:new Date().toISOString()},row.lines),'stored');
  }
  const {module_id:mid}=await call('module.source.bind',{module_id:spec.moduleId??'harbor-book',title:'Harbor Book',
    source:{path:pdf,file_sha256:sha(bytes),page_count:spec.pages.length}});
  const finish=async(job,draft,pages)=>{
    const refs=pages.map(page=>({page})),checked=job.purpose==='index'?[]:api.checkDraft(draft,job,contract,new Set(pages)).required_review;
    await Promise.all([save(join(job.work_dir,'draft.json'),draft),save(join(job.work_dir,'review.json'),{
      checked:checked.length?[{paths:checked,verdict:'supported',source_refs:refs,reason:'The supplied original pages support these fields.'}]:[],missing:[]}),
      save(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:pages,full_pages:pages,review_pages:pages})]);
    return call('module.read.finish',{module_id:mid,job_id:job.job_id,lease:job.lease,outcome:'completed',
      draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')});
  };
  const claim=async params=>{const queued=await call('module.read.request',{module_id:mid,...params});assert.equal(queued.state,'queued');
    const job=await call('module.read.claim',{module_id:mid,owner:'book-fixture'});assert.equal(job.job_id,queued.job_id);return job;};
  await finish(await claim({purpose:'index'}),{title:'Harbor Book',language:'en',sections:spec.index.sections},[1]);
  await finish(await claim({purpose:'opening'}),{...spec.opening,node_refs:[],coverage:{},dependencies:[],critical:[]},spec.openingPages);
  await call('campaign.create',{id:'card-source',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const saved=await call('investigator.save',{campaign:'card-source'});await call('campaign.create',{id:'c1',module:mid,play_language:'en'});
  await call('investigator.load',{campaign:'c1',library_id:saved.library_id});await call('setup.complete',{campaign:'c1'});
  const opened=await call('table.open',{campaign:'c1'}),input=await call('table.player_input',{campaign:'c1',text:spec.text});
  const view=await call('table.capsule',{campaign:'c1',rehydrate:true}),{_context,...capsule}=view;
  const source={home,contentRoot:content,sourceInfo:({pdf:path})=>api.sourceInfo(path),
    sourceSearch:({pdf:path,...options},signal)=>api.sourceSearch(path,options,signal,store),
    sourceText:({pdf:path,...options},signal)=>api.sourceText(path,options,signal),
    sourcePageText:({pdf:path,...options},signal)=>api.readSourcePageText({pdf:path,options,store,
      nativeText:({pdf:file,...native},cancel)=>api.sourceText(file,native,cancel),digest:async()=>sha(bytes)},signal)};
  return{home,mid,call,opened,input,capsule,binding:_context,source,store,content};
}
