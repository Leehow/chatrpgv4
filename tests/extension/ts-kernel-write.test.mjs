import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile, unlink, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { KernelClient } from '../../extensions/kernel/client.ts';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content'),RPC=join(ROOT,'build/kernel/rpc.mjs');
const evidence=join(ROOT,'.coc/playtests/ts-write-node');await mkdir(evidence,{recursive:true});
const output=await mkdtemp(join(evidence,'entry-'));
await symlink(join(ROOT,'node_modules'),join(output,'node_modules'),'dir');
await build({stdin:{contents:[
  `export {createKernelContext} from ${JSON.stringify(join(ROOT,'kernel-ts/context.ts'))};`,
  `export {createWriteRuntime} from ${JSON.stringify(join(ROOT,'kernel-ts/write/index.ts'))};`,
  `export {PythonRandom} from ${JSON.stringify(join(ROOT,'kernel-ts/random.ts'))};`,
  `export {SettleContext, presentOpponents} from ${JSON.stringify(join(ROOT,'kernel-ts/resolve/context.ts'))};`,
  `export {presentOpponents as combatOpponents} from ${JSON.stringify(join(ROOT,'kernel-ts/combat/execution.ts'))};`,
  `export {presentOpponents as chaseOpponents} from ${JSON.stringify(join(ROOT,'kernel-ts/chase/bindings.ts'))};`,
  `export {diskFiles,restoreTree} from ${JSON.stringify(join(ROOT,'kernel-ts/worldline/history.ts'))};`,
].join('\n'),sourcefile:'writer-test-api.ts',resolveDir:ROOT,loader:'ts'},outfile:join(output,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(output,'api.mjs')).href);
const create={id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'};
test('worldline restoration skips directory links and preserves their external files',async()=>{
  const home=await mkdtemp(join(evidence,'restore-links-'));
  const kernel=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
  try {
    const writer=api.createWriteRuntime(kernel);await writer.handlers['campaign.create'](create);
    const campaign=await writer.campaign({campaign:'c1'}),outside=join(home,'outside-save');
    await mkdir(outside);await mkdir(campaign.path('save'),{recursive:true});
    await writeFile(join(outside,'retained.json'),'external evidence\n');
    await symlink(outside,campaign.path('save/directory-link'),'dir');
    await symlink(join(outside,'retained.json'),campaign.path('save/file-link'),'file');
    const result=await api.restoreTree({kernel,campaign},'HEAD','save');
    assert.deepEqual(result.removed,['save/file-link']);
    assert.equal(await readFile(join(outside,'retained.json'),'utf8'),'external evidence\n');
    assert.deepEqual(await api.diskFiles({kernel,campaign},'save'),[]);
  } finally {await kernel.git.close();}
});
function environment(extra={}) {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0',GIT_AUTHOR_DATE:'2000-01-02T03:04:05Z',GIT_COMMITTER_DATE:'2000-01-02T03:04:05Z',
    COC_TEST_CLOCK:'2000-01-02T03:04:05Z',NODE_OPTIONS:`--require ${JSON.stringify(join(ROOT,'tests/kernel/rpc_clock.cjs'))}`,TZ:'UTC',...extra};
}
// SL-87: none of these waits is a subject here. On a loaded box a kernel start outlasted the 15 s request timeout, a fixture
// Git outlasted the 5 s wait for its pid file, and the host's 2 s SIGTERM-to-SIGKILL grace killed the kernel in the middle
// of its own shutdown -- before it had put the working tree back -- so the next owner opened the unfinished narrate as
// delivered. What this file asserts is what the kernel does on shutdown, not how fast: each wait is a minute.
const WAIT_MS=60_000;
async function until(read) {
  const deadline=Date.now()+WAIT_MS;
  while(Date.now()<deadline){const result=await read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Owned process did not reach its expected state');
}
function client(home,env) {return new KernelClient({command:[process.execPath,RPC,'--workspace',home,'--content',CONTENT],cwd:ROOT,env,inheritEnv:false,timeoutMs:WAIT_MS,closeGraceMs:WAIT_MS});}
async function stateBytes(home) {
  const result={};
  async function walk(path,relative='') {
    for(const entry of await readdir(path,{withFileTypes:true})) {
      const name=relative?`${relative}/${entry.name}`:entry.name;
      if(name==='repos')continue;
      if(entry.isDirectory())await walk(join(path,entry.name),name);
      else if(entry.isFile())result[name]=createHash('sha256').update(await readFile(join(path,entry.name))).digest('hex');
    }
  }
  await walk(join(home,'.coc'));return result;
}

test('the turn transaction preserves receipt replay without advancing the owner RNG',async t=>{
  const home=await mkdtemp(join(evidence,'replay-')),ctx=await api.createKernelContext({workspace:home,content:CONTENT,seed:'receipt-seed',env:environment()});
  t.after(()=>ctx.git.close());
  const runtime=api.createWriteRuntime(ctx);
  await runtime.handlers['campaign.create'](create);
  await runtime.handlers['table.player_input']({campaign:'c1',text:'I inspect the window.'});
  const params={campaign:'c1',call_id:'t1-c1',action:{intent:'investigate',skill:'Listen'}};
  const transaction=await runtime.transaction(params),start=await transaction.beginWrite('table.resolve',params);
  assert.deepEqual(start,{kind:'new',callId:'t1-c1',ordinal:1});
  const expected=new api.PythonRandom('receipt-seed'),roll=ctx.rng.randint(1,100);
  assert.equal(roll,expected.randint(1,100));
  const result={receipt:'roll:listen-t1-c1',roll};
  await transaction.commitResolve({callId:start.callId,params,result,receipts:[{id:result.receipt,kind:'roll',skill:'Listen',roll,target:60}],
    events:[{type:'roll-resolved',data:{roll,target:60},receipt:result.receipt}]});
  const fresh=await runtime.transaction(params);
  assert.deepEqual(await fresh.beginWrite('table.resolve',params),{kind:'replay',result:{...result,replayed:true}});
  assert.equal(ctx.rng.randint(1,100),expected.randint(1,100));
  await assert.rejects(fresh.beginWrite('table.resolve',{...params,action:{...params.action,skill:'Spot Hidden'}}),error=>error.code==='idempotency_conflict');
  const cursor=JSON.parse(await readFile(join(home,'.coc/campaigns/c1/turn.json'),'utf8'));
  assert.equal(cursor.state,'acting');assert.equal(cursor.receipts.length,1);
});

test('ask and narrate share delivery formatting while retaining their distinct records and turn transitions',async t=>{
  for(const method of ['ask','narrate'])await t.test(method,async()=>{
    const home=await mkdtemp(join(evidence,`delivery-${method}-`));
    const context=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
    try {
      const runtime=api.createWriteRuntime(context);
      await runtime.handlers['campaign.create'](create);
      await runtime.handlers['table.player_input']({campaign:'c1',text:'I wait.'});
      const action={campaign:'c1',call_id:'t1-c1'},transaction=await runtime.transaction(action);
      const receipt={kind:'time',id:'time:t1-c1',minutes:5};
      await transaction.commitResolve({callId:action.call_id,params:action,result:{receipts:[receipt]},receipts:[receipt],events:[]});
      const params={campaign:'c1',call_id:'t1-c2',text:'Waiting {{time}} ends. {{time}} {{unknown}}',
        ...(method==='ask'?{prompt:'Stay or leave?',options:['Stay','Leave']}: {})};
      const result=await runtime.handlers[`table.${method}`](params);
      assert.equal(result.rendered_text,'Waiting ends.');
      assert.equal(result.marked_text.match(/\{\{time\}\}/g).length,1);
      assert.deepEqual(result.dropped_markers.unknown,['unknown']);
      assert.deepEqual(result.dropped_markers.duplicate,['time']);
      assert.equal(result.mechanics.length,1);
      assert.equal(result.mechanics[0].receipt,receipt.id);
      assert.equal(Object.hasOwn(result,'placed'),false,'internal marker bindings never enter the wire');
      const campaign=await runtime.campaign({campaign:'c1'}),record=await campaign.readTurnRecord(1),cursor=await campaign.readTurn();
      assert.equal(record.closed_by,method);
      assert.equal(record.closed_how,'explicit');
      assert.equal(record.text,params.text);
      assert.equal(record.rendered_text,result.rendered_text);
      assert.deepEqual(record.mechanics,result.mechanics);
      assert.deepEqual(record.labels,result.labels);
      assert.deepEqual(record.receipts,[receipt]);
      assert.equal(Object.hasOwn(record,'dropped_markers'),false);
      assert.equal(Object.hasOwn(record,'marked_text'),method==='narrate');
      assert.equal(cursor.state,method==='ask'?'asked':'awaiting_player');
      assert.equal(cursor.turn,method==='ask'?1:2);
      assert.equal(record.commit,method==='ask'?null:result.commit);
      assert.deepEqual(await runtime.handlers[`table.${method}`](params),{...result,replayed:true});
    } finally {await context.git.close();}
  });
});

// ---- Effect-key markers (contract §34.13.1, SL-88 "what needs no result does not wait") ------------------------------
//
// A narrate sharing a batch with the writes it describes has not seen their own placement markers yet (the write's
// result, carrying `markers`, only comes back on a later turn to read it). `{{kind:handle}}` names the effect by the
// kernel's own receipt kind and the handle the write itself named, and resolves without needing that marker back.

test('an effect key ({{kind:handle}}) resolves to this turn\'s receipt without copying its placement marker',async t=>{
  const home=await mkdtemp(join(evidence,'effect-key-'));
  const context=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
  t.after(()=>context.git.close());
  const runtime=api.createWriteRuntime(context);
  await runtime.handlers['campaign.create'](create);
  await runtime.handlers['table.player_input']({campaign:'c1',text:'I go to the newspaper morgue and look through the clippings.'});
  const action={campaign:'c1',call_id:'t1-c1'},transaction=await runtime.transaction(action);
  // A move's ordinary placement marker is `scene:<to>` (markerName groups it under the card family it draws as),
  // never `move:<to>` -- the effect key is a second, independent way to a receipt's marker, not an alias for the first.
  const moveReceipt={kind:'move',id:'move:t1-c1',to:'newspaper-morgue'};
  const clueReceipt={kind:'clue',id:'clue:t1-c1',clue:'globe-unpublished-story'};
  await transaction.commitResolve({callId:action.call_id,params:action,result:{receipts:[moveReceipt,clueReceipt]},receipts:[moveReceipt,clueReceipt],events:[]});
  const params={campaign:'c1',call_id:'t1-c2',
    text:'You arrive at the Globe {{move:newspaper-morgue}} and turn up the spiked story {{clue:globe-unpublished-story}}.'};
  const result=await runtime.handlers['table.narrate'](params);
  assert.equal(Object.hasOwn(result,'dropped_markers'),false,'both effect keys resolved; nothing was dropped');
  assert.ok(!result.rendered_text.includes('{{')&&!result.rendered_text.includes('}}'),'no brace reaches the player');
  assert.ok(result.rendered_text.includes('You arrive at the Globe')&&result.rendered_text.includes('turn up the spiked story'));
  // The token stands in the delivered structure exactly as written -- never translated to the ordinary scheme's name.
  assert.ok(result.marked_text.includes('{{move:newspaper-morgue}}'));
  assert.ok(result.marked_text.includes('{{clue:globe-unpublished-story}}'));
  assert.equal(result.mechanics.length,2,'both receipts still project a mechanics card');
  assert.deepEqual(result.mechanics.map(m=>m.receipt).sort(),[clueReceipt.id,moveReceipt.id].sort());
});

test('an effect key naming no receipt of this turn is dropped exactly like an unknown marker, and the prose still delivers',async t=>{
  const home=await mkdtemp(join(evidence,'effect-key-unknown-'));
  const context=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
  t.after(()=>context.git.close());
  const runtime=api.createWriteRuntime(context);
  await runtime.handlers['campaign.create'](create);
  await runtime.handlers['table.player_input']({campaign:'c1',text:'I search the clippings for the story.'});
  const action={campaign:'c1',call_id:'t1-c1'},transaction=await runtime.transaction(action);
  const clueReceipt={kind:'clue',id:'clue:t1-c1',clue:'globe-unpublished-story'};
  await transaction.commitResolve({callId:action.call_id,params:action,result:{receipts:[clueReceipt]},receipts:[clueReceipt],events:[]});
  const params={campaign:'c1',call_id:'t1-c2',
    text:'You find the story {{clue:globe-unpublished-story}}, but {{clue:nothing-landed-this-turn}} never turns up.'};
  const result=await runtime.handlers['table.narrate'](params);
  assert.deepEqual(result.dropped_markers.unknown,['clue:nothing-landed-this-turn']);
  assert.equal(Object.hasOwn(result.dropped_markers,'duplicate'),false);
  assert.ok(!result.rendered_text.includes('{{')&&!result.rendered_text.includes('}}'));
  assert.ok(result.rendered_text.includes('You find the story')&&result.rendered_text.includes('never turns up'));
  assert.equal(result.mechanics.length,1,'the mechanic that did land still projects; the dropped key cost nothing else');
});

test('a mechanics-only ask still allows no story text and keeps an empty delivery',async t=>{
  const home=await mkdtemp(join(evidence,'empty-ask-'));
  const context=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
  t.after(()=>context.git.close());const runtime=api.createWriteRuntime(context);
  await runtime.handlers['campaign.create'](create);
  const result=await runtime.handlers['table.ask']({campaign:'c1',call_id:'t0-c1',kind:'mechanics',options:['accept']});
  assert.equal(result.rendered_text,'');assert.deepEqual(result.mechanics,[]);
  for(const field of ['marked_text','dropped_markers','placed'])assert.equal(Object.hasOwn(result,field),false);
  const record=await (await runtime.campaign({campaign:'c1'})).readTurnRecord(0);
  assert.equal(record.text,'');assert.equal(record.rendered_text,'');assert.equal(record.commit,null);
});

test('combat and chase use the same current-scene NPC query without mixing their engines',()=>{
  assert.equal(api.combatOpponents,api.presentOpponents);assert.equal(api.chaseOpponents,api.presentOpponents);
  const here={node_id:'npc-here'},there={node_id:'npc-there'},profile={hp_current:10};
  const world={active_scene:'study',npc_presence:{here:'study',unknown:'study',there:'hall'}};
  const context=Object.assign(Object.create(api.SettleContext.prototype),{
    transaction:{world},module:{graph:{find:handle=>({here,there}[handle]??null),actor:handle=>({here,there}[handle]??null)}},
    npcProfile:handle=>handle==='here'?profile:null,
  });
  assert.deepEqual(api.presentOpponents(context),[['here',here,profile]]);
  world.active_scene='hall';assert.deepEqual(api.presentOpponents(context),[['there',there,null]]);
  world.active_scene='empty';assert.deepEqual(api.presentOpponents(context),[]);
});

test('unlocked RNG reseeds on open and player input using the saved main-line seed',async t=>{
  const home=await mkdtemp(join(evidence,'line-seed-')),ctx=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
  t.after(()=>ctx.git.close());const runtime=api.createWriteRuntime(ctx);
  const {campaign}=await runtime.handlers['campaign.create'](create),seed=campaign.worldlines.main.seed;
  await runtime.handlers['table.open']({campaign:'c1'});
  assert.equal(ctx.rng.randint(1,100),new api.PythonRandom(`${seed}:0`).randint(1,100));
  await runtime.handlers['table.player_input']({campaign:'c1',text:'Continue.'});
  const next=new api.PythonRandom(`${seed}:1`);
  assert.equal(ctx.rng.randint(1,100),next.randint(1,100));
  assert.equal(ctx.rng.randint(1,100),next.randint(1,100));
  await runtime.handlers['table.open']({campaign:'c1'});
  assert.equal(ctx.rng.randint(1,100),new api.PythonRandom(`${seed}:1`).randint(1,100));
});

test('closing real TS RPC stops stubborn selected Git descendants and lets a fresh owner resume',async t=>{
  const home=await mkdtemp(join(evidence,'git-stop-')),block=join(home,'block-git'),pids=join(home,'git-pids.json'),script=join(home,'git-fixture.mjs'),executable=join(home,'managed-git');
  await writeFile(script,`
import {spawn} from 'node:child_process';import {existsSync,writeFileSync} from 'node:fs';
if(existsSync(process.env.TEST_GIT_BLOCK)&&process.argv.slice(2).includes('commit')){
 process.on('SIGTERM',()=>{});
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit','ipc']});
 child.once('message',()=>writeFileSync(process.env.TEST_GIT_PIDS,JSON.stringify({git:process.pid,descendant:child.pid})));
 setInterval(()=>{},1000);
}else{
 const child=spawn('git',process.argv.slice(2),{stdio:'inherit'});child.on('error',()=>process.exit(2));child.on('close',code=>process.exit(code??1));
}
`);
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  await writeFile(executable,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`);await chmod(executable,0o755);
  const env=environment({PI_COC_GIT:executable,TEST_GIT_BLOCK:block,TEST_GIT_PIDS:pids}),first=client(home,env);
  t.after(()=>first.close());
  await first.call('campaign.create',create);await first.call('table.open',{campaign:'c1'});
  await first.call('table.narrate',{campaign:'c1',call_id:'t0-c1',text:'The case begins.'});
  await first.call('table.player_input',{campaign:'c1',text:'I inspect the letter.'});
  await writeFile(block,'block');
  const pending=first.call('table.narrate',{campaign:'c1',call_id:'t1-c1',text:'The paper is dry.'}).catch(error=>error);
  const observed=await until(async()=>{try{return JSON.parse(await readFile(pids,'utf8'));}catch{return null;}});
  await first.close();assert.match((await pending).message,/closed|ended/);
  for(const pid of Object.values(observed))await until(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});
  await unlink(block);
  const second=client(home,env);t.after(()=>second.close());
  const reopened=await second.call('table.open',{campaign:'c1'});
  assert.deepEqual(reopened.turn,{number:1,state:'acting'});
  assert.deepEqual(reopened.pending_turn.owed,['narrate']);
  const resumed=await second.call('table.narrate',{campaign:'c1',call_id:'t1-c1',text:'The paper is dry.'});
  assert.ok(resumed.commit);await second.close();
  assert.equal(JSON.parse(await readFile(join(home,'.coc/campaigns/c1/turn.json'),'utf8')).turn,2);
});

test('a deliberately incomplete writer rejects unavailable contributions but allows stored narration replay',async t=>{
  for(const kind of ['worldline'])await t.test(kind,async()=>{
    const home=await mkdtemp(join(evidence,`preflight-${kind}-`));
    const context=await api.createKernelContext({workspace:home,content:CONTENT,env:environment()});
    const runtime=api.createWriteRuntime(context);
    // The public registry is complete; this unit seam deliberately omits the contribution.
    const kernel={call:(method,params)=>runtime.handlers[method](params),close:()=>context.git.close()};
    try {
      await kernel.call('campaign.create',create);await kernel.call('table.open',{campaign:'c1'});
      const opening={campaign:'c1',call_id:'t0-c1',text:'The case begins.'};
      const committed=await kernel.call('table.narrate',opening);
      await kernel.call('table.player_input',{campaign:'c1',text:'I inspect the letter.'});
      const path=join(home,'.coc/campaigns/c1','turn.json');
      const saved=JSON.parse(await readFile(path,'utf8'));
      saved.worldline={operation:'fork',line:'later'};
      await writeFile(path,JSON.stringify(saved,null,2)+'\n');
      const before=await stateBytes(home);
      await assert.rejects(kernel.call('table.narrate',{campaign:'c1',call_id:'t1-c1',text:'This needs its contribution.'}),error=>error.code==='not_implemented');
      assert.deepEqual(await kernel.call('table.narrate',opening),{...committed,replayed:true});
      assert.deepEqual(await stateBytes(home),before);
    }finally{await kernel.close();}
  });
});
