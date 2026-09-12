/** Existing authored clue/NPC/handout effects; no authored graph mutation. */
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {recordOf} from '../read/module-graph.js';
import {npcsPresent} from '../read/capsule.js';
import {unsupported} from '../read/handlers.js';
import {array,integer,number,repr,row,sorted,string,truth,type Row} from '../read/values.js';
import {stanceTable} from '../write/contributions.js';
import {required,nowIso} from '../write/store.js';
import {effectId,type StagedEffect} from './bookkeeping.js';
import {archetypeIds,rollArchetypeProfile} from './archetype.js';
import type {ApplyContext} from './index.js';
export async function stageClue(context:ApplyContext,effect:Row):Promise<StagedEffect>{
    const name=required(effect,'clue')!,{world,graph}=context,turn=context.turn.turn;
    const label=typeof effect.label==='string'&&effect.label.trim()?effect.label:null,how=typeof effect.how==='string'?effect.how:null;
    if(name.startsWith('echo:')){
        let rows:Row[]=[];try{const raw=await context.campaign.readSave('worldlines/echoes.json');rows=array(isJsonObject(raw)?raw.echoes:raw).filter(isJsonObject);}catch{/* Existing echo reads tolerate unavailable saved projections. */}
        const echo=rows.find(value=>string(value.id)===name);
        if(!echo)throw new RpcError('unknown_entity',`no echo ${repr(name)} on this worldline`,{fix:'reveal one of details.echoes, or none: echoes come from other lines',details:{echo:name,echoes:rows.slice(0,12).map(value=>value.id)}});
        // An echo's summary is the kernel's own sentence, never a player-facing word: the receipt needs the keeper's label.
        if(!label)throw new RpcError('invalid_params',`revealing echo ${repr(name)} needs a label`,{fix:"pass label: a short name for this echo in the campaign's play_language",details:{fields:['label'],echo:name}});
        const receipt={id:`clue:${name.replaceAll(':','-')}-t${turn}`,kind:'clue',call_id:context.callId,clue:name,label,summary:echo.summary,scene:echo.scene,how,from:null,
            echo:{line:echo.line,loop:echo.loop,turn:echo.turn,kind:echo.kind},at:nowIso()};
        if(array(world.discovered_echoes??=[]).includes(name))return {receipt,event:null};world.discovered_echoes.push(name);
        return {receipt,event:{type:'clue-discovered',data:{clue:name,scene:echo.scene,how,echo:echo.line}}};
    }
    const node=graph.clue(name),scene=graph.scene(world.active_scene),here=graph.sceneClueIds(scene),handle=graph.handle(node);
    if(!here.includes(node.node_id))throw new RpcError('not_here',`clue ${repr(handle)} is not discoverable at ${repr(graph.handle(scene))}`,{fix:'discover one of details.clues_here, or move first',details:{clue:handle,scene:graph.handle(scene),clues_here:here.map(id=>graph.handle(graph.nodes.get(id)!))}});
    let source:string|null=null;
    if(typeof effect.from==='string'&&effect.from.trim())source=graph.handle(graph.npc(effect.from));
    else {
        const present=new Set(npcsPresent(graph,world,scene).map(node=>graph.handle(node)));
        const holders=new Set((graph.incoming.get(node.node_id)||[]).filter(rel=>['held-by','delivered-by'].includes(rel.relation_kind)).map(rel=>graph.nodes.get(rel.from_node_id)).filter(node=>node?.node_kind==='npc').map(node=>graph.handle(node!)));
        const candidates=sorted([...holders].filter(name=>present.has(name)));if(candidates.length===1)source=candidates[0];
    }
    // Without a keeper label the receipt files the graph's display name: a handle is a machine word and never reaches the player.
    const receipt={id:`clue:${handle}-t${turn}`,kind:'clue',call_id:context.callId,clue:handle,label:label||graph.displayName(node),summary:node.summary||node.name,scene:graph.handle(scene),how,from:source,at:nowIso()};
    if(label)(world.clue_labels??={})[handle]=label;
    if(array(world.discovered_clues??=[]).includes(handle))return {receipt,event:null};world.discovered_clues.push(handle);
    return {receipt,event:{type:'clue-discovered',data:{clue:handle,scene:receipt.scene,how}}};
}
export async function stageNpc(context:ApplyContext,effect:Row):Promise<StagedEffect>{
    const {graph,world}=context,node=graph.npc(required(effect,'name')!),handle=graph.handle(node),{to,stance,dead}=effect;
    const why=typeof effect.why==='string'&&effect.why.trim()?effect.why:null;
    const table=await stanceTable(context.kernel),words=array(table.levels).map(level=>level.value);
    if(dead!=null&&typeof dead!=='boolean')throw new RpcError('invalid_params','npc.dead must be true or false',{fix:'say true on the turn they died',details:{field:'npc.dead'}});
    let pinned=effect.skill??null;
    if(pinned!=null){
        if(!isJsonObject(pinned)||typeof pinned.name!=='string'||!pinned.name.trim()||!integer(pinned.value))throw new RpcError('invalid_params','npc.skill must be {name: "<skill>", value: <integer>}',{fix:'name the skill and the percentage this person has',details:{field:'npc.skill'}});
        if(number(pinned.value)<0||number(pinned.value)>100)throw new RpcError('invalid_params',`npc.skill.value ${pinned.value} is not a percentage`,{fix:'a whole number from 0 to 100',details:{field:'npc.skill.value'}});
        pinned={name:pinned.name.trim(),value:number(pinned.value)};
        const authored=graph.actorSkillValue(node,pinned.name);
        if(authored!=null&&authored!==pinned.value)throw new RpcError('invalid_params',`the source already gives ${graph.displayName(node)} ${pinned.name} ${authored}; a missing-field pin cannot replace it`,{fix:`use the source-authored ${pinned.name} value ${authored}; resolve does not need a pin`,details:{field:'npc.skill',actor:handle,skill:pinned.name,authored_value:authored}});
    }
    // A stat block for a person the book never gave one (contract §34.10): the Keeper names the archetype, the kernel rolls inside it once.
    let profile:Row|null=null;const archetype=effect.archetype??null;
    if(archetype!=null){
        if(typeof archetype!=='string'||!archetype.trim())throw new RpcError('invalid_params','npc.archetype must name a rulebook NPC stat archetype',{fix:'one of details.options',details:{field:'npc.archetype',options:await archetypeIds(context.kernel)}});
        if(isJsonObject(row(recordOf(node).mechanics).profile))throw new RpcError('invalid_params',`the source prints ${graph.displayName(node)}'s numbers; an archetype cannot replace them`,{fix:'resolve against the printed profile; no pin is needed',details:{field:'npc.archetype',actor:handle,authority:'source_authored'}});
        const existing=row(row(world.npc_profiles)[handle]);
        if(truth(existing.archetype))throw new RpcError('invalid_params',`${graph.displayName(node)} already has a pinned ${string(existing.archetype)} profile from turn ${string(existing.pinned_turn)}`,{fix:'resolve against it; a pin is made once for the campaign',details:{field:'npc.archetype',actor:handle,archetype:existing.archetype,pinned_turn:existing.pinned_turn??null}});
        profile=await rollArchetypeProfile(context.kernel,archetype.trim(),why,number(context.turn.turn));
    }
    if(to==null&&stance==null&&dead==null&&pinned==null&&profile==null)throw new RpcError('invalid_params','an npc effect needs `to`, `stance`, `dead`, `skill`, `archetype`, or a combination',{fix:`move them with to: here/away/<scene>, set stance to one of ${repr(words)}, say dead: true, pin a skill they have, or name an archetype for a person the book gave no numbers`});
    const presence=world.npc_presence??={};let moved:string|null=null;
    if(to!=null){
        if(typeof to!=='string'||!to.trim())throw new RpcError('invalid_params',"npc.to must be a scene name, 'here' or 'away'",{fix:'a scene name on the graph, or here / away',details:{field:'npc.to',options:['here','away']}});
        if(to.trim()==='away'){delete presence[handle];moved='away';}else{moved=graph.handle(graph.scene(to.trim()==='here'?world.active_scene:to));presence[handle]=moved;}
    }
    if(stance!=null&&(typeof stance!=='string'||!words.includes(stance)))unsupported('npc.stance',stance,words,`npc.stance ${repr(stance)} is not one of the ledger's words`);
    if(profile!=null)(world.npc_profiles??={})[handle]=profile;
    const pinnedProfile=profile?{archetype:profile.archetype,characteristics:profile.characteristics,derived:profile.derived,skills:profile.skills}:null;
    const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{profile:pinnedProfile}:{}),why,at:nowIso()};
    return {receipt,event:{type:'npc-changed',data:{npc:handle,to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{archetype:profile!.archetype}:{}),why}}};
}
export async function stageHandout(context:ApplyContext,effect:Row,asset:(module:string,name:string)=>Promise<Row|null>):Promise<StagedEffect>{
    const {graph,world}=context,name=required(effect,'name')!,node=graph.find(name,['handout'])||graph.resolve(name,['handout','asset'],'handout');
    const handle=graph.handle(node),visibility=node.visibility,display=graph.displayName(node);
    if(!['player-safe','revealable'].includes(visibility))throw new RpcError('invalid_params',`${repr(handle)} is ${visibility}; it cannot be handed to the player`,{fix:'keeper-only images and cards stay in lookup {kind: secret}; hand out a player-safe or revealable one',details:{handout:handle,visibility}});
    const label=typeof effect.label==='string'&&effect.label.trim()?effect.label:null,record=recordOf(node),props=row(node.properties),registered=await asset(graph.moduleId,node.node_id)||{};
    const attachment:Row={handout:handle,path:null,media_type:null,available:false};
    const text=typeof record.authored_text==='string'?record.authored_text:registered.authored_text;
    if(typeof text==='string'&&text.trim()){
        const folder=join(context.campaign.directory,'handouts'),path=join(folder,`${handle}.md`);await mkdir(folder,{recursive:true});await writeFile(path,`# ${display}\n\n${text.trim()}\n`,'utf8');
        Object.assign(attachment,{path,media_type:'text/markdown',available:true});
    }else{
        const ref=registered.path||props.asset_ref||props.image_ref,media=registered.media_type||props.media_type||null;
        const candidates=ref?[isAbsolute(string(ref))?string(ref):join(context.kernel.stateRoot,'modules',graph.moduleId,string(ref)),string(ref)]:[];
        let found:string|null=null;for(const path of candidates)if(await context.kernel.snapshots.isFile(path)){found=path;break;}
        Object.assign(attachment,{path:found||(ref?string(ref):null),media_type:media,available:found!=null});
    }
    const receipt={id:`handout:${handle}-t${context.turn.turn}`,kind:'handout',call_id:context.callId,handout:handle,name:display,label:label||display,visibility,summary:node.summary??null,attachment,at:nowIso()};
    if(!array(world.handouts_shown??=[]).includes(handle))world.handouts_shown.push(handle);
    return {receipt,event:{type:'handout-shown',data:{handout:handle,name:display,visibility,attachment_available:attachment.available,media_type:attachment.media_type}}};
}
