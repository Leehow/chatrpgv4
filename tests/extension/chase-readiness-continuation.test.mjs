/** Real TS kernel catalog -> selector -> retained policy action -> canonical starter.
 * These deterministic source regressions do not claim natural Keeper/driver acceptance.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';
import {selectCheck, validateCheckOptions} from '../../runtime/jev/resolve-selection.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {initialView, settleCheckSelection, settleExecute} from '../../runtime/jev/step-policy.ts';
import {createHybridEngine} from './hybrid-engine-fixture.mjs';

async function setup(t, mobility) {
 const game = await table(t);
 // Preserve the actual player sheet and give this fixture's chosen driver its declared skill.
 const sheet = JSON.parse(await readFile(game.sheetPath,'utf8'));
 sheet.skills['Drive Auto'] = 80;
 await writeFile(game.sheetPath, JSON.stringify(sheet));
 if(mobility === 'vehicle') await game.apply([{kind:'npc',name:'Pickup gunner',walk_on:true,to:'here',why:'Riding with Steven Knott in the pursuing car.'}]);
 const rows = [], decisions = [], refusals = [];
 const decision = {async decide(batch) {
  decisions.push(batch);
  const answers = Object.fromEntries(batch.questions.map(q=>{
   if(q.type==='noul') {
    const candidate=batch.state.checks?.[q.key.replace(/_(uncertain|unsettled|blocked)$/,'')];
    const yes=batch.family==='check-selection-chase-prerequisite'?false:batch.family==='check-selection-need'?!q.key.endsWith('_blocked')&&candidate?.facts?.mobility===mobility:true;
    return [q.key,{status:'answered',type:'noul',noul:yes?.99:.01}];
   }
   const actor=batch.state.actors?.[q.key.replace('role_','actor_')];
   const value=batch.family==='check-selection-chase-roles'?actor.name==='Pickup gunner'?'passenger':'driver'
    :batch.family==='check-selection-chase-vehicles'?Object.entries(batch.state.vehicle_profiles).find(([,p])=>p.key==='car_standard')[0]
    :batch.family==='check-selection-chase-passengers'?'driver_1'
    :Object.entries(q.criteria).find(([,label])=>label==='flee')?.[0]??Object.keys(q.criteria)[0];
   return [q.key,{status:'answered',type:'choice',choice:value,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===value?1:0]))}];
  }));
  return bindDecisionAnswers(batch,answers,{inputTokens:1,outputTokens:1,costUsd:0});
 }};
 const engine = createHybridEngine({npcAct:null, env:{}, record:row=>rows.push(row), decision});
 const handlers=new Map(),events={on:(name,fn)=>handlers.set(name,fn),emit:(name,data)=>handlers.get(name)?.(data)};
 engine.extension({events,on:()=>{},getActiveTools:()=>[],setActiveTools:()=>{}});
 events.emit('coc:kernel-bridge',{campaign:'c1',call:game.call});
 events.emit('coc:operation-dispatcher',{dispatch:async(operation,context)=>{
  const callId=game.next();await context.journal.save({operationId:operation.id,taskId:operation.taskId,signature:'',callId});
  try {const result=await game.call(`table.${operation.operation}`,{...operation.args,call_id:callId});return {status:'succeeded',receipts:[...(result.receipts??[]),...(result.receipt?[result.receipt]:[])],result};}
  catch(error){refusals.push({code:error.code,message:error.message,details:error.details});return {status:'refused',receipts:[],result:{coc_error:{code:error.code,message:error.message,details:error.details}}};}
 }});
 const catalog=await game.call('table.resolve.options'), rawInput=catalog.context.declared_action;
 const plan=engine.runDriver.prepare({runId:'chase',inputRevision:'rev',rawInput,session:{}}),controller=new AbortController();let step=0;
 const invocation=()=>({runId:'chase',stepId:`s${++step}`,operationId:`op${step}`,origin:'policy',inputRevision:'rev',scopeId:'root',signal:controller.signal});
 const fresh=async()=> (await plan.ports.read.read({origin:'policy',operation:'read',readOnly:true},invocation())).artifact.fresh;
 const first=await fresh(), candidate=first.candidates.find(c=>c.checkOwner==='jev'&&c.bound.decision==='chase:start');
 assert.ok(candidate,'the production catalog issues the chosen chase capability');
 const lease=new TaskLease({owner:'readiness-regression',goal:'Flee the pursuer.',scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},readSet:[],capabilities:['decision'],
  budget:{deadlineAt:Date.now()+10000,remainingInputTokens:400000,remainingOutputTokens:40000,remainingCostUsd:2,remainingActions:60}});
 t.after(()=>lease.close());
 const selection=await selectCheck({options:validateCheckOptions(catalog.selection.options),request:{decision:'chase:start',bound:{actor:sheet.name}},declaration:'I flee Steven Knott and his passenger.',context:{},scope:{owner:'campaign:c1',campaign:'c1',worldline:'main',loop:0,audience:'keeper'},readSet:[],lease,decision,snapshot:first.selectionSnapshot});
 return {game,plan,controller,invocation,fresh,first,candidate,selection,rows,decisions,refusals};
}
const foldFresh=(view,fresh,step=2)=>settleExecute(view,step,{kind:'direct',purpose:'execute',call:{method:'apply',params:{}}},{ok:true,summary:{}},fresh,0);
function retained(f) {
 assert.equal(f.selection.status,'unresolved',JSON.stringify(f.selection));
 assert.ok(f.selection.preparation.action,'the original action was bound before preparation');
 const view=initialView({runId:'chase',rawInput:'I flee.',context:f.first.context,candidates:f.first.candidates});
 view.pending=[];
 settleCheckSelection(view,f.candidate,f.selection,0);
 return view;
}
async function complete(f,mobility) {
 await f.game.apply([{kind:'npc',name:'Steven Knott',archetype:'ordinary_adult',why:'Complete the retained participant profile.'}]);
 if(mobility==='vehicle') await f.game.apply([{kind:'npc',name:'Steven Knott',skill:{name:'Drive Auto',value:80},why:'The source-supported driver skill for this regression.'},
  {kind:'npc',name:'Pickup gunner',archetype:'capable_adult',why:'Complete the retained passenger profile.'}]);
}
for(const mobility of ['foot','vehicle']) test(`JEV-OPEN-05: ${mobility} preparation retains the actual selector action and executes one canonical starter`,async t=>{
 const f=await setup(t,mobility),view=retained(f),original=structuredClone(f.selection.preparation.action),calls=f.decisions.length;
 const initialReceipts=await f.game.call('table.status');
 for(let i=0;i<2;i++) {foldFresh(view,await f.fresh());assert.equal(view.preparingChecks.length,1);assert.ok(!view.pending.some(item=>item.candidate?.bound?.target&&item.purpose==='execute'));}
 assert.deepEqual((await f.game.call('table.status')).receipts,initialReceipts.receipts,'missing profiles do not write starter effects');
 await complete(f,mobility);
 const ready=await f.fresh();foldFresh(view,ready);
 const scheduled=view.pending.find(item=>item.purpose==='execute'&&item.candidate?.basis?.selection);
 assert.ok(scheduled,'accepted preparation releases the retained action');
 assert.deepEqual(scheduled.candidate.bound,original,'no changed actor, target, method, role, vehicle or driver link');
 assert.equal(f.decisions.length,calls,'fresh release performs no new plan or semantic binding');
 foldFresh(view,await f.fresh(),3);
 assert.equal(view.pending.filter(item=>item.candidate?.basis?.selection).length,1,'repeated freshness schedules one execution');
 const executed=await f.plan.ports.operations.execute({origin:'policy',operation:'execute',params:{candidate:scheduled.candidate,extra:{}}},f.invocation());
 assert.equal(executed.artifact.executed.ok,true,JSON.stringify({executed:executed.artifact.executed,refusals:f.refusals}));
 assert.ok((await f.game.call('table.status')).receipts.some(receipt=>receipt.kind==='session'&&String(receipt.id).startsWith('session:chase-start')));
 const saved=JSON.parse(await readFile(join(f.game.directory,'save/chase.json'),'utf8'));
 assert.ok(saved.participants.some(p=>p.actor_id==='steven-knott'));
 if(mobility==='vehicle') {
  const driver=saved.participants.find(p=>p.actor_id==='steven-knott'),passenger=saved.participants.find(p=>p.role==='passenger');
  assert.equal(driver.vehicle_key,'car_standard');assert.equal(driver.drive_auto,80);assert.equal(driver.mov_base,14);
  assert.equal(passenger.vehicle_actor_id,'steven-knott');assert.equal(passenger.movement_actions,0);
 }
 view.pending=view.pending.filter(item=>item!==scheduled);
 settleExecute(view,4,scheduled,executed.artifact.executed,executed.artifact.fresh,0);
 foldFresh(view,await f.fresh(),5);
 assert.equal(view.preparingChecks.length,0);assert.equal(view.pending.filter(item=>item.candidate?.basis?.selection).length,0);
});

test('JEV-OPEN-05: a changed scene retires the retained chase before completion',async t=>{
 const f=await setup(t,'vehicle'),view=retained(f);
 await f.game.apply([{kind:'move',to:'newspaper-morgue'}]);
 foldFresh(view,await f.fresh());
 assert.equal(view.preparingChecks.length,0);
 assert.ok(view.forced.some(row=>row.family==='check-preparation'&&row.chosen.outcome==='no_roll'));
 assert.ok(!view.pending.some(item=>item.candidate?.basis?.selection));
 assert.ok(!view.candidates.some(candidate=>candidate.bound.decision==='chase:start'));
 await f.game.apply([{kind:'move',to:'commission-briefing'}]);
 await complete(f,'vehicle');foldFresh(view,await f.fresh(),3);
 assert.ok(!view.candidates.some(candidate=>candidate.bound.decision==='chase:start'),'returning to the old scene cannot replan the expired declaration');
});

test('JEV-OPEN-05: replacing selected driver placement while profiles prepare cannot replay the old roster',async t=>{
 const f=await setup(t,'vehicle');
 // Current placement is the source of the selector's role evidence, not personality/background preparation.
 const view=retained(f);
 await f.game.apply([{kind:'npc',name:'Steven Knott',to:'here',why:'Knott has left the controls and is standing on foot outside the car.'}]);
 foldFresh(view,await f.fresh());
 await complete(f,'vehicle');foldFresh(view,await f.fresh(),3);
 assert.ok(!view.pending.some(item=>item.candidate?.basis?.selection),'a ready body does not validate the obsolete selected driver role');
 assert.ok(!view.candidates.some(candidate=>candidate.bound.decision==='chase:start'),'expiry must not offer a new plan for the same declared chase');
 const fresh=await f.fresh(),newRun=initialView({runId:'next-player-input',rawInput:'I flee again.',context:fresh.context,candidates:fresh.candidates});
 assert.ok(newRun.candidates.some(candidate=>candidate.bound.decision==='chase:start'),'expiry belongs to the old player run');
});

test('JEV-OPEN-05: a passenger leaving and returning cannot restore its retired vehicle roster',async t=>{
 const f=await setup(t,'vehicle'),view=retained(f);
 await f.game.apply([{kind:'npc',name:'Pickup gunner',to:'away',why:'The passenger leaves the pursuit before preparation completes.'}]);
 foldFresh(view,await f.fresh());
 await f.game.apply([{kind:'npc',name:'Pickup gunner',to:'here',why:'The passenger returns later beside the car.'}]);
 await complete(f,'vehicle');foldFresh(view,await f.fresh(),3);
 assert.equal(view.preparingChecks.length,0);
 assert.ok(!view.pending.some(item=>item.candidate?.basis?.selection));
 assert.ok(!view.candidates.some(candidate=>candidate.bound.decision==='chase:start'));
 assert.ok(!(await f.game.call('table.status')).receipts.some(receipt=>receipt.kind==='session'));
});
