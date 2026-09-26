/** Existing authored clue/NPC/handout effects; no authored graph mutation. */
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {isAmbiguity,notAPerson,personRefusal,recordOf} from '../read/module-graph.js';
import {handoutFile} from '../read/handout-document.js';
import {npcNode,npcsPresent,personLabel,personNode,personRecord,untoldBlock} from '../read/capsule.js';
import {unsupported} from '../read/handlers.js';
import {passageOf,tablePersonId} from '../read/table-people.js';
import {array,entries,integer,normalize,number,repr,row,sorted,string,truth,type Row} from '../read/values.js';
import {stanceTable} from '../write/contributions.js';
import {required,nowIso} from '../write/store.js';
import {effectId,type StagedEffect} from './bookkeeping.js';
import {archetypeIds,rollArchetypeProfile} from './archetype.js';
import {VALID_CONDITIONS} from '../combat/engine.js';
import {DEFENSE_WORDS,DISPOSITION_WORDS,OVERRIDE_ACTION_WORDS,authoredDisposition} from '../combat/standing.js';
import {incapacitatedBy} from '../healing/conditions.js';
import {npcProfileOf} from '../resolve/context.js';
import type {ApplyContext} from './index.js';
import {CampaignSnapshot} from '../read/campaign.js';
import {acceptReunion} from '../npc/reunion.js';
/** §135.30.7 (SL-42): the scenes the party left during this turn, latest departure first, from the turn's own move receipts. */
function departedThisTurn(context:ApplyContext):string[]{
    const moves=[...array(context.turn.receipts),...(context.staged?.()??[])].filter(receipt=>isJsonObject(receipt)&&receipt.kind==='move'&&receipt.renamed!==true&&typeof receipt.from==='string'&&receipt.from!==receipt.to);
    return [...new Set(moves.map(receipt=>string(receipt.from)).reverse())];
}
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
    const node=graph.clue(name),active=graph.scene(world.active_scene),here=graph.sceneClueIds(active),handle=graph.handle(node);
    // §135.30.7 (SL-42): a clue of a scene the party left during this turn is accepted there. The turn's departures are the
    // `from` of its move receipts (earlier calls, then earlier in this batch; a rename is not a departure), latest first.
    const left=here.includes(node.node_id)?undefined:departedThisTurn(context).map(handle=>graph.scene(handle)).find(value=>graph.sceneClueIds(value).includes(node.node_id));
    const scene=left??active;
    if(!here.includes(node.node_id)&&!left)throw new RpcError('not_here',`clue ${repr(handle)} is not discoverable at ${repr(graph.handle(scene))}`,{fix:'discover one of details.clues_here, or move first',details:{clue:handle,scene:graph.handle(scene),clues_here:here.map(id=>graph.handle(graph.nodes.get(id)!))}});
    let source:string|null=null;
    if(typeof effect.from==='string'&&effect.from.trim())source=graph.handle(npcNode(graph,world,effect.from));
    else {
        const present=new Set(npcsPresent(graph,world,scene).map(node=>graph.handle(node)));
        const holders=new Set((graph.incoming.get(node.node_id)||[]).filter(rel=>['held-by','delivered-by'].includes(rel.relation_kind)).map(rel=>graph.nodes.get(rel.from_node_id)).filter(node=>node?.node_kind==='npc').map(node=>graph.handle(node!)));
        const candidates=sorted([...holders].filter(name=>present.has(name)));if(candidates.length===1)source=candidates[0];
    }
    // Without a keeper label the receipt files the graph's display name: a handle is a machine word and never reaches the player.
    const receipt={id:`clue:${handle}-t${turn}`,kind:'clue',call_id:context.callId,clue:handle,label:label||graph.displayName(node),summary:node.summary||node.name,scene:graph.handle(scene),how,from:source,
        ...(left?{left_this_turn:true}:{}),at:nowIso()};
    if(label)(world.clue_labels??={})[handle]=label;
    // §80: the account of how this table came by the clue, kept beside its name because that is
    // what the player's own record of it says. The graph's summary is the Keeper's and stays on
    // the graph; a clue discovered without a `how` has a name and nothing more, which is honest.
    if(how)(world.clue_how??={})[handle]=how;
    if(array(world.discovered_clues??=[]).includes(handle))return {receipt,event:null};world.discovered_clues.push(handle);
    return {receipt,event:{type:'clue-discovered',data:{clue:handle,scene:receipt.scene,how}}};
}
/**
 * The person this effect is about: the book's, a reviewed adaptation's, one this table named with
 * `apply person`, one a passage the source text carried this turn names (§11.5.4), or -- declared
 * with `walk_on: true` -- one this table establishes here (contract §87, §87.7, see
 * `read/table-people.ts`).
 *
 * **A table name is a name.** Before anything is refused or minted, the word is looked up in §79's
 * record. temper-c t4-c4 sent `apply person {who: <the dock labourer>, name: <an epithet>}` and then
 * `apply npc {name: <that epithet>}` in one batch, which is what the capsule's `untold.use` tells the
 * Keeper to do, and the npc effect minted a second man under the epithet: this was the one person
 * entrance that read the book's names and not the table's. Two people given one word come back as
 * an ambiguity, never a pick.
 *
 * **A newcomer is declared, not inferred from silence.** A word no record carries can as well be an
 * authored person the Keeper has not introduced yet as someone the book never had, and deciding
 * which is the semantic judgement §87.4 forbids. So minting takes `walk_on: true`, and without it
 * the refusal hands over the calls for each reading (`notAtThisTable`) -- which is also the
 * `unknown_entity` §11.5.6's host resolution waits for, so a silent mint had been skipping it. A
 * passage the book carried vouches for its person, and needs no flag.
 *
 * **Silence was never the right test anyway.** The first version read through `graph.find`, which
 * answers null for an ambiguous name exactly as for an absent one, so `apply npc "Senora Pena"` --
 * two nodes folding to one name -- minted a third (`ts-kernel-name-fold`); an ambiguity, by an
 * exact key or a run inside two names, is still the graph's own refusal, flag or no flag. The fix
 * for that refused whenever `candidates` offered anything, and §11.5.7 and its SL-70 addendum then
 * spent two rounds taking this table's own people back out of that count. Resemblance is no reason to refuse a declared newcomer at all:
 * a refusal that sends the Keeper to pick "the porter" for the constable because the words share
 * letters is §87's turn-106 relocation again. Near names now lead the refusal's list instead.
 *
 * With the flag, a pin rides on the call that establishes the person (ticket 07's ruled shape): the
 * typo §87.2 guarded against is a Keeper reaching for someone the book has, and a Keeper who
 * declared a newcomer is not doing that. A reunion stays refused on a word nobody carries.
 */
