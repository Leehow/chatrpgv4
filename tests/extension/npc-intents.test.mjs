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
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {fauxAssistantMessage,fauxToolCall} from '@earendil-works/pi-ai';
import {KernelClient} from '../../extensions/kernel/client.ts';
import {COC_TOOLS,INTENT_RESULT_EXPLAINED} from '../../extensions/kernel/tools.ts';
import {openTable,waitForIdle} from './harness.mjs';

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
 // §139.3: the clerk's npc_act calls carry the host's `_generated` (the kernel extension sets it on them alone); the
 // writer puts the mark in the intent stamp, and the committed turn record is the fold's only input.
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted',_generated:true});
 await apply(client,'t1-c2',{intends:OTHER,outcome:'attempted'});
 await nextTurn(client,1);
 const turn1=JSON.parse(await readFile(join(home,'.coc','campaigns',campaign,'turns','0001.json'),'utf8'));
 const receipt=turn1.receipts.find(value=>value.intent?.text===SHOUT);
 assert.equal(receipt.basis,undefined,'an npc receipt has no basis of its own to collide with');
 assert.equal(receipt.intent.generated,true,'the writer stamped the mark');
 assert.equal(turn1.receipts.find(value=>value.intent?.text===OTHER).intent.generated,undefined,'and only on the table\'s own act');
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

// ---- ticket 06 (§139.7): the Keeper's side of an act the table already wrote -----------------------------------------

/** Turn 1's committed receipt that opened `line`, stamped as ticket 03's binding stamps the table's own act; the ledger rebuilt. */
async function markTableAct(client,connect,home,t,line){
 const path=join(home,'.coc','campaigns',campaign,'turns','0001.json'),turn1=JSON.parse(await readFile(path,'utf8'));
 turn1.receipts.find(value=>value.intent?.text===line).intent.generated=true;
 await writeFile(path,JSON.stringify(turn1,null,2));
 await client.close();
 await rm(join(home,'.coc','campaigns',campaign,'npc-ledger.json'));
 const fresh=connect();t.after(()=>fresh.close());
 await fresh.call('table.open',{campaign});
 return fresh;
}
const REFS_ARE='present[].history.intents[].ref';

test('the Keeper overrules the table\'s act in one turn: two receipts, no owed-result refusal, both rows on the next card (§139.7, spec D7)',async t=>{
 const {client,connect,home}=await opened(t);
 const OWN='Push the key back across the desk and say nothing more.';
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 await nextTurn(client,1);
 const fresh=await markTableAct(client,connect,home,t,SHOUT);
 const act=knott(await capsuleOf(fresh)).history.intents.find(value=>value.intent===SHOUT);
 assert.deepEqual([act.status,act.by],['attempted','table'],'the table set it out on turn 1 and it has no result yet');
 const overruled=await fresh.call('table.apply',{campaign,call_id:'t2-c1',effects:[
  {kind:'npc',name:KNOTT,intent_ref:act.ref,intent_outcome:'abandoned',why:'he swallows the shout'},
  {kind:'npc',name:KNOTT,intends:OWN,outcome:'attempted',why:'he would rather buy his way out'}]});
 assert.equal(overruled.receipts.length,2,'one receipt for the abandoned act, one for the Keeper\'s own');
 // Without the abandon this delivery is refused `intent_result_owed` (the file's §138.7 test above): the table's act is owed.
 const delivered=await fresh.call('table.narrate',{campaign,call_id:'t2-c2',text:'He swallows the shout and pushes the key back.'});
 assert.equal(delivered.turn,2,'delivered on the first try: the table\'s act has its result');
 assert.equal((await record(home,2)).warnings?.find?.(value=>value.kind==='intent_result_owed'),undefined);
 await fresh.call('table.player_input',{campaign,text:'I take the key.'});
 assert.deepEqual(knott(await capsuleOf(fresh)).history.intents.map(value=>[value.intent,value.status,value.by]),
  [[OWN,'attempted',undefined],[SHOUT,'abandoned','table']],'the Keeper\'s own row under way, the table\'s row abandoned and still the table\'s');
});

