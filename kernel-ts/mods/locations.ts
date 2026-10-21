/** Enhanced Locations v2 (contract §250) stages only inside the existing apply transaction. */
import {randomUUID} from 'node:crypto';
import {Check,Errors} from 'typebox/value';
import {PlaceEffect} from '../../shared/place-structures.js';
import type {DomainEvent} from '../transactions.js';
import type {ApplyContext} from '../apply/index.js';
import {stageMove,moveAccess} from '../apply/move.js';
import {nowIso} from '../write/store.js';
import {isPlace} from '../read/places.js';
import {RpcError} from '../errors.js';
import {isAmbiguity} from '../read/module-graph.js';
import {array,clone,normalize,row,type Row} from '../read/values.js';
import {locationProvider,locationPlace,locationFeature,locationPlaces,locationFeatures,clearLocationPosition,qualifiedLocationFeature,LOCATION_POSITION_V2_CAPABILITY} from '../read/locations.js';
import {LOCATION_OBSERVATION_CAPABILITY} from '../read/location-observations.js';
import {stagePerceptualRelations,stageLocationObservation} from './location-observations.js';
const nonblank=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
/** An unknown, unambiguous name; an ambiguous one keeps its refusal. */
export const unknownName=(error:unknown):boolean=>error instanceof RpcError&&error.code==='unknown_entity'&&error.details?.reason!=='ambiguous'&&!isAmbiguity(error);
function reference<T>(field:string,requested:string,resolve:()=>T):T {
    try{return resolve();}catch(error){
        if(!(error instanceof RpcError)||error.code!=='unknown_entity')throw error;
        throw new RpcError('invalid_params','The place reference is ambiguous or unknown',{
            fix:'Name the intended place exactly, using details.candidates when several match.',
            details:{...error.details,reason:'place_reference_unresolved',field,requested}});
    }
}
/** §250: deterministic repairs of the Keeper's own command shape, each reported on the receipt; never a semantic guess. */
function forgiving(input:Row,adjusted:Row[]):Row {
    const effect:Row={...input};
    for(const [key,value] of Object.entries(effect))
        if(key!=='kind'&&key!=='action'&&typeof value==='string'&&!value.trim()){delete effect[key];adjusted.push({field:key,reason:'blank_dropped'});}
    if(Array.isArray(effect.additions))effect.additions=effect.additions.map((draft:unknown)=>{
        if(!draft||typeof draft!=='object'||Array.isArray(draft))return draft;
        const next:Row={...draft};
        if(next.within===''||next.within==='/')next.within=null;
        if(next.description!==undefined&&!nonblank(next.description))delete next.description;
        if(Array.isArray(next.features))next.features=next.features.map((feature:unknown)=>{
            if(!feature||typeof feature!=='object'||Array.isArray(feature))return feature;
            const copy:Row={...feature};
            for(const key of ['description','state'])if(copy[key]!==undefined&&!nonblank(copy[key]))delete copy[key];
            return copy;
        });
        return next;
    });
    if(effect.action==='observe'){
        effect.to??='here';effect.sense??='sight';effect.access??='clear';
        effect.facts??=[];
        // Only blank text is dropped; a malformed fact keeps its schema refusal.
        if(Array.isArray(effect.facts)){
            const kept=effect.facts.filter((fact:unknown)=>!(typeof fact==='string'&&!fact.trim()));
            if(kept.length!==effect.facts.length){adjusted.push({field:'facts',reason:'blank_dropped'});effect.facts=kept;}
        }
    }
    return effect;
}