async function personOfEffect(context:ApplyContext,effect:Row,name:string,why:string|null):Promise<{node:Row;established:false|'table'|'passage';from_passage?:Row}>{
    const {graph,world}=context,walkOn=effect.walk_on??null;
    if(walkOn!==null&&typeof walkOn!=='boolean')throw new RpcError('invalid_params','npc.walk_on must be true or false',{fix:'walk_on: true on the effect that brings in someone the book never had; leave it out for anyone this table already has',details:{field:'npc.walk_on'}});
    let node:Row|null=null,refusal:unknown=null;
    try{node=graph.npc(name);}catch(error){refusal=error;}
    // A creature that states a stat block is the book's body, not a new person (contract §136.12); then the word this
    // table gave someone, through the one junction every person entrance reads (§87.8), which refuses two owners.
    node??=personNode(graph,world,name);
    if(node){
        if(walkOn===true&&!graph.isTablePerson(node))throw new RpcError('invalid_params',`${repr(name)} is ${graph.displayName(node)}, whom this table already has; walk_on brings in someone it does not`,{fix:`leave walk_on out to write to ${graph.displayName(node)}; call a newcomer by a word nobody here carries`,details:{field:'npc.walk_on',query:name,person:graph.displayName(node)}});
        return{node,established:false};
    }
    // A word that already names more than one person -- by an exact key or as a run inside two names
    // -- is the graph's ambiguity, flag or no flag: a newcomer under it would be a third, and would
    // shadow both. A reunion is with someone already met. Both keep SL-73's refusal.
    const ambiguous=isAmbiguity(refusal),party=await context.campaign.party();
    if(effect.reunion!=null||ambiguous)throw personRefusal(refusal,name,graph,party);
    // The investigator's own name, or exactly the name of a place or a clue, is not a person anybody
    // establishes (SL-73): asked before any road to minting, flag or no flag.
    const other=notAPerson(name,graph,party,refusal instanceof RpcError?refusal.message:`no npc named ${repr(name)}`);
    if(other)throw other;
    const passage=passageOf(effect,name),pinned=['skill','archetype','conditions'].some(key=>effect[key]!=null);
    if(walkOn!==true&&(!passage||pinned))throw await notAtThisTable(context,effect,name,refusal);
    const established=establishPerson(context,name,why,passage);
    return{node:established,established:passage?'passage':'table',...(passage?{from_passage:passage}:{})};
}
/**
 * The refusal for a word nobody at this table carries, sent without `walk_on` (contract §87.7). A
 * `fix` is executed literally, so it carries the calls rather than a description of them:
 * `details.present` is who is here, and each authored person the player has not been told about and
 * this table has no word for carries the `apply person` that gives them this one, ready to go first
 * in the same batch; `details.walk_on` is this effect with the flag set. Choosing between them is the
 * Keeper's; nothing here compares the word to anybody.
 */
