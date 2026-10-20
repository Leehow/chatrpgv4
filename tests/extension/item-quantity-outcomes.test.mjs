/** Actual item transactions remain visible to the sole author; not live-play evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importSource} from '../integration/support.ts';
import {turnPacketResult} from '../../runtime/turn-packet-prototype.ts';
const {operationOutcomes}=await importSource('kernel-ts/apply/outcomes.ts');

test('public quantity gains and losses survive the author boundary without inventing consumption',()=>{
 const graph={actor:()=>null};
 const rows=[
  {kind:'item',name:'Stew',subject:'investigator',subject_label:'Thomas',from:'counter attendant',quantity:1,before:0,after:1,why:'The attendant serves the already paid meal.'},
  {kind:'item',name:'Stew',subject:'investigator',subject_label:'Thomas',quantity:-1,before:1,after:0,why:'The investigator eats the selected meal.'},
  {kind:'item',name:'Note',subject:'investigator',subject_label:'Thomas',quantity:-1,before:1,after:0,why:'The investigator hands the note away.'},
  {kind:'item',name:'Secret',visibility:'keeper',quantity:1,before:0,after:1},
 ];
 const outcomes=turnPacketResult({outcomes:operationOutcomes(rows,graph,{})}).outcomes;
 assert.equal(outcomes.length,3);
 assert.deepEqual(outcomes.map(row=>[row.name,row.quantity,row.before,row.after]),[['Stew',1,0,1],['Stew',-1,1,0],['Note',-1,1,0]]);
 assert.equal(outcomes[0].from,'counter attendant');assert.equal(outcomes[0].to,'Thomas');
 assert.equal(outcomes[1].purpose,rows[1].why);assert.equal(outcomes[2].purpose,rows[2].why);
 assert(!JSON.stringify(outcomes).includes('Secret'));
});

test('real kernel gain and consumption reach frozen delivery with no residual food',async t=>{
 const {kernel,openTurn,campaignDir,readJson}=await import('../integration/support.ts');
 const {join}=await import('node:path');
 const client=await kernel(t);await openTurn(client,'I accept the offered stew and eat it.');
 const applied=await client.table('apply',{call_id:'t1-c1',effects:[
  {kind:'item',name:'Stew',quantity:1,from:'Steven Knott',why:'The selected meal is served.'},
  {kind:'item',name:'Stew',quantity:-1,why:'The investigator eats the selected meal.'}]});
 assert.equal(applied.outcomes.filter(row=>row.kind==='item').length,2);
 const delivery=await client.table('delivery.check');
 const items=turnPacketResult({outcomes:delivery.settled_results.outcomes}).outcomes.filter(row=>row.kind==='item'&&row.name==='Stew');
 assert.deepEqual(items.map(row=>[row.quantity,row.before,row.after]),[[1,0,1],[-1,1,0]]);
 assert.equal(items[1].purpose,'The investigator eats the selected meal.');
 assert(!readJson(join(campaignDir(client.workspace),'party/thomas-hayes.json')).equipment.some(row=>row?.name==='Stew'));
});
