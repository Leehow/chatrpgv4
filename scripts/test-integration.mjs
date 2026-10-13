/** Run every native integration assertion with the canonical evidence and storage runner. */
import {spawn} from 'node:child_process';
const root=new URL('..',import.meta.url);
const child=spawn(process.execPath,['scripts/test-integration-ts.mjs',...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('close',(code,signal)=>{process.exitCode=code??({SIGINT:130,SIGTERM:143,SIGHUP:129}[signal]??1);});
