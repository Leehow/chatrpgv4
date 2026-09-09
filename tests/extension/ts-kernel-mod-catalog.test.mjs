import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {build} from 'esbuild';

test('a fresh home reads the real builtin Mod catalog and byte digests beside content',async t=>{
  const root=resolve(import.meta.dirname,'../..');
  const home=await mkdtemp(join(tmpdir(),'fresh builtin Mods '));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await build({stdin:{contents:`export {createKernelContext} from './kernel-ts/context.ts';
export {readModCatalog} from './kernel-ts/read/mods.ts';
export {pythonJsonDumps} from './kernel-ts/json.ts';`,resolveDir:root,loader:'ts'},
    outfile:join(home,'catalog.mjs'),bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
  const api=await import(pathToFileURL(join(home,'catalog.mjs')).href);
  const context=await api.createKernelContext({workspace:home,content:join(root,'content')});
  t.after(()=>context.git.close());
  const actual=[...await api.readModCatalog(context)].map(([,value])=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='files')));
  const reference=spawnSync('uv',['run','--frozen','python','-c',[
    'import json, sys',
    'from pathlib import Path',
    'sys.path.insert(0, str(Path.cwd() / "kernel"))',
    'from coc.mods.runtime import ModRuntime',
    'rows = ModRuntime(Path.cwd() / "mods", Path(sys.argv[1])).catalog().values()',
    'print(json.dumps([{k: v for k, v in row.items() if k != "files"} for row in rows]))',
  ].join('\n'),home],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(reference.status,0,reference.stderr);
  assert.ok(actual.length>0,'The product ships builtin packages without requiring an earlier install');
  assert.deepEqual(JSON.parse(api.pythonJsonDumps(actual)),JSON.parse(reference.stdout));
});
