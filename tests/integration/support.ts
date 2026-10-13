/** Native Node test fixtures for the production TypeScript JSONL boundary. */
import assert from 'node:assert/strict';
import {after, type TestContext} from 'node:test';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

import {nativeStorageFixture} from './storage-support.ts';
export type Row=Record<string,any>;
export const ROOT=resolve(import.meta.dirname,'../..');
export const CONTENT_DIR=join(ROOT,'content');
export const CAMPAIGN='c1';
export const MODULE='the-haunting';
export const PREGEN='thomas-hayes';
mkdirSync(join(ROOT,'.tmp'),{recursive:true});
const compiled=mkdtempSync(join(ROOT,'.tmp','ts-integration-runtime-'));
const entry=join(compiled,'rpc.mjs');
await build({entryPoints:[join(ROOT,'kernel-ts/rpc.ts')],outfile:entry,bundle:true,packages:'external',
  platform:'node',format:'esm',target:'node22',logLevel:'silent'});
after(()=>rmSync(compiled,{recursive:true,force:true}));
export const rpcCommand=()=>[process.execPath,entry];
export function fixedEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  const isolated=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_')));
  const clock='2000-01-02T03:04:05Z';
  return {...isolated,COC_TEST_CLOCK:clock,TZ:'UTC',GIT_AUTHOR_DATE:clock,GIT_COMMITTER_DATE:clock,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'0',
    NODE_OPTIONS:`${env.NODE_OPTIONS??''} --require ${JSON.stringify(join(ROOT,'tests/kernel/rpc_clock.cjs'))}`.trim()};
}
const sourceModules=new Map<string,Promise<any>>();
export function importSource(path:string):Promise<any>{
  let pending=sourceModules.get(path);if(pending)return pending;
  pending=(async()=>{const outfile=join(compiled,`source-${sourceModules.size}.mjs`);
    await build({entryPoints:[join(ROOT,path)],outfile,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',logLevel:'silent'});
    return import(pathToFileURL(outfile).href);
  })();sourceModules.set(path,pending);return pending;
}

export class RpcClient {
  readonly proc:ChildProcessWithoutNullStreams;
  readonly workspace:string;
  readonly content:string;
  readonly exchanges:Row[]=[];
  private ordinal=0;
  private pending=new Map<string,{resolve:(value:Row)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private buffer='';
  private diagnostics='';
  private broken=false;
  constructor(workspace:string,options:{env?:NodeJS.ProcessEnv;content?:string;command?:string[];retargetable?:boolean;frozen_clock?:boolean}={}) {
    this.workspace=workspace;this.content=options.content??CONTENT_DIR;mkdirSync(workspace,{recursive:true});
    const command=options.command??rpcCommand();
    let env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',...options.env};
    if(options.frozen_clock)env=fixedEnvironment(env) as typeof env;
    this.proc=spawn(command[0],[...command.slice(1),...(options.retargetable?['--retargetable']:[]),'--workspace',workspace,'--content',this.content],{
      cwd:ROOT,env,stdio:'pipe'});
    this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data',chunk=>{this.diagnostics=(this.diagnostics+chunk).slice(-8192);});
    this.proc.stdout.on('data',chunk=>{
      this.buffer+=chunk;
      for(let at;(at=this.buffer.indexOf('\n'))>=0;){
        const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;
        let response:Row;
        try{response=JSON.parse(line);}catch{this.fail(new assert.AssertionError({message:'Invalid JSONL response: '+line}));return;}
        if(response.progress)continue;
        const key=this.pending.has(String(response.id))?String(response.id):this.pending.has('__raw__')?'__raw__':null;
        if(key===null)continue;const request=this.pending.get(key)!;
        this.pending.delete(key);clearTimeout(request.timer);request.resolve(response);
      }
    });
    this.proc.on('error',error=>this.fail(error));
    this.proc.stdin.on('error',error=>this.fail(error));
    this.proc.stdout.on('end',()=>{if(this.pending.size)this.fail(new assert.AssertionError({message:`Kernel stdout closed before a complete JSON line: ${this.buffer}; ${this.diagnostics}`}));});
    this.proc.on('exit',(code,signal)=>this.fail(new Error(`Kernel exited (${code??signal}): ${this.diagnostics}`)));
  }
  private fail(error:Error){this.broken=true;for(const value of this.pending.values()){clearTimeout(value.timer);value.reject(error);}this.pending.clear();}
  get healthy(){return !this.broken&&this.proc.exitCode===null&&this.proc.signalCode===null&&!this.buffer&&!this.pending.size;}
  async raw(line:string):Promise<Row>{
    assert.equal(this.pending.size,0,'Raw exchanges cannot overlap another request');
    const response=await this.exchange('__raw__',line,'raw request');this.exchanges.push({request:line,response});return response;
  }
  private exchange(id:string,line:string,method:string):Promise<Row>{
    if(this.proc.exitCode!==null||this.proc.signalCode!==null)return Promise.reject(new Error('Kernel already exited'));
    return new Promise<Row>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.broken=true;this.pending.delete(id);reject(new Error(`Kernel request timed out: ${method}; ${this.diagnostics}`));},30000);
      this.pending.set(id,{resolve,reject,timer});this.proc.stdin.write(line+'\n');
    });
  }
  async call(method:string,params:Row={}):Promise<Row>{
    const id=`req-${++this.ordinal}`,request={id,method,params};
    const response=await this.exchange(id,JSON.stringify(request),method);
    assert.equal(response.id,id);this.exchanges.push({request,response});return response;
  }
  async ok(method:string,params:Row={}):Promise<any>{const response=await this.call(method,params);assert.equal(response.ok,true,`${method}: ${JSON.stringify(response.error)}`);return response.result;}
  async err(method:string,params:Row={}):Promise<Row>{const response=await this.call(method,params);assert.equal(response.ok,false,`${method} unexpectedly succeeded`);return response.error;}
  table(method:string,params:Row={}){return this.ok(`table.${method}`,{campaign:CAMPAIGN,...params});}
  tableErr(method:string,params:Row={}){return this.err(`table.${method}`,{campaign:CAMPAIGN,...params});}
  async close(){
    if(this.proc.exitCode!==null||this.proc.signalCode!==null)return;
    await new Promise<void>(done=>{
      const timer=setTimeout(()=>this.proc.kill('SIGKILL'),2000);
      this.proc.once('exit',()=>{clearTimeout(timer);done();});this.proc.stdin.end();
    });
  }
}

