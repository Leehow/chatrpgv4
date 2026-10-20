/** Observation records share location staging, NPC authority and the one game clock. */
import {randomUUID} from 'node:crypto';
import type {ApplyContext} from '../apply/index.js';
import {RpcError} from '../errors.js';
import {clockSection,npcNode,npcsPresent} from '../read/capsule.js';
import {currentObservationPoint,observationPoint,spatialPointKey,matchingObservationRelations,locationSituations} from '../read/location-observations.js';
import {array,clone,normalize,row,type Row} from '../read/values.js';

function point(context:ApplyContext,value:Row,field:string):Row {
    try{return observationPoint(context.graph,context.world,value);}
    catch(error){
        if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
        throw new RpcError('invalid_params','The observation point needs its exact identity or minimal compatible definition',{
            fix:'Use the intended exact place/feature. An at value must be a feature inside its place: add it with additions:[{name:place,features:[{name:at,description:...}]}], not as a child place. For ordinary observation, use view to describe the path from the actual current viewpoint; a door along that path is not the observer position. Missing registration is not a physical obstruction.',
            details:{...error.details,reason:'place_observation_point_unresolved',field,requested:value,current_viewpoint:currentObservationPoint(context.graph,context.world)}});
    }
}

export function stagePerceptualRelations(context:ApplyContext,state:Row,relations:Row[]):Row[] {
    const stored:Row[]=state.relations??=[];
    return relations.map((draft,index)=>{
        const from=point(context,draft.from,`relations[${index}].from`),to=point(context,draft.to,`relations[${index}].to`);
        const old=stored.find(relation=>spatialPointKey(relation.from)===spatialPointKey(from)&&spatialPointKey(relation.to)===spatialPointKey(to)&&relation.sense===draft.sense);
        if(old){
            if(old.description!==draft.description)throw new RpcError('invalid_params','A known perceptual relation cannot be structurally redefined',{
                fix:'Reuse the established relation and judge its current feature state. Add another genuinely different viewpoint or target instead.',details:{reason:'place_relation_redefinition',from,to,sense:draft.sense}});
            return old;
        }
        const relation={id:`relation-location-${randomUUID()}`,from,to,sense:draft.sense,description:draft.description,turn:context.turn.turn};
        stored.push(relation);return relation;
    });
}
export function stageLocationObservation(context:ApplyContext,state:Row,effect:Row,receipt:Row):Row {
    const {graph,world,turn}=context,from=currentObservationPoint(graph,world),to=point(context,{place:effect.to,...(effect.at?{at:effect.at}:{})},'to');
    if(effect.access==='blocked'){
        if(!effect.reason||array(effect.facts).length||array(effect.people).length||array(effect.situations).length)
            throw new RpcError('invalid_params','A blocked observation needs a concrete reason and no target facts, people or incident updates',{
                details:{reason:'place_observation_blocked_shape'}});
    }else{
        if(!array(effect.facts).length)throw new RpcError('invalid_params','A successful observation needs at least one actual perceived fact');
        if(from.place!==to.place&&!matchingObservationRelations(world,from,to,effect.sense).length&&effect.view)
            stagePerceptualRelations(context,state,[{from,to,sense:effect.sense,description:effect.view}]);
        if(from.place!==to.place&&!matchingObservationRelations(world,from,to,effect.sense).length)
            throw new RpcError('invalid_params','This cross-place observation needs its logical sensory relation',{
                fix:'Preserve the actual current viewpoint. Supply view describing the compatible sensory path to this target; the host fills its endpoints. Use additions for missing target definitions. Explicit relations are also supported. Use access blocked only for a real obstruction, never missing registration.',
                details:{reason:'place_observation_relation_required',from,to,sense:effect.sense}});
    }
    const person=(name:string)=>{
        let node:Row;
        try{node=npcNode(graph,world,name);}catch(error){
            if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
            throw new RpcError('invalid_params','An observed participant needs an existing canonical identity',{
                fix:'Inspect the actual target people and reuse their names or references. An observation does not create a person.',
                details:{...error.details,reason:'place_observation_person_unresolved',person:name}});
        }
        if(!graph.isPerson(node))throw new RpcError('invalid_params','Observation participants must be real existing people');
        return {id:graph.survivorId(node.node_id),handle:graph.handle(node)};
    };
    const present=new Set(npcsPresent(graph,world,graph.scene(to.place)).map(node=>graph.survivorId(node.node_id)));
    const people=array(effect.people).map(name=>person(name));
    if(new Set(people.map(person=>person.id)).size!==people.length)throw new RpcError('invalid_params','An observation names each perceived person once');
    for(const perceived of people)if(!present.has(perceived.id))throw new RpcError('invalid_params','A perceived person is not currently at the target place',{
        fix:'Reuse actual current presence. Settle a real NPC departure or arrival through its existing NPC effect, not through an observation.',
        details:{reason:'place_observation_presence',person:perceived.handle,target:to}});
    const observed_clock=clockSection(graph,world),situations:Row[]=state.situations??=[],updates:Row[]=[];
    const names=new Set<string>();
    for(const draft of array(effect.situations)){
        const name=normalize(draft.name);
        if(names.has(name))throw new RpcError('invalid_params','An observation updates each situation once');
        names.add(name);
        const existing=locationSituations(world).find(situation=>spatialPointKey(row(situation.to))===spatialPointKey(to)&&normalize(situation.name)===name);
        const participants=draft.participants===undefined?clone(array(existing?.participants)):array(draft.participants).map(name=>person(name));
        const next={id:existing?.id??`situation-location-${randomUUID()}`,name:existing?.name??draft.name,to:clone(to),summary:draft.summary,status:draft.status,participants,
            assessed_clock:clone(observed_clock),turn:turn.turn,receipt:receipt.id};
        if(existing)Object.assign(existing,next);else situations.push(next);
        updates.push(clone(next));
    }
    const observation={from,to,sense:effect.sense,access:effect.access,scope:effect.scope,facts:clone(effect.facts),
        ...(effect.reason?{reason:effect.reason}:{}),people,situations:updates,observed_clock,turn:turn.turn,receipt:receipt.id};
    const observations:Row[]=state.observations??=[];
    const index=observations.findIndex(prior=>spatialPointKey(row(prior.to))===spatialPointKey(to)&&prior.sense===effect.sense);
    if(index<0)observations.push(observation);else observations[index]=observation;
    Object.assign(receipt,{place:to.place,observation:clone(observation)});
    return receipt;
}
