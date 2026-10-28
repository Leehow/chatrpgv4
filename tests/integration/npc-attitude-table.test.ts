/** Contract §259.1: the five attitude words, the table that holds every number, and the old four words read onto them. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {importSource,kernel} from './support.ts';
import {CONTENT_DIR,campaign_dir,narrate,open_turn,read_json} from './npc-support.ts';

const KNOTT='npc-steven-knott';
const CONTENT=String(CONTENT_DIR),TABLE=join(CONTENT,'rulesets','coc7','rules-json','npc-attitude.json');
const load=async(value:any)=>{
 const api=await importSource('kernel-ts/write/contributions.ts');
 return api.stanceTable({content:CONTENT,snapshots:{readJson:async()=>value}});
};

test('the attitude table loads with five levels and every number in it',async()=>{
 const table=await load(read_json(TABLE));
 assert.deepEqual(table.levels.map((level:any)=>level.value),['hostile','unfriendly','neutral','friendly','ally']);
 assert.equal(table.legacy_words.wary,'unfriendly');
 assert.equal(table.legacy_words.warm,'friendly');
});

test('a malformed attitude table is refused, naming what is wrong',async()=>{
 const good=read_json(TABLE);
 const cases:[any,string][]=[
  [{...good,contract_id:'coc.npc-stance.v1'},'coc.npc-attitude.v1'],
  [{...good,levels:[...good.levels].reverse()},'at_most rising'],
  [{...good,levels:good.levels.slice(0,-1)},'top of score_range'],
  [{...good,legacy_words:{warm:'cosy'}},'legacy word warm'],
  [{...good,initial_by_impression:{open:0.5}},'initial_by_impression.open'],
 ];
 for(const [table,said] of cases){
  await assert.rejects(load(table),(error:any)=>error.code==='campaign_not_ready'&&String(error.message).includes(said),said);
 }
});

test('an old stance word is accepted and read as its new word, and the receipt keeps what was written',async t=>{
 const k=await kernel(t);
 await open_turn(k);
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',stance:'wary',why:'pressed too hard'}]});
 await narrate(k,'t1-c2','诺特皱起眉。');
 const dir=String(campaign_dir(k.workspace));
 const receipt=read_json(join(dir,'turns','0001.json')).receipts.find((r:any)=>r.kind==='npc');
 assert.equal(receipt.stance,'unfriendly');
 assert.equal(receipt.stance_written,'wary');
 const row=read_json(join(dir,'npc-ledger.json'))[KNOTT];
 assert.equal(row.stance.value,'unfriendly');
 assert.equal(row.stance.score,-2,'the floor of unfriendly');
});

test('a word that is neither a level nor a legacy word is refused with the five words',async t=>{
 const k=await kernel(t);
 await open_turn(k);
 const refused=await k.tableErr('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',stance:'cosy',why:'x'}]});
 assert.equal(refused.code,'invalid_params');
 assert.match(JSON.stringify(refused),/unfriendly/);
});
