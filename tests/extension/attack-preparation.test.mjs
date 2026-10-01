/** Controlled host-policy and real RPC regression; live Keeper acceptance is separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {table} from './object-usages-fixture.mjs';
import {buildCandidates} from '../../runtime/jev/candidates.ts';
import {initialView,settleExecute} from '../../runtime/jev/step-policy.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';

test('an unprofiled present NPC and an ordinary held object remain a preparable first attack',async t=>{
  const game=await table(t), before=await game.world();
  const options=await game.call('table.resolve.options'), row=options.context.first_blow;
  assert.ok(row.targets.includes('Steven Knott'));
  assert.ok(row.preparation.targets.includes('Steven Knott'));
  assert.ok(row.weapons.includes('Study chair'));
  assert.ok(row.preparation.weapons.includes('Study chair'));
  assert.deepEqual(await game.world(),before,'discovering readiness creates no profiles or attack usages');
  const candidates=buildCandidates({capsule:await game.call('table.capsule'),applyOptions:await game.call('table.apply.options'),resolveOptions:options},'I strike Knott with the chair.');
  assert.ok(candidates.some(candidate=>candidate.clerk==='first_blow'),'the attack is not lost before Jev can route it');
  await game.apply([{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult',why:'The chosen attack requires his combat profile.'}]);
  assert.ok((await game.call('table.resolve.options')).context.first_blow.preparation.weapons.includes('Study chair'));
  const prepared=await game.prepare();await game.apply([prepared.effect]);
  const ready=(await game.call('table.resolve.options')).context.first_blow;
  assert.equal(ready.preparation.targets.includes('Steven Knott'),false);
  assert.equal(ready.preparation.weapons.includes('Study chair'),false);
  const attack=await game.call('table.resolve',{call_id:game.next(),action:{intent:'combat',decision:'combat:attack',target:'Steven Knott',weapon:'Study chair',usage:'swing',defense:'none',goal:'Strike with the chair'}});
  assert.ok(attack.outcome.rolls.length,'the same ordinary identity reaches the actual combat resolver');
});

test('the actual host preflight returns a usable fresh catalog without dispatching an unprepared attack',async t=>{
  const game=await table(t), handlers=new Map();
  const pi={events:{on:(name,fn)=>handlers.set(name,fn),emit:(name,value)=>handlers.get(name)?.(value)},on:()=>{},registerTool:()=>{}};
  const engine=createHybridEngine({npcAct:null,decision:null,env:process.env});engine.extension(pi);
  pi.events.emit('coc:kernel-bridge',{campaign:'c1',call:(method,args)=>game.call(method,args)});
  pi.events.emit('coc:operation-dispatcher',{dispatch:()=>{throw new Error('unprepared attack reached the dispatcher');}});
  const plan=engine.runDriver.prepare({runId:'preflight',inputRevision:'input',rawInput:'I swing the chair at Knott.',session:{}});
  const signal=new AbortController().signal;
  const invocation={runId:'preflight',stepId:'read',operationId:'read',origin:'policy',inputRevision:'input',scopeId:'root',signal};
  await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},invocation);
  const options=await game.call('table.resolve.options');
  const candidate=buildCandidates({capsule:await game.call('table.capsule'),applyOptions:await game.call('table.apply.options'),resolveOptions:options},'I swing the chair at Knott.').find(c=>c.clerk==='first_blow');
  const result=await plan.ports.operations.execute({origin:'policy',operation:'execute',params:{candidate,extra:{target:'Steven Knott',weapon:'Study chair'}}},
    {...invocation,stepId:'execute',operationId:'execute'});
  assert.equal(result.artifact.executed.summary.refusal,'check_preparation');
  assert.equal(result.artifact.executed.summary.preparation.decision,'combat:attack');
  assert.ok(Array.isArray(result.artifact.fresh.candidates));
});

test('preparation writes resume the retained attack before dependent prose, without replaying a settled attack',()=>{
  const row=(targets,weapons)=>({targets:['Knott'],weapons:['Pen','unarmed'],preparation:{targets,weapons}});
  const candidate=r=>({key:'resolve:combat:first-blow',verb:'resolve',family:'combat',source:'fixture',label:'First attack',clerk:'first_blow',checkOwner:'jev',
    bound:{decision:'combat:attack',intent:'combat',goal:'Stab with the pen',method:'Stab with the pen'},unbound:[],basis:{row:r}});
  const context={scene:'Office',clock:null,present:['Knott'],receipts:[]};
  const initial=candidate(row(['Knott'],['Pen']));
  const view=initialView({runId:'r',rawInput:'I stab Knott with the pen.',context,candidates:[initial]});
  const fresh=r=>({context,candidates:[candidate(r)]});
  const binding={name:'weapon',path:'jev',value:'Pen',confidence:1,distribution:{Pen:1}};
  settleExecute(view,1,{kind:'direct',purpose:'execute',candidate:initial},
    {ok:false,summary:{refusal:'check_preparation',preparation:{decision:'combat:attack',needs:['NPC profile','pen usage']},
      action:{decision:'combat:attack',intent:'combat',target:'Knott',weapon:'Pen'},bindings:[binding]}},fresh(row(['Knott'],['Pen'])),1);
  assert.equal(view.preparingAttacks.length,1);
  assert.equal(view.heldCheckDecisions?.length??0,0,'preparation is not semantic uncertainty');
  settleExecute(view,2,{kind:'direct',purpose:'execute',call:{method:'apply',params:{effects:[{kind:'npc',name:'Knott',archetype:'ordinary_adult'}]}}},
    {ok:true,summary:{}},fresh(row([],['Pen'])),1);
  assert.equal(view.preparingAttacks.length,1,'an unrelated ready method cannot release the pen attack');
  view.pending.push({kind:'direct',purpose:'execute',call:{method:'narrate',params:{text:'The pen has not struck yet.'}}});
  settleExecute(view,3,{kind:'direct',purpose:'execute',call:{method:'apply',params:{effects:[{kind:'usage',object:'Pen'}]}}},
    {ok:true,summary:{}},fresh(row([],[])),1);
  const resumed=view.pending[0];
  assert.equal(resumed.candidate.bound.weapon,'Pen');assert.equal(resumed.candidate.bound.target,'Knott');
  assert.deepEqual(resumed.candidate.basis.preparation_bindings,[binding]);
  assert.equal(view.pending.some(item=>item.call?.method==='narrate'),false,'pre-preparation prose cannot close the attack');
  assert.equal(view.unresolvedChecks.length,0);
  view.pending.shift();
  settleExecute(view,4,resumed,{ok:true,summary:{}},fresh(row([],[])),1);
  assert.equal(view.preparingAttacks.length,0);
  assert.equal(view.pending.filter(item=>item.candidate?.clerk==='first_blow').length,0);
});
