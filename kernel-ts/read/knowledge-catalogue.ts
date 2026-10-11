/** Public originals with bounded semantic read references; scores never define membership. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import {CampaignSnapshot,loadCampaignModule} from './campaign.js';
import {publicKnowledge} from './public-knowledge.js';
import {handoutHeading} from './handout-document.js';
import {onLine} from './exchange.js';
import {array,row,number,string,normalize,type Row} from './values.js';

export const KNOWLEDGE_ROWS=20, KNOWLEDGE_POINTS=4096, KNOWLEDGE_BYTES=12*1024;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Entry {name:string;kind:string;text:string;available:boolean;mode?:string;turn?:number}
interface Snapshot {signature:string;scope:Row;entries:Entry[];served:Map<string,Set<number>>}
const caches=new WeakMap<KernelContext,Map<string,Snapshot>>();
const clip=(text:string,n:number)=>Array.from(text).slice(0,n).join('');

/** Pure membership selection: public labels/acquisition descriptions and committed public prose only. */
export function knowledgeEntries(evidence:Row,records:readonly Row[],meta:Row,turn:number):Entry[] {
    const line=string(meta.active_worldline||'main'),scope={worldline:line,loop:number(row(row(meta.worldlines)[line]).loop)};
    const clues=array(row(evidence.clues).discovered).map((value,index)=>{
        const clue=row(value),text=[clue.label,clue.how].filter(v=>typeof v==='string'&&v).join('\n');
        return {name:`Clue ${index+1}: ${clip(String(clue.label||'Acquired clue'),64)}`,kind:'clue',text,available:!!text};
    });
    const handouts=array(evidence.handouts).map((value,index)=>{
        const handout=row(value),text=typeof handout.text==='string'?handout.text:'';
        return {name:`Handout ${index+1}: ${clip(String(handout.name||'Revealed handout'),64)}`,kind:'handout',text,available:!!text};
    });
    const transcript=records.filter(record=>record.commit&&onLine(record,scope)&&number(record.turn)<turn)
        .sort((a,b)=>number(b.turn)-number(a.turn)).map(record=>{
            const text=record.rendered_text??record.text;
            return {name:`Turn ${number(record.turn)}: Keeper account`,kind:'transcript',turn:number(record.turn),mode:record.interaction_scope??'world',
                text:typeof text==='string'?text:'',available:typeof text==='string'&&!!text};
        });
    return [...clues,...handouts,...transcript];
}
export function knowledgePage(snapshot:Snapshot,params:Row):Row {
    const page=row(params.knowledge_page),offset=page.offset??0,limit=page.limit??(params.name?KNOWLEDGE_POINTS:KNOWLEDGE_ROWS);
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)
        throw new RpcError('invalid_params','Knowledge offset and limit must be nonnegative and positive integers');
    const scope=snapshot.scope;
    const refresh={focus:'knowledge'};
    if(params.name!==undefined&&(typeof params.name!=='string'||!params.name.trim()))throw new RpcError('invalid_params','Knowledge name must be a nonempty issued name');
    if((params.name||offset>0)&&!['turn','view','line','loop'].every(key=>row(page.context)[key]===scope[key]))return {status:'stale',refresh};
    const read=(name?:string,start=0,size=params.name?KNOWLEDGE_POINTS:KNOWLEDGE_ROWS)=>({focus:'knowledge',...(name?{name}:{}),knowledge_page:{offset:start,limit:size,context:scope}});
    if(!params.name){
        if(offset>snapshot.entries.length)throw new RpcError('invalid_params','Knowledge offset is past the catalogue');
        const end=Math.min(snapshot.entries.length,offset+Math.min(limit,KNOWLEDGE_ROWS));
        return {status:'catalogue',context:scope,offset,total:snapshot.entries.length,
            entries:snapshot.entries.slice(offset,end).map(entry=>({name:entry.name,kind:entry.kind,status:entry.available?'available':'unavailable',
                preview:clip(entry.text,160),...(entry.turn===undefined?{}:{turn:entry.turn,mode:entry.mode}),read:read(entry.name,0,KNOWLEDGE_POINTS)})),
            ...(end<snapshot.entries.length?{next:read(undefined,end,KNOWLEDGE_ROWS)}:{})};
    }
    const entry=snapshot.entries.find(entry=>normalize(entry.name)===normalize(params.name));
    if(!entry)return {status:'stale',refresh};
    if(!entry.available)return {status:'unavailable',name:entry.name,context:scope};
    const served=snapshot.served.get(entry.name)??new Set<number>();
    if(offset>0&&!served.has(offset))return {status:'stale',refresh:read(entry.name)};
    const points=Array.from(entry.text);
    if(offset>points.length)throw new RpcError('invalid_params','Knowledge offset is past the original body');
    const result=(count:number):Row=>({status:'original',name:entry.name,kind:entry.kind,context:scope,offset,
        text:points.slice(offset,offset+count).join(''),complete:offset+count>=points.length,
        ...(offset+count<points.length?{next:read(entry.name,offset+count,Math.min(limit,KNOWLEDGE_POINTS))}:{}),
        ...(entry.turn===undefined?{}:{turn:entry.turn,mode:entry.mode})});
    let low=0,high=Math.min(limit,KNOWLEDGE_POINTS,points.length-offset);
    while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(result(mid)))<=KNOWLEDGE_BYTES)low=mid;else high=mid-1;}
    served.add(offset+low);snapshot.served.set(entry.name,served);
    return result(low);
}
/** SnapshotReader owns file caching. This cache retains only public bodies and continuation state. */
export async function readKnowledge(context:KernelContext,params:Row):Promise<Row> {
    const campaign=await CampaignSnapshot.open(context,params.campaign),records=await campaign.turnRecords();
    const module=await loadCampaignModule(context,string(campaign.meta.module_id),campaign.world,campaign.id);
    const evidence=await publicKnowledge(module.graph,campaign.world,campaign.dir,records,campaign.turn);
    // Read only published player handouts; never the authored module body. Missing originals remain visible as gaps.
    evidence.handouts=await Promise.all(array(campaign.world.handouts_shown).filter(value=>typeof value==='string'&&value&&!/[\\/]/u.test(value)).map(async handle=>{
        const prior=array(evidence.handouts).find(value=>value.handout===handle);
        try {const file=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(join(campaign.dir,'handouts',`${handle}.md`)));
            return {name:handoutHeading(file),text:file.startsWith('# ')?file.split('\n').slice(1).join('\n').trim():file};
        }catch{return {name:prior?.name??null,text:prior?.text??''};}
    }));
    const entries=knowledgeEntries(evidence,records,campaign.meta,number(campaign.turn.turn));
    const active=string(campaign.meta.active_worldline||'main'),line=row(row(campaign.meta.worldlines)[active]);
    const base={turn:number(campaign.turn.turn),line:line.name??'Main',loop:number(line.loop)};
    const signature=hash([base,entries]);
    let cache=caches.get(context);if(!cache){cache=new Map();caches.set(context,cache);}
    const previous=cache.get(campaign.id);
    const current=previous?.signature===signature?previous:{signature,entries,scope:{...base,view:(previous?.scope.view??0)+1},served:new Map<string,Set<number>>()};
    cache.delete(campaign.id);cache.set(campaign.id,current);if(cache.size>8)cache.delete(cache.keys().next().value!);
    if((!previous||previous!==current)&&(params.name||number(row(params.knowledge_page).offset)>0))return {status:'stale',refresh:{focus:'knowledge'}};
    return knowledgePage(current,params);
}
