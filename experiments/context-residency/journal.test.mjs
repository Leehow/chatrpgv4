/** Component evidence for the existing journal seam; no game turns are manufactured. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createRequestJournal as ordinaryJournal} from '../../extensions/table/request-journal.ts';
import {customMessage,requestSize} from '../../extensions/table/context-policy.ts';
import {residentSnapshot} from './residency.ts';
import {journalSnapshotSource,compiledTablePrototype} from './patch-runtime.mjs';

const owner=new URL('../../extensions/table/request-journal.ts',import.meta.url);
const code=stripTypeScriptTypes(journalSnapshotSource(readFileSync(owner,'utf8'))
  .replace("'./context-policy.ts'",JSON.stringify(new URL('../../extensions/table/context-policy.ts',import.meta.url).href)));
const {createRequestJournal}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const packet=(turn,materials=[{alias:'resident 1',content:{detail:'Exact source evidence.'},read:{tool:'lookup',kind:'module',query:'Caretaker'}}])=>({kind:'keeper_support',turn,materials});
const messages=(turn,resident)=>[customMessage('coc-capsule',{turn,where:{scene:'Station'}}),
  {role:'user',content:'A natural follow-up.',timestamp:turn*1000},...(resident?[customMessage('coc-residency-prototype',resident)]:[])];
const input=(turn,resident)=>({key:'one-source-scope',turn,messages:messages(turn,resident),budget:20000});

test('the disabled experiment preserves ordinary journal output',()=>{
  const baseline=ordinaryJournal(),prototype=createRequestJournal();
  for(const turn of [1,2,3]){assert.deepEqual(prototype.project(input(turn)),baseline.project(input(turn)));prototype.commit();baseline.commit();}
});
test('a resident turn update preserves the exact committed prefix',()=>{
  const journal=createRequestJournal(),first=journal.project(input(1,packet(1)));journal.commit();
  const second=journal.project(input(2,packet(2)));
  assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages);
  assert.deepEqual(residentSnapshot(second.messages).value,packet(2));
  assert.ok(!JSON.stringify(second.messages.slice(first.messages.length)).includes('Exact source evidence.'));
});
test('LOD removal is replayed while the retained original prefix stays unchanged',()=>{
  const journal=createRequestJournal(),first=journal.project(input(1,packet(1)));journal.commit();
  const compact=packet(2,[{alias:'resident 1',content:{summary:'Existing identity.'},read:{tool:'lookup',kind:'module',query:'Caretaker'}}]);
  const next=journal.project(input(2,compact));journal.commit();
  assert.deepEqual(next.messages.slice(0,first.messages.length),first.messages);
  assert.deepEqual(residentSnapshot(next.messages).value,compact);
  assert.equal(residentSnapshot(journal.project(input(3)).messages),undefined);
});
test('a capacity checkpoint re-emits a bounded current resident view',()=>{
  const journal=createRequestJournal(),first=journal.project(input(1,packet(1)));journal.commit();
  const current=input(2,packet(2));current.budget=requestSize(current.messages)+100;
  const next=journal.project(current);
  assert.equal(next.observation.reset,'capacity');assert.ok(requestSize(next.messages)<=current.budget);
  assert.deepEqual(residentSnapshot(next.messages).value,packet(2));
});
test('the isolated compiled patch rejects a drifted or duplicate anchor',()=>{
  assert.throws(()=>compiledTablePrototype('unrelated code'),/exactly once/);
  const anchor='    if (singleKeeper && policyFor(ctx.model) && !result.degraded && !result.overCeiling && !omission) {';
  const source='["coc-prescreen", "coc-workspace"];\n'+anchor;
  const patched=compiledTablePrototype(source);
  assert.ok(patched.indexOf('coc:residency-projection')<patched.indexOf(anchor));
  assert.throws(()=>compiledTablePrototype(source+'\n'+anchor),/exactly once/);
});
