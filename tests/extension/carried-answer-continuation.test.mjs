/** A source answer the host still retains rides with its continuation; one it no longer holds says so. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCarriedViews} from '../../runtime/jev/carried-views.ts';

const longAnswer={status:'landed',prepared:false,excerpts:Array.from({length:12},(_,i)=>({page:i+1,text:`passage ${i} `.repeat(60)}))};
const call=async()=>{throw Error('nothing is read for held answers');};

test('a held answer the host retains carries read_next and no cache_unavailable mark',async()=>{
 const carried=await readCarriedViews({call,people:[],held:[{name:'the-ruins',view:{...longAnswer,question:'what is in the vault'},cached:true}]});
 const view=carried.views.find(v=>v.focus==='source_answer')?.view;
 assert.ok(view,'carried');assert.equal(view.delivery.complete,false);
 assert.equal(view.delivery.cache_unavailable,undefined);
 assert.deepEqual(view.read_next?.answer_part,1);
});

test('a held answer without the host copy is marked cache_unavailable and offers no continuation',async()=>{
 const carried=await readCarriedViews({call,people:[],held:[{name:'the-ruins',view:{...longAnswer,question:'what is in the vault'}}]});
 const view=carried.views.find(v=>v.focus==='source_answer')?.view;
 assert.equal(view.delivery.cache_unavailable,true);assert.equal(view.read_next,undefined);
});
