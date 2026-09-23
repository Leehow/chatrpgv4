/**
 * One product kernel process over its own JSONL RPC (build/kernel/rpc.mjs), bound to a disposable
 * workspace copy. Transport only: no request is rewritten and no answer is interpreted here.
 */
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';

export const REPO=resolve(import.meta.dirname,'../..');

export class KernelError extends Error {
  constructor(method,error){super(`${method}: ${error?.code??'error'} ${error?.message??''}`.trim());this.method=method;this.rpc=error;}
}

export function startKernel({workspace,env={}}){
  const child=spawn(process.execPath,[join(REPO,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(REPO,'content')],
    {cwd:REPO,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  const pending=new Map();let next=0,stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
  createInterface({input:child.stdout}).on('line',line=>{
    if(!line.trim())return;const frame=JSON.parse(line);if(frame.progress)return;
    const waiter=pending.get(frame.id);if(!waiter)return;pending.delete(frame.id);waiter(frame);
  });
  child.on('exit',code=>{for(const [id,waiter] of pending){pending.delete(id);waiter({id,ok:false,error:{code:'kernel_exit',message:`exit ${code}: ${stderr.slice(-400)}`}});}});
  /** Raw frame: {ok, result} or {ok:false, error}. */
  const frame=(method,params={})=>new Promise(accept=>{
    const id=String(++next);pending.set(id,accept);child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  const call=async(method,params={})=>{
    const answer=await frame(method,params);if(!answer.ok)throw new KernelError(method,answer.error);return answer.result;
  };
  const close=()=>new Promise(done=>{if(child.exitCode!==null)return done();child.once('exit',()=>done());child.stdin.end();});
  return {call,frame,close,get stderr(){return stderr;}};
}
