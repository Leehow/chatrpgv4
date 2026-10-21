import test from 'node:test';import assert from 'node:assert/strict';
import {Check} from 'typebox/value';
import {PlaceEffect,PlaceChange,NativePlaceParameters,PlaceParameters} from '../../shared/place-structures.ts';
const observe=facts=>({action:'observe',to:'Hall',sense:'sight',access:'clear',scope:'The near wall.',facts});
for(const [label,facts] of [
 ['eight short facts',['Table','Tray','Letters','Hooks','Coats','Umbrellas','Mirror','Doorway']],
 ['one complete long fact',[String.fromCodePoint(0x4e00).repeat(16000)]],
 ['many long facts',Array.from({length:65},(_,i)=>String(i)+' '+String.fromCodePoint(0x1f642).repeat(700))],
])test(label+' pass every observation entry schema intact',()=>{
 const before=structuredClone(facts),change=observe(facts);
 assert.equal(Check(PlaceEffect,{kind:'place',...change}),true);
 assert.equal(Check(PlaceChange,change),true);
 assert.equal(Check(NativePlaceParameters,change),true);
 assert.equal(Check(PlaceParameters,{op:'submit',change}),true);
 assert.deepEqual(facts,before);
});
test('observation facts still require strings and reject undeclared fields',()=>{
 for(const facts of [null,'A table',[42],['']])assert.equal(Check(PlaceEffect,{kind:'place',...observe(facts)}),false);
 assert.equal(Check(PlaceEffect,{kind:'place',...observe(['Table']),invented:true}),false);
});
