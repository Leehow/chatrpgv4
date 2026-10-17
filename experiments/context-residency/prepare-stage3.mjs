/** Freeze the repaired production runtime through forced CoW; never copy campaigns or expose keys. */
import {mkdirSync,readFileSync,writeFileSync,existsSync,symlinkSync,chmodSync,statfsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {shareTestTree} from '../../scripts/test-workspace.mjs';
import {TEST_LANE_MODEL_ENVS} from '../../tests/play/driver.ts';

const repo=resolve(import.meta.dirname,'../..'),prior=resolve(process.argv[2]??''),root=resolve(process.argv[3]??'');
if(!process.argv[2]||!process.argv[3])throw Error('Usage: prepare-stage3.mjs RETAINED_STAGE1_ROOT NEW_ROOT');
if(existsSync(root))throw Error('Preserve existing evidence root');
const hash=value=>createHash('sha256').update(value).digest('hex');
const required={
    'build/runtime/launch.mjs':['runtime/launch.ts'],
    'build/runtime/pi-hybrid.mjs':['runtime/jev/hybrid-engine.ts','runtime/jev/continuous-turn.ts','runtime/keeper-output-guidance.ts','extensions/kernel/tools.ts'],
    'build/extensions/kernel/index.mjs':['extensions/kernel/index.ts','extensions/kernel/admission.ts','extensions/kernel/tools.ts','extensions/lanes/subsession.ts'],
    'build/extensions/table/index.mjs':['extensions/table/request-journal.ts','extensions/table/context-runtime.ts'],
    'build/kernel/rpc.mjs':['kernel-ts/mods/jobs.ts','kernel-ts/mods/objects.ts','kernel-ts/mods/stage.ts','kernel-ts/apply/index.ts','kernel-ts/apply/entities.ts']
};
const parity={};
for(const [entry,files] of Object.entries(required)){
    const map=JSON.parse(readFileSync(join(repo,entry+'.map'),'utf8'));
    for(const file of files){
        const index=map.sources.findIndex(source=>source===file||source.endsWith('/'+file));
        if(index<0||map.sourcesContent[index]!==readFileSync(join(repo,file),'utf8'))throw Error('Build is stale for '+file);
        parity[file]=hash(map.sourcesContent[index]);
    }
}
const fs=statfsSync(repo),freeBefore=fs.bavail*fs.bsize;
if(freeBefore<10*1024**3)throw Error('Insufficient test capacity');
mkdirSync(root,{recursive:true});const runtime=join(root,'runtime');mkdirSync(runtime);
const record={stage:3,created_at:new Date().toISOString(),seed:join(prior,'seed'),runtime,
    model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium',all_roles:true,jev:'jev-1.13.0',
    freeBefore,limits:{seedBytes:4*1024**3,growthBytes:512*1024**2,minFreeBytes:10*1024**3},parity,trees:[],identities:{},status:'preparing'};
const save=()=>writeFileSync(join(root,'admission.json'),JSON.stringify(record,null,2)+'\n');save();
for(const name of ['build','content','prompts','extensions','mods','bin','runtime','scripts','package.json','pipicoc/runtime-dependencies.json']){
    record.trees.push(shareTestTree(join(repo,name),join(runtime,name)));save();
}
shareTestTree(join(repo,'experiments/single-loop-routing/vault.mjs'),join(root,'vault.mjs'));
shareTestTree(join(repo,'experiments/context-residency/wire-observer.mjs'),join(root,'wire-observer.mjs'));
symlinkSync(join(repo,'node_modules'),join(runtime,'node_modules'),'dir');
const profile=join(runtime,'.pi/coc-agent');mkdirSync(profile,{recursive:true,mode:0o700});
for(const name of ['auth.json','models.json','models-store.json','settings.json','grok-build-session-id','pipiui-settings.json']){
    const source=join(prior,'runtime/.pi/coc-agent',name);if(!existsSync(source))continue;
    const result=shareTestTree(source,join(profile,name));chmodSync(join(profile,name),0o600);
    record.trees.push({source_kind:'private-test-profile',name,files:result.files,bytes:result.bytes,method:result.method});save();
}
const launch=[
    "import {spawn} from 'node:child_process';",
    "import {readVaultSecret} from './vault.mjs';",
    'import {readJevApiKey} from '+JSON.stringify(join(runtime,'extensions/jev/agent/config.js'))+';',
    "const model='minimax-cn/MiniMax-M3.1-Flash-Preview',thinking='medium';",
    "const env={...process.env,PI_COC_TEST_MODEL:model,PI_COC_ISOLATED_OUTPUT:process.env.PI_COC_ISOLATED_OUTPUT==='1'?'1':'0'};",
    "const key=readVaultSecret('EXT_JEV_APIKEY');if(!key)throw Error('The requested Jev profile is not configured');env.EXT_JEV_APIKEY=key;",
    "if(!readJevApiKey(env))throw Error('The requested Jev extension is not mounted');",
    'for(const name of '+JSON.stringify(TEST_LANE_MODEL_ENVS)+'){env[name]=model;env[name+\'_THINKING\']=thinking;env[name.replace(/_MODEL$/,\'\')+\'_THINKING\']=thinking;}',
    'const child=spawn('+JSON.stringify(join(runtime,'bin/pi-coc'))+',[\'--extension\','+JSON.stringify(join(root,'wire-observer.mjs'))+',...process.argv.slice(2)],{env,stdio:\'inherit\'});',
    "for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>child.kill(signal));",
    "child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',(code)=>{process.exitCode=code??1;});"
].join('\n')+'\n';
writeFileSync(join(root,'launch.mjs'),launch,{mode:0o600});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const launcher=join(root,'launch.sh');
writeFileSync(launcher,'#!/bin/bash\nset -euo pipefail\nexec '+quote(process.execPath)+' '+quote(join(root,'launch.mjs'))+' "$@"\n',{mode:0o755});
for(const entry of Object.keys(required))record.identities[entry]=hash(readFileSync(join(runtime,entry)));
record.driver_sha256=hash(readFileSync(join(repo,'tests/play/driver.ts')));
record.observer_sha256=hash(readFileSync(join(root,'wire-observer.mjs')));
record.launcher=launcher;record.status='ready';save();
console.log(JSON.stringify({root,launcher,seed:record.seed,parity:Object.keys(parity).length,freeBefore,status:record.status}));