test('a table act its binding already settled keeps its result: the overrule is refused with where the refs are and the rows under way (§139.7)',async t=>{
 const {client,connect,home}=await opened(t);
 const OTHER='Offer the key back if the visitor steps away from the desk.';
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'done'});
 await apply(client,'t1-c2',{intends:OTHER,outcome:'attempted'});
 await nextTurn(client,1);
 const fresh=await markTableAct(client,connect,home,t,SHOUT);
 const card=knott(await capsuleOf(fresh)).history.intents,act=card.find(value=>value.intent===SHOUT),other=card.find(value=>value.intent===OTHER);
 assert.deepEqual([act.status,act.by],['done','table']);
 await assert.rejects(fresh.call('table.apply',{campaign,call_id:'t2-c1',effects:[{kind:'npc',name:KNOTT,intent_ref:act.ref,intent_outcome:'abandoned'}]}),
  e=>e.code==='invalid_params'&&e.details?.reason==='intent_settled'&&e.fix.includes('its result stands')&&e.fix.includes(REFS_ARE)&&e.fix.includes('details.options')
   &&JSON.stringify(e.details.options)===JSON.stringify([{ref:other.ref,intent:OTHER,status:'attempted'}]));
});

test('every refusal of a ref says where refs are and lists the options: made up, unknown, owned by nobody, settled, unresolved (§139.7)',async t=>{
 const {client,home}=await opened(t);
 await begin(client);
 await apply(client,'t1-c1',{intends:SHOUT,outcome:'attempted'});
 const ref=(await client.call('table.status',{campaign})).receipts.find(value=>value.intent?.text===SHOUT).intent.ref;
 const underWay=[{ref,intent:SHOUT,status:'attempted'}];
 const says=(e,reason)=>e.code==='invalid_params'&&e.fix.includes(REFS_ARE)&&e.fix.includes('details.options')&&(reason===undefined||e.details?.reason===reason);
 await assert.rejects(apply(client,'t1-c2',{intent_ref:'@intent-placeholder',intent_outcome:'done'}),e=>says(e)&&JSON.stringify(e.details.options)===JSON.stringify(underWay),'live gate A T12\'s placeholder');
 await assert.rejects(apply(client,'t1-c3',{intent_ref:'intent:steven-knott:0123456789ab',intent_outcome:'done'}),e=>says(e,'unknown_intent')&&JSON.stringify(e.details.options)===JSON.stringify(underWay));
 // An effect about no one: every intention under way at this table, with whose it is.
 await assert.rejects(client.call('table.apply',{campaign,call_id:'t1-c4',effects:[{kind:'flag',name:'door-barred',intent_ref:'@intent-placeholder'}]}),
  e=>says(e)&&JSON.stringify(e.details.options)===JSON.stringify([{ref,npc:'steven-knott',intent:SHOUT,status:'attempted'}]));
 await assert.rejects(client.call('table.resolve',{campaign,call_id:'t1-c5',action:{actor:KNOTT,intent:'investigate',goal:'spot the visitor',method:'look',skill:'Spot Hidden',intent_ref:'@intent-placeholder'}}),
  e=>says(e)&&e.details.options.length===1);
 await nextTurn(client,1);
 await assert.rejects(apply(client,'t2-c1',{intent_ref:ref,outcome:'attempted'}),e=>says(e,'intent_unresolved')&&e.fix.includes('details.ref')&&JSON.stringify(e.details.options)===JSON.stringify(underWay));
 await apply(client,'t2-c2',{intent_ref:ref,outcome:'failed'});
 await assert.rejects(apply(client,'t2-c3',{intent_ref:ref,outcome:'done'}),e=>says(e,'intent_settled')&&JSON.stringify(e.details.options)===JSON.stringify([]));
});

