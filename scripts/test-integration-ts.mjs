/** Native integration tier with actual case outcomes, owned storage and retained failure evidence. */
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildNative} from './build-native.mjs';

await buildNative();

const root=fileURLToPath(new URL('..',import.meta.url)),parent=join(root,'.coc/test-runs');
mkdirSync(parent,{recursive:true});
const report=mkdtempSync(join(parent,'integration-ts-')),startedAt=new Date().toISOString();
const selected=process.argv.slice(2);
// Node discovers every repository test when options are supplied without file operands.
// Consume separate option values so a name pattern is not mistaken for an explicit file.
const valueOptions=new Set(['--test-name-pattern','--test-skip-pattern','--test-concurrency','--test-timeout',
  '--test-shard','--test-isolation','--experimental-test-isolation','--test-reporter','--test-reporter-destination',
  '--test-global-setup','--test-random-seed','--test-rerun-failures','--test-coverage-branches',
  '--test-coverage-functions','--test-coverage-lines','--test-coverage-exclude','--test-coverage-include',
  '--import','--require','-r','--loader','--experimental-loader','--conditions','-C']);
let explicitFiles=false;
for(let index=0;index<selected.length;index++){
  const arg=selected[index];
  if(arg==='--'){explicitFiles=index+1<selected.length;break;}
  if(valueOptions.has(arg)){
    if(index+1===selected.length)throw new Error(`Missing value for ${arg}`);
    index++;
  }else if(!arg.startsWith('-'))explicitFiles=true;
}
const files=explicitFiles?selected:[...selected,'tests/integration/*.test.ts'];
const concurrency=Number(process.env.COC_TS_TEST_CONCURRENCY??2);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)throw new Error('COC_TS_TEST_CONCURRENCY must be an integer from 1 to 32');
const args=['--test',`--test-concurrency=${concurrency}`,'--test-reporter=spec','--test-reporter-destination=stdout',
  '--test-reporter=junit',`--test-reporter-destination=${join(report,'results.xml')}`,...files];
console.log(`Native integration evidence: ${report}`);
const child=spawn(process.execPath,['scripts/test-storage.mjs','--run-dir',join(report,'storage'),'--',...args.slice(1)],{cwd:root,stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('close',(code,signal)=>{
  const exitCode=code??({SIGINT:130,SIGTERM:143,SIGHUP:129}[signal]??1);
  writeFileSync(join(report,'run.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),command:[process.execPath,...args],exitCode,signal},null,2)+'\n');
  process.exitCode=exitCode;
});
