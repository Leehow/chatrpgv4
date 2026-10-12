/** Core character material: source evidence stays authoritative and supplements survive Mod changes. */
import {jsonDigest} from '../json.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {row,string,type Row} from '../read/values.js';
import {moduleCharacterProfile, profileSourceRevision} from './profile.js';

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
    const value=row(row(row(world.npc_character)[string(node.node_id)]).personality);
    if (value.origin === 'module_derived' && value.profile) return {
        ...(typeof authored === 'string' && authored.trim() ? {description: authored} : {}),
        profile: value.profile, origin: 'module_derived',
        ...(value.source_revision !== profileSourceRevision(graph.raw, node) ? {source_changed: true} : {}),
        note: 'Derived character guidance, not source truth or a knowledge grant. Source facts and current relationships govern; motives need not be spoken.'};
    if (!value.description) {
        const profile = moduleCharacterProfile(graph, node);
        if (profile) return {...(typeof authored==='string'&&authored.trim()?{description:authored}:{}),profile: profile.profile, origin: 'module_derived',
            note: 'Derived character guidance, not source truth or a knowledge grant. Current relationships govern; motives need not be spoken.'};
    }
    if(typeof authored==='string'&&authored.trim())return {description:authored,origin:'source_authored'};
    if(typeof value.description!=='string'||!value.description.trim())return null;
    return {description:value.description,origin:'table_supplement',
        ...(value.source_revision!==personalitySourceRevision(graph,node)?{source_changed:true}: {})};
}

/** Initial source ties remain directed and separate from played relationship evidence. */
export function sourceRelationships(graph: ModuleGraph, node: Row): Row[] {
    const kinds = graph.dossier.tie_relation_kinds ?? [];
    return (graph.raw.relations ?? []).filter((r: Row) => r.from_node_id === node.node_id && !r.campaign_origin && kinds.includes(r.relation_kind))
        .flatMap((r: Row) => {
            const target = graph.nodes.get(r.to_node_id), claim = (graph.raw.claims ?? []).find((c: Row) => c.claim_id === r.claim_id);
            if (claim?.known_by_ids?.length && !claim.known_by_ids.includes(node.node_id)) return [];
            return target ? [{subject: graph.displayName(node), kind: r.relation_kind, toward: graph.displayName(target), authority: 'source_authored',
                ...(claim?.truth_status ? {truth_status: claim.truth_status} : {}),
                ...(claim?.validity ? {validity: claim.validity} : {}),
                note: 'Initial attributed source relation, not played trust or automatic world truth.'}] : [];
        }).slice(0, 6);
}