export function stageLocation(context:ApplyContext,given:Row,active:readonly Row[],travelRows?:ReadonlyMap<string,number>|null):{receipt:Row;event:DomainEvent|null} {
    const adjusted:Row[]=[];
    let effect:Row=forgiving(given,adjusted);
    const shape:unknown=effect;
    if(!Check(PlaceEffect,shape)){
        const schema=PlaceEffect.anyOf.find(schema=>schema.properties.action.const===effect.action)??PlaceEffect;
        const fields=Errors(schema,effect).slice(0,4).map(error=>({field:error.instancePath,problem:error.message}));
        throw new RpcError('invalid_params','Invalid typed place command',{
            fix:'Correct details.fields; additions and features are JSON arrays.',details:{reason:'place_shape',fields}});
    }
    const provider=locationProvider(active);
    if(!provider)throw new RpcError('needs','No active Mod provides locations.v1',{
        fix:'Enable Enhanced Locations through ordinary Mod configuration. Stored places remain readable.',details:{reason:'location_mod_inactive'}});
    if((effect.spot!==undefined||effect.action==='observe'&&effect.relation!==undefined||array(effect.relations).some(edge=>edge.from?.spot!==undefined||edge.to?.spot!==undefined||edge.from?.relation!==undefined||edge.to?.relation!==undefined))
        &&!array(provider.requires).includes(LOCATION_POSITION_V2_CAPABILITY))
        throw new RpcError('needs','Descriptive local positions require a compatible location provider',{
            fix:'Adopt an Enhanced Locations package requiring locations.position.v2. Existing feature positions remain valid.',details:{reason:'location_position_mod_required'}});
    const {world,graph,turn,callId}=context;
    const modState=(world.mods.state[provider.id]??={});
    const state:Row=modState.locations??={schema:1,places:[],features:[]};
    if(state.schema!==1)throw new RpcError('needs','Location state requires a compatible Mod migration');
    const added:string[]=[],features:string[]=[];
    const finish=(result:{receipt:Row;event:DomainEvent|null})=>{if(adjusted.length)result.receipt.adjusted=[...array(result.receipt.adjusted),...adjusted];return result;};
    /** A new place record; the name stands in for an omitted description. */
    const createPlace=(name:string,leaf:string,within:string|null,description:string):Row=>{
        if([...graph.nodes.values()].some(node=>node.node_kind!=='scene'&&graph.nameKeys(node).some(key=>normalize(key)===normalize(name))))
            throw new RpcError('invalid_params','This name already identifies a non-place entity',{details:{reason:'place_name_taken',name}});
        const record={id:`scene-location-${randomUUID()}`,name,label:leaf,within,description,turn:turn.turn,
            source_anchor:graph.handle(graph.scene(world.active_scene)),provider:provider.id};
        state.places.push(record);
        added.push(name);
        return graph.addTableEntity({...record,kind:'scene',summary:record.description,location_mod:true});
    };
    for(const [index,draft] of array(row(effect).additions).entries()){
        let parent:Row|null=null;
        if(draft.within!=null)try{parent=graph.resolve(draft.within,['scene','location'],'containing place');}
        catch(error){
            if(!(error instanceof RpcError))throw error;
            adjusted.push({field:`additions[${index}].within`,reason:'unregistered_parent_ignored',requested:draft.within});
        }
        if(parent&&!isPlace(graph,parent)){adjusted.push({field:`additions[${index}].within`,reason:'non_place_parent_ignored',requested:draft.within});parent=null;}
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
            if(!nonblank(draft.description))adjusted.push({field:`additions[${index}].description`,reason:'name_as_description'});
            place=createPlace(name,leaf,within,nonblank(draft.description)?draft.description.trim():leaf);
        }else if(draft.description!==undefined&&draft.description.trim()!==row(place.properties).description){
            adjusted.push({field:`additions[${index}].description`,reason:'existing_description_kept',place:name});
        }
        const handle=graph.handle(place);
        for(const draftFeature of array(draft.features)){
            const existing=locationFeatures(world).find(feature=>feature.place===handle&&normalize(feature.name)===normalize(draftFeature.name));
            if(existing){
                if(draftFeature.description!==undefined&&existing.description!==draftFeature.description||draftFeature.state!==undefined&&existing.state!==draftFeature.state
                    ||draftFeature.passable!==undefined&&existing.passable!==draftFeature.passable)
                    adjusted.push({field:`additions[${index}].features`,reason:'existing_feature_kept',place:handle,feature:existing.name});
                continue;
            }
            state.features.push({id:`feature-location-${randomUUID()}`,place:handle,...clone(draftFeature),description:draftFeature.description??draftFeature.name,turn:turn.turn});
            features.push(draftFeature.name);
        }
    }
    const receipt:Row={id:context.mint(`place:${callId}`),kind:'place',call_id:callId,action:effect.action,added,features,at:nowIso(),mod:provider.id};
    if(['relate','observe'].includes(effect.action)&&!array(provider.requires).includes(LOCATION_OBSERVATION_CAPABILITY))
        throw new RpcError('needs','This location package does not provide observation continuity',{
            fix:'Adopt the current Enhanced Locations package through ordinary Mod configuration; existing locations remain intact.',details:{reason:'location_observation_mod_required'}});
    if('relations' in effect&&effect.relations)receipt.relations=stagePerceptualRelations(context,state,array(effect.relations),adjusted);
    if(effect.action==='relate')return finish({receipt:{...receipt,visibility:'keeper'},event:null});
    if(effect.action==='observe')return finish({receipt:stageLocationObservation(context,state,effect,receipt,adjusted),event:null});
    if(effect.action==='establish')return finish({receipt,event:null});
    let destination:Row;
    try{destination=locationPlace(graph,world,effect.to);}
    catch(error){
        if(effect.action!=='move'||!unknownName(error))return reference('to',effect.to,()=>{throw error;});
        const qualified=effect.at===undefined&&effect.spot===undefined?qualifiedLocationFeature(world,effect.to):undefined;
        if(qualified){
            // §250: a registered feature named as the destination is that place, standing at that feature.
            destination=locationPlace(graph,world,qualified.place);effect={...effect,to:qualified.place,at:qualified.at};
            adjusted.push({field:'to',reason:'qualified_feature_resolved',place:qualified.place,at:qualified.at});
        }else{
            // §250: a name that is neither registered nor defined in additions could be another wording of a known place;
            // registering it would silently split that place, so the Keeper gets the known names in one short refusal.
            const known=[...new Set([...locationPlaces(world).map(place=>String(place.name)),...graph.scenes().map(node=>graph.handle(node))])].slice(0,24);
            throw new RpcError('invalid_params','The destination is not a known place',{
                fix:'Use one of details.known_places, or define the new place in additions on this move.',
                details:{reason:'place_destination_unknown',field:'to',requested:effect.to,known_places:known}});
        }
    }
    const to=graph.handle(destination);
    if(effect.action==='feature'){
        if(effect.state===undefined&&effect.passable===undefined){
            adjusted.push({field:'state',reason:'no_change'});
            return finish({receipt:{...receipt,place:to,feature:effect.at,before:{},after:{}},event:null});
        }
        let feature:Row;
        try{feature=locationFeature(world,to,effect.at);}
        catch(error){
            if(!unknownName(error))return reference('at',effect.at,()=>{throw error;});
            feature={id:`feature-location-${randomUUID()}`,place:to,name:String(effect.at).trim(),description:String(effect.at).trim(),turn:turn.turn};
            state.features.push(feature);features.push(feature.name);
            adjusted.push({field:'at',reason:'implicit_feature',feature:feature.name});
        }
        const before=clone(feature);
        const fields=(value:Row)=>Object.fromEntries(['state','passable'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
        if(effect.state!==undefined)feature.state=effect.state;
        if(effect.passable!==undefined)feature.passable=effect.passable;
        Object.assign(receipt,{place:to,feature:feature.name,before:fields(before),after:fields(feature)});
        return finish({receipt,event:null});
    }
    let anchor:Row|undefined;
    if(effect.at!==undefined){
        try{anchor=locationFeature(world,to,effect.at);}
        catch(error){
            if(!unknownName(error))return reference('at',effect.at,()=>{throw error;});
            effect={...effect,spot:effect.spot??effect.at};delete effect.at;
            adjusted.push({field:'at',reason:'unregistered_feature_as_spot',spot:effect.spot});
        }
    }
    if(anchor&&effect.spot!==undefined){adjusted.push({field:'spot',reason:'spot_dropped_for_feature'});effect={...effect};delete effect.spot;}
    if(effect.spot!==undefined&&!array(provider.requires).includes(LOCATION_POSITION_V2_CAPABILITY))
        throw new RpcError('needs','Descriptive local positions require a compatible location provider',{
            fix:'Adopt an Enhanced Locations package requiring locations.position.v2. Existing feature positions remain valid.',details:{reason:'location_position_mod_required'}});
    const through=effect.through;
    if(through){
        let boundaryPlace:string|undefined,boundary:Row|undefined;
        try{boundaryPlace=graph.handle(locationPlace(graph,world,through.place));boundary=locationFeature(world,boundaryPlace,through.feature);}
        catch(error){if(!unknownName(error))throw error;adjusted.push({field:'through',reason:'unregistered_crossing_ignored'});}
        if(boundary&&boundaryPlace!==world.active_scene&&boundaryPlace!==to){adjusted.push({field:'through',reason:'unrelated_crossing_ignored'});boundary=undefined;}
        if(boundary?.passable===false)throw new RpcError('not_reachable','The declared passage is impassable',{
            fix:'Resolve the actual obstacle or use a different established route; no part of this batch committed.',details:{reason:'place_barrier',place:boundaryPlace??null,feature:boundary.name,state:boundary.state??null}});
    }
    const from=world.active_scene;
    let moved:{receipt:Row;event:DomainEvent|null};
    if(from===to){
        if(effect.travel_band!==undefined||effect.travel_minutes!==undefined)adjusted.push({field:'travel_band',reason:'local_travel_ignored'});
        moved={receipt:{...receipt,place:to,...(effect.via?{via:effect.via}:{})},event:null};
    }else{
        // §250: a new route the Keeper did not describe is an open, improvised arrival, never an unreachable destination.
        const openRoute=!effect.via&&moveAccess(graph,world,graph.scene(from),destination,false,false).requiresVia;
        if(openRoute)adjusted.push({field:'via',reason:'open_route'});
        // Route/timing/trail/clock and all arrival consumers remain owned by canonical movement.
        moved=stageMove(context,{kind:'move',to,...(effect.via?{via:effect.via}:{}),...(openRoute?{_open_route:true}:{}),
            ...(effect.travel_band?{travel_band:effect.travel_band}:{}),...(effect.travel_minutes!==undefined?{travel_minutes:effect.travel_minutes}:{})},travelRows,{containmentIsRoute:false});
        Object.assign(moved.receipt,{mod:provider.id,added,features});
    }
    clearLocationPosition(world);
    state.position={place:to,...(anchor?{at:anchor.name}:{}),...(effect.spot?{spot:effect.spot}:{}),...(effect.relation?{relation:effect.relation}:{})};
    Object.assign(moved.receipt,{position:clone(state.position)});
    return finish(moved);
}
