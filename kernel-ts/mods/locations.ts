/** Enhanced Locations stages only inside the existing apply transaction. */
import {randomUUID} from 'node:crypto';
import {Check,Errors} from 'typebox/value';
import {PlaceEffect} from '../../shared/place-structures.js';
import type {DomainEvent} from '../transactions.js';
import type {ApplyContext} from '../apply/index.js';
import {stageMove,moveAccess} from '../apply/move.js';
import {nowIso} from '../write/store.js';
import {isPlace} from '../read/places.js';
import {RpcError} from '../errors.js';
import {array,clone,normalize,row,type Row} from '../read/values.js';
import {locationProvider,locationPlace,locationFeature,locationPlaces,locationFeatures,clearLocationPosition} from '../read/locations.js';
import {LOCATION_OBSERVATION_CAPABILITY} from '../read/location-observations.js';
import {stagePerceptualRelations,stageLocationObservation} from './location-observations.js';
const blank=(value:unknown):boolean=>typeof value==='string'?!value.trim():Array.isArray(value)?value.some(blank):value!==null&&typeof value==='object'?Object.values(value).some(blank):false;
function reference<T>(field:string,requested:string,resolve:()=>T):T {
    try{return resolve();}catch(error){
        if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
        throw new RpcError('invalid_params','The place reference needs its registered identity or minimal definition',{
            fix:'Reuse an exact known place/feature, or add the missing compatible observable definition in additions. For a feature, name its existing place and omit that place description. Establish missing feature facts before changing their state. Ambiguous candidates require the intended qualified name; no physical obstruction is inferred.',
            details:{...error.details,reason:'place_reference_unresolved',field,requested}});
    }
}

