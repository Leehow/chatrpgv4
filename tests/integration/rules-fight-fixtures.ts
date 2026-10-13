/** Exact legacy fight/chase setup over native RPC and authored content copies. */
import assert from 'node:assert/strict';
import {cpSync} from 'node:fs';
import {join} from 'node:path';
import {isolated} from './rules-engine-support.ts';
import {CONTENT_DIR,RpcClient,campaignDir,readJson,writeJson} from './support.ts';
import {opening,resolve,walkToConfrontation} from './rules-rpc-support.ts';
export const CORBITT='walter-corbitt',INVESTIGATOR='thomas-hayes';
export const FLEE={actor:'Walter Corbitt',intent:'flee',goal:'get away',method:'run for the stairs'};
export function corbittRecord(graph:any){const node=graph.nodes.find((n:any)=>n.node_id==='npc-walter-corbitt'),properties=node.properties??(node.properties={});return properties.runtime_projection?.record??properties;}
export async function clientFor(t:any,options:{combat?:any;profile?:(v:any)=>void;seed?:string}={}){
  const {workspace}=await isolated(t);let content=CONTENT_DIR;
  if(options.combat||options.profile){content=join(workspace,'content');cpSync(CONTENT_DIR,content,{recursive:true});const path=join(content,'starters/the-haunting/module-graph.json'),g=readJson(path),r=corbittRecord(g);if(options.combat)r.combat=options.combat;options.profile?.(r.mechanics.profile);writeJson(path,g);}
  const client=new RpcClient(join(workspace,'ws'),{content,env:{COC_KERNEL_SEED:options.seed??'7'}});t.after(()=>client.close());return client;
}
export async function corbittsTurn(k:RpcClient,stance?:string){await opening(k,'I hit him.');let n=await walkToConfrontation(k);await resolve(k,`t1-c${n}`,{intent:'combat',goal:'hit him',method:'fists',target:'Walter Corbitt',weapon:'unarmed'});const defended=await resolve(k,`t1-c${n+1}`,{intent:'combat',goal:'combat:defend',method:'combat:defend',actor:'Walter Corbitt',defense:'dodge'});assert.equal(defended.session.turn_of,CORBITT);assert.equal(defended.session.pending_defense,null);n+=2;if(stance!==undefined){await k.table('apply',{call_id:`t1-c${n++}`,effects:[{kind:'npc',name:'Walter Corbitt',stance,why:'test'}]});}return n;}
export const fightPath=(k:RpcClient)=>join(campaignDir(k.workspace),'save/combat.json');
export const savedFight=(k:RpcClient)=>readJson(fightPath(k));
export const corbittIn=(fight:any)=>fight.participants.find((p:any)=>p.actor_id===CORBITT);
export function editFight(k:RpcClient,options:{hp_fraction?:number;ally?:boolean;investigator?:any;corbitt?:any;round_delta?:number;corbitt_turn?:boolean}={}){const fight=savedFight(k);for(const p of fight.participants){if(p.actor_id===CORBITT){if(options.hp_fraction!==undefined)p.hp_current=Math.trunc(p.hp_max*options.hp_fraction);Object.assign(p,options.corbitt??{});}if(p.actor_id===INVESTIGATOR)Object.assign(p,options.investigator??{});}if(options.ally)fight.participants.push({...fight.participants.find((p:any)=>p.actor_id===INVESTIGATOR),actor_id:'a-second-investigator'});fight.current_round+=options.round_delta??0;if(options.corbitt_turn)fight.initiative_cursor=fight.current_initiative.findIndex((p:any)=>p.actor_id===CORBITT);writeJson(fightPath(k),fight);}
export async function hayesTurn(k:RpcClient){const n=await corbittsTurn(k);await k.table('apply',{call_id:`t1-c${n}`,effects:[{kind:'npc',name:'Walter Corbitt',action:'hold',why:'he backs off'}]});const s=(await k.table('look',{focus:'session'})).session;assert.equal(s.turn_of,INVESTIGATOR);assert.equal(s.pending_defense,null);return n+1;}
export async function investigatorFlees(k:RpcClient){const n=await corbittsTurn(k);await k.table('apply',{call_id:`t1-c${n}`,effects:[{kind:'npc',name:'Walter Corbitt',action:'hold',why:'he freezes'}]});assert.equal((await k.table('look',{focus:'session'})).session.turn_of,INVESTIGATOR);return [await resolve(k,`t1-c${n+1}`,{intent:'flee',goal:'get out of the cellar',method:'run for the stairs'}),n+1] as const;}
