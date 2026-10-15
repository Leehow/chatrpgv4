/** Build the existing descriptor-lock addon without a Python build generator. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, mkdir, readFile, realpath, rename, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const exec = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smoke = `const fs=require('node:fs'),addon=require(process.argv[1]);const fd=fs.openSync(process.argv[2],'a+');try{addon.flock(fd,addon.constants.LOCK_EX|addon.constants.LOCK_NB);addon.flock(fd,addon.constants.LOCK_UN);}finally{fs.closeSync(fd);}`;

export async function buildNative({packageRoot=ROOT, nodeRoot, nodeExecutable=process.execPath, force=false,
  run=(command,args,options)=>exec(command,args,{...options,maxBuffer:4*1024*1024}), signal, log}={}) {
  if (!['darwin','linux'].includes(process.platform)) throw new Error('Native descriptor-lock builds support macOS and Linux.');
  nodeExecutable = await realpath(nodeExecutable);
  nodeRoot ??= dirname(dirname(nodeExecutable));
  const module = join(packageRoot,'node_modules/fs-ext'), output = join(module,'build/Release/fs_ext.node');
  const metadata = JSON.parse(await readFile(join(module,'package.json'),'utf8'));
  if (metadata.version !== '2.1.1') throw new Error('Review the native build recipe before changing fs-ext.');
  const headers = join(nodeRoot,'include/node'), source = join(module,'fs-ext.cc');
  const nan = dirname(await realpath(join(module,'../nan/package.json')));
  await access(join(headers,'node.h'));
  const flags = ['-std=c++20','-shared','-fPIC','-O2','-fno-rtti','-fno-exceptions',
    '-DNODE_GYP_MODULE_NAME=fs_ext','-DBUILDING_NODE_EXTENSION','-D_FILE_OFFSET_BITS=64','-D_LARGEFILE_SOURCE',
    '-I'+headers,'-I'+nan];
  if (process.platform === 'darwin') flags.push('-Wl,-undefined,dynamic_lookup','-mmacosx-version-min=13.5');
  const directory = dirname(output);
  await mkdir(directory,{recursive:true});
  const temporary = join(directory,`.fs_ext-${randomUUID()}.node`), lock = temporary+'.lock';
  const check = path => run(nodeExecutable,['-e',smoke,path,lock],{signal,log});
  try {
    if (!force) {
      try { await check(output); return {output,rebuilt:false}; } catch (error) { if(signal?.aborted)throw error; }
    }
    // Compiler arguments are separate argv values; no shell, dependency lifecycle or generator runs.
    await run('/usr/bin/c++',[...flags,source,'-o',temporary],{signal,log});
    await check(temporary);
    await rename(temporary,output);
    return {output,rebuilt:true};
  } finally {
    await rm(temporary,{force:true});
    await rm(lock,{force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildNative({force:process.argv.includes('--force')})));
