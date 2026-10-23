/**
 * Contract §258.2: who said what to whom. The host hands the narrate/ask commit what the packet selected for each speaker
 * (`_delivery_evidence.selections`); the commit settles each selection against the committed say spans and the presence at
 * publication, and the turn record keeps the result as `communication`. Nothing else stores it: every count is read back
 * from the turn records, so a rollback, a replay or a rebuilt campaign reads the same counts.
 */
import {createHash} from 'node:crypto';
import type {ModuleGraph} from '../read/module-graph.js';
import {array,number,row,string,type Row} from '../read/values.js';
import {isNpcReference,npcReference} from './references.js';

export const STRATEGIES=['new','refer','restate','clarify','update'] as const;
export type Strategy=typeof STRATEGIES[number];
const CONTENT_ID=/^[a-z]:[A-Za-z0-9_.:-]{1,120}$/;
const LISTENER=/^(npc_[1-9][0-9]*|investigator_[1-9][0-9]*)$/;
const INVESTIGATOR=/^investigator_[1-9][0-9]*$/;
/** §258.9: how a selection reaches people. `aside` is said so only its addressed listeners hear it. */
export const CHANNELS=['speech','aside'] as const;
/** At most this many told rows per person reach the Keeper (§258.4). */
export const TOLD_ROWS=6;

/** The host's selections, as `_delivery_evidence` carries them; anything malformed is dropped, never trusted. */
export function selectionsOf(evidence:Row):Row[] {
    return array(evidence.selections).slice(0,16).flatMap((value,index)=>{
        const selection=row(value);
        if(!isNpcReference(selection.actor)||typeof selection.act!=='string')return [];
        const to=array(selection.to).filter(ref=>typeof ref==='string'&&LISTENER.test(ref)).slice(0,16);
        const items=array(selection.items).slice(0,8).flatMap(item=>{
            const value=row(item);
            if(typeof value.content_id!=='string'||!CONTENT_ID.test(value.content_id))return [];
            return [{content_id:value.content_id,strategy:STRATEGIES.includes(value.strategy)?value.strategy:'new',
                ...(typeof value.kind==='string'?{kind:value.kind.slice(0,40)}:{}),
                ...(typeof value.gist==='string'&&value.gist.trim()?{gist:[...value.gist.trim()].slice(0,120).join('')}:{})}];
        });
        return [{seq:index,actor:selection.actor,act:selection.act.slice(0,24),to,items,
            ...(CHANNELS.includes(selection.channel)&&selection.channel!=='speech'?{channel:selection.channel}:{})}];
    });
}

/**
 * §258.2: one turn's communication events. A selection is `attested` when the committed speech holds a non-empty line by
 * its speaker, otherwise `missing`: the author did not give that person words, so nothing was told. Addressed listeners are
 * the selection's `to`; everyone else present at publication, investigators included, `heard` it.
 */
