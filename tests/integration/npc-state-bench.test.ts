/**
 * Contract §259 on the NPC state bench (content/starters/npc-state-bench, staged by
 * tests/play/fixtures/npc-state-bench/build.mjs): a printed routine with a printed chance, an investigator's promise
 * kept and broken, and a death that shakes the person tied to the dead.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {kernel,CAMPAIGN,campaignDir,readJson,CONTENT_DIR,type RpcClient,type Row} from './support.ts';

const KEEPER='钱老板',BROTHER='钱老二',KEEPER_ID='npc-qian-laoban';
const TABLE=readJson(join(CONTENT_DIR,'rulesets','coc7','rules-json','npc-attitude.json'));
const ledger=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'npc-ledger.json'));
const world=(k:RpcClient)=>readJson(join(campaignDir(k.workspace),'world.json'));
const card=(capsule:Row,name=KEEPER)=>capsule.present.find((p:Row)=>p.name===name);

async function bench(t:any){
 const k=await kernel(t);
 await k.ok('campaign.create',{id:CAMPAIGN,module:'npc-state-bench',pregen:'shen-zhiwei',play_language:'zh-Hans'});
 await k.table('open');await k.table('narrate',{call_id:'t0-c1',text:'粮店开着门，钱老板在柜台后面拨算盘。'});
 const {capsule}=await k.table('player_input',{text:'我走进粮店。'});
 return {k,capsule};
}
/** Close the turn with the host's delivery evidence, carrying the agreement marks the Keeper's packet resolved. */
async function closeWith(k:RpcClient,callId:string,text:string,agreements:Row[]){
 const c=(await k.table('capsule'))._context;
 const evidence={version:1,packet:'a'.repeat(64),binding:'b'.repeat(64),materials:[],required:[],coverage:[],author:'keeper',artifact_text:text,
  agreements,context:{campaign:c.campaign,turn:c.turn,worldline:c.worldline,loop:c.loop,world_revision:c.task_world_revision,source_revision:c.source_revision}};
 return k.table('narrate',{call_id:callId,text,_delivery_evidence:evidence});
}

test('the printed routine puts him in the shop by day; at night a forty-in-a-hundred chance, drawn once, decides',async t=>{
 const {k,capsule}=await bench(t);
 assert.deepEqual(card(capsule).schedule_now,{basis:'book routine; present[] is where they are',where:'粮店',doing:'在柜台后面称米记账',reachable:true});
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'time',minutes:600,why:'she waits for the evening'}]});
 await k.table('narrate',{call_id:'t1-c2',text:'天黑了。'});
 const night=(await k.table('player_input',{text:'我看看钱老板在不在。'})).capsule;
 const routine=card(night).schedule_now;
 assert.ok(routine,'a routine holds at night');
 if(routine.where==='茶馆后屋')assert.ok(routine.roll.d100<=40,JSON.stringify(routine));
 else{assert.equal(routine.where,'粮店后面的家');}
 const again=(await k.table('look',{focus:'npc'})).present.find((p:Row)=>p.name===KEEPER).schedule_now;
 assert.deepEqual(again,routine,'the same occasion answers the same');
 assert.equal(world(k).npc_presence['qian-laoban']??world(k).npc_presence[KEEPER_ID]??'grain-shop','grain-shop','the routine moves nobody');
});

test("an investigator's promise kept warms him by the table; broken, it costs him more",async t=>{
 const {k}=await bench(t);
 const ref=Object.entries(world(k).npc_references?.by_node??{}).find(([node])=>node===KEEPER_ID||node==='qian-laoban')?.[1] as string;
 assert.ok(ref,'the keeper has a reference at the table');
 const start=ledger(k)[KEEPER_ID]?.stance?.score??TABLE.initial_score;
 await closeWith(k,'t1-c1','钱老板点点头，收下了她的保证。',[{content_id:'p:'+'1'.repeat(24),by:'investigator_1',status:'kept',with:[ref]}]);
 const kept=ledger(k)[KEEPER_ID];
 assert.equal(kept.stance.score,start+TABLE.kept_delta);
 assert.equal(kept.stance.because.at(-1).how,'kept');
 await k.table('player_input',{text:'我没有回来。'});
 await closeWith(k,'t2-c1','钱老板等了一整天。',[{content_id:'p:'+'2'.repeat(24),by:'investigator_1',status:'broken',with:[ref]}]);
 assert.equal(ledger(k)[KEEPER_ID].stance.score,Math.max(-5,start+TABLE.kept_delta+TABLE.betrayal_delta));
 const capsule=(await k.table('player_input',{text:'我又走进粮店。'})).capsule;
 assert.equal(card(capsule).toward_party.because.at(-1),'turn 2: the investigator broke a promise');
 const record=readJson(join(campaignDir(k.workspace),'turns','0002.json'));
 assert.deepEqual(record.communication.agreements[0].with_npc.length,1,'the turn record names the person by node');
});

test('his brother dies; he is shaken by the tie the book draws between them',async t=>{
 const {k}=await bench(t);
 await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:BROTHER,dead:true,why:'the cart overturned'}]});
 await k.table('narrate',{call_id:'t1-c2',text:'钱老二没能再起来。'});
 const affect=ledger(k)[KEEPER_ID].affect;
 assert.equal(affect.pressure.level,readJson(join(CONTENT_DIR,'rulesets/coc7/rules-json/npc-affect.json')).events.tied_person_dead.pressure);
 const capsule=(await k.table('player_input',{text:'我去看钱老板。'})).capsule;
 assert.equal(card(capsule).affect.pressure.because.at(-1),'turn 1: tied_person_dead');
});
