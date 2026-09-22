/** Core character material: source evidence stays authoritative and supplements survive Mod changes. */
import {jsonDigest} from '../json.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {row,string,type Row} from '../read/values.js';

export function personalitySources(graph:ModuleGraph,node:Row):Row[] {
    const profile=graph.npcProfile(node),properties=row(node.properties);
    const fields:Row={summary:node.summary,personality:properties.personality,biography:properties.biography,...profile};
    return Object.entries(fields).flatMap(([field,value])=>typeof value==='string'&&value.trim()
        ?[{field,text:value}]:Array.isArray(value)&&value.every(line=>typeof line==='string')?[{field,text:value.join('\n')}]:[])
        .map((value,index)=>({alias:`source:${index+1}`,...value}));
}
export function personalitySourceRevision(graph:ModuleGraph,node:Row):string {
    return jsonDigest({name:graph.displayName(node),sources:personalitySources(graph,node)});
}
export function personalityView(graph:ModuleGraph,world:Row,node:Row):Row|null {
    const authored=row(node.properties).personality;
    if(typeof authored==='string'&&authored.trim())return {description:authored,origin:'source_authored'};
    const value=row(row(row(world.npc_character)[string(node.node_id)]).personality);
    if(typeof value.description!=='string'||!value.description.trim())return null;
    return {description:value.description,origin:'table_supplement',
        ...(value.source_revision!==personalitySourceRevision(graph,node)?{source_changed:true}: {})};
}