export async function kernel(t:TestContext,options:{env?:NodeJS.ProcessEnv;content?:string}={}){
  let client:RpcClient|undefined;
  t.after(async()=>{if(client)await client.close();});
  const temporary=nativeStorageFixture(t);
  client=new RpcClient(join(temporary,'ws'),options);return client;
}
export const campaignDir=(workspace:string,campaign=CAMPAIGN)=>join(workspace,'.coc/campaigns',campaign);
export const readJson=(path:string):any=>JSON.parse(readFileSync(path,'utf8'));
export const readJsonl=(path:string):Row[]=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line)):[];
export const writeJson=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value));
export const createCampaign=(client:RpcClient,id=CAMPAIGN)=>client.ok('campaign.create',{id,module:MODULE,pregen:PREGEN,play_language:'zh-Hans'});
export async function openTurn(client:RpcClient,text='I inspect Knott.'){
  await createCampaign(client);await client.table('open');await client.table('narrate',{call_id:'t0-c1',text:'Knott puts the keys on the desk.'});
  return client.table('player_input',{text});
}
export async function prepared(client:RpcClient,draft:Row){
  const request={name:draft.name,category:draft.category,description:draft.description};
  const job=await client.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:request});
  writeJson(join(job.cwd,'result.json'),draft);
  const accepted=await client.ok('mods.accept',{campaign:CAMPAIGN,job:job.job});
  return {kind:'define',...request,_definition:accepted.definition,_provenance:accepted.provenance};
}
