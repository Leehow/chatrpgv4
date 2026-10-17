/** Prepare an admitted private runtime from the retained stage 1 runtime, using forced CoW. */
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,statfsSync,chmodSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {shareTestTree} from '../../scripts/test-workspace.mjs';
import {compiledTableRepair} from './patch-runtime.mjs';

const [priorArg,destinationArg]=process.argv.slice(2);
if(!priorArg||!destinationArg)throw Error('Usage: node prepare-stage2.mjs PRIOR_EVIDENCE_ROOT NEW_EVIDENCE_ROOT');
const prior=resolve(priorArg),root=resolve(destinationArg),repo=resolve(import.meta.dirname,'../..');
if(existsSync(root))throw Error('Preserve existing evidence root');
const fs=statfsSync(repo),freeBefore=fs.bavail*fs.bsize;
if(freeBefore<10*1024**3)throw Error('Insufficient test storage admission');
mkdirSync(root,{recursive:true});
const runtime=join(root,'runtime');mkdirSync(runtime);
const record={stage:2,created_at:new Date().toISOString(),root,prior,seed:join(prior,'seed'),runtime,
  model:'minimax-cn/MiniMax-M3.1-Flash-Preview',thinking:'medium',all_roles:true,
  limits:{seedBytes:4*1024**3,growthBytes:512*1024**2,minFreeBytes:10*1024**3},freeBefore,
  qualification:'Same retained stage 1 runtime; only isolated table journal patch and observer change. No current-source build or App acceptance.',
  trees:[],identities:{},status:'preparing'};
const save=()=>writeFileSync(join(root,'admission.json'),JSON.stringify(record,null,2)+'\n');save();
for(const name of ['build','content','prompts','extensions','mods','bin','runtime','scripts','package.json','pipicoc/runtime-dependencies.json']){
  record.trees.push(shareTestTree(join(prior,'runtime',name),join(runtime,name)));save();
}
symlinkSync(join(repo,'node_modules'),join(runtime,'node_modules'),'dir');
const profile=join(runtime,'.pi/coc-agent');mkdirSync(profile,{recursive:true,mode:0o700});
for(const name of ['auth.json','models.json','models-store.json','settings.json','grok-build-session-id','pipiui-settings.json']){
  const shared=shareTestTree(join(prior,'runtime/.pi/coc-agent',name),join(profile,name));
  // Credential bytes and their digest are deliberately excluded from the human-readable record.
  record.trees.push({source_kind:'private-test-profile',name,files:shared.files,bytes:shared.bytes,method:shared.method});
  chmodSync(join(profile,name),0o600);save();
}
const original=join(prior,'artifacts/table-original.mjs');
const table=join(runtime,'build/extensions/table/index.mjs');
writeFileSync(table,compiledTableRepair(readFileSync(original,'utf8')));
const addon=join(runtime,'experiments/context-residency/extension-stage2.mjs');mkdirSync(resolve(addon,'..'),{recursive:true});
await build({entryPoints:[join(repo,'experiments/context-residency/extension-stage2.ts')],outfile:addon,bundle:true,
  platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const launcher=join(root,'launch.sh');
writeFileSync(launcher,'#!/bin/bash\nset -euo pipefail\nexec '+quote(join(runtime,'bin/pi-coc'))+' --extension '+quote(addon)+' "$@"\n',{mode:0o755});
for(const name of ['build/runtime/launch.mjs','build/runtime/pi-hybrid.mjs','build/kernel/rpc.mjs','build/extensions/table/index.mjs','experiments/context-residency/extension-stage2.mjs'])
  record.identities[name]=createHash('sha256').update(readFileSync(join(runtime,name))).digest('hex');
record.driver_sha256=createHash('sha256').update(readFileSync(join(repo,'tests/play/driver.ts'))).digest('hex');
record.launcher=launcher;record.status='ready';save();
console.log(JSON.stringify({root,launcher,seed:record.seed,freeBefore,status:record.status}));