export function communicationRecord(graph:ModuleGraph,world:Row,party:Row[],scope:Row,turn:number,evidence:Row,speech:Row[],present:Row[],playerText?:unknown):Row|undefined {
    const selections=selectionsOf(evidence);
    if(!selections.length)return undefined;
    const investigator=(name:unknown)=>{const at=party.findIndex(sheet=>sheet.name===name||sheet.id===name);return at>=0?`investigator_${at+1}`:undefined;};
    const refOf=(who:Row):string|undefined=>{
        if(typeof who.investigator==='string')return investigator(who.investigator);
        if(typeof who.npc!=='string')return undefined;
        const node=graph.find(who.npc,['npc']);
        return node?npcReference(graph,world,node):undefined;
    };
    const spoke=new Set(speech.flatMap(line=>string(row(line).text).trim()?[refOf(row(row(line).who))]:[]).filter(Boolean));
    // The author's own say tokens name the speaker by reference; a span with words attests it even when the committed
    // speech resolved no line (live P1 run, turn 4: three people spoke and `speech` came back empty).
    for(const match of string(evidence.artifact_text).matchAll(/\{\{say:(npc_[1-9][0-9]*)\}\}([\s\S]*?)(?=\{\{\/say\}\}|\{\{say:|\n[ \t]*\n|$)/g))
        if(match[2].replace(/\{\{[^{}]*\}\}/g,'').trim())spoke.add(match[1]);
    const here=[...present.map(node=>npcReference(graph,world,node)).filter((ref):ref is string=>!!ref),...party.map((_sheet,index)=>`investigator_${index+1}`)];
    const events=selections.map(selection=>({...selection,id:`t${turn}:${selection.seq}`,
        status:spoke.has(selection.actor)?'attested':'missing',
        heard:selection.channel==='aside'?[]:here.filter(ref=>ref!==selection.actor&&!selection.to.includes(ref))}));
    const said=partyEvent(turn,party,here,selections,playerText);
    return {version:1,scope:{worldline:string(scope.worldline||'main'),loop:number(scope.loop)},turn,events:said?[said,...events]:events};
}

/**
 * §258.9: what the investigator said this input, as the player wrote it. The speaker is the one investigator the selected
 * people answered (the only one at a one-investigator table); its addressees are the people who answered them, and everyone
 * else present heard it. The words are the player's own, so the event is attested; it is the investigator's claim, not truth.
 */
function partyEvent(turn:number,party:Row[],here:string[],selections:Row[],playerText:unknown):Row|undefined {
    const text=typeof playerText==='string'?[...playerText.trim()].slice(0,160).join(''):'';
    if(!text)return undefined;
    const answered=[...new Set(selections.flatMap(selection=>array(selection.to).filter(ref=>INVESTIGATOR.test(ref))))];
    const actor=answered.length===1?answered[0]:party.length===1?'investigator_1':undefined;
    if(!actor)return undefined;
    const to=[...new Set(selections.filter(selection=>array(selection.to).includes(actor)).map(selection=>selection.actor as string))];
    const content_id=`p:${createHash('sha256').update(JSON.stringify([actor,turn,text])).digest('hex').slice(0,24)}`;
    return {seq:-1,id:`t${turn}:p`,actor,act:'player_input',to,status:'attested',
        heard:here.filter(ref=>ref!==actor&&!to.includes(ref)),items:[{content_id,strategy:'new',kind:'player_input',gist:text}]};
}

/** The records of this worldline and loop before `turn`, oldest first; a later turn a rewind left behind is not read. */
function scoped(records:Row[],scope:Row,turn?:number):Row[] {
    return records.filter(record=>{
        const communication=row(record.communication),origin=row(communication.scope);
        return communication.version===1&&origin.worldline===string(scope.worldline||'main')&&number(origin.loop)===number(scope.loop)
            &&(turn===undefined||number(record.turn)<turn);
    }).sort((a,b)=>number(a.turn)-number(b.turn));
}

/**
 * §258.4: what this speaker already told, newest first, at most `TOLD_ROWS`. Each row counts attested deliveries per
 * listener by strategy; `unverified` counts selections the author never voiced. `addressed` marks a listener who was spoken
 * to at least once, as opposed to one who only overheard.
 */
export function toldView(records:Row[],actor:string,scope:Row,turn?:number):Row[] {
    const told=new Map<string,Row>();
    for(const record of scoped(records,scope,turn))for(const event of array(row(record.communication).events)){
        if(event.actor!==actor)continue;
        for(const item of array(event.items)){
            const entry=told.get(item.content_id)??{content_id:item.content_id,...(item.kind?{kind:item.kind}:{}),to:{} as Row};
            if(item.gist)entry.gist=item.gist;
            entry.last_turn=number(record.turn);
            if(event.status==='attested')entry.turns=[...new Set([...array(entry.turns),number(record.turn)])].slice(-8);
            const listeners=event.status==='attested'?[...array(event.to),...array(event.heard)]:array(event.to);
            for(const listener of listeners){
                const counts=entry.to[listener]??={};
                if(event.status!=='attested')counts.unverified=number(counts.unverified)+1;
                else{
                    counts[item.strategy]=number(counts[item.strategy])+1;
                    if(array(event.to).includes(listener))counts.addressed=true;
                }
                counts.last_turn=number(record.turn);
            }
            told.delete(item.content_id);told.set(item.content_id,entry);
        }
    }
    return [...told.values()].reverse().slice(0,TOLD_ROWS);
}

/** How many times this listener was told this content (every strategy but unverified). */
export function toldCount(counts:Row):number {
    return STRATEGIES.reduce((sum,strategy)=>sum+number(row(counts)[strategy]),0);
}

/**
 * §258.5: whether a promise the memory lane extracted at `turn` has an origin -- a turn with communication records counts
 * only when its obligor's own selection there was voiced. A turn recorded before §258 has no communication to judge by,
 * so its promises stand as they did.
 */
export function promiseHasOrigin(records:Row[],actor:string|undefined,turn:unknown,scope:Row):boolean {
    const record=records.find(value=>number(value.turn)===number(turn)&&row(value.communication).version===1
        &&row(row(value.communication).scope).worldline===string(scope.worldline||'main'));
    if(!record)return true;
    return !!actor&&array(row(record.communication).events).some(event=>event.actor===actor&&event.status==='attested');
}

/**
 * §258.8: what others said in this person's hearing -- attested items whose event lists them as `heard` -- newest first,
 * one row per item, at most `TOLD_ROWS`. The words stay the speaker's: a reader issues them as attributed hearsay.
 */
export function heardView(records:Row[],listener:string,scope:Row,turn?:number):Row[] {
    const heard=new Map<string,Row>(),own=new Set<string>();
    for(const record of scoped(records,scope,turn))for(const event of array(row(record.communication).events)){
        // §258.9: what an investigator said is read by partySaidView, as their claim.
        if(event.status!=='attested'||INVESTIGATOR.test(string(event.actor)))continue;
        // What this person said themself is never hearsay to them, even when someone else repeats it later.
        if(event.actor===listener){for(const item of array(event.items))own.add(item.content_id);continue;}
        if(!array(event.heard).includes(listener))continue;
        for(const item of array(event.items)){
            if(!item.gist)continue;
            // The first speaker keeps the words; a later repeat only refreshes when it was heard.
            const first=heard.get(item.content_id);
            heard.delete(item.content_id);
            heard.set(item.content_id,{content_id:item.content_id,said_by:first?.said_by??event.actor,to:first?.to??array(event.to),gist:item.gist,turn:number(record.turn)});
        }
    }
    return [...heard.values()].filter(row=>!own.has(row.content_id)).reverse().slice(0,TOLD_ROWS);
}

/**
 * §258.9: what the investigators said to this person or in their hearing, newest first, at most `TOLD_ROWS`. `to_me` marks
 * words addressed to this person. These are the investigator's claims as the player wrote them, never verified truth.
 */
export function partySaidView(records:Row[],listener:string,scope:Row,turn?:number):Row[] {
    const said:Row[]=[];
    for(const record of scoped(records,scope,turn))for(const event of array(row(record.communication).events)){
        if(event.status!=='attested'||!INVESTIGATOR.test(string(event.actor)))continue;
        const toMe=array(event.to).includes(listener);
        if(!toMe&&!array(event.heard).includes(listener))continue;
        for(const item of array(event.items))if(item.gist)
            said.push({content_id:item.content_id,said_by:event.actor,...(toMe?{to_me:true}:{}),gist:item.gist,turn:number(record.turn)});
    }
    return said.reverse().slice(0,TOLD_ROWS);
}
