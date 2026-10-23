/**
 * Contract §257.15 through the kernel's real entries: a bound book whose graph carries no exhibits, a campaign opened on it
 * (`table.open`) and a move made with `table.apply`. The scene the table opens in and the scene a move arrives at are each
 * queued one background exhibits read; re-entering queues no second. Jobs are observed as the reader would claim them.
 */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {after,before,test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {bookFixture} from './book-fixture.mjs';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
let api,bundle;
before(async()=>{
  await mkdir(join(ROOT,'.tmp'),{recursive:true});bundle=await mkdtemp(join(ROOT,'.tmp/legacy-scene-exhibits-'));
  await build({stdin:{contents:[
    "export {createKernelContext} from './kernel-ts/context.ts';",
    "export {createKernelRuntime} from './kernel-ts/registry.ts';",
    "export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
    "export {checkDraft} from './kernel-ts/modules/visual.ts';",
    "export {sourceInfo,sourceLines,sourceSearch,sourceText,sourceTextVersion,closeSourceDocuments} from './extensions/module/source.ts';",
    "export {assembleLayout} from './extensions/module/page-transcript.ts';",
    "export {TRANSCRIPT_RECORD_SCHEMA,TranscriptStore} from './extensions/module/transcript-store.ts';",
    "export {readSourcePageText} from './extensions/module/source-page-text.ts';",
  ].join('\n'),resolveDir:ROOT,sourcefile:'legacy-scene-exhibits-entry.ts'},outfile:join(bundle,'api.mjs'),bundle:true,
    packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  api=await import(pathToFileURL(join(bundle,'api.mjs')).href);
});
after(async()=>{await api?.closeSourceDocuments?.();if(bundle)await rm(bundle,{recursive:true,force:true});});

const PAGES=[['Harbor District','The pier is old.','1'],['The lighthouse stands on the rock.','2']];
const fixture=t=>bookFixture(t,api,CONTENT,{seed:'legacy-scene-exhibits',pages:PAGES,layouts:{},
  index:{sections:[{name:'Harbor District',pages:[[1,2]],topics:['opening'],entities:['Pier','Lighthouse'],references:[],source_refs:[{page:1}]}]},
  opening:{nodes:[
    {node_id:'scene-pier',node_kind:'scene',name:'Pier',source_refs:[{page:1}],properties:{is_entrance:true}},
    {node_id:'scene-lighthouse',node_kind:'scene',name:'Lighthouse',source_refs:[{page:2}],properties:{is_final:true}}],
    claims:[{subject_id:'scene-pier',predicate:'route-to',object:{node_id:'scene-lighthouse'},truth_status:'authored-fact',source_refs:[{page:1}]}],
    ready_nodes:['scene-pier','scene-lighthouse']},openingPages:[1,2],text:'I look around.'});

/** Every job the reader can claim now, as claimed; the exhibits ones by focus. */
async function exhibitsJobs(f){
  const seen=[];
  for(;;){
    const job=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'legacy-exhibits'}).catch(()=>null);
    if(!job||!job.job_id||seen.some(value=>value.job_id===job.job_id))break;
    seen.push(job);
  }
  return seen.filter(job=>job.material==='exhibits').map(job=>({focus:job.focus,foreground:job.foreground,purpose:job.purpose}));
}

test('the scene the table opens in is queued one background exhibits read, and a move queues the arrival scene once', async t=>{
  const f=await fixture(t);
  const first=await exhibitsJobs(f);
  assert.deepEqual(first.map(job=>job.focus),['pier'],'the opening scene is read for exhibits');
  assert.ok(first.every(job=>job.foreground===false&&job.purpose==='detail'));
  await f.call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The opening.'});
  await f.call('table.player_input',{campaign:'c1',text:'I walk to the lighthouse.'});
  await f.call('table.apply',{campaign:'c1',call_id:'t1-c1',effects:[{kind:'move',to:'lighthouse'}]});
  assert.deepEqual((await exhibitsJobs(f)).map(job=>job.focus),['lighthouse'],'the arrival scene is read, the opening one is not queued again');
  await f.call('table.apply',{campaign:'c1',call_id:'t1-c2',effects:[{kind:'move',to:'pier'}]});
  assert.deepEqual(await exhibitsJobs(f),[],'re-entering a scene already queued queues no second read');
});

test('the exhibits read of the scene the table is in is claimed first; the scene left behind falls back to the least urgent', async t=>{
  const f=await fixture(t);
  await f.call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The opening.'});
  await f.call('table.player_input',{campaign:'c1',text:'I walk to the lighthouse.'});
  await f.call('table.apply',{campaign:'c1',call_id:'t1-c1',effects:[{kind:'move',to:'lighthouse'}]});
  const order=[];
  for(;;){
    const job=await f.call('module.read.claim',{campaign:'c1',module_id:f.mid,owner:'legacy-exhibits'}).catch(()=>null);
    if(!job||!job.job_id||order.some(value=>value.job_id===job.job_id))break;
    order.push(job);
  }
  const labels=order.map(job=>job.material==='exhibits'?`exhibits:${job.focus}`:String(job.purpose));
  assert.equal(labels[0],'exhibits:lighthouse',`the current scene's exhibits read goes first: ${labels.join(', ')}`);
  assert.equal(labels.at(-1),'exhibits:pier',`the scene left behind goes last: ${labels.join(', ')}`);
});
