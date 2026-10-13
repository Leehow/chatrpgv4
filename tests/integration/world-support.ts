/** Shared native fixtures for world projection and delivery boundary tests. */
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {campaignDir,createCampaign,readJson,writeJson,type RpcClient,type Row} from './support.ts';
export * from './support.ts';
export const narrate=(k:RpcClient,call_id:string,text:string,params:Row={})=>k.table('narrate',{call_id,text,...params});
export async function narrateOpening(k:RpcClient,text='开场。\n\n诺特把钥匙拍在桌上。'){
  await k.table('open');return narrate(k,'t0-c1',text);
}
export async function openTurn(k:RpcClient,text='我仔细观察诺特。'){
  await createCampaign(k);await narrateOpening(k);return k.table('player_input',{text});
}
export const resolve=(k:RpcClient,call_id:string,action:Row)=>k.table('resolve',{call_id,action});
export const resolveErr=(k:RpcClient,call_id:string,action:Row)=>k.tableErr('resolve',{call_id,action});
export async function firstFailure(k:RpcClient,prefix:string,action:Row):Promise<[string,Row]>{
  for(let n=1;n<=24;n++){const id=prefix+n,result=await resolve(k,id,action);if(!result.outcome.passed&&result.outcome.level!=='fumble')return[id,result];}
  throw new Error('no ordinary failure in 24 seeded rolls');
}
export function git(workspace:string,...args:string[]){
  return execFileSync('git',[`--git-dir=${join(workspace,'.coc/repos/c1.git')}`,`--work-tree=${campaignDir(workspace)}`,...args],{encoding:'utf8'}).trim();
}
export function seedWound(workspace:string,hp:number,conditions:string[]=[],minutesAgo=0){
  const root=campaignDir(workspace),path=join(root,'party/thomas-hayes.json'),sheet=readJson(path);sheet.current_hp=hp;writeJson(path,sheet);
  const clock=readJson(join(root,'world.json')).clock.minutes,folder=join(root,'save/healing-state');mkdirSync(folder,{recursive:true});
  writeJson(join(folder,'thomas-hayes.json'),{investigator_id:'thomas-hayes',current_hp:hp,conditions,wound_ledger:[{wound_id:'wound-seeded',source_damage_roll_id:null,occurred_elapsed_minutes:Math.max(0,clock-minutesAgo),status:'active'}]});
}
