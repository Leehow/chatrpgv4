import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, symlink, copyFile, rm, access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildNative} from '../../scripts/build-native.mjs';
import {createPackageRecipe} from '../../pipicoc/package-config.mjs';

const root=resolve(import.meta.dirname,'../..');
test('fresh native addon compiles and locks without a generator or interpreter', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'coc-python-free-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'node_modules/fs-ext'),{recursive:true});
  for(const file of ['fs-ext.cc','package.json'])await copyFile(join(root,'node_modules/fs-ext',file),join(dir,'node_modules/fs-ext',file));
  await symlink(join(root,'node_modules/nan'),join(dir,'node_modules/nan'),'dir');
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const exec=promisify(execFile),calls=[];
  const run=async(command,args,options)=>{
    calls.push({command,args});
    assert.ok(command==='/usr/bin/c++'||command===process.execPath);
    return exec(command,args,{...options,env:{PATH:'/usr/bin:/bin',HOME:dir},maxBuffer:4*1024*1024});
  };
  const result=await buildNative({packageRoot:dir,force:true,run});
  assert.equal(result.rebuilt,true);await access(result.output);
  assert.equal(calls.filter(call=>call.command==='/usr/bin/c++').length,1);
  assert.equal(calls.filter(call=>call.command===process.execPath).length,1);
  assert.equal((await buildNative({packageRoot:dir,run})).rebuilt,false);
});

test('failed compilation preserves the existing addon and clears temporary outputs', async t=>{
  const dir=await mkdtemp(join(tmpdir(),'coc-native-failure-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'node_modules/fs-ext/build/Release'),{recursive:true});
  await copyFile(join(root,'node_modules/fs-ext/package.json'),join(dir,'node_modules/fs-ext/package.json'));
  await symlink(join(root,'node_modules/nan'),join(dir,'node_modules/nan'),'dir');
  const output=join(dir,'node_modules/fs-ext/build/Release/fs_ext.node');await writeFile(output,'previous');
  await assert.rejects(()=>buildNative({packageRoot:dir,force:true,run:async()=>{throw Error('compiler failed');}}),/compiler failed/);
  assert.equal(await readFile(output,'utf8'),'previous');
  const {readdir}=await import('node:fs/promises');
  assert.deepEqual(await readdir(join(dir,'node_modules/fs-ext/build/Release')),['fs_ext.node']);
});

test('installation and canonical packaging disable generator fallback', async()=>{
  for(const file of ['.npmrc','Electron/.npmrc'])assert.match(await readFile(join(root,file),'utf8'),/^ignore-scripts=true/m);
  const {config}=createPackageRecipe({repo:root,stage:'/stage',product:{appId:'test.coc',name:'PipiCOC',icon:'icon.png'},version:'1',userHome:'/home'});
  assert.equal(config.npmRebuild,false);
  const source=await readFile(join(root,'scripts/package-runtime.mjs'),'utf8');
  assert.doesNotMatch(source,/run\(['"]uv['"]|node-gyp|npm_config_python|NODE_GYP_FORCE_PYTHON/);
  assert.match(source,/buildNative\(/);
});
