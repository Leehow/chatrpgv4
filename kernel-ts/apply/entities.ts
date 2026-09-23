/** Existing authored clue/NPC/handout effects; no authored graph mutation. */
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {recordOf} from '../read/module-graph.js';
import {handoutFile} from '../read/handout-document.js';
import {npcsPresent,personLabel} from '../read/capsule.js';
import {unsupported} from '../read/handlers.js';
import {tablePersonId} from '../read/table-people.js';
import {array,integer,normalize,number,repr,row,sorted,string,truth,type Row} from '../read/values.js';
import {stanceTable} from '../write/contributions.js';
import {required,nowIso} from '../write/store.js';
import {effectId,type StagedEffect} from './bookkeeping.js';
import {archetypeIds,rollArchetypeProfile} from './archetype.js';
import {VALID_CONDITIONS} from '../combat/engine.js';
import {DEFENSE_WORDS} from '../combat/standing.js';
import {incapacitatedBy} from '../healing/conditions.js';
import {npcProfileOf} from '../resolve/context.js';
import type {ApplyContext} from './index.js';
import {CampaignSnapshot} from '../read/campaign.js';
import {acceptReunion} from '../npc/reunion.js';
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
    // §80: the account of how this table came by the clue, kept beside its name because that is
    // what the player's own record of it says. The graph's summary is the Keeper's and stays on
    // the graph; a clue discovered without a `how` has a name and nothing more, which is honest.
    if(how)(world.clue_how??={})[handle]=how;
    if(array(world.discovered_clues??=[]).includes(handle))return {receipt,event:null};world.discovered_clues.push(handle);
    return {receipt,event:{type:'clue-discovered',data:{clue:handle,scene:receipt.scene,how}}};
}
/**
 * The person this effect is about: the book's, a reviewed adaptation's, or -- when the graph has
 * nothing to offer under that name -- one this table establishes here (contract §87, see
 * `read/table-people.ts`).
 *
 * **Silence is what mints, not failure to resolve.** The first version of this read through
 * `graph.find`, which answers null for an ambiguous name exactly as it does for an absent one, so
 * `apply npc "Senora Pena"` -- two nodes folding to one name -- minted a third person called that
 * instead of refusing. `ts-kernel-name-fold` caught it. The same hole shadowed the book: a Keeper
 * who wrote a name one word longer than an authored one got a duplicate ghost where #64's guard
 * requires `unknown_entity`.
 *
 * So the condition is the graph having no suggestion at all. `candidates` is the ranking the kernel
 * already uses for "did you mean", and this consults it to decide whether to *refuse*, never to pick:
 * when it offers anything, the original refusal and its own candidates go back untouched and the
 * Keeper chooses. That is the opposite of correcting a near name, which stays forbidden (contract
 * §2), and it is strictly more conservative than minting on every miss.
 *
 * `skill` and `archetype` refuse an unknown name outright. Those pin numbers, and pinning numbers
 * onto someone the same call is inventing is how a stat block gets attached to a typo; the Keeper
 * establishes the person first and pins afterwards, which is the order §34.10 already describes.
 */
