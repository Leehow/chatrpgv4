/** Closed diagnostic projection and the real completion decision, not live-play evidence. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {locationCoverageError} from '../../extensions/kernel/location-coverage-error.ts';
import {locationDecisionCoverage} from '../../extensions/table/location-relevance.ts';
const spatial={current_place:'House',current_position:{place:'House',spot:'Hall wall'},features:[{name:'Entrance',state:'open',passable:true}]};
test('the actual feature-only completion refusal returns the missing constructor without redoing movement or observation',async()=>{
 const input={...spatial,player_declaration:'I walk to the living room doorway, push it open and look inside.',initial_selection:{move:.99,feature:.99,observation:.99},
    proposed_effects:[{kind:'place',action:'move',to:'here',spot:'Living room doorway'},
      {kind:'place',action:'observe',to:'House',sense:'sight',access:'limited',scope:'Near furniture',facts:['A chair.']}],settled_receipts:[]};
 const before=structuredClone(input),seen=[];
 const decision={decide:async batch=>{seen.push(batch);return {batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key==='feature_blocked'||q.key==='feature_satisfied'?.01:.99}]))};}};
 const result=await locationDecisionCoverage(input,{campaign:'coverage-error',turn:7},decision,new AbortController().signal);
 assert.deepEqual(result.axes,{move:'accounted',feature:'missing',observation:'accounted'});assert.equal(result.covered,false);
 const error=locationCoverageError(result,spatial);assert.equal(error.code,'invalid_params');assert.equal(error.details.transaction_state,'uncommitted');
 assert.deepEqual(error.details.corrections.map(row=>row.axis),['feature']);assert.match(error.fix,/action:"feature"/);assert.match(error.fix,/features:\[/);
 assert(!error.fix.includes('action:"observe"'));assert(!error.fix.includes('action:"move"'));
 assert.match(error.fix,/Keep accounted but uncommitted steps/);assert.match(error.fix,/do not replay settled/);
 assert.equal(error.details.current_position.spot,'Hall wall');assert.deepEqual(input,before);
});
test('each reviewed missing axis selects only its existing operation while uncertainty stays unconfirmed',()=>{
 for(const [axis,action] of [['move','move'],['feature','feature'],['observation','observe']]){
  const error=locationCoverageError({status:'answered',axes:{[axis]:'missing'}},spatial);
  assert.deepEqual(error.details.corrections.map(row=>row.axis),[axis]);assert(error.fix.includes('action:"'+action+'"'));
 }
 const error=locationCoverageError({status:'answered',axes:{feature:'uncertain',move:'already_satisfied',observation:'not_selected'}},spatial);
 assert.equal(error.details.corrections[0].status,'uncertain');assert.match(error.fix,/uncertainty grants no action/);
});
test('unavailable review never invents missing operations or authority',()=>{
 const error=locationCoverageError({status:'fallback',reason:'unconfigured'},spatial);
 assert.deepEqual(error.details.corrections,[]);assert.equal(error.details.cause,'unconfigured');assert(!error.fix.includes('action:"'));
 assert.match(error.fix,/review was unavailable/);assert.match(error.message,/could not be verified/);
});
test('the production refusal boundary consumes the diagnostic projection',()=>{
 const source=readFileSync(new URL('../../extensions/kernel/index.ts',import.meta.url),'utf8');
 assert(source.includes("import {locationCoverageError} from './location-coverage-error.ts'"));
 assert(source.includes('if(!coverage.covered)throw locationCoverageError(coverage,spatial)'));
});
test('the shipped observation guidance agrees with complete fact preservation',()=>{
 const text=readFileSync(new URL('../../mods/enhanced-locations/agent.md',import.meta.url),'utf8');
 assert(!text.includes('Facts are at most six'));assert(!text.includes('short perceived fact'));
 assert.match(text,/Preserve all actual perceived facts in full and in order/);
});
