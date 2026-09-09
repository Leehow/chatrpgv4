import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { callColdKernel, readColdSheet } from '../../Electron/packages/pi-backend/src/coc-view.ts';

const ROOT=resolve(import.meta.dirname,'../..');

function fixture(t) {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'cold runtime view ')));
  const repo=join(base,'relocated resources'),home=join(base,'selected data'),contentRoot=join(base,'selected content');
  for(const path of [repo,home,join(contentRoot,'rulesets/coc7')])mkdirSync(path,{recursive:true});
  symlinkSync(join(ROOT,'node_modules'),join(repo,'node_modules'),'dir');
  buildSync({entryPoints:{'runtime/host':join(ROOT,'runtime/host.ts'),'kernel/rpc':join(ROOT,'kernel-ts/rpc.ts')},
    outdir:join(repo,'build'),outExtension:{'.js':'.mjs'},bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
  const pidLog=join(base,'child-pids.txt'),nodeExecutable=join(base,'managed node');
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(nodeExecutable,`#!/bin/sh\nprintf '%s\\n' "$$" >> ${quote(pidLog)}\nexec ${quote(process.execPath)} "$@"\n`);
  chmodSync(nodeExecutable,0o755);
  const transport=join(repo,'cold transport fixture.mjs');
  // This process verifies the existing RPC transport only; it does not implement gameplay.
  writeFileSync(transport,`
import {createInterface} from 'node:readline';
process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),25));
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line),args=process.argv.slice(2);
 const result={pid:process.pid,method:request.method,params:request.params,cwd:process.cwd(),home:process.env.PI_COC_HOME,
  campaign:process.env.PI_COC_CAMPAIGN,agentHome:process.env.PI_CODING_AGENT_DIR,marker:process.env.COLD_CAPTURED,
  workspace:args[args.indexOf('--workspace')+1],content:args[args.indexOf('--content')+1]};
 process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\\n');
});
`);
  const pids=()=>existsSync(pidLog)?readFileSync(pidLog,'utf8').trim().split('\n').filter(Boolean).map(Number):[];
  t.after(()=>{
    for(const pid of pids())try{process.kill(pid,'SIGKILL');}catch{}
    rmSync(base,{recursive:true,force:true});
  });
  const env={...process.env,PI_COC_KERNEL_CMD:undefined,PI_COC_HOME:'/ambient/home',PI_COC_CAMPAIGN:'ambient-campaign',
    PI_CODING_AGENT_DIR:join(base,'selected Pi home'),COLD_CAPTURED:'captured'};
  const options={contentRoot,nodeExecutable,backend:'typescript',kernelEntrypoint:transport};
  return {base,repo,home,contentRoot,env,options,pids};
}

test('cold calls capture the selected runtime and close their disposable kernel before returning',async t=>{
  const f=fixture(t);
  const params={name:'Notebook'},options={...f.options};
  const pending=callColdKernel(f.repo,f.home,'mods.list',params,f.env,options);
  f.env.COLD_CAPTURED='late environment';options.kernelEntrypoint='/missing/late-kernel';params.name='late input';
  const result=await pending;
  assert.equal(result.method,'mods.list');
  assert.deepEqual(result.params,{name:'Notebook'});
  assert.equal(result.marker,'captured');
  assert.equal(result.home,f.home);
  assert.equal(result.workspace,f.home);
  assert.equal(result.content,f.contentRoot);
  assert.equal(result.cwd,f.repo);
  assert.equal(result.agentHome,f.env.PI_CODING_AGENT_DIR);
  assert.equal(result.campaign,undefined);
  assert.deepEqual(f.pids(),[result.pid]);
  assert.throws(()=>process.kill(result.pid,0),{code:'ESRCH'});
});

test('cold sheet and preview calls preserve positional arguments and use independent campaign-bound owners',async t=>{
  const f=fixture(t),binding={campaign:'selected-campaign',home:f.home,play_language:'en'};
  const [sheet,preview]=await Promise.all([
    readColdSheet(f.repo,binding,undefined,f.env,f.options),
    readColdSheet(f.repo,binding,3,f.env,{...f.options,hostEntrypoint:join(f.repo,'build/runtime/host.mjs')}),
  ]);
  assert.equal(sheet.method,'table.view');
  assert.deepEqual(sheet.params,{campaign:binding.campaign});
  assert.equal(preview.method,'setup.previewed');
  assert.deepEqual(preview.params,{campaign:binding.campaign,revision:3});
  assert.equal(sheet.campaign,binding.campaign);
  assert.equal(preview.campaign,binding.campaign);
  assert.notEqual(sheet.pid,preview.pid);
  for(const pid of f.pids())assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('a cold TypeScript read fails explicitly and preserves data without falling back to Python',async t=>{
  const f=fixture(t),retained=join(f.home,'retained.json');
  writeFileSync(retained,'{"keep":true}\n');
  const env={...f.env,PATH:''};
  const options={...f.options,kernelEntrypoint:join(f.repo,'build/kernel/rpc.mjs')};
  await assert.rejects(readColdSheet(f.repo,{home:f.home,campaign:'unimplemented',play_language:'en'},undefined,env,options),
    error=>error.code==='not_implemented'&&/table.view/.test(error.message));
  assert.equal(f.pids().length,1);
  for(const pid of f.pids())assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  assert.equal(readFileSync(retained,'utf8'),'{"keep":true}\n');
  assert.equal(existsSync(join(f.home,'.coc')),false);
  await assert.rejects(callColdKernel(f.repo,f.home,'kernel.hello',{},env,{...options,kernelEntrypoint:'missing-kernel.mjs'}),
    error=>error.details?.reason==='runtime_configuration');
  assert.equal(f.pids().length,1);
  assert.equal(readFileSync(retained,'utf8'),'{"keep":true}\n');
});
