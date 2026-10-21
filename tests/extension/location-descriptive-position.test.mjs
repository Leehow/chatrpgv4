/** One spatial representation through native grammar, viewpoint and route proof. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Check} from 'typebox/value';
import {PlaceEffect,SpatialPoint,NativePlaceParameters} from '../../shared/place-structures.ts';
import {turnPacket,turnPacketParameterSchema,compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';
import {admissionRequest} from '../../extensions/kernel/admission.ts';
import {importSource} from '../integration/support.ts';
const {currentObservationPoint,spatialPointKey,matchingObservationRelations,publicObservation}=await importSource('kernel-ts/read/location-observations.ts');

const move={kind:'place',action:'move',to:'here',spot:'public sidewalk',relation:'standing'};
test('a descriptive spot uses normal native movement without declaring an interactive feature',()=>{
 assert(Check(PlaceEffect,move));assert(Check(SpatialPoint,{place:'House',spot:move.spot,relation:move.relation}));
 // §250: both anchors are accepted; the kernel keeps a registered feature and reports the dropped spot.
 assert(Check(PlaceEffect,{...move,at:'Door'}));assert(Check(SpatialPoint,{place:'House',at:'Door',spot:move.spot}));
 assert(!Check(PlaceEffect,{kind:'place',action:'feature',to:'House',spot:move.spot,state:'open'}));
 const packet={version:4,commands:[move,{kind:'scene',service:'unknown',crowd:'unknown'}]};
 assert(Check(NativePlaceParameters,{action:'inspect',name:'House',spot:move.spot,relation:'standing',need:'observation'}));
 assert(Check(NativePlaceParameters,{action:'inspect',name:'House',spot:move.spot,at:'Door',need:'observation'}));
 assert(!Check(turnPacketParameterSchema(true,undefined,undefined,true,undefined,true),{version:4,commands:[{kind:'place',action:'move',to:'here'},{kind:'scene',service:'unknown',crowd:'unknown'}]}),'after arrival a local move needs a feature or descriptive position');
 for(const arrived of [false,true]){
  const schema=turnPacketParameterSchema(arrived,undefined,undefined,true,undefined,true);
  assert(Check(schema,packet));assert.deepEqual(compileTurnPacket(turnPacket(JSON.stringify(packet),schema)).effects[0],move);
 }
});
test('the single Keeper judges a descriptive position; the lane review still preserves its endpoint (§249)',()=>{
 assert.equal(admissionRequest('apply',{effects:[move]},{party:['Thomas'],consentOnly:true}),null,'the typed consent review receives no place line');
 const proposal=admissionRequest('apply',{effects:[move]},{party:['Thomas']});
 assert.equal(proposal.operations[0].spot,move.spot);
});
test('observation origin and public projection keep spot and relation without minting fixtures',()=>{
 const position={place:'House',spot:'public sidewalk',relation:'standing'};
 const graph={scene:()=>({name:'House'}),handle:()=> 'House',displayName:()=> 'House',placeName:()=> 'House'};
 const world={active_scene:'House',mods:{state:{'enhanced-locations':{locations:{schema:1,position,features:[],places:[]}}}}};
 assert.deepEqual(currentObservationPoint(graph,world),position);
 const observation={from:position,to:{place:'House'},sense:'sight',access:'clear',scope:'Facade',facts:['A brick wall.'],people:[],situations:[],observed_clock:{minutes:10}};
 assert.deepEqual(publicObservation(graph,world,observation).from,position);
 assert.equal(world.mods.state['enhanced-locations'].locations.features.length,0);
});
test('different local spots and feature sides never share an exact viewpoint identity',()=>{
 const left={place:'House',at:'Window',relation:'left of'},right={...left,relation:'right of'};
 assert.notEqual(spatialPointKey(left),spatialPointKey(right));
 assert.notEqual(spatialPointKey({place:'House',spot:'near corner'}),spatialPointKey({place:'House',spot:'far corner'}));
 const target={place:'Street'},world={mods:{state:{'enhanced-locations':{locations:{schema:1,relations:[{from:left,to:target,sense:'sight'}]}}}}};
 assert.equal(matchingObservationRelations(world,left,target,'sight').length,1);
 assert.equal(matchingObservationRelations(world,right,target,'sight').length,0);
});