test('the made-up ref of live gate A T12 reaches the Keeper with where the refs are and the options, through the extension (§139.7)',async t=>{
 // The opening is closed through the emitted kernel's own RPC; the player's line opens turn 1 with Knott in the room.
 const opening=workspace=>{
  const input=[['table.open',{}],['table.narrate',{call_id:'t0-c1',text:'诺特把钥匙拍在桌上。'}]]
   .map(([method,params],index)=>JSON.stringify({id:String(index),method,params:{campaign:'test-camp',...params}})).join('\n');
  const run=spawnSync(process.execPath,[join(root,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(root,'content')],{cwd:root,input:`${input}\n`,encoding:'utf8'});
  for(const frame of run.stdout.split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line)).filter(frame=>!frame.progress))
   if(!frame.ok)throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
 };
 const STAY='Stay behind the desk and let the investigator walk out.';
 const table=await openTable({realKernel:true,prepareWorkspace:opening,responses:[
  // The exact batch of gate A T12: a new intention, and a placeholder where its ref would go.
  fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'npc',name:KNOTT,intends:STAY,outcome:'attempted'},{kind:'npc',name:KNOTT,intent_ref:'@intent-placeholder',intent_outcome:'done'}]})],{stopReason:'toolUse'}),
  fauxAssistantMessage([fauxToolCall('narrate',{text:'他站在桌后没动。'})],{stopReason:'toolUse'}),
 ]});
 t.after(()=>table.dispose());
 await table.session.prompt('我转身就走。');
 await waitForIdle(table.session);
 const [result]=table.session.messages.filter(message=>message.role==='toolResult'&&message.toolName==='apply');
 const text=result.content.map(block=>block.text??'').join('');
 assert.equal(result.isError,true,text);
 assert.match(text,/^fix: refs are on the capsule at present\[\]\.history\.intents\[\]\.ref, or in details\.options here/m);
 const line=text.split('\n').find(value=>value.startsWith('options: '));
 assert.ok(line,`the options the fix names travel on their own line:\n${text}`);
 const options=JSON.parse(line.slice('options: '.length));
 assert.deepEqual(options.map(value=>[value.intent,value.status]),[[STAY,'attempted']],'the intention this very batch started is named, with its ref');
 assert.match(options[0].ref,/^intent:steven-knott:[0-9a-f]{12}$/);
});

test('the effects\' intent_ref and intent_outcome are one short line each, explained once in apply (§139.7)',t=>{
 const apply=COC_TOOLS.find(tool=>tool.name==='apply');
 const kinds=branch=>JSON.stringify(branch.properties.kind);
 const carriers=apply.parameters.properties.effects.items.anyOf.filter(branch=>branch.properties?.intent_ref&&!kinds(branch).includes('"npc"'));
 assert.ok(carriers.length>=10,`the effects that spread the intent fields: ${carriers.length}`);
 for(const branch of carriers)for(const key of ['intent_ref','intent_outcome']){
  const description=branch.properties[key].description;
  assert.ok(description.length<=60,`${kinds(branch)}.${key} is a pointer, not the explanation: ${description.length} characters`);
 }
 assert.ok(apply.description.endsWith(INTENT_RESULT_EXPLAINED),'the explanation is in the apply description');
 assert.ok(INTENT_RESULT_EXPLAINED.includes('present[].history.intents[].ref'));
 const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
 t.diagnostic(`tool schema bytes: all ${size(COC_TOOLS.map(tool=>({name:tool.name,description:tool.description,parameters:tool.parameters})))}, `+
  `apply parameters ${size(apply.parameters)}, the intent fields across ${carriers.length} effects ${carriers.reduce((sum,branch)=>sum+size({intent_ref:branch.properties.intent_ref,intent_outcome:branch.properties.intent_outcome}),0)}`);
});

test('the Keeper prompt says the people present may already have acted, and presumes no forced blow (§139.7)',async()=>{
 const prompt=await readFile(join(root,'prompts','keeper.md'),'utf8');
 assert.ok(prompt.includes('The people present may already have acted this turn'));
 assert.ok(prompt.includes('rows marked `by: table`'));
 assert.ok(prompt.includes('nothing is written as if it had not happened'));
 assert.equal(prompt.includes('need not be a blow'),false,'no default blow is presumed: the table writes the act (§139)');
});