function personOfEffect(context:ApplyContext,effect:Row,name:string,why:string|null):{node:Row;established:boolean}{
    const {graph,world}=context;
    try{return{node:graph.npc(name),established:false};}
    catch(error){
        // A pin, an ambiguity, or a name the book has something to say about: the graph's own answer
        // stands, with the candidates it minted. Only a name it is silent on reaches the table.
        // A creature that states a stat block is the book's body, not a new person (contract §136.12).
        const creature=graph.actor(name);
        if(creature)return{node:creature,established:false};
        if(effect.skill!=null||effect.archetype!=null||effect.conditions!=null||effect.reunion!=null||graph.candidates(name,['npc']).length)throw error;
    }
    const trimmed=name.trim(),people=array(world.table_people??=[]);
    const node=graph.addTablePerson(tablePersonId(trimmed),trimmed,{reason:why,turn:context.turn.turn});
    if(!people.some(person=>normalize(string(row(person).name))===normalize(trimmed)))
        people.push({name:trimmed,turn:context.turn.turn,why,established_at:nowIso()});
    return{node,established:true};
}
export async function stageNpc(context:ApplyContext,effect:Row):Promise<StagedEffect>{
    const {graph,world}=context;
    const why=typeof effect.why==='string'&&effect.why.trim()?effect.why:null;
    const {node,established}=personOfEffect(context,effect,string(required(effect,'name')),why);
    const handle=graph.handle(node),{to,stance,dead}=effect;
    if(effect.reunion!=null){
        if(['to','stance','dead','skill','archetype','conditions','defense'].some(key=>effect[key]!=null))
            throw new RpcError('invalid_params','Reunion continuity is separate from mechanical or positional NPC effects');
        const meta=await context.campaign.readCampaign(),worldline=string(meta.active_worldline||'main');
        const scope={worldline,loop:number(row(row(meta.worldlines)[worldline]).loop)};
        const snapshot=new CampaignSnapshot(context.kernel,context.campaign.id);
        const reunion=acceptReunion(graph,world,node,await snapshot.files('turns'),scope,effect.reunion,number(context.turn.turn));
        return {receipt:{id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,
            name:graph.displayName(node),reunion,why,visibility:'keeper',at:nowIso()},
            event:reunion.reused?null:{type:'npc-changed',data:{npc:handle,reunion}}};
    }
    // §11.5.2: the Keeper's override of this person's standing defence. Its own variant, like conditions: one
    // closed word and the reason, an ordinary keeper-side receipt, and the world key the session view reads.
    if(effect.defense!=null){
        const combined=['to','stance','dead','skill','archetype','conditions'].filter(key=>effect[key]!=null);
        if(combined.length)throw new RpcError('invalid_params','npc.defense is its own state-changing effect',{fix:'put the standing defence and the other npc change in two effects in the same atomic batch',details:{field:'npc.defense',conflicts:combined}});
        if(typeof effect.defense!=='string'||!DEFENSE_WORDS.includes(effect.defense))unsupported('npc.defense',effect.defense,[...DEFENSE_WORDS],`npc.defense ${repr(effect.defense)} is not a defence`);
        if(!why)throw new RpcError('invalid_params','npc.defense needs a why',{fix:'say in one sentence what in the fiction changed how this person defends',details:{field:'npc.why'}});
        const tactics=world.npc_defense??={},previous=typeof row(tactics[handle]).defense==='string'?row(tactics[handle]).defense:null;
        tactics[handle]={defense:effect.defense,why,turn:number(context.turn.turn)};
        const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),label:personLabel(world,handle,graph.displayName(node)),defense:effect.defense,previous,...(established?{established:'table'}:{}),why,visibility:'keeper',at:nowIso()};
        return {receipt,event:{type:'npc-changed',data:{npc:handle,defense:effect.defense,why}}};
    }
    if(effect.conditions!=null){
        const combined=['to','stance','dead','skill','archetype'].filter(key=>effect[key]!=null);
        if(combined.length)throw new RpcError('invalid_params','npc.conditions is its own state-changing effect',{fix:'put the condition change and the other npc change in two effects in the same atomic batch',details:{field:'npc.conditions',conflicts:combined}});
        if(!isJsonObject(effect.conditions)||Object.keys(effect.conditions).some(key=>!['gained','lost'].includes(key)))throw new RpcError('invalid_params','npc.conditions must be {gained?: string[], lost?: string[]}',{fix:'name the rules conditions that became true or stopped being true',details:{field:'npc.conditions'}});
        for(const key of ['gained','lost'])if(Object.hasOwn(effect.conditions,key)&&!Array.isArray(effect.conditions[key]))throw new RpcError('invalid_params',`npc.conditions.${key} must be a list`,{fix:'use a list of rules condition names',details:{field:`npc.conditions.${key}`}});
        const gained=array(effect.conditions.gained).map(string),lost=array(effect.conditions.lost).map(string);
        const options=sorted([...VALID_CONDITIONS].filter(value=>value!=='dead'));
        const duplicates=[...gained,...lost].filter((value,index,all)=>all.indexOf(value)!==index);
        const invalid=[...gained,...lost].filter(value=>!options.includes(value));
        if(!gained.length&&!lost.length)throw new RpcError('invalid_params','npc.conditions needs at least one gained or lost condition',{fix:'name what became true or stopped being true',details:{field:'npc.conditions',options}});
        if(duplicates.length)throw new RpcError('invalid_params',`npc.conditions repeats ${repr(sorted([...new Set(duplicates)]))}`,{fix:'each condition appears once, on only one side',details:{field:'npc.conditions',duplicates:sorted([...new Set(duplicates)])}});
        if(invalid.length)throw new RpcError('invalid_params',`npc.conditions contains unsupported values ${repr(sorted([...new Set(invalid)]))}`,{fix:'use one of details.options; record death with dead: true',details:{field:'npc.conditions',options}});
        const profile=npcProfileOf(graph,world,handle),before=[...new Set(array(profile?.conditions??row(row(world.npc_resources)[handle]).conditions).map(string))];
        const after=before.filter(value=>!lost.includes(value));for(const value of gained)if(!after.includes(value))after.push(value);
        const actualGained=after.filter(value=>!before.includes(value)),actualLost=before.filter(value=>!after.includes(value));
        ((world.npc_resources??={})[handle]??={}).conditions=[...after];
        const label=personLabel(world,handle,graph.displayName(node));
        const receipt={id:effectId(context,'condition',handle),kind:'condition',call_id:context.callId,subject:handle,subject_label:label,subject_is_investigator:false,npc:handle,before,after,gained:actualGained,lost:actualLost,incapacitated:incapacitatedBy(after),visibility:'public',why,at:nowIso()};
        return {receipt,event:{type:'npc-changed',data:{npc:handle,conditions:{before,after,gained:actualGained,lost:actualLost},why}}};
    }
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
        if(isJsonObject(graph.mechanicsOf(node).profile))throw new RpcError('invalid_params',`the source prints ${graph.displayName(node)}'s numbers; an archetype cannot replace them`,{fix:'resolve against the printed profile; no pin is needed',details:{field:'npc.archetype',actor:handle,authority:'source_authored'}});
        const existing=row(row(world.npc_profiles)[handle]);
        if(truth(existing.archetype))throw new RpcError('invalid_params',`${graph.displayName(node)} already has a pinned ${string(existing.archetype)} profile from turn ${string(existing.pinned_turn)}`,{fix:'resolve against it; a pin is made once for the campaign',details:{field:'npc.archetype',actor:handle,archetype:existing.archetype,pinned_turn:existing.pinned_turn??null}});
        profile=await rollArchetypeProfile(context.kernel,archetype.trim(),why,number(context.turn.turn));
    }
    if(to==null&&stance==null&&dead==null&&pinned==null&&profile==null)throw new RpcError('invalid_params','an npc effect needs `to`, `stance`, `conditions`, `dead`, `skill`, `archetype`, or a combination',{fix:`move them with to: here/away/<scene>, set stance to one of ${repr(words)}, change an explicit condition, say dead: true, pin a skill they have, or name an archetype for a person the book gave no numbers`});
    const presence=world.npc_presence??={};let moved:string|null=null;
    if(to!=null){
        if(typeof to!=='string'||!to.trim())throw new RpcError('invalid_params',"npc.to must be a scene name, 'here' or 'away'",{fix:'a scene name on the graph, or here / away',details:{field:'npc.to',options:['here','away']}});
        if(to.trim()==='away'){delete presence[handle];moved='away';}else{moved=graph.handle(graph.scene(to.trim()==='here'?world.active_scene:to));presence[handle]=moved;}
    }
    if(stance!=null&&(typeof stance!=='string'||!words.includes(stance)))unsupported('npc.stance',stance,words,`npc.stance ${repr(stance)} is not one of the ledger's words`);
    if(profile!=null)(world.npc_profiles??={})[handle]=profile;
    const pinnedProfile=profile?{archetype:profile.archetype,characteristics:profile.characteristics,derived:profile.derived,skills:profile.skills}:null;
    // `established` rides on the receipt and the event so that a person this table just invented is
    // never indistinguishable from one the book printed -- for the Keeper reading the result, and for
    // anything that folds receipts later (the ledger, a worldline rebuild, the KPI).
    const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),label:personLabel(world,handle,graph.displayName(node)),to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{profile:pinnedProfile}:{}),...(established?{established:'table'}:{}),why,at:nowIso()};
    return {receipt,event:{type:'npc-changed',data:{npc:handle,to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{archetype:profile!.archetype}:{}),...(established?{established:'table'}:{}),why}}};
}
export async function stageHandout(context:ApplyContext,effect:Row,asset:(module:string,name:string)=>Promise<Row|null>):Promise<StagedEffect>{
    const {graph,world}=context,name=required(effect,'name')!,node=graph.find(name,['handout'])||graph.resolve(name,['handout','asset'],'handout');
    const handle=graph.handle(node),visibility=node.visibility,display=graph.displayName(node);
    if(!['player-safe','revealable'].includes(visibility))throw new RpcError('invalid_params',`${repr(handle)} is ${visibility}; it cannot be handed to the player`,{fix:'keeper-only images and cards stay in lookup {kind: secret}; hand out a player-safe or revealable one',details:{handout:handle,visibility}});
    const label=typeof effect.label==='string'&&effect.label.trim()?effect.label:null,record=recordOf(node),props=row(node.properties),registered=await asset(graph.moduleId,node.node_id)||{};
    const attachment:Row={handout:handle,path:null,media_type:null,available:false};
    const text=typeof record.authored_text==='string'?record.authored_text:registered.authored_text;
    if(typeof text==='string'&&text.trim()){
        const folder=join(context.campaign.directory,'handouts'),path=join(folder,`${handle}.md`);await mkdir(folder,{recursive:true});await writeFile(path,handoutFile(display,text),'utf8');
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
