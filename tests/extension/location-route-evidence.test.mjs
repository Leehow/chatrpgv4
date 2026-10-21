/** Controlled route projection and decision evidence; never live-play acceptance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locationRouteBatch,locationDecisionCoverage} from '../../extensions/table/location-relevance.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
const binding={campaign:'test',turn:3};
const input={player_declaration:'I leave the window, wait at the counter until 18:45, then return to the window and look outside.',
 current_place:'Dining room',current_position:{place:'Dining room',at:'counter'},initial_selection:{move:.99,feature:.01,observation:.99},
 recent_public:[{keeper:'An unrelated conversation.'}],people:[{ref:'npc_1',display_name:'Clerk'}],features:[{name:'counter'}],known_failures:[{reason:'invalid_params'}],
 settled_receipts:[{kind:'place',action:'move',position:{place:'Dining room',at:'counter',relation:'at'},via:'Along the dining room aisle'},{kind:'time',minutes:15,until:{days:0,time:'18:45'},clock_before:510,clock_after:525}],
 proposed_effects:[{kind:'place',action:'move',to:'Dining room',at:'window',relation:'at'},{kind:'place',action:'observe',to:'Street',sense:'sight',access:'clear',scope:'The street.',facts:['A cart passes.']}]};
test('route review receives one canonical ordered chronology without other evidence domains',()=>{
 const batch=locationRouteBatch(input,binding);packDecisionBatch(batch);
 assert.deepEqual(Object.keys(batch.state),['player_declaration','location_steps']);
 assert.deepEqual(batch.state.location_steps,[{stage:'committed',destination:input.settled_receipts[0].position,via:'Along the dining room aisle'},{stage:'committed',wait_until:{days:0,time:'18:45'}},{stage:'proposed',destination:{place:'Dining room',at:'window',relation:'at'}}]);
 assert.equal(batch.questions.length,1);assert.match(batch.questions[0].instructions,/Proposed steps are explicit moves/);
 assert.equal(JSON.stringify(batch.state).includes('unrelated'),false);
});
test('stationary review retains current position and optional movement fields never introduce undefined JSON',()=>{
 const stationary=locationRouteBatch({...input,proposed_effects:[],settled_receipts:[]},binding);
 assert.deepEqual(stationary.state.current_position,input.current_position);packDecisionBatch(stationary);
 for(const proposed_effects of [[{kind:'place',action:'move',to:'Street'}],[{kind:'move',to:'Street'}]])packDecisionBatch(locationRouteBatch({...input,proposed_effects,settled_receipts:[{kind:'time'}]},binding));
});
test('movement coverage is never judged against the full unrelated observation context',async()=>{
 const decision={decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='move_satisfied'&&Object.hasOwn(batch.state,'people')?.1:.99}]))})};
 const result=await locationDecisionCoverage(input,binding,decision,new AbortController().signal);
 assert.equal(result.covered,true);assert.equal(result.axes.move,'accounted');assert.equal(result.axes.observation,'accounted');
});
test('independent route and observation reviews start concurrently and keep their own exact failure bases',async()=>{
 const batches=[];let release;const ready=new Promise(resolve=>{release=resolve;});
 const decision={decide:async batch=>{batches.push(batch);if(batches.length===2)release();await ready;
  return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='move_satisfied'?.49:.99}]))};}};
 const result=await locationDecisionCoverage(input,binding,decision,new AbortController().signal);
 assert.equal(result.covered,false);assert.equal(result.axes.move,'uncertain');assert.equal(result.axes.observation,'accounted');assert.equal(result.jev_calls,2);
 const route=batches.find(batch=>batch.family==='location-route-coverage'),other=batches.find(batch=>batch.family==='location-observation-coverage');
 assert(route);assert(other);assert(!other.questions.some(q=>q.key==='move_satisfied'));
 assert.deepEqual(result.decision_basis.request,packDecisionBatch(route).request);
 assert.deepEqual(result.decision_basis.additional[0].request,packDecisionBatch(other).request);
 assert.deepEqual(Object.keys(result.decision_basis.additional[0].answers),other.questions.map(q=>q.key));
 assert.equal(result.decision_basis.answers.move_satisfied,.49);
});
