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
].join('\n'),sourcefile:'writer-test-api.ts',resolveDir:ROOT,loader:'ts'},outfile:join(output,'api.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(output,'api.mjs')).href);
const create={id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'};
function environment(extra={}) {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0',GIT_AUTHOR_DATE:'2000-01-02T03:04:05Z',GIT_COMMITTER_DATE:'2000-01-02T03:04:05Z',
    COC_TEST_CLOCK:'2000-01-02T03:04:05Z',NODE_OPTIONS:`--require ${JSON.stringify(join(ROOT,'tests/kernel/rpc_clock.cjs'))}`,TZ:'UTC',...extra};
}
async function until(read) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const result=await read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Owned process did not reach its expected state');
}
function client(home,env) {return new KernelClient({command:[process.execPath,RPC,'--workspace',home,'--content',CONTENT],cwd:ROOT,env,inheritEnv:false,timeoutMs:15000});}
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

test('unavailable contributions reject new writes before mutation but allow a stored narration replay',async t=>{
  for(const kind of ['library','worldline','pending-mod'])await t.test(kind,async()=>{
    const home=await mkdtemp(join(evidence,`preflight-${kind}-`)),kernel=client(home,environment());
    try {
      await kernel.call('campaign.create',create);await kernel.call('table.open',{campaign:'c1'});
      const opening={campaign:'c1',call_id:'t0-c1',text:'The case begins.'};
      const committed=await kernel.call('table.narrate',opening);
      await kernel.call('table.player_input',{campaign:'c1',text:'I inspect the letter.'});
      const path=join(home,'.coc/campaigns/c1',kind==='library'?'party/thomas-hayes.json':kind==='worldline'?'turn.json':'world.json');
      const saved=JSON.parse(await readFile(path,'utf8'));
      if(kind==='library')saved.origin={library_id:'retained-library-card'};
      else if(kind==='worldline')saved.worldline={operation:'fork',line:'later'};
      else saved.mods.pending={'natural-npc':{enabled:false}};
      await writeFile(path,JSON.stringify(saved,null,2)+'\n');
      const before=await stateBytes(home);
      await assert.rejects(kernel.call('table.narrate',{campaign:'c1',call_id:'t1-c1',text:'This needs its contribution.'}),error=>error.code==='not_implemented');
      assert.deepEqual(await kernel.call('table.narrate',opening),{...committed,replayed:true});
      assert.deepEqual(await stateBytes(home),before);
    }finally{await kernel.close();}
  });
});
