/** §180.20: explicit reviewed missing-field upgrades; no prose inference or model calls. */
import {join} from 'node:path';
import {RpcError} from '../errors.js';
import {isJsonObject, jsonDigest} from '../json.js';
import {withExclusiveLock} from '../locks.js';
import {ModuleGraph, recordOf} from '../read/module-graph.js';
import {readPublishedGraph} from '../read/published-graph.js';
import {array, clone, equal, integer, row, string, type Row} from '../read/values.js';
import {weaknessRefusals} from './being-shape.js';
import {validSemanticId} from './contract.js';
import {ModuleStore, validateModuleId} from './store.js';

const SHA=/^[a-f0-9]{64}$/;
const nonempty=(value:any):boolean=>typeof value==='string'&&value.trim().length>0;
const invalid=(message:string,reason='source_upgrade_invalid'):never=>{throw new RpcError('invalid_params',message,{details:{reason}});};
function closed(value:any,keys:string[],label:string):Row {
    if(!isJsonObject(value)||Object.keys(value).some(key=>!keys.includes(key)))return invalid(`${label} has unsupported fields`);
    return value;
}
function pointer(node:Row,path:any):any {
    if(typeof path!=='string'||!path.startsWith('/')||!/^\/(properties\/|summary$)/.test(path))return invalid('Evidence must cite an existing source property or summary');
    let value:any=node;
    for(const key of path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'))) {
        if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return invalid('The cited source field no longer exists','source_upgrade_evidence_changed');
        value=value[key];
    }
    return value;
}
const hasWeaknesses=(node:Row)=>Object.hasOwn(row(node.properties),'weaknesses')||Object.hasOwn(recordOf(node),'weaknesses');
function unassessed(graph:Row):Row[] {
    return array(graph.nodes).filter(node=>['npc','creature'].includes(node.node_kind)&&!node.campaign_origin&&!hasWeaknesses(node))
        .map(node=>({actor_id:node.node_id,source_refs:clone(array(node.source_refs)),state:'source_extraction_required'}));
}
function checkedArtifact(input:any):Row {
    const artifact=closed(input,['version','id','base_graph_digest','review','entries'],'Upgrade');
    if(artifact.version!==1||!validSemanticId(artifact.id)||!SHA.test(string(artifact.base_graph_digest)))return invalid('Upgrade needs version 1, a semantic id and exact base_graph_digest');
    const review=closed(artifact.review,['method','source','reason'],'Review');
    if(review.method!=='source-fragment-review'||!nonempty(review.source)||!nonempty(review.reason))return invalid('Upgrade requires a recorded original-source fragment review');
    if(!Array.isArray(artifact.entries)||!artifact.entries.length)return invalid('Upgrade needs reviewed actor entries');
    return artifact;
}
/** Pure candidate/preview; an exact source witness is required even for a preserved manual field. */
export function previewSourceUpgrade(meta:Row,graph:Row,input:any,law:Row):{report:Row;graph:Row;artifact:Row|null} {
    const base={module_id:meta.id,generation:meta.generation,graph_digest:meta.graph_digest};
    if(input==null)return {artifact:null,graph,report:{...base,state:'source_extraction_required',additions:[],preserved:[],unassessed:unassessed(graph)}};
    const artifact=checkedArtifact(input),digest=jsonDigest(artifact),prior=array(meta.source_fact_upgrades).find(item=>item.id===artifact.id);
    if(prior) {
        if(prior.artifact_digest!==digest)return invalid('An applied upgrade id cannot name different bytes','source_upgrade_id_conflict');
        return {artifact,graph,report:{...base,state:'already_applied',artifact_digest:digest,record:clone(prior),additions:[],preserved:[],unassessed:unassessed(graph)}};
    }
    if(artifact.base_graph_digest!==meta.graph_digest)throw new RpcError('needs','The source graph changed; review this exact generation before upgrading',
        {details:{reason:'source_upgrade_base_changed',expected:artifact.base_graph_digest,actual:meta.graph_digest}});
    const candidate=clone(graph),view=new ModuleGraph(string(meta.id),candidate,string(meta.graph_digest),{}),seen=new Set<string>(),additions:Row[]=[],preserved:Row[]=[];
    for(const raw of artifact.entries) {
        const entry=closed(raw,['actor_id','weaknesses','source_refs','evidence'],'Entry'),actor=view.nodes.get(string(entry.actor_id));
        if(!actor||!array(law.on_kinds).includes(actor.node_kind)||actor.campaign_origin||seen.has(string(entry.actor_id)))return invalid('Each reviewed entry must name one existing source actor');
        seen.add(string(entry.actor_id));
        if(!Array.isArray(entry.weaknesses)||!Array.isArray(entry.evidence)||!entry.evidence.length||!Array.isArray(entry.source_refs)||!entry.source_refs.length)return invalid('Entry needs weakness entries, citations and exact source evidence');
        const witnesses:Row[]=[];
        for(const rawEvidence of entry.evidence) {
            const evidence=closed(rawEvidence,['node_id','path','value'],'Evidence'),node=view.nodes.get(string(evidence.node_id));
            if(!node||node.campaign_origin||!array(node.source_refs).length||!Object.hasOwn(evidence,'value')||!equal(pointer(node,evidence.path),evidence.value))return invalid('Source evidence differs from the reviewed field','source_upgrade_evidence_changed');
            witnesses.push(...array(node.source_refs));
        }
        for(const ref of entry.source_refs) {
            closed(ref,['source_id','pdf_index','box'],'Citation');
            if(!nonempty(ref.source_id)||!integer(ref.pdf_index)||ref.pdf_index<0||!witnesses.some(w=>w.source_id===ref.source_id&&w.pdf_index===ref.pdf_index&&(!ref.box||equal(ref.box,w.box))))return invalid('Upgrade citations must match the existing source evidence');
        }
        if(hasWeaknesses(actor)) {preserved.push({actor_id:actor.node_id,reason:'existing_field_preserved'});continue;}
        actor.properties={...row(actor.properties),weaknesses:clone(entry.weaknesses)};
        candidate.field_spans={...row(candidate.field_spans),[`/nodes/${actor.node_id}/properties/weaknesses`]:clone(entry.source_refs)};
        additions.push({actor_id:actor.node_id,weaknesses:clone(entry.weaknesses),source_refs:clone(entry.source_refs)});
    }
    const refusals=weaknessRefusals(view,law);
    if(refusals.length)throw new RpcError('invalid_params','Source weakness upgrade violates the existing entry law',{details:{reason:'source_upgrade_weaknesses_invalid',refusals}});
    return {artifact,graph:candidate,report:{...base,state:'preview',artifact_digest:digest,
        revision:jsonDigest({...base,artifact_digest:digest}),additions,preserved,unassessed:unassessed(candidate)}};
}
export function assertSourceUpgradeRevision(report:Row,revision:any):void {
    if(report.state==='already_applied')return;
    if(report.state!=='preview'||revision!==report.revision)throw new RpcError('needs',
        'Apply needs the exact current source-upgrade preview revision',
        {details:{reason:'source_upgrade_preview_required',preview:report}});
}
export async function sourceUpgrade(store:ModuleStore,params:Row):Promise<Row> {
    const id=validateModuleId(params.module_id),action=params.action??'preview';
    if(!['preview','apply'].includes(action))return invalid('action must be preview or apply');
    return withExclusiveLock(store.context.locks,join(store.moduleDir(id),'.metadata.lock'),async()=>{
        const meta=await store.module(id),graph=await store.readGraph(id);
        if(!graph)throw new RpcError('needs','This source has no published graph to upgrade');
        let input=params.upgrade;
        if(input===undefined) {
            const root=join(store.context.content,'starters',id);
            const exact=join(root,'weaknesses-upgrades',`${meta.graph_digest}.json`);
            const path=await store.context.snapshots.pathExists(exact)?exact:join(root,'weaknesses-upgrade.json');
            if(await store.context.snapshots.pathExists(path))input=await store.context.snapshots.readJson(path);
        }
        const preview=previewSourceUpgrade(meta,graph,input,row((await store.contract()).graph.actor_weaknesses));
        if(action==='preview'||preview.report.state==='already_applied')return preview.report;
        assertSourceUpgradeRevision(preview.report,params.revision);
        if(!preview.artifact)return invalid('Apply requires a reviewed upgrade artifact');
        const record={id:preview.artifact.id,version:1,artifact_digest:preview.report.artifact_digest,
            base_generation:meta.generation,base_graph_digest:meta.graph_digest,result_generation:Number(meta.generation)+1,
            review:clone(preview.artifact.review),entries:clone(preview.artifact.entries)};
        if(meta.source==='starter')meta.starter_graph_digest??=meta.graph_digest;
        meta.vocabulary={...row(meta.vocabulary),actor_weaknesses:{source:'module-source',version:1}};
        meta.source_fact_upgrades=[...array(meta.source_fact_upgrades),record];
        preview.graph.source_fact_upgrades=[...array(preview.graph.source_fact_upgrades),clone(record)];
        await store.writeGraph(meta,preview.graph);
        await readPublishedGraph(store.context,join(store.moduleDir(id),string(meta.graph_file)),meta,id);
        await store.writeModule(meta);
        return {...preview.report,state:'applied',generation:meta.generation,graph_digest:meta.graph_digest,record};
    });
}
