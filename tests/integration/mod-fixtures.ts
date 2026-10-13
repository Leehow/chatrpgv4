/** Shared declarative Mod fixtures. Values are test input, not scenario claims. */
export const weapon=(name='Workshop launcher')=>({name,category:'weapon',description:'An improvised single-shot launcher.',
  basis:'Fixture: a single-shot firearm profile; numbers are test data.',parameters:{skill:'Firearms (Rifle/Shotgun)',damage:'1D6',base_range_yards:30,
    uses_per_round:1,magazine:1,malfunction:95,impale:false,adds_damage_bonus:false},player_view:{description:'An improvised launcher.',fields:['damage','magazine']}});
import {join} from 'node:path';
import {CAMPAIGN,prepared,writeJson,type Row,type RpcClient} from './support.ts';
export async function walkToConfrontation(k:RpcClient,start=1){
  for(const scene of ['corbitt-house-ground','basement-rites','corbitt-confrontation'])await k.table('apply',{call_id:`t1-c${start++}`,effects:[{kind:'move',to:scene,travel_minutes:0}]});
  return start;
}
export async function fork(k:RpcClient,turn:number,name:string){await k.table('player_input',{text:'I take another route.'});const result=await k.table('apply',{call_id:`t${turn}-c1`,effects:[{kind:'fork',name,mode:'if'}]});await k.table('narrate',{call_id:`t${turn}-c2`,text:'The world follows another line.'});return result;}
export async function switchLine(k:RpcClient,turn:number,line:string){await k.table('player_input',{text:'I return to the earlier route.'});const result=await k.table('apply',{call_id:`t${turn}-c1`,effects:[{kind:'switch',line}]});await k.table('narrate',{call_id:`t${turn}-c2`,text:'The previous line is restored.'});return result;}
export async function prefetchObject(k:RpcClient,call_id='t1-c1'){
  const draft={name:'Wooden rod',category:'weapon',description:'A solid wooden rod, heavy enough to swing.',basis:'Fixture physical facts; numbers are test data.',
    parameters:{skill:'Fighting (Brawl)',damage:'1D6',uses_per_round:1,impale:false,adds_damage_bonus:true,base_range_yards:null,magazine:null,malfunction:null},player_view:{description:'A wooden rod.',fields:['damage']}};
  return k.table('apply',{call_id,effects:[await prepared(k,draft),{kind:'object',name:'My rod',definition:draft.name,to:'Thomas Hayes'}]});
}
export const prefetchUsage=(name='Swing')=>({name,description:'Swing the solid rod as a club.',basis:'Fixture club profile',mode:'melee',parameters:{skill:'Fighting (Brawl)',damage:'1D6',uses_per_round:1,impale:false,adds_damage_bonus:true},player_view:{description:'A club swing.',fields:['damage']}});
export const proposalJob=(k:RpcClient)=>k.ok('mods.job',{campaign:CAMPAIGN,role:'usage',input:{object:'My rod',propose:true}});
export async function acceptProposal(k:RpcClient,job:Row,draft:Row|null){writeJson(join(job.cwd,'result.json'),draft);return k.ok('mods.prefetch.accept',{campaign:CAMPAIGN,job:job.job});}
