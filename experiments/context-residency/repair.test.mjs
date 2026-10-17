/** Regression checks at the real hook/journal seams. These are not game turns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {journalSnapshotSource,journalRepairSource,compiledTableRepair} from './patch-runtime.mjs';
import {customMessage,requestSize,pairedTools} from '../../extensions/table/context-policy.ts';

const owner=new URL('../../extensions/table/request-journal.ts',import.meta.url);
const baseline=process.env.PI_COC_RESIDENCY_REGRESSION_BASELINE==='on';
const {default:prototype}=await import(baseline?'./extension.ts':'./extension-stage2.ts');
const code=stripTypeScriptTypes((baseline?journalSnapshotSource:journalRepairSource)(readFileSync(owner,'utf8'))
  .replace("'./context-policy.ts'",JSON.stringify(new URL('../../extensions/table/context-policy.ts',import.meta.url).href)));
const {createRequestJournal}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const binding=turn=>({version:1,campaign:'component',worldline:'main',loop:0,turn,source_revision:'a'.repeat(64)});
const oldBody='An obsolete exact source unit. '.repeat(2200);
const fresh=(turn,scene='Station',detail=oldBody)=>[
  customMessage('coc-capsule',{turn,where:{scene},present:[{id:'Caretaker',name:'Caretaker'}]}),
  customMessage('coc-clerk',{authority:'Current owner view',people:[{name:'Caretaker',source:detail,knowledge:['Current scoped fact.']}]}),
  {role:'user',content:'A follow-up at the current place.',timestamp:turn*1000},
  {role:'assistant',timestamp:turn*1000+1,content:[{type:'toolCall',id:'native-read',name:'look',arguments:{focus:'scene'}}]},
  {role:'toolResult',toolCallId:'native-read',toolName:'look',content:[{type:'text',text:'The current native result.'}],isError:false,timestamp:turn*1000+2}
];

test('the enabled hook reuses issued owner views without a second catalog or appended source packet',async()=>{
  const previous={enabled:process.env.PI_COC_RESIDENCY_PROTOTYPE,stage:process.env.PI_COC_RESIDENCY_STAGE};
  process.env.PI_COC_RESIDENCY_PROTOTYPE='on';process.env.PI_COC_RESIDENCY_STAGE='prejournal';
  try{
    const bus=new Map(),hooks=new Map();let reads=0;
    const pi={events:{on:(name,fn)=>bus.set(name,fn),emit:()=>{}},on:(name,fn)=>hooks.set(name,fn),getAllTools:()=>[]};
    prototype(pi);
    bus.get('coc:kernel-bridge')({campaign:'component',call:async()=>{reads++;return {status:'valid',authority:{checked:true},binding:binding(1),materials:{candidates:[{
      key:'source',kind:'graph_entity',authority:'module_source',source_revision:'a'.repeat(64),scope:{campaign:'component',worldline:'main',loop:0},
      label:'Caretaker',summary:'An existing identity.',read:{tool:'lookup',kind:'module',query:'Caretaker'},
      coverage:{unit:{kind:'identity'},dependencies:[]},body:JSON.stringify({source:oldBody.slice(0,8000)})
    }]}};}});
    const messages=fresh(1),request={messages,binding:binding(1),capsule:JSON.parse(messages[0].content),ctx:{model:{provider:'minimax-cn',id:'MiniMax-M3.1-Flash-Preview'},getSystemPrompt:()=>''}};
    bus.get('coc:residency-projection')(request);
    const result=await request.project();
    assert.equal(reads,0,'Existing native coverage must not trigger another catalog read');
    assert.deepEqual(result?.messages??messages,messages,'Current state and source views must be preserved without a duplicate packet');
    assert.equal(requestSize(result?.messages??messages),requestSize(messages));
  }finally{
    for(const [key,value]of [['PI_COC_RESIDENCY_PROTOTYPE',previous.enabled],['PI_COC_RESIDENCY_STAGE',previous.stage]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('a large retired source body is physically absent after the input-boundary checkpoint',()=>{
  const journal=createRequestJournal();
  journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});journal.commit();
  const current=fresh(2,'Library','Existing compact identity; lookup remains available.');
  const next=journal.project({key:'same-scope',turn:2,messages:current,budget:300000});
  assert.ok(!JSON.stringify(next.messages).includes(oldBody),'Logical retirement must reclaim the old submitted body');
  assert.ok(requestSize(next.messages)<requestSize(fresh(1))/2);
  assert.ok(JSON.stringify(next.messages).includes('Current scoped fact.'));
  assert.ok(JSON.stringify(next.messages).includes('The current native result.'));
  assert.ok(pairedTools(next.messages));
  assert.equal(next.observation.retained_bytes,0,'A checkpoint retains no old journal prefix');
});

test('unchanged material keeps the exact prefix and a small update never forces reclamation',()=>{
  const journal=createRequestJournal();
  const first=journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});journal.commit();
  const next=journal.project({key:'same-scope',turn:2,messages:fresh(2),budget:300000});
  assert.equal(next.observation.reset,undefined);
  assert.deepEqual(next.messages.slice(0,first.messages.length),first.messages);
  assert.equal(JSON.stringify(next.messages).split(oldBody).length,2,'The unchanged full source occurs once');
});

test('discarding an unsubmitted reclamation never changes the committed prefix',()=>{
  const journal=createRequestJournal();
  const first=journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});journal.commit();
  journal.project({key:'same-scope',turn:2,messages:fresh(2,'Library','Compact identity.'),budget:300000});
  const retry=journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});
  assert.deepEqual(retry.messages,first.messages);
});

test('large obsolete content cannot force a checkpoint inside one player input',()=>{
  const journal=createRequestJournal();
  const first=journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});journal.commit();
  const next=journal.project({key:'same-scope',turn:1,messages:fresh(1,'Library','Compact identity.'),budget:300000});
  assert.equal(next.observation.reset,undefined);
  assert.deepEqual(next.messages.slice(0,first.messages.length),first.messages);
});

test('same-focus reclamation waits two input boundaries to amortize rebuilding the prefix',()=>{
  const journal=createRequestJournal();
  journal.project({key:'same-scope',turn:1,messages:fresh(1),budget:300000});journal.commit();
  const second=journal.project({key:'same-scope',turn:2,messages:fresh(2,'Station','Compact identity.'),budget:300000});journal.commit();
  assert.equal(second.observation.reset,undefined);
  const third=journal.project({key:'same-scope',turn:3,messages:fresh(3,'Station','Compact identity.'),budget:300000});
  if(baseline)return;
  assert.equal(third.observation.reset,'residency_reclaim');
  assert.ok(!JSON.stringify(third.messages).includes(oldBody));
});

test('the repaired factory with its policy disabled is equivalent to the ordinary factory',async()=>{
  const ordinarySource=readFileSync(owner,'utf8');
  const load=async source=>{
    const code=stripTypeScriptTypes(source.replace("'./context-policy.ts'",JSON.stringify(new URL('../../extensions/table/context-policy.ts',import.meta.url).href)));
    return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).createRequestJournal();
  };
  const ordinary=await load(ordinarySource),disabled=await load(journalRepairSource(ordinarySource,{enabled:'false'}));
  const now=Date.now;Date.now=()=>0;
  try{for(const turn of [1,2,3]){
    const input={key:'same-scope',turn,messages:fresh(turn,turn===1?'Station':'Library',turn===1?oldBody:'Compact identity.'),budget:300000};
    assert.deepEqual(disabled.project(input),ordinary.project(input));ordinary.commit();disabled.commit();
  }}finally{Date.now=now;}
});

test('an explicit identity change always uses the current owner view',()=>{
  const journal=createRequestJournal();
  journal.project({key:'first-worldline',turn:1,messages:fresh(1),budget:300000});journal.commit();
  const next=journal.project({key:'other-worldline',turn:2,messages:fresh(2,'Library','Compact identity.'),budget:300000});
  assert.equal(next.observation.reset,'identity_changed');
  assert.ok(!JSON.stringify(next.messages).includes(oldBody));
});

test('the repair refuses drifted and duplicate compiled seams',()=>{
  assert.throws(()=>compiledTableRepair('unrelated code'),/exactly once/);
  if(process.env.PI_COC_RESIDENCY_FROZEN_TABLE){
    const original=readFileSync(process.env.PI_COC_RESIDENCY_FROZEN_TABLE,'utf8');
    const patched=compiledTableRepair(original);
    assert.equal(patched.split('function reclamationPlan(').length,2);
    assert.equal(patched.split('residency_reclaim').length,3);
    assert.ok(!patched.includes('coc-residency-prototype'));
    assert.throws(()=>compiledTableRepair(patched),/exactly once/);
  }
});