async function notAtThisTable(context:ApplyContext,effect:Row,name:string,refusal:unknown):Promise<RpcError>{
    const {graph,world}=context,snapshot=new CampaignSnapshot(context.kernel,context.campaign.id);
    const journal=row(await snapshot.optional('npc-journal.json')),records=await snapshot.files('turns');
    let here:Row[]=[];try{here=npcsPresent(graph,world,graph.scene(world.active_scene));}catch{here=[];}
    const present=here.map(node=>{
        const display=graph.displayName(node),called=string(personRecord(world,graph.handle(node)).name||'').trim();
        const untold=!called&&!graph.isTablePerson(node)&&untoldBlock(graph,world,journal,node,records)!==null;
        return {name:display,...(called?{called}:{}),...(untold?{introduce:{kind:'person',who:display,name:name.trim()}}:{})};
    });
    const walk_on={...Object.fromEntries(entries(effect).filter(([key])=>!key.startsWith('_'))),walk_on:true};
    // Near names lead; an empty list never travels (SL-73), and the fix names only lists that are there.
    const candidates=graph.candidates(name,['npc']),lists=[...(candidates.length?['details.candidates']:[]),...(present.length?['details.present']:[])];
    const pick=lists.length?`if this is someone in ${lists.join(' or ')}, write to them by that name`:'';
    const introduce=present.some(person=>person.introduce)?'; one in details.present carrying introduce has no word at this table yet, so send its introduce effect first in this same apply and this npc effect after it':'';
    // The graph's own sentence stays the message ("no npc named ..."): it is still true, and the fix and
    // details are what change.
    return new RpcError('unknown_entity',refusal instanceof RpcError?refusal.message:`nobody at this table is called ${repr(name)}`,{
        fix:`${pick}${introduce}${pick?'. ':''}To establish someone the book never had, send details.walk_on in place of this effect`,
        details:{query:name,...(present.length?{present}:{}),...(candidates.length?{candidates}:{}),walk_on}});
}
/**
 * §87's record of a person the table has and the book (so far) does not; with §11.5.4's `from_passage` when a passage the
 * source text carried this turn names them. Idempotent on the name.
 */
export function establishPerson(context:Pick<ApplyContext,'graph'|'world'|'turn'>,name:string,why:string|null,passage:Row|null):Row{
    const {graph,world}=context,trimmed=name.trim(),people=array(world.table_people??=[]);
    const node=graph.addTablePerson(tablePersonId(trimmed),trimmed,{reason:why,turn:context.turn.turn,...(passage?{from_passage:passage}:{})});
    if(!people.some(person=>normalize(string(row(person).name))===normalize(trimmed)&&!row(person).replaced_by))
        people.push({name:trimmed,turn:context.turn.turn,why,established_at:nowIso(),...(passage?{from_passage:passage}:{})});
    return node;
}
/** What a receipt says about where a person came from: nothing for the book's, `table` for §87's, `passage` for §11.5.4's.
 *  §11.5.6 (SL-62): `resolved_from` rides beside it -- the name the Keeper wrote, when the host resolved it to this
 *  person against the scene's known people rather than an exact match. */
const establishedOf=(established:false|'table'|'passage',fromPassage:Row|undefined,resolvedFrom?:string):Row=>
    ({...(established?{established,...(fromPassage?{from_passage:fromPassage}:{})}:{}),...(resolvedFrom?{resolved_from:resolvedFrom}:{})});
