/** A person's directed reports and own words; relevance never grants another person's knowledge. */
import {jsonDigest} from '../json.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {memoryEvidenceView} from '../read/memory.js';
import {array,normalize,number,row,string,type Row} from '../read/values.js';
import {personalityView,personalitySourceRevision} from './material.js';
import {reunionView} from './reunion.js';

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
export function npcCommitments(graph:ModuleGraph,node:Row,memory:Row[],scope:Row={}):Row[]{
    const names=namesOf(graph,node);
    return memory.filter(value=>current(value,scope)&&value.kind==='promise'
        &&(names.has(normalize(string(value.subject)))||array(value.knowers).some(name=>names.has(normalize(string(name))))))
        .sort((a,b)=>number(b.valid_from_turn??b.turn)-number(a.valid_from_turn??a.turn))
        .map(value=>({subject:value.subject,entities:array(value.entities),...report(value)}));
}
export function npcPerspective(graph:ModuleGraph,world:Row,node:Row,memory:Row[],records:Row[],scope:Row):Row {
    const names=namesOf(graph,node),profile=graph.npcProfile(node);
    const reports=memory.filter(value=>current(value,scope)&&['knowledge','belief'].includes(value.kind)
        &&array(value.knowers).some(name=>names.has(normalize(string(name))))&&typeof value.statement==='string')
        .sort((a,b)=>number(b.valid_from_turn??b.turn)-number(a.valid_from_turn??a.turn)).map(report);
    const commitments=npcCommitments(graph,node,memory,scope);
    const view={name:graph.displayName(node),personality:personalityView(graph,world,node),
        goals:profile.agenda??null,fears:profile.fear??null,
        authored_knowledge:[...graph.npcKnows(node).map(item=>({name:item.handle,statement:item.node.summary||item.node.name,authority:'source_authored'})),
            ...graph.authoredLines(node,'knowledge').map(statement=>({statement,authority:'source_authored'}))],
        authored_beliefs:graph.npcBeliefs(node),knowledge_reports:reports.slice(0,12),
        commitments:commitments.slice(0,12),
        coverage:{knowledge_reports_omitted:Math.max(0,reports.length-12),commitments_omitted:Math.max(0,commitments.length-12),relationship_view:'bounded; use ordinary recall for older evidence',speech_view:'last six committed own utterances'},
        relationships:npcRelationships(graph,node,memory,scope),recent_speech:npcRecentSpeech(graph,node,records,scope),
        reunion:reunionView(graph,world,node,records,scope),
        note:'Only this person\'s authored material and explicitly attributed reports are supplied. A report or prior utterance is not established world truth. Missing information remains unknown.'};
    return {view,revision:jsonDigest({scope,source:personalitySourceRevision(graph,node),view})};
}
