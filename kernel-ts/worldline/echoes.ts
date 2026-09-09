/** Echoes are deterministic projections of retained receipts, never prose inference. */
import {isJsonObject,parsePythonJson} from '../json.js';
import {array,row,integer,number,string,sorted,type Row} from '../read/values.js';
import {nowIso} from '../write/store.js';
import {blob,tree,type WorldlineContext} from './history.js';
export async function readEchoes(context:WorldlineContext):Promise<Row[]>{try{const raw=await context.campaign.readSave('worldlines/echoes.json');return array(isJsonObject(raw)?raw.echoes:raw).filter(isJsonObject);}catch{return [];}}
export const writeEchoes=(context:WorldlineContext,echoes:Row[])=>context.campaign.writeSave('worldlines/echoes.json',{schema:1,echoes,written_at:nowIso()});
export function mergeEchoes(existing:Row[],fresh:Row[]):Row[]{const byId=new Map([...existing,...fresh].map(value=>[string(value.id),value]));return sorted(byId.keys()).map(key=>byId.get(key)!);}
function echoOf(receipt:Row,where:string):[string,string,string,string[]]|null{
    const kind=string(receipt.kind||'');
    if(kind==='move')return ['move',string(receipt.to||where),`They came here from ${string(receipt.from||'elsewhere')}.`,[]];
    if(kind==='clue'){const source=receipt.from;return ['clue_taken',string(receipt.scene||where),`They found ${string(receipt.label||receipt.clue||'')} here.${source?' '+string(source)+' gave it to them.':''}`,source?[string(source)]:[]];}
    if(kind==='handout')return ['handout',where,`They were shown ${string(receipt.label||receipt.name||receipt.handout||'')} here.`,[]];
    if(kind==='session'&&receipt.family==='combat')return ['fight',where,'A fight broke out here.',[]];
    if(kind==='npc'){const name=string(receipt.name||receipt.handle||'');return typeof receipt.to==='string'&&receipt.to&&receipt.to!=='away'&&name?['presence',receipt.to,`${name} was here.`,[name]]:null;}
    if(kind==='delta'&&receipt.resource==='hp'&&(integer(receipt.after)||typeof receipt.after==='boolean')&&number(receipt.after)<=0){const who=string(receipt.subject_label||receipt.subject||'Someone');return ['death',where,`${who} died here.`,[who]];}
    return null;
}
export function echoesFromRecord(record:Row,line:string,loop:number):Row[]{
    if(!integer(record.turn)&&typeof record.turn!=='boolean')return [];
    const where=string(row(row(record.world).scene).name||''),rows:Row[]=[];
    for(const receipt of array(record.receipts).filter(isJsonObject)){const made=echoOf(receipt,where);if(!made)continue;const [kind,scene,summary,entities]=made;rows.push({id:`echo:${line}-t${string(record.turn)}-${rows.length+1}`,line,loop,turn:record.turn,scene,kind,summary,receipts:[string(receipt.id)],entities});}
    return rows;
}
export async function generateEchoes(context:WorldlineContext,line:string,loop:number):Promise<Row[]>{
    const rows:Row[]=[];for(const path of await tree(context,`wl/${line}`,'turns/')){const raw=await blob(context,`wl/${line}`,path);if(raw==null)continue;try{const record=parsePythonJson(raw);if(isJsonObject(record))rows.push(...echoesFromRecord(record,line,loop));}catch{}}
    return rows;
}