export async function stageNpc(context:ApplyContext,effect:Row):Promise<StagedEffect>{
    const {graph,world}=context;
    const why=typeof effect.why==='string'&&effect.why.trim()?effect.why:null;
    const {node,established,from_passage:fromPassage}=await personOfEffect(context,effect,string(required(effect,'name')),why);
    // §11.5.6 (SL-62): the host's `_resolved_from` -- the name the Keeper wrote, once a fan-out question against the
    // scene's known people cleared it to this person's handle and the host rewrote `name` before the retry. Host-only:
    // the model never sends it, and it never changes who the effect is about, only what the receipt says about it.
    const resolvedFrom=typeof effect._resolved_from==='string'&&effect._resolved_from.trim()?effect._resolved_from.trim():undefined;
    const handle=graph.handle(node),{to,stance,dead}=effect;
    if(effect.reunion!=null){
        if(['to','stance','dead','skill','archetype','conditions','defense','action','disposition'].some(key=>effect[key]!=null))
            throw new RpcError('invalid_params','Reunion continuity is separate from mechanical or positional NPC effects');
        const meta=await context.campaign.readCampaign(),worldline=string(meta.active_worldline||'main');
        const scope={worldline,loop:number(row(row(meta.worldlines)[worldline]).loop)};
        const snapshot=new CampaignSnapshot(context.kernel,context.campaign.id);
        const reunion=acceptReunion(graph,world,node,await snapshot.files('turns'),scope,effect.reunion,number(context.turn.turn));
        return {receipt:{id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,
            name:graph.displayName(node),reunion,...(resolvedFrom?{resolved_from:resolvedFrom}:{}),why,visibility:'keeper',at:nowIso()},
            event:reunion.reused?null:{type:'npc-changed',data:{npc:handle,reunion}}};
    }
    // §11.5.2: the Keeper's override of this person's standing defence. Its own variant, like conditions: one
    // closed word and the reason, an ordinary keeper-side receipt, and the world key the session view reads.
    if(effect.defense!=null){
        const combined=['to','stance','dead','skill','archetype','conditions','action','disposition'].filter(key=>effect[key]!=null);
        if(combined.length)throw new RpcError('invalid_params','npc.defense is its own state-changing effect',{fix:'put the standing defence and the other npc change in two effects in the same atomic batch',details:{field:'npc.defense',conflicts:combined}});
        if(typeof effect.defense!=='string'||!DEFENSE_WORDS.includes(effect.defense))unsupported('npc.defense',effect.defense,[...DEFENSE_WORDS],`npc.defense ${repr(effect.defense)} is not a defence`);
        if(!why)throw new RpcError('invalid_params','npc.defense needs a why',{fix:'say in one sentence what in the fiction changed how this person defends',details:{field:'npc.why'}});
        const tactics=world.npc_defense??={},previous=typeof row(tactics[handle]).defense==='string'?row(tactics[handle]).defense:null;
        tactics[handle]={defense:effect.defense,why,turn:number(context.turn.turn)};
        const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),label:personLabel(world,handle,graph.displayName(node)),defense:effect.defense,previous,...establishedOf(established,fromPassage,resolvedFrom),why,visibility:'keeper',at:nowIso()};
        return {receipt,event:{type:'npc-changed',data:{npc:handle,defense:effect.defense,why}}};
    }
    // §11.5.3: the Keeper's override of this person's standing action in a fight, and of their combat disposition.
    // Each its own variant, like `defense`: one closed word and the reason, an ordinary keeper-side receipt, and the
    // world key the session view reads. A `hold` holds for the round it is written in, so it names that fight and round.
    if(effect.action!=null||effect.disposition!=null){
        const field=effect.action!=null?'action':'disposition',words=field==='action'?OVERRIDE_ACTION_WORDS:DISPOSITION_WORDS;
        const combined=['to','stance','dead','skill','archetype','conditions','defense',field==='action'?'disposition':'action'].filter(key=>effect[key]!=null);
        if(combined.length)throw new RpcError('invalid_params',`npc.${field} is its own state-changing effect`,{fix:`put the ${field} and the other npc change in two effects in the same atomic batch`,details:{field:`npc.${field}`,conflicts:combined}});
        const word=effect[field];
        if(typeof word!=='string'||!words.includes(word))unsupported(`npc.${field}`,word,[...words],`npc.${field} ${repr(word)} is not one of the closed words`);
        if(!why)throw new RpcError('invalid_params',`npc.${field} needs a why`,{fix:field==='action'?'say in one sentence what in the fiction makes this person attack, or hold back this round':'say in one sentence what about this person makes them fight that way',details:{field:'npc.why'}});
        const written=field==='action'?world.npc_action??={}:world.npc_disposition??={};
        const previous=typeof row(written[handle])[field]==='string'?row(written[handle])[field]:null;
        let scope:Row={};
        // §11.5.3 source 2: a disposition Jev inferred for the clerk arrives with the host-only `_inferred` marker (the
        // extension strips it from every model call). It names the parameters read, and it is written once: never over
        // a disposition this campaign or the book already has.
        if(effect._inferred!=null){
            const read=array(row(effect._inferred).read);
            if(field!=='disposition'||!read.length||read.some(value=>typeof value!=='string'||!value))
                throw new RpcError('invalid_params','an inferred write is a disposition with the parameters it was read from',{details:{field:'npc._inferred'}});
            if(previous!==null||authoredDisposition(graph,handle)!==null)
                throw new RpcError('invalid_params',`${graph.displayName(node)} already has a combat disposition; it is inferred once`,{fix:'read it from the NPC card; only the Keeper rewrites it',details:{field:'npc.disposition',reason:'disposition_already_set'}});
            scope={basis:'inferred',read:[...read]};
        }else if(field==='disposition')scope={basis:'keeper'};
        if(word==='hold'){
            const combat=row(await context.campaign.readSave('combat.json'));
            if(combat.status!=='active')throw new RpcError('invalid_params','npc.action hold holds back for this round of a fight, and no fight is running',{fix:'write hold on the round the person holds back; outside a fight, just narrate it',details:{field:'npc.action'}});
            if(!array(combat.participants).some(participant=>string(row(participant).actor_id)===handle))throw new RpcError('invalid_params',`${graph.displayName(node)} is not in this fight`,{fix:'write hold for a participant of the running fight',details:{field:'npc.name',actor:handle}});
            scope={combat_id:string(combat.combat_id),round:number(combat.current_round)};
        }
        written[handle]={[field]:word,why,turn:number(context.turn.turn),...scope};
        const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),label:personLabel(world,handle,graph.displayName(node)),[field]:word,previous,...scope,...establishedOf(established,fromPassage,resolvedFrom),why,visibility:'keeper',at:nowIso()};
        return {receipt,event:{type:'npc-changed',data:{npc:handle,[field]:word,why}}};
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
        const receipt={id:effectId(context,'condition',handle),kind:'condition',call_id:context.callId,subject:handle,subject_label:label,subject_is_investigator:false,npc:handle,before,after,gained:actualGained,lost:actualLost,incapacitated:incapacitatedBy(after),...(resolvedFrom?{resolved_from:resolvedFrom}:{}),visibility:'public',why,at:nowIso()};
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
    const receipt={id:effectId(context,'npc',handle),kind:'npc',call_id:context.callId,npc:node.node_id,handle,name:graph.displayName(node),label:personLabel(world,handle,graph.displayName(node)),to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{profile:pinnedProfile}:{}),...establishedOf(established,fromPassage,resolvedFrom),why,at:nowIso()};
    return {receipt,event:{type:'npc-changed',data:{npc:handle,to:moved,stance:stance??null,dead:dead??null,skill:pinned,...(pinnedProfile?{archetype:profile!.archetype}:{}),...establishedOf(established,fromPassage,resolvedFrom),why}}};
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

