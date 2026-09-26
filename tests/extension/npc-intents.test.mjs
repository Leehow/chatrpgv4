/**
 * Contract §138 (docs/specs/npc-as-actor.md tickets 01-02): what a person sets out to do is a receipt-folded ledger row,
 * the card and the Director's offer carry the ones still under way, and a settled one is never tried again. With the
 * NPC response bank retired (§139.6) the ledger is the only place an intention is known from, and a row the table's
 * own act of a person set out is marked `by: "table"` on the card. Real kernel over its RPC surface.
 *
 * Evidence this answers: campaign game-26d5a671 (2026-09-23), where the advice lane handed the Keeper "end the
 * arrangement, reclaim the key" on four turns after Knott had already done it, and Knott announced "I'll call for help"
 * five times with nothing recorded behind any of them.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {KernelClient} from '../../extensions/kernel/client.ts';

const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'.pi/npc-implementation/intent-tests');
await mkdir(evidence,{recursive:true});
const emitted=await mkdtemp(join(evidence,'entry-'));
await symlink(join(root,'node_modules'),join(emitted,'node_modules'),'dir');
await build({entryPoints:[join(root,'kernel-ts/rpc.ts')],outfile:join(emitted,'rpc.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const campaign='intent-test',KNOTT='Steven Knott';
const SHOUT='Shout for help down the stairs and have the visitor thrown out.';

async function opened(t){
 const home=await mkdtemp(join(evidence,'campaign-'));
 const connect=()=>new KernelClient({command:[process.execPath,join(emitted,'rpc.mjs'),'--workspace',home,'--content',join(root,'content')],cwd:root,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',COC_KERNEL_SEED:'npc-intents'},timeoutMs:30000});
 const client=connect();t.after(()=>client.close());
 await client.call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await client.call('table.open',{campaign});
 return {client,connect,home};
}
const capsuleOf=async client=>{const value=await client.call('table.capsule',{campaign});return value.capsule??value;};
const knott=capsule=>capsule.present.find(person=>person.name===KNOTT);
const ledger=async home=>JSON.parse(await readFile(join(home,'.coc','campaigns',campaign,'npc-ledger.json'),'utf8'));
const knottLedger=async home=>Object.entries(await ledger(home)).find(([id])=>id.includes('knott'))?.[1]??{};
const apply=(client,call_id,effect)=>client.call('table.apply',{campaign,call_id,effects:[{kind:'npc',name:KNOTT,...effect}]});
/** Close the opening and take the first player line: the table is on turn 1. */
async function begin(client){
 await client.call('table.narrate',{campaign,call_id:'t0-c1',text:'Knott slaps the key on the desk.'});
 await client.call('table.player_input',{campaign,text:'I hit him.'});
}
/** Close turn `turn` and take the next line: the table is on turn `turn + 1`. */
async function nextTurn(client,turn,text='I keep hitting him.'){
 await client.call('table.narrate',{campaign,call_id:`t${turn}-c9`,text:'The office holds its breath.'});
 await client.call('table.player_input',{campaign,text});
}

test('an intention the Keeper records is a receipt, folds into the ledger, and reaches the card and the offer',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 const landed=await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted',why:'he backs toward the stairwell'});
 assert.equal(landed.receipts.length,1);
 await nextTurn(client,1);
 const entry=await knottLedger(home);
 const row=entry.intents.find(value=>value.text===SHOUT);
 assert.ok(row,'the ledger folds the receipt');
 assert.equal(row.status,'attempted');
 assert.match(row.ref,/^intent:steven-knott:[0-9a-f]{12}$/);
 const capsule=await capsuleOf(client);
 const card=knott(capsule).history.intents.find(value=>value.ref===row.ref);
 assert.deepEqual([card.intent,card.status],[SHOUT,'attempted']);
 const offered=capsule.director.offer.find(value=>value.ref===row.ref);
 assert.ok(offered,'an intention under way takes a seat in the offer');
 assert.equal(offered.kind,'consequence');
 assert.equal(offered.from,'npc.intents');
});

test('a result settles an intention; a settled one is refused whether named by ref or written again',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 await apply(client,'t2-c1',{intent_ref:ref,outcome:'failed',why:'nobody comes up the stairs'});
 await nextTurn(client,2);
 assert.equal((await knottLedger(home)).intents[0].status,'failed');
 const capsule=await capsuleOf(client);
 assert.equal(capsule.director.offer.find(value=>value.ref===ref),undefined,'a settled intention leaves the offer');
 assert.equal(knott(capsule).history.intents.find(value=>value.ref===ref).status,'failed','and stays on the card as settled');
 for(const [call,effect] of [['t3-c1',{intent_ref:ref,outcome:'attempted'}],['t3-c2',{intends:SHOUT,outcome:'attempted'}],['t3-c3',{intends:`  ${SHOUT}`,outcome:'done'}]]){
  await assert.rejects(apply(client,call,effect),error=>error.code==='invalid_params'&&error.details?.reason==='intent_settled'&&error.details?.ref===ref,`${call} is refused as settled`);
 }
 const other=await apply(client,'t3-c4',{intends:'Offer the key back if the visitor steps away from the desk.',outcome:'attempted'});
 assert.equal(other.receipts.length,1,'a different thing to try lands');
});

