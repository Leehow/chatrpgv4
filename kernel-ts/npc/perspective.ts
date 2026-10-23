/** A person's directed reports and own words; relevance never grants another person's knowledge. */
import {jsonDigest} from '../json.js';
import {sameNode,type ModuleGraph} from '../read/module-graph.js';
import {memoryEvidenceView} from '../read/memory.js';
import {array,normalize,number,row,string,type Row} from '../read/values.js';
import {personalityView,personalitySourceRevision,sourceRelationships} from './material.js';
import {reunionView} from './reunion.js';
import {observedDocuments} from '../mods/document-visibility.js';
import {canonicalEvents,actorEventView} from '../turn-events.js';
import {remembersAcrossLoops} from '../read/worldline.js';
import {currentNpcMood, npcVariation} from './variation.js';
import {deriveCommittedSpeechSpans} from '../../runtime/jev/committed-speech-spans.ts';
import {promiseHasOrigin} from './communication.js';
import {npcReference} from './references.js';

function namesOf(graph:ModuleGraph,node:Row):Set<string>{
    return new Set(graph.nameKeys(node).map(normalize));
}
function current(value:Row,scope:Row):boolean {
    return value.superseded_by==null&&value.status!=='superseded'
        &&(value.worldline==null||scope.worldline==null||value.worldline===scope.worldline)
        &&(value.loop==null||scope.loop==null||number(value.loop)===number(scope.loop));
}
function report(value:Row):Row {
    return {kind:value.kind,statement:value.statement,turn:value.valid_from_turn??value.turn??null,
        state:value.state??'uncertain',status:value.status??'candidate',...memoryEvidenceView(value)};
}
export function npcRelationships(graph:ModuleGraph,node:Row,memory:Row[],scope:Row={}):Row[]{
    const names=namesOf(graph,node),groups=new Map<string,Row[]>();
    const rows=memory.filter(value=>current(value,scope)&&value.kind==='relationship'&&names.has(normalize(string(value.subject)))
        &&array(value.entities).length===1&&typeof value.statement==='string')
        .sort((a,b)=>number(b.valid_from_turn??b.turn)-number(a.valid_from_turn??a.turn));
    for(const value of rows){
        const target=string(value.entities[0]);if(!target)continue;
        const evidence=groups.get(target)??[];
        if(evidence.length<4)evidence.push(report(value));
        groups.set(target,evidence);
    }
    return [...groups].map(([toward,evidence])=>({toward,evidence})).slice(0,6);
}
export function npcRecentSpeech(graph:ModuleGraph,node:Row,records:Row[],scope:Row={}):Row[]{
    const handle=graph.handle(node),name=graph.displayName(node);
    return records.filter(record=>Boolean(record.commit)&&current(record,scope)).sort((a,b)=>number(a.turn)-number(b.turn))
        .flatMap(record=>array(record.speech).filter(line=>row(line.who).npc===handle&&typeof line.text==='string').map(line=>({
            statement:line.text,turn:record.turn,authority:'conversation_report',attribution:{kind:'speech',speaker:{kind:'npc',name}}
        }))).slice(-6);
}
/** Exact prior public staging is continuity evidence, never current state or an inferred identity. */
export function npcPublicRendering(graph:ModuleGraph,node:Row,records:Row[],scope:Row={}):Row|null {
    const handle=graph.handle(node),scene=scope.scene;
    const sceneNode=typeof scene==='string'?graph.find(scene,['scene']):null;
    const atScene=(record:Row)=>{const closed=row(row(record.world).scene).name??row(record.world).active_scene;
        return typeof closed==='string'&&(sceneNode?sameNode(graph,closed,sceneNode):closed===scene);};
    if(typeof scene!=='string'||!scene)return null;
    const record=records.filter(record=>record.commit&&current(record,scope)
        &&record.closed_how!=='stranded'&&(!record.interaction_scope||record.interaction_scope==='world')
        &&(scope.turn==null||number(record.turn)<number(scope.turn))
        &&atScene(record)
        &&!array(record.receipts).some(receipt=>['move','npc'].includes(row(receipt).kind))
        &&typeof record.rendered_text==='string'&&record.rendered_text.trim()
        &&array(record.speech).length>0&&array(record.speech).every(line=>row(line.who).npc===handle))
        .sort((a,b)=>number(b.turn)-number(a.turn))[0];
    if(!record)return null;
    const speech=deriveCommittedSpeechSpans({markedText:record.marked_text,renderedText:record.rendered_text,speech:record.speech});
    if(speech.status!=='verified')return null;
    let cursor=0;const parts:string[]=[];
    for(const span of speech.spans){parts.push(record.rendered_text.slice(cursor,span.start));cursor=span.end;}
    parts.push(record.rendered_text.slice(cursor));
    const narration=parts.join('').trim();if(!narration)return null;
    const text=Array.from(narration).slice(0,1200).join('');
    return {turn:record.turn,scene,text,...(text.length<narration.length?{truncated:true}:{}),
        authority:'Past public rendering only; not current action, presence, physical state or selected response content'};
}
/**
 * The promises a person holds: their own (the obligor is the promise's subject) and those made to them that they heard (they
 * are an entity and a knower), which stay attributed to their maker. §258.5: a bystander who only heard it holds nothing, and
 * a person's own promise from a turn whose communication shows them voicing nothing has no origin and is not issued.
 */