/**
 * §22.4.7.1 (SL-56): the host's `_land_on_text` -- the people it asks to land on the book's text, by the gate's key, with
 * the passage it found (or none). Host-only; a malformed entry is ignored, never a refusal.
 */
export function landRequests(value:unknown):Map<string,Row|null>{
    const out=new Map<string,Row|null>();
    for(const entry of array(value))if(isJsonObject(entry)&&typeof entry.key==='string'&&entry.key)out.set(entry.key,isJsonObject(entry.passage)?entry.passage:null);
    return out;
}
/** Why a person the gate landed on the book's text was registered (the record keeps the passage). */
const LANDED_WHY='the book\'s text names them; their record is still being read';
/**
 * §22.4.7.1 (SL-56): what a person's landing on the book's text writes -- an index-only name registered provisionally in
 * §11.5.4's shape, and the focus in `world.index_people` so the gate passes it until the record lands -- and the result's
 * `person_text` rows.
 */
export function landPeople(context:Pick<ApplyContext,'graph'|'world'|'turn'>,landed:Array<{kind:string;name:string;focus:string;pages:number[];person?:string;book?:boolean;passage?:Row|null}>):Row[]{
    const out:Row[]=[];
    for(const entry of landed){
        if(entry.kind!=='person')continue;
        if(!entry.book&&entry.passage)establishPerson(context,entry.name,LANDED_WHY,entry.passage);
        const people=array(context.world.index_people).filter((value):value is string=>typeof value==='string');
        if(!people.includes(entry.focus))context.world.index_people=[...people,entry.focus];
        out.push({person:entry.person??entry.name,focus:entry.focus,pages:entry.pages,...(entry.passage?{passage:entry.passage}:{})});
    }
    return out;
}
