// Mechanical guards only. No provider requests or visual quotation verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateDataset,validateBindings,digest,buildInput} from './bank.mjs';
import {prepareUnseen,scoreUnseen,unseenSchedule,unseenSummary,dispatchAfterIntent,readResponseText} from './unseen-core.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const datasets=['eye','train','bast'].map(n=>JSON.parse(fs.readFileSync(new URL(`./unseen-${n}.json`,import.meta.url))));
const template=JSON.parse(fs.readFileSync(new URL('./pdf.json',import.meta.url))).cases.find(c=>c.id==='idol-context-fidelity').questions;
const body=(p,choices)=>({answers:Object.fromEntries(Object.entries(p.request.questions).map(([k,q])=>[k,{choice:choices[k]??Object.keys(q.criteria)[0]}]))});

test('new validation uses three families, six controlled arms each, and 36 single calls',()=>{
  const tasks=unseenSchedule(datasets);assert.equal(tasks.length,36);
  assert.equal(new Set(tasks.map(t=>t.case_id)).size,3);
  for(const d of datasets){validateDataset(d);assert.equal(d.cases.length,1);const c=d.cases[0];assert.equal(c.arms.length,6);
    assert.deepEqual([...new Set(c.arms.map(a=>a.input.player_text))],[c.arms[0].input.player_text]);
    assert.deepEqual([...new Set(c.arms.map(a=>a.input.situation))],[c.arms[0].input.situation]);
    for(const a of c.arms)assert.deepEqual(a.input.candidates,c.arms[0].input.candidates);
    assert.deepEqual(c.questions.content,template.content);assert.deepEqual(c.questions.source_support,template.source_support);
    assert.equal(c.questions.selection.instructions,template.selection.instructions);
    assert.equal(c.selection_options.length,2**c.arms[0].input.candidates.length);
  }
  assert.throws(()=>unseenSchedule(datasets,3),/budget exceeded/);
});
for(const d of datasets)test(`${d.id}: authentic image bindings require separate visual review`,t=>{
  const v=validateBindings(d,root,{allowMissing:true});if(v.unavailable.length){t.skip('Local source image unavailable');return;}
  assert.equal(v.checked,d.sources.length);assert.equal(v.text_quotes_checked,0);
  assert.deepEqual(v.visual_review_required,d.sources.map(s=>s.id));
});
test('source images and document/page identity are checked, but image hashes do not prove quote text',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jev-visual-binding-'));
  try{
    const image=path.join(temp,'page.png'),record=path.join(temp,'page.json');
    fs.writeFileSync(image,'mechanical image fixture, not a visual-verification result');
    const meta={path:image,page:5,file_sha256:'a'.repeat(64),image_sha256:digest(fs.readFileSync(image))};
    fs.writeFileSync(record,JSON.stringify(meta));
    const s={id:'test-source',kind:'pdf-visual',path:'page.json',sha256:digest(fs.readFileSync(record)),document_sha256:meta.file_sha256,
      selector:{type:'pdf-image',page:5},quote:'The mechanical check cannot establish whether this sentence appears in the image.'};
    const d={sources:[s]};assert.deepEqual(validateBindings(d,temp).visual_review_required,['test-source']);
    assert.throws(()=>validateBindings({sources:[{...s,selector:{type:'pdf-image',page:6}}]},temp),/image page mismatch/);
    assert.throws(()=>validateBindings({sources:[{...s,document_sha256:'b'.repeat(64)}]},temp),/PDF identity mismatch/);
    fs.writeFileSync(image,'changed');assert.throws(()=>validateBindings(d,temp),/image bytes changed/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('image and metadata symlinks cannot escape the declared source root',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jev-visual-root-'));
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'jev-visual-outside-'));
  try{
    const image=path.join(temp,'image.png'),external=path.join(outside,'image.png');
    fs.writeFileSync(external,'mechanical boundary fixture');fs.symlinkSync(external,image);
    const record=path.join(temp,'page.json');
    const bytes=JSON.stringify({path:image,page:5,file_sha256:'a'.repeat(64),image_sha256:digest(fs.readFileSync(external))});
    fs.writeFileSync(record,bytes);
    const d={sources:[{id:'test',kind:'pdf-visual',path:'page.json',sha256:digest(Buffer.from(bytes)),document_sha256:'a'.repeat(64),selector:{type:'pdf-image',page:5},quote:'unverified fixture'}]};
    assert.throws(()=>validateBindings(d,temp),/Image real path escapes root/);
    const externalRecord=path.join(outside,'page.json');fs.writeFileSync(externalRecord,bytes);
    fs.unlinkSync(record);fs.symlinkSync(externalRecord,record);
    assert.throws(()=>validateBindings(d,temp),/Source real path escapes root/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
test('failure during intent persistence cancels a queued send without pretending it reached the provider',async()=>{
  let stopped=false,release,sends=0,cancels=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const work=dispatchAfterIntent({isStopped:()=>stopped,writeIntent:()=>pending,cancelled:async()=>{cancels++;},send:async()=>{sends++;return {ok:true};}});
  stopped=true;release();assert.equal(await work,null);assert.equal(sends,0);assert.equal(cancels,1);
});
test('a known failure prevents new sends while an already-started request may finish',async()=>{
  let stopped=false,release,sends=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const first=dispatchAfterIntent({isStopped:()=>stopped,writeIntent:async()=>{},cancelled:async()=>{},send:()=>{sends++;return pending;}});
  await Promise.resolve();assert.equal(sends,1);
  stopped=true;
  const next=await dispatchAfterIntent({isStopped:()=>stopped,writeIntent:async()=>{throw Error('should not write');},cancelled:async()=>{},send:async()=>{sends++;}});
  assert.equal(next,null);release({ok:true});assert.deepEqual(await first,{ok:true});assert.equal(sends,1);
});
test('HTTP failure stops new dispatch before its delayed error body is read',async()=>{
  let stopped=false,release,sends=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const text=readResponseText({ok:false,text:()=>pending},()=>{stopped=true;});
  assert.equal(stopped,true);
  const result=await dispatchAfterIntent({isStopped:()=>stopped,writeIntent:async()=>{},cancelled:async()=>{},send:async()=>{sends++;}});
  assert.equal(result,null);assert.equal(sends,0);
  release('delayed error body');assert.equal(await text,'delayed error body');
});
test('evaluation gold and audit metadata cannot alter a model request',()=>{
  for(const d of datasets)for(const c of d.cases)for(const a of c.arms){
    const p=prepareUnseen(d,c.id,a.id),copy=structuredClone(d);
    for(const cc of copy.cases)for(const aa of cc.arms)aa.expected={canary:'GOLD_CANARY'};
    copy.audit={canary:'AUDIT_CANARY'};
    assert.deepEqual(prepareUnseen(copy,c.id,a.id).mixed.request,p.mixed.request);
    assert(!JSON.stringify(p.mixed.request).includes('GOLD_CANARY'));
    assert.equal(Object.keys(p.mixed.request.questions.selection.criteria).length,64);
    if(a.id==='faithful-full')assert(buildInput(d,c.id,a.id).state.existing_material.every(m=>m.provenance==='context_report'));
  }
});
test('prospective host decisions reuse one untouched raw response',()=>{
  const d=datasets[1],c=d.cases[0],p=prepareUnseen(d,c.id,'faithful-full');
  const b=body(p.mixed,{content:'complete',source_support:'complete',selection:'set_0'}),before=structuredClone(b);
  const grades=scoreUnseen(d,c.id,'faithful-full',p,b);
  assert.equal(grades.raw.fields.source_support,false);assert.equal(grades['single-host-boundaries'].all_correct,true);
  assert.equal(grades['single-host-boundaries'].source_support_origin,'host_absence_floor');assert.deepEqual(b,before);
});
test('false-ready host stop can harm recall and is reported rather than hidden by overall failure',()=>{
  const d=datasets[1],c=d.cases[0],p=prepareUnseen(d,c.id,'empty');
  const wanted=p.mixed.binding.selection_options.find(o=>o.materials.join('|')==='train-A|train-B|train-C');
  const grades=scoreUnseen(d,c.id,'empty',p,body(p.mixed,{content:'complete',source_support:'incomplete',selection:wanted.id}));
  assert.equal(grades.raw.all_correct,false);assert.equal(grades.raw.selection_exact,true);
  assert.equal(grades['single-host-boundaries'].declared_evidence_units_covered,false);
  const rows=Object.entries(grades).map(([policy,grade])=>({dataset_id:d.id,case_id:c.id,arm_id:'empty',repeat:1,policy,grade,ok:true,ms:10,usage:{input_tokens:100,output_tokens:10}}));
  const s=unseenSummary(rows,1);assert.equal(s.completed_api_attempts,1);
  assert.equal(s.policies['single-host-boundaries'].lost_coverage_vs_raw,1);
  assert.equal(s.policies['single-host-boundaries'].lost_exact_selection_vs_raw,1);
});
test('malformed responses are unavailable for every derived policy',()=>{
  const d=datasets[1],c=d.cases[0],p=prepareUnseen(d,c.id,'empty');
  for(const g of Object.values(scoreUnseen(d,c.id,'empty',p,{})))assert.equal(g.available,false);
});
