/** Staged Keeper flags, continuity notes and rule-anchored rulings. */
import {join} from 'node:path';
import {RpcError} from '../errors.js';
import {canonicalJson,isJsonObject,orderedObject} from '../json.js';
import {EntityIndex} from '../read/memory.js';
import {RuleObservations,semanticName} from '../read/rule-facts.js';
import {array,entries,kebab,length,normalize,number,repr,row,sorted,string,truth,words,type Row} from '../read/values.js';
import {recordOf} from '../read/module-graph.js';
import {SkillResolver} from '../rules/skills.js';
import {RuleTables} from '../rules/tables.js';
import {asciiSlug} from '../write/text.js';
import {nowIso} from '../write/store.js';
import {unsupported} from '../read/handlers.js';
import type {ApplyContext} from './index.js';
import type {DomainEvent} from '../transactions.js';
export type StagedEffect={receipt:Row;event:DomainEvent|null};
export const effectId=(context:ApplyContext,kind:string,name:string)=>{
    const slug=asciiSlug(name);return context.mint(`${kind}:${slug?slug+'-':''}t${context.turn.turn}-c${context.ordinal}`);
};
const why=(effect:Row)=>typeof effect.why==='string'&&effect.why.trim()?effect.why.trim():null;
const publicRow=(value:Row)=>Object.fromEntries(entries(value).filter(([key])=>key!=='seq'));
async function ledger(context:ApplyContext,file:string,staged:Row[]):Promise<Map<string,Row>>{
    const rows=[...await context.kernel.snapshots.readJsonl(join(context.campaign.directory,file)),...staged],out=new Map<string,Row>();
    for(const [seq,value] of rows.entries()){const item=row(value),key=normalize(string(item.name||''));if(key)out.set(key,{...item,seq});}
    return out;
}
function names(value:any,field:string):string[]{
    if(value==null)return [];
    if(!Array.isArray(value)||!value.every(name=>typeof name==='string'&&name.trim()))throw new RpcError('invalid_params',`${field} must be a list of names`);
    return value.map(name=>name.trim());
}
/** A threat clock is the Keeper's pacing instrument (Agents.md: the module is a reference, the clock is theirs).
 *  The book writes the segments, what each one shows and what a full clock means; only this effect moves one, so
 *  `on_tick_visible` finally has a reader. The runtime count lives in `world.threat_clocks`, never on the graph. */
