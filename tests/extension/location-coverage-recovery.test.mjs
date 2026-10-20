/** Actual completion seam: an uncertain context hint is not a selected operation. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {locationDecisionCoverage,locationContextRelevance} from '../../extensions/table/location-relevance.ts';

const binding={campaign:'spatial-recovery',turn:7};
const input={player_declaration:'I leave the lunchroom, enter a nearby open shop and look around its counter.',
 current_place:'Sporting shop',current_position:{place:'Sporting shop'},features:[{name:'counter',description:'A wooden counter.'}],
 initial_selection:{move:.97,feature:.49},proposed_effects:[],
 settled_receipts:[{kind:'move',from:'Lunchroom',to:'Sporting shop',position:{place:'Sporting shop'}}]};
const answer=(observed,selected=.02)=>({decide:async batch=>{
 observed.push(batch);
 return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,
  {status:'answered',type:'noul',noul:q.key==='feature_selected'?selected:q.key==='move_satisfied'?.99:.01}]))};
}});
test('ambiguous preliminary feature relevance is clarified against the committed journey',async()=>{
 const observed=[],before=structuredClone(input);
 const result=await locationDecisionCoverage(input,binding,answer(observed),new AbortController().signal);
 assert.equal(result.covered,true,'a clarified nonselected feature cannot veto the actual arrival');
 assert.equal(result.accounting.move,'committed');
 assert.equal(result.axes.feature,'not_selected');
 assert(observed.some(batch=>batch.questions.some(q=>q.key==='feature_selected')));
 assert.deepEqual(input,before);
});
test('clarification cannot discharge a selected uncommitted feature change or an unavailable decision',async()=>{
 for(const probability of [.49,.99]){
  const result=await locationDecisionCoverage(input,binding,answer([],probability),new AbortController().signal);
  assert.equal(result.covered,false);
 }
 const result=await locationDecisionCoverage(input,binding,undefined,new AbortController().signal);
 assert.equal(result.covered,false);
});

test('arrival alone cannot discharge a separately selected focused reading',async()=>{
 const selected={player_declaration:'I return to the cafe and read the names and prices on the board, without ordering.',current_place:'Office',initial_selection:{move:.99,feature:.01,observation:.99},proposed_effects:[{kind:'place',action:'move',to:'Cafe',via:'The known public street.'}],settled_receipts:[]};
 const decide=covered=>({decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='observation_satisfied'?covered:q.key==='move_satisfied'?.99:.01}]))})});
 const missing=await locationDecisionCoverage(selected,binding,decide(.99),new AbortController().signal);
 assert.equal(missing.covered,false);assert.equal(missing.axes.observation,'missing');
 const observed={...selected,proposed_effects:[...selected.proposed_effects,{kind:'place',action:'observe',to:'Cafe',at:'Menu board',sense:'sight',access:'clear',scope:'Names and prices',facts:['Stew 25 cents; bread 10 cents; coffee 10 cents.']}]};
 assert.equal((await locationDecisionCoverage(observed,binding,decide(.99),new AbortController().signal)).covered,true);
 assert.equal((await locationDecisionCoverage(observed,binding,decide(.01),new AbortController().signal)).covered,false,'an unrelated or incomplete look is not the chosen reading');
});
test('ordinary arrival adds no observation obligation while movement coverage is checked',async()=>{
 const ordinary={player_declaration:'I walk to the Cafe.',current_place:'Office',initial_selection:{move:.99,feature:.01,observation:.01},proposed_effects:[{kind:'place',action:'move',to:'Cafe'}],settled_receipts:[]};
 const result=await locationDecisionCoverage(ordinary,binding,{decide:async batch=>{assert.deepEqual(batch.questions.map(q=>q.key),['move_satisfied']);return{batchId:batch.id,status:'complete',answers:{move_satisfied:{status:'answered',type:'noul',noul:.99}}};}},new AbortController().signal);
 assert.equal(result.covered,true);assert.equal(result.jev_calls,1);
});

test('focused reading alone activates the same completion lane and cannot reuse old observation state',async()=>{
 const selected=await locationContextRelevance({mods:{location_context:{mod:'enhanced-locations',version:'1.1.6'}},turn:{player_text:'I read the posted prices.'},where:{scene:'Cafe'}},binding,{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='observation_selected'?.99:.01}]))})},new AbortController().signal);
 assert.equal(selected.review,true);assert.equal(selected.selection.observation,.99);
 const input={player_declaration:'I read the posted prices.',initial_selection:selected.selection,proposed_effects:[],settled_receipts:[{kind:'place',action:'observe',observation:{target:{place:'Cafe'},scope:'Posted prices',facts:['Coffee 10 cents.']}}]};
 const decide={decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='observation_satisfied'?.99:.01}]))})};
 assert.equal((await locationDecisionCoverage(input,binding,decide,new AbortController().signal)).covered,true);
 const oldOnly={...input,settled_receipts:[],previous_observation:input.settled_receipts[0]};
 assert.equal((await locationDecisionCoverage(oldOnly,binding,decide,new AbortController().signal)).covered,false);
});
