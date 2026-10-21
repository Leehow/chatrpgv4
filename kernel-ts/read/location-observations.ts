/** Directed perception and last-seen projections; reads never advance the world. */
import {isAmbiguity,type ModuleGraph} from './module-graph.js';
import {clockSection,npcsPresent,npcReferenceView,untoldBlock,publicSceneLabel} from './capsule.js';
import {npcActivityView} from './temporal.js';
import {locationStates,locationPlace,locationFeature,locationPosition,qualifiedLocationFeature} from './locations.js';
import {array,clone,number,row,type Row} from './values.js';
import {Check} from 'typebox/value';
import {SpatialPoint} from '../../shared/place-structures.js';
import {RpcError} from '../errors.js';

export const LOCATION_OBSERVATION_CAPABILITY='locations.observation.v1';
export const LOCATION_OBSERVATION_V2_CAPABILITY='locations.observation.v2';
export const locationRelations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.relations));
export const locationSituations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.situations));
export const locationObservations=(world:Row):Row[]=>locationStates(world).flatMap(state=>array(state.observations));
const pointDetail=(point:Row):Row=>Object.fromEntries(['at','spot','relation'].filter(key=>typeof point?.[key]==='string').map(key=>[key,point[key]]));
export const spatialPointKey=(point:Row):string=>JSON.stringify([point.place,point.at??null,point.spot??null,point.relation??null]);
export function observationPoint(graph:ModuleGraph,world:Row,value:Row):Row {
    if(!Check(SpatialPoint,value)||value.relation!==undefined&&value.at===undefined&&value.spot===undefined)
        throw new RpcError('invalid_params','A spatial point needs one valid at feature or descriptive spot when locally qualified',{
            details:{reason:'place_point_shape'}});
    const place=graph.handle(locationPlace(graph,world,value.place));
    return {place,...pointDetail(value),...(value.at!==undefined?{at:locationFeature(world,place,value.at).name}:{})};
}
/** Read-only resolution accepts the catalogue's exact feature reference without changing write grammar. */
export function locationInspectionPoint(graph:ModuleGraph,world:Row,params:Row):Row {
    let place=params.name??'here',at=params.at;
    if(at===undefined&&params.spot===undefined)try{locationPlace(graph,world,place);}
    catch(error){
        if(!(error instanceof RpcError)||error.code!=='unknown_entity'||error.details?.reason==='ambiguous'||isAmbiguity(error))throw error;
        const feature=qualifiedLocationFeature(world,place);
        if(!feature)throw error;
        place=feature.place;at=feature.at;
    }
    return observationPoint(graph,world,{place,...(at!==undefined?{at}:{}),
        ...Object.fromEntries(['spot','relation'].filter(key=>params[key]!==undefined).map(key=>[key,params[key]]))});
}
export function currentObservationPoint(graph:ModuleGraph,world:Row):Row {
    const position=locationPosition(world);
    return {place:graph.handle(graph.scene(world.active_scene)),...pointDetail(position??{})};
}
/** Perceptual access permits an investigative attempt, never a new percept or physical reach. */
export function observationTargetAccessible(graph:ModuleGraph,world:Row,node:Row):boolean {
    const from=currentObservationPoint(graph,world),presence=row(world.npc_presence)[graph.handle(node)];
    return locationRelations(world).some(relation=>{
        if(row(relation.to).place!==presence||!covers(row(relation.from),from))return false;
        const latest=locationObservations(world).find(observation=>observation.sense===relation.sense
            &&spatialPointKey(row(observation.to))===spatialPointKey(row(relation.to))
            &&spatialPointKey(row(observation.from))===spatialPointKey(from));
        return latest?.access!=='blocked';
    });
}
const covers=(edge:Row,point:Row)=>edge.place===point.place&&['at','spot','relation'].every(key=>edge[key]===undefined||edge[key]===point[key]);
export function matchingObservationRelations(world:Row,from:Row,to:Row,sense:string):Row[] {
    return locationRelations(world).filter(relation=>relation.sense===sense&&covers(row(relation.from),from)&&covers(row(relation.to),to));
}
export function observationIdentity(graph:ModuleGraph,world:Row,node:Row,journal:Row={},records:Row[]=[]):Row {
    return npcReferenceView(graph,world,node,untoldBlock(graph,world,journal,node,records));
}
/** Public immutable receipt material only; private target activity is not an author input. */
export function publicObservation(graph:ModuleGraph,world:Row,value:Row):Row {
    const point=(value:Row)=>({place:publicSceneLabel(graph,world,graph.scene(value.place)),...pointDetail(value)});
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
    const relations=locationRelations(world);if(!relations.length)return [];
    const from=currentObservationPoint(graph,world);
    return relations.filter(relation=>covers(row(relation.from),from)).slice(0,8).map(relation=>({
        to:clone(row(relation.to)),sense:relation.sense,description:relation.description,
        read:{op:'inspect',need:'observation',name:relation.to.place,...pointDetail(row(relation.to)),sense:relation.sense}}));
}
/** Caller supplies already committed current-line deliveries, not raw unpublished records. */
export function locationObservationView(graph:ModuleGraph,world:Row,params:Row={},records:Row[]=[],journal:Row={}):Row {
    const from=currentObservationPoint(graph,world),to=locationInspectionPoint(graph,world,params),sense=params.sense??'sight';
    const key=spatialPointKey(to),clock=clockSection(graph,world);
    const same=(observation:Row)=>spatialPointKey(row(observation.to))===key&&observation.sense===sense;
    const deliveries=records.filter(record=>record.commit&&record.interaction_scope!=='reference'&&record.interaction_scope!=='uncertain')
        .sort((a,b)=>number(b.turn)-number(a.turn));
    const delivered=deliveries.flatMap(record=>array(record.receipts).slice().reverse().filter(receipt=>receipt.kind==='place'&&receipt.action==='observe'&&same(row(receipt.observation)))
        .map(receipt=>({...receipt.observation,delivered_turn:record.turn})));
    const prior=delivered.find(observation=>observation.access!=='blocked');
    const latest=locationObservations(world).find(same);
    const elapsed=(then:Row)=>Math.max(0,number(clock.minutes)-number(then.minutes));
    const incidents=locationSituations(world).filter(situation=>spatialPointKey(row(situation.to))===key).slice(-8);
    return {from,to,sense,clock,local:from.place===to.place,relations:matchingObservationRelations(world,from,to,sense).map(relation=>({from:clone(relation.from),to:clone(relation.to),sense:relation.sense,description:relation.description})),
        recent_observations:delivered.slice(0,4).map(observation=>({...publicObservation(graph,world,observation),
            delivered_turn:observation.delivered_turn,elapsed_minutes:elapsed(row(observation.observed_clock))})),
        ...(to.at?{target_feature:Object.fromEntries(Object.entries(locationFeature(world,to.place,to.at)).filter(([key])=>['name','description','state','passable'].includes(key)))}:{}),
        ...(to.spot?{target_spot:to.spot}:{}),
        ...(prior?{last_observation:{...publicObservation(graph,world,prior),delivered_turn:prior.delivered_turn,elapsed_minutes:elapsed(row(prior.observed_clock))}}:{}),
        ...(latest?{latest_settled:{...publicObservation(graph,world,latest),publication:deliveries.some(record=>array(record.receipts).some(receipt=>receipt.id===latest.receipt))?'delivered':'undelivered'}}:{}),
        people:npcsPresent(graph,world,graph.scene(to.place)).filter(node=>graph.isPerson(node)).slice(0,16).map(node=>({...observationIdentity(graph,world,node,journal,records),
            location:to.place,local_presence:from.place===to.place,activity:npcActivityView(graph,world,graph.handle(node))})),
        situations:incidents.map(situation=>({name:situation.name,summary:situation.summary,status:situation.status,assessed_clock:clone(row(situation.assessed_clock)),
            elapsed_minutes:elapsed(row(situation.assessed_clock)),review_required:situation.status!=='ended'&&elapsed(row(situation.assessed_clock))>0,
            participants:array(situation.participants).flatMap(person=>{const node=graph.nodes.get(graph.survivorId(person.id));return node?[{...observationIdentity(graph,world,node,journal,records),location:row(world.npc_presence)[graph.handle(node)]??null}]:[];})})),
        note:'Read-only Keeper preparation, not new player perception. recent_observations are delivered records, newest first; repeated person refs identify the same recorded person even when their proper name is unknown. Compare their recorded clocks and viewpoints for continuity; no new recognition roll is required to read an existing identity association. Current unseen activity is not a new observation. Assess only elapsed game time not already assessed; time does not force change. Commit actual selected perception with place observe. This read records no movement, speech, observation or elapsed time.'};
}
