/** Versioned Mod records projected into the ordinary graph without changing source. */
import {parentsOf,isPlace} from './places.js';
import {RpcError} from '../errors.js';
import type {ModuleGraph} from './module-graph.js';
import {array,normalize,row,string,type Row} from './values.js';
import {destinationIdentity} from './module-graph.js';
export const LOCATIONS_CAPABILITY='locations.v1';
export function locationProvider(active:readonly Row[]):Row|undefined {
    return active.filter(mod=>array(mod.requires).includes(LOCATIONS_CAPABILITY)).at(-1);
}
export function locationStates(world:Row):Row[] {
    return Object.values(row(row(world.mods).state)).map(state=>row(row(state).locations)).filter(state=>state.schema===1);
}
export function locationPlaces(world:Row):Row[] {return locationStates(world).flatMap(state=>array(state.places));}
export function locationFeatures(world:Row):Row[] {return locationStates(world).flatMap(state=>array(state.features));}
export function locationPolicyApplies(graph:ModuleGraph,world:Row,...places:Row[]):boolean {
    return places.some(node=>locationPlaces(world).some(place=>place.id===node.node_id)||locationFeatures(world).some(feature=>feature.place===graph.handle(node)));
}
export function projectLocations(graph:ModuleGraph,world:Row):void {
    graph.addTableEntities(locationEntities(world));
}
export function locationEntities(world:Row):Row[] {
    return locationPlaces(world).map(place=>({...place,kind:'scene',summary:place.description,location_mod:true}));
}
/** Names are exact normalized references. Local leaf matching is structural, never fuzzy. */
export function locationPlace(graph:ModuleGraph,world:Row,name:unknown):Row {
    if(name==='here'||name===undefined)return graph.scene(world.active_scene);
    if(typeof name!=='string'||!name.trim())throw new RpcError('invalid_params','A place needs a nonempty name');
    const exact=locationPlaces(world).filter(place=>normalize(place.name)===normalize(name));
    if(exact.length===1)return graph.scene(exact[0].name);
    const current=graph.scene(world.active_scene),here=graph.handle(current);
    const currentRecord=locationPlaces(world).find(place=>place.id===current.node_id);
    const matches=locationPlaces(world).filter(place=>normalize(place.label)===normalize(name));
    const local=matches.filter(place=>place.name===here||place.within===here||currentRecord?.within&&place.within===currentRecord.within);
    if(local.length===1)return graph.scene(local[0].name);
    if(matches.length>1)throw new RpcError('unknown_entity','The place name is ambiguous',{
        fix:'Use one qualified place name from details.candidates.',details:{reason:'ambiguous',candidates:matches.map(place=>place.name)}});
    const selected=graph.scene(name);
    if(!graph.nameKeys(selected).some(key=>normalize(key)===normalize(name)))
        throw new RpcError('unknown_entity','No registered place has this exact name',{
            fix:'Reuse a known qualified place or establish the minimal compatible new place.',details:{reason:'destination_missing',requested_destination:name}});
    return selected;
}
/** A bounded catalogue is decision support, never the boundary of the fictional world. */
export function locationCandidates(graph:ModuleGraph,world:Row,limit=24):Row[] {
    const current=graph.handle(graph.scene(world.active_scene)),stored=locationPlaces(world),features=locationFeatures(world);
    const featureRows:Row[]=[...features.filter(feature=>feature.place===current),...features.filter(feature=>feature.place!==current)].map(feature=>({
        name:`${feature.place} / ${feature.name}`,kind:'feature',place:feature.place,feature:feature.name,origin:'mod',summary:feature.description}));
    const placeRow=(place:Row):Row=>({name:graph.handle(place),display_name:graph.displayName(place),kind:'place',
        origin:stored.some(record=>record.id===place.node_id)?'mod':graph.isTableEntity(place)?'table':'source',
        ...(destinationIdentity(place)?{identity:destinationIdentity(place)}:{}),summary:graph.summary(place).slice(0,300)});
    const groups=[[placeRow(graph.scene(current))],graph.scenes().filter(place=>!graph.isTableEntity(place)).map(placeRow),
        stored.slice().reverse().map(place=>placeRow(graph.scene(place.name))),featureRows,
        graph.scenes().filter(place=>graph.isTableEntity(place)&&!stored.some(record=>record.id===place.node_id)).map(placeRow)];
    const seen=new Set<string>(),result:Row[]=[];
    for(let i=0;i<Math.max(0,...groups.map(group=>group.length))&&result.length<limit;i++)for(const group of groups){
        const candidate=group[i];if(!candidate)continue;
        const key=JSON.stringify([candidate.kind,candidate.name]);if(seen.has(key))continue;
        seen.add(key);result.push(candidate);if(result.length>=limit)break;
    }
    return result;
}
export function locationFeature(world:Row,place:string,name:unknown):Row {
    const matches=locationFeatures(world).filter(feature=>feature.place===place&&typeof name==='string'&&normalize(feature.name)===normalize(name));
    if(matches.length!==1)throw new RpcError('unknown_entity','No unique feature in this place',{
        details:{reason:'feature_missing',place,features:locationFeatures(world).filter(feature=>feature.place===place).map(feature=>feature.name)}});
    return matches[0];
}
export function locationPosition(world:Row):Row|undefined {
    return locationStates(world).map(state=>row(state.position)).find(position=>position.place===world.active_scene);
}
export function clearLocationPosition(world:Row):void {for(const state of locationStates(world))delete state.position;}
export function locationView(graph:ModuleGraph,world:Row,name?:unknown):Row {
    const place=locationPlace(graph,world,name),handle=graph.handle(place);
    const stored=locationPlaces(world).find(record=>record.id===place.node_id);
    return {name:handle,display_name:graph.displayName(place),origin:stored?'mod':'existing',
        ...(stored?.within?{within:stored.within}:{}),parents:parentsOf(graph,place).map(parent=>graph.handle(parent)),
        ...(typeof row(place.properties).description==='string'?{description:place.properties.description}:{}),
        children:[...graph.nodes.values()].filter(child=>isPlace(graph,child)&&parentsOf(graph,child).some(parent=>parent.node_id===place.node_id)).map(child=>({name:graph.handle(child),display_name:graph.displayName(child)})),
        features:locationFeatures(world).filter(feature=>feature.place===handle).map(({name,description,state,passable})=>({name,description,...(state!==undefined?{state}:{}),...(passable!==undefined?{passable}:{})})),
        ...(world.active_scene===handle&&locationPosition(world)?{position:locationPosition(world)}:{})};
}