export function stageLocation(context:ApplyContext,effect:Row,active:readonly Row[],travelRows?:ReadonlyMap<string,number>|null):{receipt:Row;event:DomainEvent|null} {
    if(Array.isArray(effect.additions))effect={...effect,additions:effect.additions.map(draft=>draft&&typeof draft==='object'&&draft.within===''?{...draft,within:null}:draft)};
    if(!Check(PlaceEffect,effect)||blank(effect)){
        const schema=PlaceEffect.anyOf.find(schema=>schema.properties.action.const===effect.action)??PlaceEffect;
        const fields=Errors(schema,effect).slice(0,4).map(error=>({field:error.instancePath,problem:error.message}));
        throw new RpcError('invalid_params','Invalid typed place command',{
            fix:'Correct details.fields using the place contract. Additions and features are JSON arrays, not item wrappers. Supply only declared fields and nonblank text.',details:{reason:'place_shape',fields}});
    }
    const provider=locationProvider(active);
    if(!provider)throw new RpcError('needs','No active Mod provides locations.v1',{
        fix:'Enable Enhanced Locations through ordinary Mod configuration. Stored places remain readable.',details:{reason:'location_mod_inactive'}});
    const {world,graph,turn,callId}=context;
    const modState=(world.mods.state[provider.id]??={});
    const state:Row=modState.locations??={schema:1,places:[],features:[]};
    if(state.schema!==1)throw new RpcError('needs','Location state requires a compatible Mod migration');
    const added:string[]=[],features:string[]=[];
    for(const [index,draft] of array(row(effect).additions).entries()){
        let parent:Row|null=null;
        if(draft.within!=null)try{parent=graph.resolve(draft.within,['scene','location'],'containing place');}
        catch(error){
            if(!(error instanceof RpcError))throw error;
            throw new RpcError('invalid_params','The containing place is not uniquely registered',{
                fix:'Use an exact known containing place, JSON null, or omit within when there is no registered parent. The literal string "null" is a place name, not JSON null. Do not invent containment in the departure room.',
                details:{reason:'place_parent_unregistered',field:`additions[${index}].within`,requested:draft.within,candidates:error.details?.candidates??[]}});
        }
        if(parent&&!isPlace(graph,parent))throw new RpcError('invalid_params','within must name a real containing place',{details:{reason:'within_not_a_place'}});
        const within=parent?graph.handle(parent):null;
        const parentParts=within?.split(' / ')??[],parts=draft.name.trim().split(' / ');
        const qualified=parentParts.length>0&&parts.length>parentParts.length&&parentParts.every((part,index)=>normalize(part)===normalize(parts[index]));
        const leaf=qualified?parts.slice(parentParts.length).join(' / '):draft.name.trim();
        const name=within?`${within} / ${leaf}`:leaf;
        const stored=locationPlaces(world);
        const exact=graph.scenes().filter(node=>{const record=stored.find(place=>place.id===node.node_id);return record?normalize(record.name)===normalize(name):graph.nameKeys(node).some(key=>normalize(key)===normalize(name));});
        if(exact.length>1)throw new RpcError('unknown_entity','The new place name is ambiguous',{details:{reason:'ambiguous',candidates:exact.map(node=>graph.handle(node))}});
        let place=exact[0];
        if(!place){
            if([...graph.nodes.values()].some(node=>node.node_kind!=='scene'&&graph.nameKeys(node).some(key=>normalize(key)===normalize(name))))throw new RpcError('invalid_params','This name already identifies a non-place entity');
            if(typeof draft.description!=='string'||!draft.description.trim())throw new RpcError('invalid_params','A new place requires a public observable description');
            const record={id:`scene-location-${randomUUID()}`,name,label:leaf,within,description:draft.description.trim(),turn:turn.turn,
                source_anchor:graph.handle(graph.scene(world.active_scene)),provider:provider.id};
            state.places.push(record);
            place=graph.addTableEntity({...record,kind:'scene',summary:record.description,location_mod:true});
            added.push(name);
        }else if(draft.description!==undefined&&draft.description.trim()!==row(place.properties).description){
            throw new RpcError('invalid_params','An existing place description cannot be replaced by establishment',{
                fix:'Reuse the place without description; add only missing observable features. Use the existing adaptation contract for source changes.',details:{reason:'place_redefinition',place:name}});
        }
        const handle=graph.handle(place);
        for(const draftFeature of array(draft.features)){
            const existing=locationFeatures(world).find(feature=>feature.place===handle&&normalize(feature.name)===normalize(draftFeature.name));
            if(existing){
                if(existing.description!==draftFeature.description||draftFeature.state!==undefined&&existing.state!==draftFeature.state||draftFeature.passable!==undefined&&existing.passable!==draftFeature.passable)
                    throw new RpcError('invalid_params','An existing feature cannot be redefined; use action feature for a real state change', {details:{reason:'feature_redefinition',place:handle,feature:existing.name}});
                continue;
            }
            state.features.push({id:`feature-location-${randomUUID()}`,place:handle,...clone(draftFeature),turn:turn.turn});
            features.push(draftFeature.name);
        }
    }
    const receipt:Row={id:context.mint(`place:${callId}`),kind:'place',call_id:callId,action:effect.action,added,features,at:nowIso(),mod:provider.id};
    if(['relate','observe'].includes(effect.action)&&!array(provider.requires).includes(LOCATION_OBSERVATION_CAPABILITY))
        throw new RpcError('needs','This location package does not provide observation continuity',{
            fix:'Adopt the current Enhanced Locations package through ordinary Mod configuration; existing locations remain intact.',details:{reason:'location_observation_mod_required'}});
    if('relations' in effect&&effect.relations)receipt.relations=stagePerceptualRelations(context,state,array(effect.relations));
    if(effect.action==='relate')return {receipt:{...receipt,visibility:'keeper'},event:null};
    if(effect.action==='observe')return {receipt:stageLocationObservation(context,state,effect,receipt),event:null};
    if(effect.action==='establish')return {receipt,event:null};
    const destination=reference('to',effect.to,()=>locationPlace(graph,world,effect.to)),to=graph.handle(destination);
    if(effect.action==='feature'){
        if(effect.state===undefined&&effect.passable===undefined)throw new RpcError('invalid_params','A feature change requires state or passable');
        const feature=reference('at',effect.at,()=>locationFeature(world,to,effect.at)),before=clone(feature);
        const fields=(value:Row)=>Object.fromEntries(['state','passable'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
        if(effect.state!==undefined)feature.state=effect.state;
        if(effect.passable!==undefined)feature.passable=effect.passable;
        Object.assign(receipt,{place:to,feature:feature.name,before:fields(before),after:fields(feature)});
        return {receipt,event:null};
    }
    if(effect.relation!==undefined&&effect.at===undefined)throw new RpcError('invalid_params','A local relation requires its feature in at');
    const anchor=effect.at!==undefined?reference('at',effect.at,()=>locationFeature(world,to,effect.at)):undefined;
    const through=effect.through;
    if(through){
        const boundaryPlace=graph.handle(reference('through.place',through.place,()=>locationPlace(graph,world,through.place)));
        const boundary=reference('through.feature',through.feature,()=>locationFeature(world,boundaryPlace,through.feature));
        if(boundaryPlace!==world.active_scene&&boundaryPlace!==to)throw new RpcError('invalid_params','A crossed feature must belong to the departure or arrival place');
        if(boundary.passable===false)throw new RpcError('not_reachable','The declared passage is impassable',{
            fix:'Resolve the actual obstacle or use a different established route; no part of this batch committed.',details:{reason:'place_barrier',place:boundaryPlace,feature:boundary.name,state:boundary.state??null}});
    }
    const from=world.active_scene;
    let moved:{receipt:Row;event:DomainEvent|null};
    if(from===to){
        if(effect.travel_band!==undefined||effect.travel_minutes!==undefined)throw new RpcError('invalid_params','Local positioning does not supply travel time');
        moved={receipt:{...receipt,place:to,...(effect.via?{via:effect.via}:{})},event:null};
    }else{
        if(!effect.via&&moveAccess(graph,world,graph.scene(from),destination,false,false).requiresVia)throw new RpcError('invalid_params','The enhanced move needs its selected route in via',{
            fix:'Resubmit action:"move" with the same destination and additions, adding via to describe how the party reaches it. Do not switch to inspect: inspect cannot move or register places. This is an uncommitted argument correction, not an impassable place or a new player choice.',
            details:{reason:'place_route_required',field:'via',from,to}});
        // Route/timing/trail/clock and all arrival consumers remain owned by canonical movement.
        moved=stageMove(context,{kind:'move',to,...(effect.via?{via:effect.via}:{}),
            ...(effect.travel_band?{travel_band:effect.travel_band}:{}),...(effect.travel_minutes!==undefined?{travel_minutes:effect.travel_minutes}:{})},travelRows,{containmentIsRoute:false});
        Object.assign(moved.receipt,{mod:provider.id,added,features});
    }
    clearLocationPosition(world);
    state.position={place:to,...(anchor?{at:anchor.name}:{}),...(effect.relation?{relation:effect.relation}:{})};
    Object.assign(moved.receipt,{position:clone(state.position)});
    return moved;
}