export function stageThreat(context:ApplyContext,effect:Row):StagedEffect{
    const {name,clock:clockName,segments,why:reason}=effect;
    if(typeof name!=='string'||!name.trim())throw new RpcError('invalid_params','a threat effect names the threat to advance',{fix:'{"kind": "threat", "name": "<a threat from pressures>", "clock": "<its clock>", "why": "..."}'});
    const threat=context.graph.find(name.trim(),['threat']);
    if(!threat){
        const known=context.graph.kind('threat').map(node=>context.graph.handle(node));
        throw new RpcError('invalid_params',`no threat named ${repr(name)}`,{fix:known.length?`use one of ${repr(known)}`:'this module declares no threat',details:{options:known}});
    }
    const clocks=array(recordOf(threat).clocks).map(row).filter(clock=>truth(clock.clock_id||clock.id||clock.name));
    if(!clocks.length)throw new RpcError('invalid_params',`the threat ${repr(context.graph.handle(threat))} has no clock`,{fix:'this threat paces through its dangers, not a clock; narrate the pressure or use apply time'});
    const chosen=clockName==null&&clocks.length===1?clocks[0]:typeof clockName==='string'?context.graph.threatClock(threat,clockName):null;
    if(!chosen){
        const known=clocks.map(clock=>string(clock.clock_id||clock.id||clock.name));
        throw new RpcError('invalid_params',clockName==null?'this threat has more than one clock; name the one to advance':`no clock named ${repr(clockName)} on that threat`,{fix:`use one of ${repr(known)}`,details:{options:known}});
    }
    const id=string(chosen.clock_id||chosen.id||chosen.name),total=Math.trunc(number(chosen.segments??0));
    if(!(total>0))throw new RpcError('invalid_params',`the clock ${repr(id)} declares no segments`,{fix:'the book gives this clock no length; pace it in the fiction instead'});
    let step=1;
    if(segments!=null){
        if(!Number.isInteger(segments)||segments===0||Math.abs(segments)>total)throw new RpcError('invalid_params','segments must be a non-zero whole number of segments, at most the clock\'s length',{fix:'omit segments to advance one, or give a small positive or negative whole number',details:{segments,length:total}});
        step=segments;
    }
    const handle=context.graph.handle(threat),
        live=row(context.world.threat_clocks),
        current=row(live[handle]),
        before=Math.min(total,Math.max(0,Math.trunc(number(current[id]??chosen.current_segments??0)))),
        after=Math.min(total,Math.max(0,before+step));
    context.world.threat_clocks=orderedObject([...entries(live).filter(([key])=>key!==handle),[handle,orderedObject([...entries(current).filter(([key])=>key!==id),[id,after]])]]);
    const visible=array(chosen.on_tick_visible).map(string),
        receipt:Row={id:effectId(context,'threat',`${handle}-${id}`),kind:'threat',call_id:context.callId,threat:handle,clock:id,
            before,after,segments:total,full:after>=total,why:why(effect),visibility:'keeper',at:nowIso()};
    if(after>0&&visible.length)receipt.shows=visible[Math.min(after,visible.length)-1];
    if(after>=total&&typeof chosen.on_full==='string'&&chosen.on_full)receipt.on_full=chosen.on_full;
    // The canonical event set of 12.1 is closed at twenty-four kinds and a pacing tick did not enter it; the
    // receipt and the turn record carry it, as the sanity engine's own day_ended does.
    return {receipt,event:null};
}
export function stageFlag(context:ApplyContext,effect:Row):StagedEffect{
    const slug=typeof effect.name==='string'?kebab(effect.name):'';
    if(!slug)throw new RpcError('invalid_params','flag name must be a non-empty string',{fix:'name the flag, e.g. ritual-stopped'});
    let value=effect.value;
    if(value==null||value===true)value=true;
    else if(value===false)value=false;
    else if(typeof value==='string'&&['true','false'].includes(value.trim().toLowerCase()))value=value.trim().toLowerCase()==='true';
    else if(typeof value==='string'&&value.trim()&&length(value.trim())<=40)value=value.trim();
    else throw new RpcError('invalid_params','flag value must be true, false or a string of at most 40 characters',{details:{value:value??null}});
    const flags=row(context.world.flags),previous=flags[slug]??null;
    context.world.flags=orderedObject([...entries(flags).filter(([key])=>key!==slug),[slug,value]]);
    const receipt={id:effectId(context,'flag',slug),kind:'flag',call_id:context.callId,name:slug,value,previous,why:why(effect),visibility:'keeper',at:nowIso()};
    return {receipt,event:{type:'flag-set',data:{name:slug,value,previous}}};
}
export async function stageNote(context:ApplyContext,effect:Row,staged:Row[]):Promise<StagedEffect>{
    const {name,text,closes}=effect;
    for(const [field,value] of [['name',name],['text',text],['closes',closes]])if(value!=null&&(typeof value!=='string'||!value.trim()))throw new RpcError('invalid_params',`note ${field} must be a non-empty string`);
    if(text==null&&closes==null)throw new RpcError('invalid_params','a note needs text (to open one) or closes (to close one)',{fix:'{"kind": "note", "name": "...", "text": "one line"} or {"kind": "note", "closes": "<name>"}'});
    if(text!=null&&name==null)throw new RpcError('invalid_params','a note with text needs a name',{fix:'give the note a short semantic name'});
    const current=await ledger(context,'notes.jsonl',staged),rows:Row[]=[];
    let closed:Row|null=null,opened:Row|null=null;
    if(closes!=null){
        const old=current.get(normalize(closes));
        if(!old||old.status!=='open'){
            const open=[...current.values()].filter(value=>value.status==='open').map(value=>string(value.name));
            throw new RpcError('invalid_params',`no open note named ${repr(closes)}`,{fix:open.length?`close one of ${repr(open)}`:'there is no open note to close',details:{closes,open}});
        }
        closed={...publicRow(old),status:'closed',closed_turn:context.turn.turn,closed_by:context.callId};rows.push(closed);
    }
    if(text!=null){
        const key=normalize(name),old=current.get(key);
        if(old?.status==='open'&&!(closes!=null&&normalize(closes)===key))throw new RpcError('invalid_params',`a note named ${repr(name)} is already open`,{fix:'pick another name, or close it first with closes',details:{name,open_since_turn:old.turn??null}});
        const index=new EntityIndex(context.graph,await context.campaign.party() as Row[]),entities:string[]=[];
        for(const name of names(effect.entities,'entities')){const exact=index.matches(name),found=exact.length?exact:index.looseMatches(name),canonical=found.length===1?index.canonicalName(found[0]):name;if(!entities.includes(canonical))entities.push(canonical);}
        opened={name:name.trim(),text:words(text),entities,turn:context.turn.turn,status:'open'};
    }
    const label=(opened||closed)?.name||string(closes),id=effectId(context,'note',label);
    if(opened){opened.receipt=id;rows.push(opened);}staged.push(...rows);
    const receipt={id,kind:'note',call_id:context.callId,name:label,status:opened?'open':'closed',text:opened?.text??null,entities:opened?.entities??[],closes:closed?.name??null,visibility:'keeper',at:nowIso()};
    return {receipt,event:{type:'note-written',data:{name:label,status:receipt.status,entities:receipt.entities,closes:receipt.closes}}};
}
async function anchorOf(context:ApplyContext,raw:any):Promise<Row>{
    const fields=['family','decision','skill','entities'];
    if(!isJsonObject(raw)||!truth(raw))throw new RpcError('invalid_params','ruling.anchor must be an object with at least one of family, decision, skill, entities',{fix:`anchor fields: ${repr(fields)}`});
    const unknown=sorted(Object.keys(raw).filter(key=>!fields.includes(key)));
    if(unknown.length)throw new RpcError('invalid_params',`unknown anchor fields ${repr(unknown)}`,{fix:`anchor fields: ${repr(fields)}`});
    const observations=await RuleObservations.load(context.kernel),party=await context.campaign.party(),resolver=await SkillResolver.create(new RuleTables(context.kernel),party[0]||{});
    const source=observations.graph;
    const families=sorted(Object.keys(row(source.coverage))),decisions=sorted([...observations.nodes.values()].filter(node=>node.node_kind==='decision').map(node=>semanticName(node.node_id)));
    const anchor:Row={};
    const invalid=(field:string,value:any,options:string[]):never=>{throw new RpcError('invalid_params',`ruling.anchor.${field} ${repr(string(value))} is not a known ${field}`,{fix:`use one of details.options for anchor.${field}`,details:{field,query:string(value),options}});};
    if(raw.family!=null){if(typeof raw.family!=='string'||!families.includes(raw.family))invalid('family',raw.family,families);anchor.family=raw.family;}
    if(raw.decision!=null){const name=typeof raw.decision==='string'?semanticName(raw.decision):'';if(!decisions.includes(name))invalid('decision',raw.decision,decisions);anchor.decision=name;}
    if(raw.skill!=null){const skill=typeof raw.skill==='string'&&raw.skill.trim()?resolver.resolveExplicit(raw.skill):null;if(skill==null)invalid('skill',raw.skill,resolver.optionsFor(string(raw.skill)));anchor.skill=skill;}
    if(raw.entities!=null){
        const handles:string[]=[];
        for(const name of names(raw.entities,'anchor.entities')){try{const handle=context.graph.handle(context.graph.resolve(name));if(!handles.includes(handle))handles.push(handle);}catch(error){if(error instanceof RpcError)throw new RpcError('invalid_params',`ruling.anchor.entities: ${error.message}`,{fix:'name an entity of the module graph exactly, or one of details.candidates',details:{field:'entities',...error.details}});throw error;}}
        if(!handles.length)throw new RpcError('invalid_params','ruling.anchor.entities must name at least one entity');anchor.entities=sorted(handles);
    }
    if(!truth(anchor))throw new RpcError('invalid_params','ruling.anchor must carry at least one of family, decision, skill, entities');
    return anchor;
}
export async function stageRuling(context:ApplyContext,effect:Row,staged:Row[]):Promise<StagedEffect>{
    const anchor=await anchorOf(context,effect.anchor),{name,statement}=effect;
    if(typeof name!=='string'||!name.trim())throw new RpcError('invalid_params','ruling name must be a non-empty string',{fix:'a short semantic name for the ruling'});
    if(typeof statement!=='string'||!statement.trim())throw new RpcError('invalid_params','ruling statement must be a non-empty string',{fix:'one line: how it is judged'});
    const scope=Object.hasOwn(effect,'scope')?effect.scope:'campaign';
    if(!['campaign','module','scene'].includes(scope))unsupported('scope',scope,['campaign','module','scene'],`unknown ruling scope ${repr(scope)}`);
    const current=await ledger(context,'rulings.jsonl',staged),key=canonicalJson(anchor);
    const superseded=[...current.values()].filter(value=>value.status==='active'&&(normalize(string(value.name))===normalize(name)||canonicalJson(row(value.anchor))===key));
    const id=effectId(context,'ruling',name);
    const rows=superseded.map(value=>({...publicRow(value),status:'superseded',superseded_by:name.trim(),superseded_turn:context.turn.turn}));
    staged.push(...rows,{name:name.trim(),statement:words(statement),anchor,scope,scene:context.world.active_scene,module:context.graph.moduleId,turn:context.turn.turn,status:'active',receipt:id});
    const supersedes=superseded.map(value=>string(value.name)),receipt={id,kind:'ruling',call_id:context.callId,name:name.trim(),statement:words(statement),anchor,scope,supersedes,visibility:'keeper',at:nowIso()};
    return {receipt,event:{type:'ruling-made',data:{name:name.trim(),anchor,scope,supersedes}}};
}