test('the writer refuses what is not an intention of this person, and the variant stands alone',async t=>{
 const {client}=await opened(t);
 await begin(client);
 await assert.rejects(apply(client,'t1-c1',{intent_ref:'not-a-ref',outcome:'done'}),e=>e.code==='invalid_params'&&Array.isArray(e.details?.options));
 await assert.rejects(apply(client,'t1-c2',{intent_ref:'intent:walter-corbitt:0123456789ab',outcome:'done'}),e=>e.code==='invalid_params'&&e.details?.owner==='walter-corbitt');
 await assert.rejects(apply(client,'t1-c3',{intent_ref:'intent:steven-knott:0123456789ab',outcome:'done'}),e=>e.code==='invalid_params'&&e.details?.reason==='unknown_intent');
 await assert.rejects(apply(client,'t1-c4',{intends:SHOUT,outcome:'attempted',to:'away'}),e=>e.code==='invalid_params'&&e.details?.conflicts?.includes('to'));
 await assert.rejects(apply(client,'t1-c5',{intends:SHOUT,outcome:'maybe'}),e=>e.code==='invalid_params');
 await assert.rejects(apply(client,'t1-c6',{intends:SHOUT}),e=>e.code==='invalid_params');
});

test('with the bank retired the ledger alone names an intention, and the card, the options and the perspective read it (§139.6)',async t=>{
 const {client,home}=await opened(t);
 const persona=await client.call('npc.job',{campaign,name:KNOTT});
 await client.call('npc.submit',{campaign,job_id:persona.job_id,claim:persona.claim,personality:{description:'Practical and money-minded.'}});
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted',why:'he backs toward the stairwell'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 const under=knott(await capsuleOf(client));
 assert.deepEqual(under.history.intents.map(value=>[value.ref,value.status]),[[ref,'attempted']],'the card carries the attempted row');
 assert.equal(under.response_options,undefined,'no advice hint beside it');
 const unknown='intent:steven-knott:0123456789ab';
 await assert.rejects(apply(client,'t2-c1',{intent_ref:unknown,outcome:'done'}),e=>e.code==='invalid_params'&&e.details?.reason==='unknown_intent'
  &&JSON.stringify(e.details.options.map(value=>[value.ref,value.status]))===JSON.stringify([[ref,'attempted']]),'the options are the ledger rows under way, nothing else');
 await apply(client,'t2-c2',{intent_ref:ref,outcome:'failed',why:'nobody comes up the stairs'});
 await nextTurn(client,2);
 const perspective=await client.call('npc.perspective',{campaign,name:KNOTT});
 assert.equal(perspective.responses,undefined,'a perspective carries no bank rows');
 assert.deepEqual(perspective.tried.map(value=>[value.intent,value.status]),[[SHOUT,'failed']],'and what was tried comes from the ledger');
 assert.deepEqual(knott(await capsuleOf(client)).history.intents.map(value=>[value.ref,value.status,value.by]),[[ref,'failed',undefined]],'the Keeper set it out: no by');
});

test('the row the table\'s own act set out carries by: table on the card, through the rebuild and a later Keeper result (§139.6)',async t=>{
 const {client,connect,home}=await opened(t);
 const OTHER='Offer the key back if the visitor steps away from the desk.';
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await apply(client,'t1-c2',{intends:OTHER,outcome:'attempted'});
 await nextTurn(client,1);
 // Ticket 03's binding writes this stamp on the receipts of an act the table generated; the committed turn record is
 // the fold's only input, so the stamp is put where that writer will put it.
 const path=join(home,'.coc','campaigns',campaign,'turns','0001.json'),turn1=JSON.parse(await readFile(path,'utf8'));
 const receipt=turn1.receipts.find(value=>value.intent?.text===SHOUT);
 assert.equal(receipt.basis,undefined,'an npc receipt has no basis of its own to collide with');
 receipt.intent.generated=true;
 await writeFile(path,JSON.stringify(turn1,null,2));
 await client.close();
 await rm(join(home,'.coc','campaigns',campaign,'npc-ledger.json'));
 const fresh=connect();t.after(()=>fresh.close());
 await fresh.call('table.open',{campaign});
 const folded=(await knottLedger(home)).intents;
 assert.equal(folded.find(value=>value.text===SHOUT).generated,true,'the fold carries the mark into the ledger row');
 assert.equal(folded.find(value=>value.text===OTHER).generated,undefined);
 const card=knott(await capsuleOf(fresh)).history.intents;
 const shout=card.find(value=>value.intent===SHOUT),other=card.find(value=>value.intent===OTHER);
 assert.equal(shout.by,'table','the table set it out');
 assert.equal(other.by,undefined,'the Keeper set it out');
 await fresh.call('table.apply',{campaign,call_id:'t2-c1',effects:[{kind:'npc',name:KNOTT,intent_ref:shout.ref,outcome:'failed',why:'nobody comes'}]});
 await fresh.call('table.apply',{campaign,call_id:'t2-c2',effects:[{kind:'npc',name:KNOTT,intent_ref:other.ref,outcome:'abandoned'}]});
 await nextTurn(fresh,2);
 const after=knott(await capsuleOf(fresh)).history.intents.find(value=>value.ref===shout.ref);
 assert.deepEqual([after.status,after.by],['failed','table'],'a later result from the Keeper settles it and leaves who set it out');
});

