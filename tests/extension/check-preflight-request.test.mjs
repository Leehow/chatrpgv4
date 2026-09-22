/** §126.2 advisory/request contract. Controlled decisions do not prove Keeper use or gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {prepareCheckPreflight} from '../../runtime/jev/check-preflight.ts';

const rawInput='I carefully search the desk.',scope={owner:'preflight-test',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},
  readSet=[{kind:'world',resource:'c1',revision:'world-r1'}];
const options=(overrides={})=>({version:1,profiles:[{alias:'profile:0',actor:'Alice',skill:'Spot Hidden',availability:'bound',value:55}],
  decisions:[{name:'core-check:ordinary-check',family:'core-check',description:'Ordinary check',capability:'check'}],revision:'options-r1',world_revision:'world-r1',
  context:{_binding:{campaign:'c1',worldline:'main',loop:0,turn:1},scene:'Office',pending_choice:null,session:null,conditions:[],current_receipts:[],declared_action:rawInput},...overrides});
const lease=(signal,budget={})=>new TaskLease({owner:'preflight-test',goal:rawInput,scope,capabilities:['decision'],readSet,signal,
  budget:{deadlineAt:Date.now()+10_000,remainingInputTokens:100_000,remainingOutputTokens:10_000,remainingCostUsd:1,remainingActions:2,...budget}});

function port(mode='ordinary',seen=[],expectedLease){return{async decide(batch,actualLease){
  if(expectedLease)assert.equal(actualLease,expectedLease,'preflight uses the caller-owned shared lease');seen.push(structuredClone(batch));
  const raw=Object.fromEntries(batch.questions.map(question=>{let choice;
    if(question.key==='route')choice=mode;else if(question.key==='consent')choice='authorized';else if(question.key==='actor')choice='actor_0';
    else if(question.key==='intent')choice='investigate';else if(question.key==='difficulty')choice='regular';else if(question.key==='bonus'||question.key==='penalty')choice='none';
    else if(question.key==='profile')choice='profile_0';return[question.key,{status:'answered',type:'choice',choice}];}));
  return bindDecisionAnswers(batch,raw,{inputTokens:1,outputTokens:1,costUsd:0});
}};}
const callFor=values=>{let index=0;return async method=>{assert.equal(method,'table.resolve.options');const value=values[Math.min(index,values.length-1)];index++;if(value instanceof Error)throw value;return structuredClone(value);};};

test('public advice is semantic and private freshness bindings stay outside it',async t=>{
  const shared=lease();t.after(()=>shared.close());const seen=[],result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,goal:'Find the ledger.',scope,readSet,
    call:callFor([options()]),decision:port('ordinary',seen,shared),lease:shared});
  assert.equal(result.advice.disposition,'ordinary');assert.equal(result.advice.authorization,'advisory_only');assert.equal(result.advice.settled,false);
  assert.deepEqual(result.advice.action,{actor:'Alice',intent:'investigate',goal:'Find the ledger.',method:rawInput,skill:'Spot Hidden',decision:'core-check:ordinary-check',
    modifiers:{difficulty:'regular',bonus_dice:0,penalty_dice:0,reason:rawInput}});
  const publicText=JSON.stringify(result.advice);for(const privateValue of ['world-r1','options-r1','profile:0','55'])assert.equal(publicText.includes(privateValue),false);
  assert.match(result.checkpoint.input_revision,/^[a-f0-9]{64}$/);assert.equal(seen.length,2);
});

test('nonordinary dispositions skip the dependent profile decision and never create an action',async t=>{
  for(const [mode,expected] of [['no_roll','no_roll'],['incumbent','incumbent'],['needs_player','needs_player'],['unknown','unknown']])await t.test(mode,async t=>{
    const shared=lease();t.after(()=>shared.close());const seen=[],result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,call:callFor([options()]),
      decision:port(mode,seen),lease:shared});assert.equal(result.advice.disposition,expected);assert.equal(result.advice.action,undefined);assert.equal(seen.length,1);
  });
  for(const [name,context,expected] of [['pending choice',{pending_choice:{kind:'luck'},session:null},'needs_player'],['active session',{pending_choice:null,session:{kind:'combat'}},'incumbent']])await t.test(name,async t=>{
    const shared=lease();t.after(()=>shared.close());const seen=[],result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,
      call:callFor([options({context:{_binding:{campaign:'c1',worldline:'main',loop:0,turn:1},scene:'Office',conditions:[],current_receipts:[],declared_action:rawInput,...context}})]),decision:port('ordinary',seen),lease:shared});
    assert.equal(result.advice.disposition,expected);assert.equal(seen.length,0);
  });
});

test('unknown profiles, provider failure and parent cancellation fail safely without settlement',async t=>{
  await t.test('unavailable profile',async t=>{const shared=lease();t.after(()=>shared.close());const result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,
    call:callFor([options({profiles:[{alias:'profile:0',actor:'Alice',skill:'Spot Hidden',availability:'unknown',value:null}]})]),decision:port(),lease:shared});
    assert.equal(result.advice.disposition,'unknown');assert.equal(result.advice.action,undefined);});
  await t.test('decision failure',async t=>{const shared=lease();t.after(()=>shared.close());const result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,
    call:callFor([options()]),decision:{async decide(){throw new Error('controlled provider outage');}},lease:shared});assert.equal(result.advice.disposition,'unknown');
    assert.match(result.advice.unresolved[0],/controlled provider outage/);});
  await t.test('parent cancellation',async t=>{const controller=new AbortController(),shared=lease(controller.signal);t.after(()=>shared.close());let began;
    const decision={decide:()=>new Promise((_resolve,reject)=>{began=true;shared.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});})};
    const pending=prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,call:callFor([options()]),decision,lease:shared,signal:controller.signal});
    while(!began)await new Promise(resolve=>setImmediate(resolve));controller.abort();const result=await pending;assert.equal(result.advice.disposition,'unknown');
    assert.deepEqual(result.advice.unresolved,['cancelled']);assert.equal(result.advice.action,undefined);
  });
});

test('final check rejects changed world/profile/rules state and reports owner failure unavailable',async t=>{
  const shared=lease();t.after(()=>shared.close());const changed=options({world_revision:'world-r2'}),result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,
    call:callFor([options(),changed]),decision:port(),lease:shared});assert.deepEqual(await result.check(),{status:'stale',reason:'resolve_options_changed'});
  const sharedFailure=lease();t.after(()=>sharedFailure.close());const failed=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,
    call:callFor([options(),new Error('controlled options outage')]),decision:port(),lease:sharedFailure});
  assert.deepEqual(await failed.check(),{status:'unavailable',reason:'controlled options outage'});
});

test('a mismatched caller scope/read set cannot borrow another preparation lease',async t=>{
  const shared=lease();t.after(()=>shared.close());let calls=0;const result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,
    scope:{...scope,worldline:'other'},readSet,call:async()=>{calls++;return options();},decision:port(),lease:shared});
  assert.equal(result.advice.disposition,'unknown');assert.deepEqual(result.advice.unresolved,['check_preflight_lease_binding_mismatch']);assert.equal(calls,0);
});

test('cross-campaign input and changed turn or worldline cannot carry check advice',async t=>{
  const shared=lease();t.after(()=>shared.close());let reads=0;
  const invalid=await prepareCheckPreflight({campaign:'other',turn:1,rawInput,scope,readSet,lease:shared,decision:port(),
    call:async()=>{reads++;return options();}});
  assert.equal(invalid.advice.disposition,'unknown');assert.equal(reads,0);
  for(const binding of [{campaign:'c1',worldline:'main',loop:0,turn:2},{campaign:'c1',worldline:'other',loop:0,turn:1},
    {campaign:'c1',worldline:'main',loop:1,turn:1}]){
    const changed=options();changed.context._binding=binding;
    const prepared=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,lease:shared,decision:port(),call:callFor([options(),changed])});
    assert.equal(prepared.advice.disposition,'ordinary');assert.equal((await prepared.check()).status,'stale');
  }
});

test('hung options reads and final checks stop at the caller deadline',async t=>{
  const shared=lease(undefined,{deadlineAt:Date.now()+100});t.after(()=>shared.close());
  const result=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,lease:shared,decision:port(),call:()=>new Promise(()=>{})});
  assert.equal(result.advice.disposition,'unknown');
  const current=lease();t.after(()=>current.close());let calls=0;
  const prepared=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,lease:current,decision:port(),
    call:async()=>++calls===1?options():new Promise(()=>{})});
  assert.equal((await prepared.check(new AbortController().signal,Date.now()+100)).status,'unavailable');
});

test('public dialogue participates in check reasoning and freshness without exposing private binding keys',async t=>{
  const shared=lease();t.after(()=>shared.close());const seen=[],publicContext=[{role:'keeper',text:'You can inspect the desk before choosing a risky action.'}];
  const prepared=await prepareCheckPreflight({campaign:'c1',turn:1,rawInput,scope,readSet,lease:shared,decision:port('ordinary',seen),
    call:callFor([options()]),publicContext});
  assert(seen.every(batch=>JSON.stringify(batch.state).includes(publicContext[0].text)));
  assert(!JSON.stringify(seen).includes('_binding'));assert(prepared.advice.basis.some(row=>row.text===publicContext[0].text));
  publicContext[0].text='A different choice.';assert.equal((await prepared.check()).status,'stale');
});
