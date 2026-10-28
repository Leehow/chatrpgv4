/** Contract §259.7: the book's routine at this hour, a printed chance drawn once for the occasion. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {importSource,readJson,CONTENT_DIR,type Row} from './support.ts';

const graphOf=async(schedule:unknown)=>{
 const api=await importSource('kernel-ts/read/module-graph.ts');
 const raw=readJson(join(CONTENT_DIR,'starters/the-haunting/module-graph.json'));
 const knott=raw.nodes.find((n:Row)=>n.node_id==='npc-steven-knott');knott.properties={...knott.properties,schedule};
 return new api.ModuleGraph('the-haunting',raw,'t',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier);
};
const META={id:'c1',active_worldline:'main',worldlines:{main:{seed:'seed-a'}}};
const at=async(graph:any,minutes:number)=>{const cap=await importSource('kernel-ts/read/capsule.ts');return minutes-cap.clockStart(graph).minutes;};

test('the first entry whose hours hold is the routine; none holding is no routine',async()=>{
 const {scheduleNow}=await importSource('kernel-ts/npc/schedule.ts');
 const graph=await graphOf([{when:{clock_range:{from:'09:00',to:'17:00'}},where:'his office',doing:'reading contracts',reachable:true},
  {when:{day_part:['evening']},where:'the Lamplighter bar'}]);
 const node=graph.nodes.get('npc-steven-knott');
 assert.deepEqual(scheduleNow(graph,{clock:{minutes:await at(graph,10*60)}},META,node),{basis:'book routine; present[] is where they are',where:'his office',doing:'reading contracts',reachable:true});
 assert.deepEqual(scheduleNow(graph,{clock:{minutes:await at(graph,19*60)}},META,node),{basis:'book routine; present[] is where they are',where:'the Lamplighter bar'});
 assert.equal(scheduleNow(graph,{clock:{minutes:await at(graph,3*60)}},META,node),null);
});

test('a printed chance is drawn once per occasion and answers the same every time it is read',async()=>{
 const {scheduleNow,scheduleRoll}=await importSource('kernel-ts/npc/schedule.ts');
 const graph=await graphOf([{when:{day_part:['night']},where:'the back room',probability:30},{when:{day_part:['night']},where:'home'}]);
 const node=graph.nodes.get('npc-steven-knott'),world={clock:{minutes:await at(graph,23*60)}};
 const first=scheduleNow(graph,world,META,node),again=scheduleNow(graph,world,META,node);
 assert.deepEqual(first,again);
 const roll=scheduleRoll('seed-a','steven-knott',0,'day 1 night');
 assert.equal(first.where,roll<=30?'the back room':'home');
 if(first.roll)assert.deepEqual(first.roll,{d100:roll,probability:30,occasion:'day 1 night'});
 const other=scheduleNow(graph,world,{...META,worldlines:{main:{seed:'seed-b'}}},node);
 assert.ok(['the back room','home'].includes(other.where),'another line draws its own die');
});

test('an entry the kernel cannot read is skipped, and no chance is invented',async()=>{
 const {scheduleNow,scheduleEntry}=await importSource('kernel-ts/npc/schedule.ts');
 assert.equal(scheduleEntry({when:{day_part:['teatime']},where:'x'}),null);
 assert.equal(scheduleEntry({where:'x',probability:0}),null);
 const graph=await graphOf([{when:{clock_range:{from:'9am',to:'5pm'}},where:'office'},{where:'the house'}]);
 assert.deepEqual(scheduleNow(graph,{clock:{minutes:0}},META,graph.nodes.get('npc-steven-knott')),{basis:'book routine; present[] is where they are',where:'the house'});
});
