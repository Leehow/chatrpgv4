/** Prefetch (PI_COC_KP_PREFETCH=1): the foci the host asks, and the first step's bounded wait for them. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prefetchTargets,PREFETCH_FOCI} from '../../runtime/prefetch.ts';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';

const capsule={where:{scene:'harbour',exits:[{to:'church',display_name:'圣玛丽教堂'},{to:'cellar'}]},
 present:[{ref:'npc_1',display_name:'港务长'}],npc_references:{people:[{ref:'npc_2',display_name:'哈尔牧师'}]},
 documents_in_reach:{rows:[{name:'航海日志',holder:'Mara',reach:'investigator'}]}};

test('the current place first, then the one issued name the words carry, longest first, at most two',()=>{
 assert.deepEqual(prefetchTargets(capsule,'我去圣玛丽教堂找哈尔牧师'),[{focus:'harbour',kind:'scene'},{focus:'church',kind:'place'}]);
 assert.deepEqual(prefetchTargets(capsule,'我翻看航海日志'),[{focus:'harbour',kind:'scene'},{focus:'航海日志',kind:'document'}]);
 assert.deepEqual(prefetchTargets(capsule,'我四处看看'),[{focus:'harbour',kind:'scene'}],'no name: the place only');
 assert.ok(prefetchTargets(capsule,'港务长 哈尔牧师 航海日志').length<=PREFETCH_FOCI);
});

test('settle waits for this input\'s prefetched answers only when asked to',async()=>{
 const answers=new PendingAnswers(()=>{});
 let land;const settled=new Promise(resolve=>{land=resolve;});
 answers.register('c',{focus:'harbour',question:'q'},5,undefined,settled,'answer','harbour',undefined,'o',true);
 const plain=await answers.settle('c',{scene:'harbour',turn:5,ms:50});
 assert.deepEqual(plain.foci,[],'a same-turn ask is not waited for without prefetch');
 setTimeout(()=>land({source_answer:{status:'landed',excerpts:[]}}),20);
 const waited=await answers.settle('c',{scene:'harbour',turn:5,ms:500,prefetch:true});
 assert.deepEqual(waited.foci,['harbour']);assert.equal(waited.landed,1);
});

import {readCarriedViews,prefetchedPages} from '../../runtime/jev/carried-views.ts';

const hostPages=(n,chars)=>({status:'excerpts',authority:'original-source-excerpts',prepared:false,host_pages:true,question:'q',
 excerpts:Array.from({length:n},(_,i)=>({id:`page-${i+1}`,page:i+1,start:0,end:chars,text:'页'.repeat(chars)})),
 source_refs:Array.from({length:n},(_,i)=>({source_id:'pdf:x',pdf_index:i})),coverage:{partial:true}});

test('a prefetched host-cut answer rides whole, whole pages up to the budget, with no read_next',async()=>{
 const carried=await readCarriedViews({call:async()=>{throw Error('no reads');},people:[],answers:[{name:'harbour',view:hostPages(2,500),prefetch:true,cached:true}]});
 const view=carried.views.find(v=>v.focus==='source_answer').view;
 assert.equal(view.excerpts.length,2);assert.equal(view.delivery.complete,true);assert.equal(view.read_next,undefined);assert.equal(view.delivery.pages_not_sent,undefined);
 const big=prefetchedPages(hostPages(4,2000),16*1024).view;
 assert.deepEqual(big.excerpts.map(e=>e.page),[1,2],'whole pages in book order until the budget');
 assert.deepEqual(big.delivery.pages_not_sent,[3,4]);assert.equal(big.read_next,undefined);
 assert.deepEqual(big.source_refs.map(r=>r.pdf_index),[0,1]);
});

test('without the prefetch mark the same answer is paged as before',async()=>{
 const carried=await readCarriedViews({call:async()=>{throw Error('no reads');},people:[],answers:[{name:'harbour',view:hostPages(4,2000),cached:true}]});
 const view=carried.views.find(v=>v.focus==='source_answer').view;
 assert.equal(view.delivery.complete,false);assert.ok(view.read_next);
});
