/** Explicit temporal-context writes through the ordinary atomic apply owner (§208). */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {clockSection,npcsPresent} from '../read/capsule.js';
import {npcReference} from '../npc/references.js';
import {activityView,temporalAnchor} from '../read/temporal.js';
import {clone,integer,number,row,string,type Row} from '../read/values.js';
import {effectId,type StagedEffect} from './bookkeeping.js';
import {nowIso} from '../write/store.js';
import type {ApplyContext} from './index.js';

export const openingActivityShape=(effect:Row):boolean=>effect.kind==='npc'&&effect.activity!=null&&Object.keys(effect).every(key=>['kind','name','activity','why'].includes(key));
function validate(value:unknown,npc:boolean):Row {
    const keys=['summary','basis','review_after_minutes',...(npc?['wakefulness']:['service','crowd'])];
    if(!isJsonObject(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new RpcError('invalid_params','activity has unsupported fields');
    const result=clone(value);
    if(typeof result.summary!=='string'||!result.summary.trim()||Array.from(result.summary).length>200)throw new RpcError('invalid_params','activity.summary must be one nonempty English sentence of at most 200 characters');
    result.summary=result.summary.trim();
    for(const [key,options,required] of [['basis',['observed','established','inferred'],true],['wakefulness',['awake','asleep','resting','unknown'],npc],['service',['open','closed','limited','unknown'],false],['crowd',['empty','quiet','active','crowded','unknown'],false]] as const){
        const value=result[key];
        if(required&&value==null||value!=null&&(typeof value!=='string'||!(options as readonly string[]).includes(value)))throw new RpcError('invalid_params',`activity.${key} must be one of ${options.join(', ')}`);
    }
    if(result.review_after_minutes!=null&&(!integer(result.review_after_minutes)||number(result.review_after_minutes)<=0||!Number.isSafeInteger(result.review_after_minutes)))throw new RpcError('invalid_params','activity.review_after_minutes must be a positive safe integer');
    return result;
}
/** §264.24: a reason is recorded when given; its absence refuses nothing, and every receipt carries one. */
const withWhy=(effect:Row):Row=>typeof effect.why==='string'&&effect.why.trim()?effect:{...effect,why:'(no reason given)'};
function record(context:ApplyContext,effect:Row,npc:boolean,scene:string|null,previous:Row):Row {
    const value=validate(effect.activity,npc);
    // §227.1: an observed or established record guards only while it still applies at the staged clock -- the same
    // applicability the capsule reports (`activityView`). Once the reader asks for review, a later inferred account of now
    // describes another time; the old record stays in the receipt's `previous`.
    if(value.basis==='inferred'&&['observed','established'].includes(string(previous.basis))&&activityView(context.graph,context.world,previous,scene).current===true)
        throw new RpcError('invalid_params','An inferred routine cannot overwrite an observed or established activity that still applies',{
        fix:'Preserve the recorded event. For an actual supported transition, record observed or established activity and explain its cause in why.',details:{reason:'activity_basis',previous:clone(previous)}});
    const clock=clockSection(context.graph,context.world);
    return {...value,recorded_clock:clock,anchor:temporalAnchor(context.graph,context.world),scene,turn:context.turn.turn,
        ...(value.review_after_minutes!=null?{review_at_minutes:number(clock.minutes)+value.review_after_minutes}:{})};
}
export function stageSceneActivity(context:ApplyContext,effect:Row):StagedEffect {
    effect=withWhy(effect);
    if(typeof effect.name!=='string'||!effect.name.trim())throw new RpcError('invalid_params','A scene activity needs its existing name or here');
    const scene=context.graph.scene(effect.name==='here'?context.world.active_scene:effect.name),handle=context.graph.handle(scene);
    const previous=row(row(context.world.scene_activity)[handle]),next=record(context,effect,false,handle,previous);
    let adjusted:Row|null=null;
    if(effect._population===true){
        const people=npcsPresent(context.graph,context.world,scene).filter(node=>context.graph.isPerson(node));
        // §250.6: an empty assessment beside a seated registered person contradicts the cast; a populated one with nobody
        // registered is an unnamed crowd, which registration never has to list.
        // live el-v2-20261022h T14: back at Knott's office at night the Keeper called it empty, and the refusal never said
        // who was still registered there, so the Keeper had to guess.
        // §264.24: "empty" beside people registered here says nobody else is: the registered people stay, and the receipt says
        // so (live 2026-10-24: the opening was refused for calling Knott's office empty with Knott in it).
        if(next.crowd==='empty'&&people.length)
            adjusted={field:'crowd',reason:'registered_people_stay',present:people.map(node=>npcReference(context.graph,context.world,node)??context.graph.handle(node))};
    }
    (context.world.scene_activity??={})[handle]=next;
    const receipt={id:effectId(context,'scene',handle),kind:'scene',call_id:context.callId,scene:handle,activity:clone(next),previous:clone(previous),why:effect.why,visibility:'keeper',at:nowIso(),...(adjusted?{adjusted:[adjusted]}:{})};
    return {receipt,event:{type:'scene-activity-changed',data:{scene:handle,activity:clone(next),why:effect.why}}};
}
export function stageNpcActivity(context:ApplyContext,effect:Row,node:Row):StagedEffect {
    effect=withWhy(effect);
    const handle=context.graph.handle(node),previous=row(row(context.world.npc_activity)[handle]);
    const conflicts=['to','stance','dead','skill','archetype','creature','conditions','defense','action','disposition','mood','intends','outcome','intent_ref','intent_outcome','spend_turn','reunion','_draws','_produces'].filter(key=>effect[key]!=null);
    if(conflicts.length)throw new RpcError('invalid_params','npc.activity is its own effect',{fix:'Write activity and other changes as separate effects in the same atomic batch',details:{conflicts}});
    const place=row(context.world.npc_presence)[handle],scene=typeof place==='string'?place:null;
    const next=record(context,effect,true,scene,previous);
    (context.world.npc_activity??={})[handle]=next;
    const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:context.graph.displayName(node),activity:clone(next),previous:clone(previous),why:effect.why,visibility:'keeper',at:nowIso()};
    return {receipt,event:{type:'npc-changed',data:{npc:handle,activity:clone(next),why:effect.why}}};
}
