/** Observation records share location staging, NPC authority and the one game clock. */
import {randomUUID} from 'node:crypto';
import type {ApplyContext} from '../apply/index.js';
import {RpcError} from '../errors.js';
import {clockSection,npcNode,npcsPresent} from '../read/capsule.js';
import {currentObservationPoint,observationPoint,spatialPointKey,matchingObservationRelations,locationSituations} from '../read/location-observations.js';
import {array,clone,normalize,row,type Row} from '../read/values.js';
import {qualifiedLocationFeature} from '../read/locations.js';
import {isAmbiguity} from '../read/module-graph.js';

const unknownName=(error:unknown):boolean=>error instanceof RpcError&&error.code==='unknown_entity'&&error.details?.reason!=='ambiguous'&&!isAmbiguity(error);
/** §250: an unregistered feature or target is kept as a descriptive spot, reported on the receipt; ambiguity still refuses. */
function point(context:ApplyContext,value:Row,field:string,adjusted:Row[]=[]):Row {
    try{return observationPoint(context.graph,context.world,value);}
    catch(error){
        if(unknownName(error)&&value.at!==undefined){
            const {at,...rest}=value;
            try{const kept=observationPoint(context.graph,context.world,{...rest,spot:rest.spot??at});adjusted.push({field,reason:'unregistered_feature_as_spot',spot:kept.spot});return kept;}
            catch(failure){if(!unknownName(failure))throw failure;}
        }
        if(unknownName(error)&&value.place!==undefined&&value.place!=='here'&&!qualifiedLocationFeature(context.world,value.place)){
            const kept=observationPoint(context.graph,context.world,{place:'here',spot:value.spot??value.at??value.place,...(value.relation!==undefined?{relation:value.relation}:{})});
            adjusted.push({field,reason:'unregistered_target_as_spot',spot:kept.spot});return kept;
        }
        if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
        const reference=value.at===undefined&&value.spot===undefined&&error.details?.reason!=='ambiguous'&&!isAmbiguity(error)?qualifiedLocationFeature(context.world,value.place):undefined;
        throw new RpcError('invalid_params','The observation point needs its exact identity or minimal compatible definition',{
            fix:(reference?`This exact reference identifies a registered feature. Use the canonical spatial point ${JSON.stringify(reference)}; a direct observe command uses its place as to and its at as at. The feature needs no new definition. `:'')+
                'Use the intended exact place/feature. An at value must be a feature inside its place: add it with additions:[{name:place,features:[{name:at,description:...}]}], not as a child place. For ordinary observation, use view to describe the path from the actual current viewpoint; a door along that path is not the observer position. Missing registration is not a physical obstruction.',
            details:{...error.details,reason:'place_observation_point_unresolved',field,requested:value,...(reference?{reference:{kind:'feature',...reference}}:{}),current_viewpoint:currentObservationPoint(context.graph,context.world)}});
    }
}

export function stagePerceptualRelations(context:ApplyContext,state:Row,relations:Row[],adjusted:Row[]=[]):Row[] {
    const stored:Row[]=state.relations??=[];
    return relations.map((draft,index)=>{
        const from=point(context,draft.from,`relations[${index}].from`,adjusted),to=point(context,draft.to,`relations[${index}].to`,adjusted);
        const old=stored.find(relation=>spatialPointKey(relation.from)===spatialPointKey(from)&&spatialPointKey(relation.to)===spatialPointKey(to)&&relation.sense===draft.sense);
        if(old){
            if(old.description!==draft.description)adjusted.push({field:`relations[${index}]`,reason:'existing_relation_kept'});
            return old;
        }
        const relation={id:`relation-location-${randomUUID()}`,from,to,sense:draft.sense,description:draft.description,turn:context.turn.turn};
        stored.push(relation);return relation;
    });
}
export function stageLocationObservation(context:ApplyContext,state:Row,effect:Row,receipt:Row,adjusted:Row[]=[]):Row {
    const {graph,world,turn}=context,from=currentObservationPoint(graph,world),to=point(context,{place:effect.to,...Object.fromEntries(['at','spot','relation'].filter(key=>effect[key]!==undefined).map(key=>[key,effect[key]]))},'to',adjusted);
    let access=effect.access,reason=effect.reason;
    const scope=effect.scope??to.at??to.spot??graph.displayName(graph.scene(to.place));
    if(access==='blocked'&&(array(effect.facts).length||array(effect.people).length||array(effect.situations).length)){access='limited';adjusted.push({field:'access',reason:'blocked_with_facts_as_limited'});}
    if(access==='blocked'&&!reason)reason=scope;
    if(access!=='blocked'&&from.place!==to.place&&!matchingObservationRelations(world,from,to,effect.sense).length){
        // §250: the Keeper judged the target perceivable; an unrecorded sightline is recorded from its own words.
        stagePerceptualRelations(context,state,[{from,to,sense:effect.sense,description:effect.view??scope}],adjusted);
        if(!effect.view)adjusted.push({field:'view',reason:'relation_from_scope'});
    }
    const person=(name:string,field:string):Row|undefined=>{
        let node:Row;
        try{node=npcNode(graph,world,name);}catch(error){
            if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
            adjusted.push({field,reason:'unrecognized_person_dropped',person:name});return undefined;
        }
        if(!graph.isPerson(node)){adjusted.push({field,reason:'non_person_dropped',person:name});return undefined;}
        return {id:graph.survivorId(node.node_id),handle:graph.handle(node)};
    };
    const present=new Set(npcsPresent(graph,world,graph.scene(to.place)).map(node=>graph.survivorId(node.node_id)));
    const people:Row[]=[];
    for(const name of array(effect.people)){
        const perceived=person(name,'people');
        if(!perceived)continue;
        if(people.some(row=>row.id===perceived.id))continue;
        if(!present.has(perceived.id)){adjusted.push({field:'people',reason:'absent_person_dropped',person:perceived.handle});continue;}
        people.push(perceived);
    }
    const observed_clock=clockSection(graph,world),situations:Row[]=state.situations??=[],updates:Row[]=[];
    const drafts=new Map<string,Row>();
    for(const draft of array(effect.situations)){
        const name=normalize(draft.name);
        if(drafts.has(name))adjusted.push({field:'situations',reason:'repeated_situation_merged',situation:draft.name});
        drafts.set(name,draft);
    }
    for(const [name,draft] of drafts){
        const existing=locationSituations(world).find(situation=>spatialPointKey(row(situation.to))===spatialPointKey(to)&&normalize(situation.name)===name);
        const participants=draft.participants===undefined?clone(array(existing?.participants)):array(draft.participants).map(name=>person(name,'situations.participants')).filter(Boolean);
        const next={id:existing?.id??`situation-location-${randomUUID()}`,name:existing?.name??draft.name,to:clone(to),summary:draft.summary,status:draft.status,participants,
            assessed_clock:clone(observed_clock),turn:turn.turn,receipt:receipt.id};
        if(existing)Object.assign(existing,next);else situations.push(next);
        updates.push(clone(next));
    }
    const observation={from,to,sense:effect.sense,access,scope,facts:clone(access==='blocked'?[]:array(effect.facts)),
        ...(reason?{reason}:{}),people,situations:updates,observed_clock,turn:turn.turn,receipt:receipt.id};
    const observations:Row[]=state.observations??=[];
    const index=observations.findIndex(prior=>spatialPointKey(row(prior.to))===spatialPointKey(to)&&prior.sense===effect.sense);
    if(index<0)observations.push(observation);else observations[index]=observation;
    Object.assign(receipt,{place:to.place,observation:clone(observation)});
    return receipt;
}
