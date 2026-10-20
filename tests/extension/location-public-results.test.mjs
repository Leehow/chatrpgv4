/** Shared read/write seams; synthetic fixtures are not live acceptance evidence. */
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {decisionScene} from '../../runtime/isolated-expression.ts';
import {locationIdentityContext} from '../../extensions/table/location-context.ts';
let temp,api;
before(async()=>{
 const root=resolve(import.meta.dirname,'../..');await mkdir(join(root,'.tmp'),{recursive:true});temp=await mkdtemp(join(root,'.tmp/location-public-results-'));
 await build({stdin:{contents:"export {parsePythonJson,pythonJsonDumps} from './kernel-ts/json.ts'; export {operationOutcomes} from './kernel-ts/apply/outcomes.ts'; export {ModuleGraph} from './kernel-ts/read/module-graph.ts'; export {locationCandidates} from './kernel-ts/read/locations.ts'; export {publicInventory} from './kernel-ts/read/public-inventory.ts'; export {turnPacketResult} from './runtime/turn-packet-prototype.ts';",resolveDir:root,sourcefile:'public-results-entry.ts'},outfile:join(temp,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
 api=await import(pathToFileURL(join(temp,'api.mjs')).href);
});
after(async()=>{if(temp)await rm(temp,{recursive:true,force:true});});
test('covered services and quotations reach the same canonical delivery projection as movement',()=>{
 const graph=new api.ModuleGraph('test',{nodes:[],relations:[],claims:[]},'',{}),world={};
 const receipts=[{kind:'cash',subject:'investigator',subject_label:'Detective',with:'Lunch cook',category:'living',settlement:'living_standard',purchase_amount:.35,before:70,after:70,currency:'USD',why:'A stew and coffee',items:[{name:'Stew',quantity:1},{name:'Coffee',quantity:1}]},
  {kind:'cash',subject:'investigator',subject_label:'Detective',with:'Shopkeeper',category:'purchase',settlement:'quote',purchase_amount:15,before:70,after:70,currency:'USD',purpose:'A quoted item',items:[{name:'Ordinary item',quantity:1}]}];
 const original=structuredClone(receipts),outcomes=JSON.parse(api.pythonJsonDumps(api.operationOutcomes(api.parsePythonJson(JSON.stringify(receipts)),graph,world)));
 assert.equal(outcomes.length,2,'final preparation must not lose both financial receipts');
 assert.equal(outcomes[0].settlement,'living_standard');assert.equal(outcomes[0].transaction,'settled');
 assert.equal(outcomes[0].purpose,'A stew and coffee','canonical cash purpose is stored as why');
 assert.equal(outcomes[1].transaction,'quoted','a quote cannot establish payment or handover');
 assert.deepEqual(outcomes[0].items,[{name:'Stew',quantity:1},{name:'Coffee',quantity:1}]);
 assert.deepEqual(api.turnPacketResult({outcomes}).outcomes,outcomes,'the host-to-author decoder must preserve these actual results');
 assert.deepEqual(receipts,original);
});
test('a long feature registry cannot starve authored destination identities',()=>{
 const source={node_id:'source-archive',node_kind:'scene',name:'archive-reading-room',properties:{destination_identity:{canonical_name:'Municipal Archive',aliases:['City records office']}}};
 const opening={node_id:'source-street',node_kind:'scene',name:'Street'};
 const graph=new api.ModuleGraph('test',{nodes:[opening,source],relations:[],claims:[]},'',{});
 const world={active_scene:'Street',mods:{state:{locations:{locations:{schema:1,places:[],features:Array.from({length:40},(_,i)=>({place:'Street',name:'Feature '+i,description:'A local fixture.'}))}}}}};
 const candidates=api.locationCandidates(graph,world);
 assert(candidates.length<=24);
 const archive=candidates.find(row=>row.name===graph.handle(graph.nodes.get(source.node_id)));
 assert(archive,'authored places need a share of the bounded catalogue');
 assert.equal(archive.identity.canonical_name,'Municipal Archive');
 assert(archive.identity.aliases.includes('City records office'));
 assert.equal(archive.origin,'source');
 const view=locationIdentityContext({place:{name:'Street'},catalogue:candidates});
 assert.equal(view.current,'Street');assert(view.candidates.some(row=>row.identity?.canonical_name==='Municipal Archive'));
 assert.equal(locationIdentityContext({place:{name:'Street'}}),undefined);
});
test('current custody reaches the author and stale sheet object references cannot reclaim transferred items',()=>{
 const party=[{id:'detective',name:'Detective',equipment:['Notebook',{name:'Key',object_id:'key'},{name:'Transferred letter',object_id:'letter'}]}];
 const world={objects:{instances:{key:{name:'Key',quantity:1,owner:{kind:'investigator',id:'detective'}},letter:{name:'Transferred letter',quantity:1,owner:{kind:'npc',id:'clerk'}}}}};
 const custody=api.publicInventory(party,world);
 const scene=decisionScene({public_inventory:custody,where:{scene:'Office'},present:[]});
 assert.deepEqual(scene.current_inventory.holders[0].items,[{name:'Key',quantity:1},{name:'Notebook',quantity:1}]);
 scene.current_inventory.holders[0].items.length=0;
 assert.equal(custody.holders[0].items.length,2);
});

test('decimal cash receipts retain numeric values through kernel serialization and the author decoder',()=>{
 const graph=new api.ModuleGraph('test',{nodes:[],relations:[],claims:[]},'',{});
 const receipt=api.parsePythonJson(JSON.stringify({kind:'cash',settlement:'quote',currency:'USD',purchase_amount:.45,items:[{name:'Stew',quantity:1,unit_price:'0.25',amount:.25},{name:'Bread',quantity:1,unit_price:'0.10',amount:.1},{name:'Coffee',quantity:1,unit_price:'0.10',amount:.1}]}));
 const wire=JSON.parse(api.pythonJsonDumps({outcomes:api.operationOutcomes([receipt],graph,{})}));
 const delivered=api.turnPacketResult(wire).outcomes[0];
 assert.equal(delivered.purchase_amount,.45);
 assert.deepEqual(delivered.items.map(item=>item.amount),[.25,.1,.1]);
 assert.deepEqual(delivered.items.map(item=>item.unit_price),['0.25','0.10','0.10']);
 assert.equal(delivered.transaction,'quoted');
});
