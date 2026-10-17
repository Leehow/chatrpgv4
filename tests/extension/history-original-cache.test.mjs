import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSnapshotReadCache} from '../../extensions/table/history-original-cache.ts';
test('only verified exact-snapshot originals reuse bytes; listings and changed source stay fresh',async()=>{
 const cache=createSnapshotReadCache(),params={_snapshot:'commit-one',read:{kind:'transcript',turn:3,offset:0,limit:50}};let calls=0;
 const load=async()=>{calls++;return{verified:true,_snapshot:'commit-one',text:'The original words.',range:{offset:0}};};
 const first=await cache.read('campaign/line',params,load);first.value.text='Caller mutation';
 assert.equal((await cache.read('campaign/line',params,load)).value.text,'The original words.');assert.equal(calls,1);
 assert.equal((await cache.read('campaign/other',params,load)).reused,false);
 await cache.read('campaign/line',{...params,_snapshot:'commit-two'},load);assert.equal(calls,3);
 const listing=async()=>{calls++;return{_snapshot:'commit-one',cards:[]};};
 await cache.read('campaign/line',{what:'transcript',turns:[3,3]},listing);await cache.read('campaign/line',{what:'transcript',turns:[3,3]},listing);assert.equal(calls,5);
 cache.clear();await cache.read('campaign/line',params,load);assert.equal(calls,6);
});
test('unverified failures are never cached and identical in-flight originals share one load',async()=>{
 const cache=createSnapshotReadCache(),params={_snapshot:'one',read:{id:'original'}};let calls=0,release;
 const load=async()=>{calls++;await new Promise(r=>release=r);return{verified:true,_snapshot:'one',text:'Exact.'};};
 const a=cache.read('line',params,load),b=cache.read('line',params,load);release();assert.equal((await a).reused,false);assert.equal((await b).reused,true);assert.equal(calls,1);
 const bad=async()=>{calls++;return{verified:false,_snapshot:'one',text:'Unchecked.'};};
 const other={...params,read:{id:'unverified'}};await cache.read('line',other,bad);await cache.read('line',other,bad);assert.equal(calls,3);
});
test('an unverified in-flight result is not reused and clearing a session prevents late storage',async()=>{
 const cache=createSnapshotReadCache(),params={_snapshot:'one',read:{id:'original'}};let calls=0,release;
 const load=async()=>{if(++calls===1){await new Promise(r=>release=r);return{verified:false,_snapshot:'one'};}return{verified:true,_snapshot:'one',text:'Verified.'};};
 const first=cache.read('line',params,load),second=cache.read('line',params,load);release();
 assert.equal((await first).reused,false);assert.equal((await second).reused,false);assert.equal(calls,2);
 let finish;const delayed=()=>new Promise(r=>finish=()=>r({verified:true,_snapshot:'two',text:'Old session.'}));
 const other={...params,_snapshot:'two'},pending=cache.read('line',other,delayed);cache.clear();finish();await pending;
 assert.equal((await cache.read('line',other,async()=>({verified:true,_snapshot:'two',text:'New session.'}))).reused,false);
});
