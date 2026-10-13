/** Combat fixture setup and current native method signatures. */
import {native,tables,PythonRandom,arithmetic} from './rules-engine-support.ts';
export {native,tables,PythonRandom,arithmetic};
export const combat=(id='test-fight',seed=42,scene='test/scene',weapons:any[]=[])=>native.combatEngine.CombatSession.create(id,scene,1,new PythonRandom(seed),tables,weapons);
export function participant(s:any,id:string,side:string,dex:number,combatSkill:number,build:number,hpMax:number,extra:any={}){s.addParticipant(id,side,{dex,combatSkill,build,hpMax,...extra});}
export async function make(seed=42){const s=await combat('test-fight',seed);participant(s,'hero','investigator',70,60,0,10,{magicPoints:5,armor:0,weapons:[{weapon_id:'sword',skill:'Fighting (Brawl)',damage:'1D8+1',impales:true,special:null}]});participant(s,'ghoul','monster',50,40,1,12,{magicPoints:0,armor:0,weapons:[{weapon_id:'claws',skill:'Fighting',damage:'1D3+1D4',impales:false,special:null}]});return s;}
export const turn=(s:any,actor:string,intent:string,action:string|null='attack',extra:any={})=>s.declareAndResolveTurn(actor,intent,{...(action?{action}:{}),...extra});
export function fixedCheck(s:any,roll:number,extra:any={}){s.arithmetic.check=(target:number,difficulty='regular')=>({...s.arithmetic.resolve(roll,target,difficulty),roll,bonus:0,penalty:0,tens_values:[],units:null,...extra});}
