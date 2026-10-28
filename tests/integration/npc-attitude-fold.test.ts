/** Contract §259.2: a person's attitude toward the investigator, started by the first impression and moved by the table. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,ROOT,CAMPAIGN,CONTENT_DIR,campaignDir,readJson,createCampaign,type RpcClient,type Row} from './support.ts';

const KNOTT='npc-steven-knott';
const TABLE=readJson(join(CONTENT_DIR,'rulesets','coc7','rules-json','npc-attitude.json'));
const ledger=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'npc-ledger.json'));
const receiptsOf=(k:RpcClient,turn:number)=>readJson(join(campaignDir(k.workspace),'turns',String(turn).padStart(4,'0')+'.json')).receipts as Row[];
const wordOf=(score:number)=>TABLE.levels.find((level:Row)=>score<=level.at_most).value;
const IMPRESSION={intent:'social',decision:'natural-npc:first-impression',target:'Steven Knott',goal:'Introduce myself'};

async function meet(t:any,seed='7'){
 const k=await kernel(t,{env:{COC_KERNEL_SEED:seed}});
 await createCampaign(k);
 await k.ok('mods.install',{path:join(ROOT,'tests/extension/fixtures/natural-npc-1.4.4')});
 await k.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',version:'1.4.4'});
 await k.table('open');await k.table('narrate',{call_id:'t0-c1',text:'Knott nods.'});
 await k.table('player_input',{text:'我仔细观察诺特。'});
 const first=await k.table('resolve',{call_id:'t1-c1',action:IMPRESSION});
 return {k,reaction:first.outcome.impression.reaction as string};
}

test('the first impression is the starting attitude and the present card says so',async t=>{
 const {k,reaction}=await meet(t);
 await k.table('narrate',{call_id:'t1-c2',text:'诺特审视了我一眼。'});
 const row=ledger(k)[KNOTT],start=TABLE.initial_by_impression[reaction];
 assert.equal(typeof start,'number',`the table has a start for ${reaction}`);
 const rows=Object.values(row.attitude) as Row[];
 assert.equal(rows.length,1,'one investigator, one row');
 assert.equal(rows[0].score,start);assert.equal(rows[0].value,wordOf(start));assert.equal(rows[0].base,'impression');
 assert.deepEqual({value:row.stance.value,score:row.stance.score},{value:rows[0].value,score:start},'stance mirrors the row');
 assert.ok(!row.interactions.length,'a first impression is still no interaction (§178.4)');
 await k.table('player_input',{text:'我继续和诺特交谈。'});
 const card=(await k.table('look',{focus:'npc'})).present.find((p:Row)=>p.name==='Steven Knott');
 assert.equal(card.toward_party.stance,wordOf(start));
 assert.equal(card.toward_party.because.at(-1),`turn 1: first impression ${reaction}`);
});

test('a social roll after the impression moves the started score by the table',async t=>{
 const {k,reaction}=await meet(t);
 const social=await k.table('resolve',{call_id:'t1-c2',action:{intent:'social',goal:'get the keys and the story',method:'persuade him',target:'Steven Knott',stakes:'he clams up'}});
 await k.table('narrate',{call_id:'t1-c3',text:'诺特想了想。'});
 const roll=receiptsOf(k,1).find(r=>r.id===social.receipt)!;
 const delta=Number(TABLE.social[roll.approach]?.[roll.level]??0)+(roll.pushed&&!roll.passed?TABLE.pushed_failure_delta:0);
 const expected=Math.max(-5,Math.min(5,TABLE.initial_by_impression[reaction]+delta));
 assert.equal(ledger(k)[KNOTT].stance.score,expected);
});

test('a paid trade warms the person once a turn',async t=>{
 const {k,reaction}=await meet(t);
 const start=TABLE.initial_by_impression[reaction];
 await k.table('apply',{call_id:'t1-c2',effects:[{kind:'cash',delta:-2,with:'Steven Knott',source:'found',why:'tip for the keys'}]});
 await k.table('apply',{call_id:'t1-c3',effects:[{kind:'cash',delta:-1,with:'Steven Knott',source:'found',why:'and a drink'}]});
 await k.table('narrate',{call_id:'t1-c4',text:'诺特收下了钱。'});
 assert.equal(ledger(k)[KNOTT].stance.score,Math.min(5,start+TABLE.trade_delta),'two payments in one turn are one trade');
 assert.equal(ledger(k)[KNOTT].stance.because.at(-1).how,'trade');
});

test('the attitude rebuilds from the turn records exactly as it was folded',async t=>{
 const {k}=await meet(t);
 await k.table('apply',{call_id:'t1-c2',effects:[{kind:'npc',name:'Steven Knott',stance:'ally',why:'he owes them his brother'}]});
 await k.table('narrate',{call_id:'t1-c3',text:'诺特握住我的手。'});
 const folded=ledger(k)[KNOTT];
 assert.equal(folded.stance.value,'ally');
 assert.equal((Object.values(folded.attitude)[0] as Row).base,'keeper');
 rmSync(join(campaignDir(k.workspace),'npc-ledger.json'));
 await k.table('open');
 assert.deepEqual(ledger(k)[KNOTT].attitude,folded.attitude);
 assert.deepEqual(ledger(k)[KNOTT].stance,folded.stance);
});
