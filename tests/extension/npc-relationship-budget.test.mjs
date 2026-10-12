/** Structural pressure regressions; these fixtures are not real Keeper acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, symlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {npcMemoryPayloadDigests} from '../../extensions/npc/profile-observation.ts';
const root=resolve(import.meta.dirname,'../..'),parent=join(root,'.pi/npc-relationship-budget-tests');
await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'run-'));
await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
await build({stdin:{contents:`export {fitPresent} from './kernel-ts/read/assemble.ts'; export {fitBudget,jsonSize} from './kernel-ts/read/capsule.ts';`,
 resolveDir:root,sourcefile:'relationship-budget-api.ts'},outfile:join(dir,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const {fitPresent,fitBudget,jsonSize}=await import(pathToFileURL(join(dir,'api.mjs')).href);
const report=(turn,letter='x')=>({kind:'relationship',statement:`After repeated attribution requests the vendor declined further conversation. ${letter.repeat(320)}`,
 turn,state:'uncertain',status:'candidate',authority:'conversation_report',attribution:{kind:'speech',speaker:{kind:'npc',name:'Vendor'},qualifiers:['heard','quoted']}});
const card=()=>({name:'Vendor',now:{feels:'Wary after the visitor ignored a clear refusal.',since_turn:4},
 personality:{description:'A working vendor.'},knowledge_reports:Array.from({length:12},(_,i)=>({statement:`Report ${i}: ${'k'.repeat(450)}`})),
 relationships:[{toward:'Visitor',evidence:[report(4),report(3),report(2)]},{toward:'Neighbor',evidence:[report(1,'y')]}]});
test('pressure keeps the newest directed report whole, never a target with empty evidence',()=>{
 const rows=[card()],latest=structuredClone(rows[0].relationships[0].evidence[0]),now=structuredClone(rows[0].now);
 assert(fitPresent(rows,1600));assert(jsonSize(rows)<=1600);
 assert(!rows[0].truncated);assert.deepEqual(rows[0].now,now);
 assert.deepEqual(rows[0].relationships[0],{toward:'Visitor',evidence:[latest]});
 for(const tie of rows[0].relationships)assert(tie.evidence.length);
 assert(rows[0].coverage.relationship_reports_omitted>=2);
});
test('the original generic leaf cut reproduces empty evidence; its other callers remain unchanged',()=>{
 const rows=[{name:'Vendor',description:'d'.repeat(1000),relationships:[{toward:'Visitor',evidence:[report(4)]}]}];assert(fitBudget(rows,1150));
 assert(rows.some(p=>p.relationships?.some(tie=>tie.evidence.length===0)));
 const ordinary={items:[{label:'a'.repeat(120)},{label:'b'.repeat(120)}]};assert(fitBudget(ordinary,170));assert.equal(ordinary.items.length,1);
});
test('normal allowance leaves complete relationships and attributes unchanged',()=>{
 const rows=[card()],before=structuredClone(rows);assert.equal(fitPresent(rows,20000),false);assert.deepEqual(rows,before);
});
test('whole-person stubs retain identity and disclose omitted relationships without an empty shell',()=>{
 const rows=[{name:'First'},{...card(),name:'Second'}];assert(fitPresent(rows,180));
 assert(rows.some(p=>p.name==='Second'));const second=rows.find(p=>p.name==='Second');assert(second.truncated);
 assert(!second.relationships);assert(second.coverage.relationship_reports_omitted>0);
 assert(jsonSize(rows)<=180);
});
test('activity and actor kind survive the same pressure while relation attribution stays atomic',()=>{
 const rows=[{...card(),kind:'person',activity:{wakefulness:'awake',source:'committed'},untold:{say_name:'issued name token'}}];
 const latest=structuredClone(rows[0].relationships[0].evidence[0]);fitPresent(rows,1700);
 assert.equal(rows[0].kind,'person');assert.equal(rows[0].untold.say_name,'issued name token');
 assert.deepEqual(rows[0].activity,{wakefulness:'awake',source:'committed'});
 assert.deepEqual(rows[0].relationships[0].evidence[0],latest);
});
test('retained evidence appears in the actual adapter JSON observation without changing its statement',()=>{
 const rows=[card()],before=structuredClone(rows[0].relationships[0]);fitPresent(rows,1600);
 const observed=npcMemoryPayloadDigests({input:[{role:'tool',content:JSON.stringify({present:rows})}]});
 const expected=npcMemoryPayloadDigests({name:'Vendor',relationships:[{toward:before.toward,evidence:[before.evidence[0]]}]});
 assert(observed[0].relationship_digests.includes(expected[0].relationship_digests[0]));
 assert.equal(rows[0].relationships[0].evidence[0].statement,before.evidence[0].statement);
});
