/** One projection of executed transitions, shared by apply and frozen final preparation. */
import type {ModuleGraph} from '../read/module-graph.js';
import {sceneLabel} from '../read/capsule.js';
import {npcReference} from '../npc/references.js';
import {string,clone,type Row} from '../read/values.js';
import {publicObservation} from '../read/location-observations.js';

/** §250: the kernel's deterministic repairs of a location command, as compact field: reason lines for the Keeper. */
const adjusted=(receipt:Row):Row=>Array.isArray(receipt.adjusted)&&receipt.adjusted.length
    ?{adjusted:receipt.adjusted.map((row:Row)=>`${String(row.field)}: ${String(row.reason)}`)}:{};
export function operationOutcomes(receipts:Row[],graph:ModuleGraph,world:Row):Row[] {
    const place=(value:unknown)=>value==null?null:typeof value==='string'&&value!=='away'?sceneLabel(graph,world,graph.scene(value)):value;
    const owner=(id:unknown,label:unknown)=>{
        const person=typeof id==='string'?graph.actor(id):null;
        return person?npcReference(graph,world,person):label??null;
    };
    return receipts.flatMap<Row>(receipt=>{
        const kind=string(receipt.kind);
        if(receipt.visibility==='keeper')return [];
        if(kind==='cash')return [{kind,status:receipt.settlement==='quote'?'unchanged':'changed',
            transaction:receipt.settlement==='quote'?'quoted':receipt.settlement==='cancelled'?'cancelled':'settled',
            ...Object.fromEntries(['settlement','category','currency','before','after','purchase_amount','items','quote'].filter(key=>receipt[key]!==undefined).map(key=>[key,clone(receipt[key])])),
            ...(receipt.purpose??receipt.why?{purpose:receipt.purpose??receipt.why}:{}),
            ...(receipt.price_name?{name:receipt.price_name}:{}),
            subject:receipt.subject_label??receipt.subject??null,
            ...(receipt.with_label??receipt.with?{with:receipt.with_label??receipt.with}:{})}];
        if(kind==='place')return [{kind,status:'changed',action:receipt.action,...(receipt.place?{place:receipt.place}:{}),
            ...(receipt.observation?{observation:publicObservation(graph,world,receipt.observation)}:{}),
            ...(receipt.position?{position:receipt.position}:{}),...(receipt.feature?{feature:receipt.feature,state:receipt.after}:{}),
            ...(receipt.added?.length?{added:receipt.added}:{}),...(receipt.features?.length?{features:receipt.features}:{}),...adjusted(receipt)}];
        if(kind==='item'&&typeof receipt.instance!=='string'&&receipt.quantity!==undefined)return [{kind,status:'changed',
            name:receipt.label??receipt.name,from:owner(receipt.from_id,receipt.from_label??receipt.from),to:receipt.subject_label??receipt.subject,
            quantity:receipt.quantity,before:receipt.before,after:receipt.after,...(receipt.why?{purpose:receipt.why}:{})}];
        if(kind==='item'&&typeof receipt.instance==='string')return [{kind,status:receipt.offer==='made'||receipt.offer==='declined'?'unchanged':'changed',
            name:receipt.label??receipt.name,from:owner(receipt.from_id,receipt.from_label??receipt.from),to:owner(receipt.subject,receipt.subject_label),
            quantity:receipt.quantity,...(receipt.offer?{offer:receipt.offer}:{})}];
        if(!['move','npc','time'].includes(kind)||kind==='npc'&&typeof receipt.to!=='string')return [];
        const person=kind==='npc'?graph.actor(receipt.handle):undefined;
        return [{kind,status:receipt.unchanged===true||receipt.renamed===true||kind==='move'&&receipt.from===receipt.to?'unchanged':'changed',
            ...(kind==='move'?{from:receipt.from_label??place(receipt.from),to:receipt.to_label??place(receipt.to),minutes:receipt.minutes,...(receipt.position?{position:receipt.position}:{}),...adjusted(receipt)}:{}),
            ...(kind==='npc'?{actor:(person&&npcReference(graph,world,person))||receipt.label||receipt.name,from:place(receipt.from),to:place(receipt.to)}:{}),
            ...(kind==='time'?{minutes:receipt.minutes,...(receipt.band!==undefined?{band:receipt.band}:{})}:{}),}];
    });
}
