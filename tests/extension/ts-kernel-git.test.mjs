import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {createGitRuntime} from '../../kernel-ts/git.ts';
import {parsePythonJson, pythonObjectEntries, pythonJsonDumps} from '../../kernel-ts/json.ts';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'runtime Git '));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const work=join(root,'.coc/campaigns/example');
  await mkdir(work,{recursive:true});
  return {root,work};
}

test('Python dictionary iteration preserves source numeric-key order',()=>{
  const value=parsePythonJson('{"10":"ten","2":"two","01":"one","__proto__":1.0}');
  const entries=pythonObjectEntries(value);
  assert.deepEqual(entries.map(([key])=>key),['10','2','01','__proto__']);
  entries[0][0]='changed';
  assert.equal(pythonJsonDumps(value),'\u007b"10": "ten", "2": "two", "01": "one", "__proto__": 1.0}');
});

test('captured Git reads retained worldline blobs without checkout or changing the working tree',async t=>{
  const {root,work}=await fixture(t);
  const found=spawnSync('/usr/bin/which',['git'],{encoding:'utf8'});
  assert.equal(found.status,0,found.stderr);
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),
    PI_COC_GIT:found.stdout.trim(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_AUTHOR_DATE:'2000-01-02T03:04:05Z',GIT_COMMITTER_DATE:'2000-01-02T03:04:05Z'};
  const git=createGitRuntime(root,env);
  t.after(()=>git.close());
  env.PI_COC_GIT='/unavailable';
  assert.equal((await git.init('example')).code,0);
  const command=async args=>{const result=await git.run('example',args);assert.equal(result.code,0,result.stderr);return result.stdout;};
  await command(['symbolic-ref','HEAD','refs/heads/wl/main']);
  await writeFile(join(work,'world.json'),'{"scene":"first"}\n');
  await command(['add','-A','.']);await command(['commit','--quiet','--allow-empty','-m','campaign example: created']);
  const first=(await command(['rev-parse','--short','HEAD'])).trim();
  await command(['branch','wl/retained']);
  await writeFile(join(work,'world.json'),'{"scene":"second"}\n');
  await command(['add','-A','.']);await command(['commit','--quiet','-m','turn 1: changed scene']);
  assert.equal(await git.lineBlob('example','retained','world.json'),'{"scene":"first"}\n');
  assert.equal(await git.lineBlob('example','absent','world.json'),null);
  assert.equal(await git.rootCommit('example'),first);
  assert.equal(await readFile(join(work,'world.json'),'utf8'),'{"scene":"second"}\n');
  assert.equal((await command(['symbolic-ref','HEAD'])).trim(),'refs/heads/wl/main');
  assert.equal(await command(['status','--porcelain']),'');
  await git.close();
  await assert.rejects(git.run('example',['status']),/closed/);
});

test('closing Git stops owned descendants and missing Git cannot create repository state',async t=>{
  const {root}=await fixture(t);
  const missing=createGitRuntime(root,{PATH:'',PI_COC_GIT:'/unavailable'});
  await assert.rejects(missing.init('example'),/unavailable/);
  await assert.rejects(readFile(join(root,'.coc/repos/example.git/HEAD')),{code:'ENOENT'});
  const entry=join(root,'owned git');
  const pidPath=join(root,'processes.json');
  // shebang 的解释器路径不能带空格：fixture 目录名（"runtime Git …"）和宿主的 node
  // 路径（Application Support）都有空格，所以软链接放到一个没有空格的临时目录里。
  const binDir=await mkdtemp(join(tmpdir(),'node-bin-'));
  t.after(()=>rm(binDir,{recursive:true,force:true}));
  const nodeBin=join(binDir,'node');
  await symlink(process.execPath,nodeBin);
  await writeFile(entry,`#!${nodeBin}\nimport{spawn}from'node:child_process';import{writeFileSync}from'node:fs';
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});
writeFileSync(process.env.TEST_GIT_PIDS,JSON.stringify([process.pid,child.pid]));
process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`);
  await chmod(entry,0o700);
  const git=createGitRuntime(root,{...process.env,PI_COC_GIT:entry,TEST_GIT_PIDS:pidPath});
  t.after(()=>git.close());
  const running=git.run('example',['status']);
  const rejected=assert.rejects(running,/cancelled/);
  let pids;
  for(let attempt=0;attempt<100;attempt++){
    try{pids=JSON.parse(await readFile(pidPath,'utf8'));break;}catch{await delay(10);}
  }
  assert.equal(pids?.length,2);
  await git.close();await rejected;
  for(const pid of pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