export function npcCommitments(graph:ModuleGraph,node:Row,memory:Row[],scope:Row={},origin?:{records:Row[];ref?:string}):Row[]{
    const names=namesOf(graph,node),named=(values:unknown)=>array(values).some(name=>names.has(normalize(string(name))));
    return memory.filter(value=>current(value,scope)&&value.kind==='promise'&&(names.has(normalize(string(value.subject)))
        ?!origin||promiseHasOrigin(origin.records,origin.ref,value.valid_from_turn??value.turn,scope)
        :named(value.entities)&&named(value.knowers)))
        .sort((a,b)=>number(b.valid_from_turn??b.turn)-number(a.valid_from_turn??a.turn))
        .map(value=>({subject:value.subject,entities:array(value.entities),...report(value)}));
}
export function npcPerspective(graph:ModuleGraph,world:Row,node:Row,memory:Row[],records:Row[],scope:Row,ledger:Row={}):Row {
    const names=namesOf(graph,node),profile=graph.npcProfile(node);
    const reports=memory.filter(value=>current(value,scope)&&['knowledge','belief'].includes(value.kind)
        &&array(value.knowers).some(name=>names.has(normalize(string(name))))&&typeof value.statement==='string')
        .sort((a,b)=>number(b.valid_from_turn??b.turn)-number(a.valid_from_turn??a.turn)).map(report);
    const commitments=npcCommitments(graph,node,memory,scope,{records,ref:npcReference(graph,world,node)});
    const semantic=actorEventView(canonicalEvents(records,array(scope.current_receipts),scope),graph.nameKeys(node),
        {...scope,across_loops:remembersAcrossLoops(graph,node)});
    const documents=observedDocuments(world,string(node.node_id));
    const now=currentNpcMood(graph,world,node,ledger,array(scope.current_receipts)),variation=npcVariation(graph,world,node,now);
    const view={name:graph.displayName(node),personality:personalityView(graph,world,node),
        ...(now?{now}:{}),...(variation?{variation}:{}),
        goals:profile.agenda??null,fears:profile.fear??null,
        authored_knowledge:[...graph.npcKnows(node).map(item=>({name:item.handle,statement:item.node.summary||item.node.name,authority:'source_authored'})),
            ...graph.authoredLines(node,'knowledge').map(statement=>({statement,authority:'source_authored'}))],
        authored_beliefs:graph.npcBeliefs(node),knowledge_reports:reports.slice(0,12),
        ...(documents.length?{observed_documents:documents}:{}),
        commitments:commitments.slice(0,12),
        coverage:{...semantic.coverage,knowledge_reports_omitted:Math.max(0,reports.length-12),commitments_omitted:Math.max(0,commitments.length-12),relationship_view:'bounded; use ordinary recall for older evidence',speech_view:'last six committed own utterances'},
        ...(sourceRelationships(graph,node).length ? {source_relationships:sourceRelationships(graph,node)} : {}),
        cognition:semantic.cognition,relationships:[...array(semantic.relationships).reverse(),...npcRelationships(graph,node,memory,scope)],recent_speech:npcRecentSpeech(graph,node,records,scope),
        reunion:reunionView(graph,world,node,records,{worldline:scope.worldline,loop:scope.loop}),
        note:'Only this person\'s authored material and explicitly attributed reports are supplied. A report or prior utterance is not established world truth. Missing information remains unknown.'};
    return {view,revision:jsonDigest({scope,source:personalitySourceRevision(graph,node),view})};
}