test('the intention ledger is a fold of the turn records and is rebuilt from them',async t=>{
 const {client,connect,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 await apply(client,'t2-c1',{intent_ref:ref,outcome:'failed'});
 await nextTurn(client,2);
 const folded=(await knottLedger(home)).intents;
 await client.close();
 await rm(join(home,'.coc','campaigns',campaign,'npc-ledger.json'));
 const fresh=connect();t.after(()=>fresh.close());
 await fresh.call('table.open',{campaign});
 const card=knott(await (async()=>{const value=await fresh.call('table.capsule',{campaign});return value.capsule??value;})()).history.intents;
 assert.deepEqual(card.map(value=>[value.ref,value.status]),[[ref,'failed']]);
 assert.deepEqual((await knottLedger(home)).intents,folded,'the rebuilt ledger is the same fold');
});

// ---- ticket 03 (§138.7): what was set out on gets a result by the next turn -----------------------------------------

const record=async(home,turn)=>JSON.parse(await readFile(join(home,'.coc','campaigns',campaign,'turns',`${String(turn).padStart(4,'0')}.json`),'utf8'));

test('a delivery that reports no result for an intention under way is refused once, then delivered with a finding',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 await assert.rejects(client.call('table.narrate',{campaign,call_id:'t2-c1',text:'You swing again.'}),
  e=>e.code==='needs'&&e.details?.reason==='intent_result_owed'&&e.details.owed.map(item=>item.ref).join()===ref);
 const delivered=await client.call('table.narrate',{campaign,call_id:'t2-c2',text:'You swing again.'});
 assert.equal(delivered.turn,2,'the same owed set a second time is delivered');
 const warning=(await record(home,2)).warnings.find(value=>value.kind==='intent_result_owed');
 assert.equal(warning.ref,ref);
 assert.equal(warning.lane,'intents');
});

test('an intention under way is not announced again on a later turn; a result clears the debt',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await apply(client,'t1-c2',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 await assert.rejects(apply(client,'t2-c1',{intent_ref:ref,outcome:'attempted'}),e=>e.code==='invalid_params'&&e.details?.reason==='intent_unresolved');
 await assert.rejects(apply(client,'t2-c2',{intends:SHOUT,outcome:'attempted'}),e=>e.details?.reason==='intent_unresolved','the same line is the same intention');
 await apply(client,'t2-c3',{intent_ref:ref,outcome:'failed',why:'nobody comes up the stairs'});
 const delivered=await client.call('table.narrate',{campaign,call_id:'t2-c4',text:'Nobody answers his shout.'});
 assert.equal(delivered.turn,2);
 assert.equal((await record(home,2)).warnings?.find?.(value=>value.kind==='intent_result_owed'),undefined);
});

test('someone who is no longer present owes the delivery nothing',async t=>{
 const {client}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 await apply(client,'t2-c1',{to:'away',why:'he bolts down the stairs'});
 const delivered=await client.call('table.narrate',{campaign,call_id:'t2-c2',text:'He is gone.'});
 assert.equal(delivered.turn,2);
});

test('an npc effect with only intent_ref and intent_outcome settles that intention (how a Keeper writes it)',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const ref=(await knottLedger(home)).intents[0].ref;
 const settled=await apply(client,'t2-c1',{intent_ref:ref,intent_outcome:'failed',why:'nobody comes up the stairs'});
 assert.equal(settled.receipts.length,1);
 const delivered=await client.call('table.narrate',{campaign,call_id:'t2-c2',text:'Nobody answers.'});
 assert.equal(delivered.turn,2,'settled: nothing is owed');
 assert.equal((await knottLedger(home)).intents[0].status,'failed');
});
