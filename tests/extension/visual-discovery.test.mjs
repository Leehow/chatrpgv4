import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {visualScanRanges,validVisualScan,requireVisualOverview} from '../../kernel-ts/modules/visual-discovery.ts';
import {createSourceReaderDriver} from '../../runtime/jev/source-reader-driver.ts';

test('visual navigation covers every physical page independently of text availability',()=>{
 const ranges=visualScanRanges(43);
 assert.deepEqual(ranges,[{first:1,last:20},{first:21,last:40},{first:41,last:43}]);
 assert.equal(validVisualScan({first:1,last:21},43),false);
 assert.equal(validVisualScan({first:21,last:40},43),true);
 assert.equal(validVisualScan({first:21,last:40,complete:true},43),false);
 assert.throws(()=>requireVisualOverview(ranges[0],[1,20]),/page 2/);
 assert.doesNotThrow(()=>requireVisualOverview(ranges[0],Array.from({length:20},(_,i)=>i+1)));
});

test('visual discovery does not use native text relevance to omit an assigned image page',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'visual-discovery-policy-'));
 t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'task.json'),JSON.stringify({purpose:'detail',module_id:'book',visual_scan:{first:1,last:20},source:{page_count:20}}));
 const driver=await createSourceReaderDriver({cwd,env:{},source:{pdf:join(cwd,'source.pdf'),cache:join(cwd,'cache')}});
 const {policy}=await driver.prepare({runId:'visual-run',inputRevision:'v1',rawInput:'Scan visuals',session:{}});
 const request=state=>policy.next({policyState:state,pendingProposals:[],steps:0});
 let state=policy.initial({});
 assert.equal(request(state).proposals[0].operation,'source.catalog');
 state=policy.reduce(state,{kind:'operate',origin:'policy',status:'ok',outcomes:[{artifact:{kind:'catalog'}}]},{});
 assert.equal(request(state).proposals[0].operation,'source.project','no relevance question may discard text-rich visual pages');
 state=policy.reduce(state,{kind:'operate',origin:'policy',status:'ok',outcomes:[{artifact:{kind:'projected'}}]},{});
 assert.equal(request(state).kind,'infer','the real tool-enabled vision reader performs discovery');
});

test('held image handouts follow actual delivered receipts and disappear from the current board after rewind',async t=>{
 const {heldHandouts}=await import('../../kernel-ts/read/handout-document.ts');
 const dir=await mkdtemp(join(tmpdir(),'held-handout-images-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const receipt={kind:'handout',handout:'paper',label:'Morning newspaper',visibility:'player-safe',attachment:{path:'/owned/paper.png',media_type:'image/png',available:true}};
 assert.deepEqual(await heldHandouts(dir,['paper','unrevealed'],[receipt]),[{handout:'paper',name:'Morning newspaper',text:'',path:'/owned/paper.png',media_type:'image/png',document:'ready'}]);
 assert.deepEqual(await heldHandouts(dir,[],[receipt]),[]);
 assert.deepEqual(await heldHandouts(dir,['paper'],[{...receipt,visibility:'keeper-only'}]),[]);
});
