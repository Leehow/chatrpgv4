/** One projection of executed transitions, shared by apply and frozen final preparation. */
import type {ModuleGraph} from '../read/module-graph.js';
import {sceneLabel} from '../read/capsule.js';
import {npcReference} from '../npc/references.js';
import {string,type Row} from '../read/values.js';

export function operationOutcomes(receipts:Row[],graph:ModuleGraph,world:Row):Row[] {
    const place=(value:unknown)=>value==null?null:typeof value==='string'&&value!=='away'?sceneLabel(graph,world,graph.scene(value)):value;
    return receipts.flatMap(receipt=>{
        const kind=string(receipt.kind);
        if(!['move','npc','time'].includes(kind)||kind==='npc'&&typeof receipt.to!=='string')return [];
        const person=kind==='npc'?graph.actor(receipt.handle):undefined;
        return [{kind,status:receipt.unchanged===true||receipt.renamed===true||kind==='move'&&receipt.from===receipt.to?'unchanged':'changed',
            ...(kind==='move'?{from:receipt.from_label??place(receipt.from),to:receipt.to_label??place(receipt.to),minutes:receipt.minutes}:{}),
            ...(kind==='npc'?{actor:(person&&npcReference(graph,world,person))||receipt.label||receipt.name,from:place(receipt.from),to:place(receipt.to)}:{}),
            ...(kind==='time'?{minutes:receipt.minutes,...(receipt.band!==undefined?{band:receipt.band}:{})}:{}),}];
    });
}
