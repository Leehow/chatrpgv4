/** Chase fixtures advance solely through current issued session actions. */
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {campaignDir,readJson} from './support.ts';
import {resolve} from './rules-rpc-support.ts';
import {CORBITT,INVESTIGATOR,FLEE,corbittsTurn} from './rules-fight-fixtures.ts';
export const chasePath=(k:any)=>join(campaignDir(k.workspace),'save/chase.json');
export const sides=(s:any)=>s.participants.map((p:any)=>[p.name,p.side]);
export const presence=(k:any)=>readJson(join(campaignDir(k.workspace),'world.json')).npc_presence??{};
export const chaseStart=(k:any,call_id:string,action:any={})=>resolve(k,call_id,{target:'Walter Corbitt',decision:'chase:start',goal:'run him down',method:'after him up the stairs',...action});
export async function corbittFlees(k:any){const n=await corbittsTurn(k),fled=await resolve(k,`t1-c${n}`,FLEE);assert.equal(fled.decision,'combat:flee');assert.equal(fled.outcome.turn_outcome,'fled');return [fled,n+1] as const;}
export async function playOut(k:any,turn:number,n:number,hints?:string[]){for(let i=0;i<30;i++){const s=(await k.table('look')).where.session;assert.ok(s);assert.equal(s.status,'active');const a=s.actions[0],params:any={intent:'move',goal:'keep after him',method:'',decision:a.decision};if(s.turn_of!==INVESTIGATOR)Object.assign(params,{actor:s.turn_of,intent:'flee',goal:'get away'});if(a.decision==='chase:conflict')params.target=a.targets[0];const step=await resolve(k,`t${turn}-c${n++}`,params);assert.equal(step.decision,a.decision);hints?.push(...(step.hints??[]));if(step.outcome.status==='ended')return [step,n] as const;}assert.fail('the chase did not end in 30 steps');}
export const AWAY={kind:'npc',name:'Walter Corbitt',to:'away',why:'he bolts up the cellar stairs'};
export async function flightTurn(k:any,away=true){const n=await corbittsTurn(k),fled=await resolve(k,`t1-c${n}`,FLEE);assert.equal(fled.decision,'combat:flee');assert.equal(fled.outcome.turn_outcome,'fled');if(away){await k.table('apply',{call_id:`t1-c${n+1}`,effects:[AWAY]});assert.ok(!(CORBITT in presence(k)));}await k.table('narrate',{call_id:`t1-c${n+2}`,text:'He is gone up the stairs.'});assert.equal((await k.table('player_input',{text:'I run up the stairs after him.'})).turn,2);return fled;}
