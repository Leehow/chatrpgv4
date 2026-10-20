/** Directed perception and last-seen projections; reads never advance the world. */
import type {ModuleGraph} from './module-graph.js';
import {clockSection,npcsPresent,npcReferenceView,untoldBlock,publicSceneLabel} from './capsule.js';
import {npcActivityView} from './temporal.js';
import {locationStates,locationPlace,locationFeature,locationPosition} from './locations.js';
import {array,clone,number,row,type Row} from './values.js';

export const LOCATION_OBSERVATION_CAPABILITY='locations.observation.v1';
export const locationRelations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.relations));
export const locationSituations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.situations));
export const locationObservations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.observations));
export const spatialPointKey=(point:Row):string=>JSON.stringify([point.place,point.at??null]);
export function observationPoint(graph:ModuleGraph,world:Row,value:Row):Row {
    const place=graph.handle(locationPlace(graph,world,value.place));
    return {place,...(value.at!==undefined?{at:locationFeature(world,place,value.at).name}:{})};
}
export function currentObservationPoint(graph:ModuleGraph,world:Row):Row {
    const position=locationPosition(world);
    return {place:graph.handle(graph.scene(world.active_scene)),...(position?.at?{at:position.at}:{})};
}
const covers=(edge:Row,point:Row)=>edge.place===point.place&&(edge.at===undefined||edge.at===point.at);
export function matchingObservationRelations(world:Row,from:Row,to:Row,sense:string):Row[] {
    return locationRelations(world).filter(relation=>relation.sense===sense&&covers(row(relation.from),from)&&covers(row(relation.to),to));
}
export function observationIdentity(graph:ModuleGraph,world:Row,node:Row,journal:Row={},records:Row[]=[]):Row {
    return npcReferenceView(graph,world,node,untoldBlock(graph,world,journal,node,records));
}
/** Public immutable receipt material only; private target activity is not an author input. */
export function publicObservation(graph:ModuleGraph,world:Row,value:Row):Row {
    const point=(value:Row)=>({place:publicSceneLabel(graph,world,graph.scene(value.place)),...(value.at?{at:value.at}:{})});
    const identity=(id:string):Row|undefined=>{
        const node=graph.nodes.get(graph.survivorId(id));
        return node&&graph.isPerson(node)?observationIdentity(graph,world,node):undefined;
    };
    return {from:point(row(value.from)),to:point(row(value.to)),sense:value.sense,access:value.access,scope:value.scope,
        observed_clock:clone(row(value.observed_clock)),facts:clone(array(value.facts)),...(value.reason?{reason:value.reason}:{}),
        people:array(value.people).flatMap(person=>{const known=identity(person.id);return known?[known]:[];}),
        situations:array(value.situations).map(situation=>({name:situation.name,summary:situation.summary,status:situation.status,
            assessed_clock:clone(row(situation.assessed_clock))})),
        authority:'Committed observation only; remote people remain at its target, not in the observer scene.'};
}
/** Small current-viewpoint route index, never an automatic census of connected scenes. */
export function observationRoutes(graph:ModuleGraph,world:Row):Row[] {
    const from=currentObservationPoint(graph,world);
    return locationRelations(world).filter(relation=>covers(row(relation.from),from)).slice(0,8).map(relation=>({
        to:clone(row(relation.to)),sense:relation.sense,description:relation.description,
        read:{op:'inspect',need:'observation',name:relation.to.place,...(relation.to.at?{at:relation.to.at}:{}),sense:relation.sense}}));
}
/** Caller supplies already committed current-line deliveries, not raw unpublished records. */
export function locationObservationView(graph:ModuleGraph,world:Row,params:Row={},records:Row[]=[],journal:Row={}):Row {
    const from=currentObservationPoint(graph,world),to=observationPoint(graph,world,{place:params.name??'here',...(params.at?{at:params.at}:{})}),sense=params.sense??'sight';
    const key=spatialPointKey(to),clock=clockSection(graph,world);
    const same=(observation:Row)=>spatialPointKey(row(observation.to))===key&&observation.sense===sense;
    const deliveries=records.filter(record=>record.commit&&record.interaction_scope!=='reference'&&record.interaction_scope!=='uncertain')
        .sort((a,b)=>number(b.turn)-number(a.turn));
    const prior=deliveries.flatMap(record=>array(record.receipts).slice().reverse().filter(receipt=>receipt.kind==='place'&&receipt.action==='observe'&&same(row(receipt.observation)))
        .map(receipt=>({...receipt.observation,delivered_turn:record.turn}))).find(observation=>observation.access!=='blocked');
    const latest=locationObservations(world).find(same);
    const elapsed=(then:Row)=>Math.max(0,number(clock.minutes)-number(then.minutes));
    const incidents=locationSituations(world).filter(situation=>spatialPointKey(row(situation.to))===key).slice(-8);
    return {from,to,sense,clock,local:from.place===to.place,relations:matchingObservationRelations(world,from,to,sense).map(relation=>({from:clone(relation.from),to:clone(relation.to),sense:relation.sense,description:relation.description})),
        ...(to.at?{target_feature:Object.fromEntries(Object.entries(locationFeature(world,to.place,to.at)).filter(([key])=>['name','description','state','passable'].includes(key)))}:{}),
        ...(prior?{last_observation:{...publicObservation(graph,world,prior),delivered_turn:prior.delivered_turn,elapsed_minutes:elapsed(row(prior.observed_clock))}}:{}),
        ...(latest?{latest_settled:{...publicObservation(graph,world,latest),publication:deliveries.some(record=>array(record.receipts).some(receipt=>receipt.id===latest.receipt))?'delivered':'undelivered'}}:{}),
        people:npcsPresent(graph,world,graph.scene(to.place)).filter(node=>graph.isPerson(node)).slice(0,16).map(node=>({...observationIdentity(graph,world,node,journal,records),
            location:to.place,local_presence:from.place===to.place,activity:npcActivityView(graph,world,graph.handle(node))})),
        situations:incidents.map(situation=>({name:situation.name,summary:situation.summary,status:situation.status,assessed_clock:clone(row(situation.assessed_clock)),
            elapsed_minutes:elapsed(row(situation.assessed_clock)),review_required:situation.status!=='ended'&&elapsed(row(situation.assessed_clock))>0,
            participants:array(situation.participants).flatMap(person=>{const node=graph.nodes.get(graph.survivorId(person.id));return node?[{...observationIdentity(graph,world,node,journal,records),location:row(world.npc_presence)[graph.handle(node)]??null}]:[];})})),
        note:'Keeper preparation only, not player perception. Reuse canonical people and current incident state. Assess only the elapsed game-time interval not already assessed; elapsed time does not force change. Commit selected observable facts with place observe. No movement, speech or observation is recorded by this read.'};
}
