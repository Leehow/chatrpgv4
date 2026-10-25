/** Enhanced Locations v2 (contract §250): one forgiving location command at every entrance. */
import {Type,type Static} from 'typebox';
import {legibleClosedSchema} from './native-schema.ts';
import {TRAVEL_ADJACENT,ROUTE_TRAVEL_ROWS} from '../kernel-ts/modules/route-travel.ts';
/** Reuse the kernel's closed road registry, not an independent travel vocabulary. */
export const LocationTravelBand=Type.String({minLength:1,maxLength:240,enum:[TRAVEL_ADJACENT,...ROUTE_TRAVEL_ROWS],description:'How far a journey to a place with no known road goes; the kernel takes its minutes. Not for moves inside the current place.'});
const name=()=>Type.String({minLength:1,maxLength:240});
const fact=()=>Type.String({minLength:1,maxLength:1200});
const feature=Type.Object({name:name(),description:Type.Optional(fact()),state:Type.Optional(fact()),passable:Type.Optional(Type.Boolean())},{additionalProperties:false});
export const PlaceAddition=Type.Object({name:Type.String({minLength:1,maxLength:240,description:'The place name; a room inside a registered place uses its own name with within.'}),
    within:Type.Optional(Type.Union([name(),Type.Null(),Type.Literal('')],{description:'The registered place that contains it; omit or null for a standalone place.'})),
    description:Type.Optional(fact()),features:Type.Optional(Type.Array(feature,{maxItems:16}))},{additionalProperties:false});
const using_skill=Type.Optional(Type.String({description:'Optional exact currently offered skill card name; host-only annotation, never authority.'}));
const additions=Type.Optional(Type.Array(PlaceAddition,{minItems:1,maxItems:12,description:'New places, or new features of a known place. Known places and features are reused as they are; repeating them changes nothing.'}));
const spot=()=>Type.String({minLength:1,maxLength:240,description:'A descriptive position such as by the window or on the sidewalk; it needs no registered feature and grants no passage.'});
export const SpatialPoint=Type.Object({place:name(),at:Type.Optional(name()),spot:Type.Optional(spot()),relation:Type.Optional(name())},{additionalProperties:false});
const sense=()=>Type.Union([Type.Literal('sight'),Type.Literal('hearing')]);
const observedFact=()=>Type.String({minLength:1,maxLength:600});
export const PerceptualRelation=Type.Object({from:SpatialPoint,to:SpatialPoint,sense:sense(),description:observedFact()},{additionalProperties:false});
const relations=Type.Array(PerceptualRelation,{minItems:1,maxItems:8});
export const ObservedSituation=Type.Object({name:name(),summary:observedFact(),status:Type.Union([Type.Literal('ongoing'),Type.Literal('ended'),Type.Literal('unknown')]),participants:Type.Optional(Type.Array(name(),{maxItems:8}))},{additionalProperties:false});
export const PlaceEffect=Type.Union([
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('move'),to:Type.String({minLength:1,maxLength:240,description:'A known place, a new place named in additions, or here for a position inside the current place.'}),
        at:Type.Optional(Type.String({minLength:1,maxLength:240,description:'A registered feature to stand at; an unregistered name is kept as a spot.'})),spot:Type.Optional(spot()),
        relation:Type.Optional(Type.String({minLength:1,maxLength:240,description:'The pose, such as seated at or beside.'})),
        via:Type.Optional(Type.String({minLength:1,maxLength:240,description:'How the party gets there when the route is new.'})),through:Type.Optional(Type.Object({place:name(),feature:name()},{additionalProperties:false})),
        travel_band:Type.Optional(LocationTravelBand),travel_minutes:Type.Optional(Type.Integer({minimum:0,description:'With travel_band: how long this journey takes, within that band\'s range; omit for its usual time.'})),
        label:Type.Optional(Type.String({minLength:1,maxLength:120,description:'For a book place: its name in play_language as the investigators know it, shown on the player\'s cards. Omit when the place already has one.'})),
        with:Type.Optional(Type.Array(name(),{minItems:1,maxItems:8,description:'People who go along with the party (npc_N or their word); they keep going along on later moves until sent elsewhere.'})),additions},
        {additionalProperties:false,description:'Move the party. A new place carries its minimal additions. Inside the current place use to:"here" with at or spot; that takes no travel time.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('establish'),additions:Type.Array(PlaceAddition,{minItems:1,maxItems:12})},{additionalProperties:false,description:'Register surroundings without moving anyone.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('feature'),to:name(),at:name(),state:Type.Optional(fact()),passable:Type.Optional(Type.Boolean())},{additionalProperties:false,description:'Change the state of a door, window or fixture the player acted on, here or at a place left behind; an unregistered fixture is registered by this change itself (adjusted: at: implicit_feature) and the receipt lists it. A fixture is never a place.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('relate'),relations,additions},{additionalProperties:false,description:'Record that one point can see or hear another; moves nobody.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('observe'),to:Type.Optional(Type.String({minLength:1,maxLength:240,description:'What is perceived: a place, or here (the default).'})),
        at:Type.Optional(Type.String({minLength:1,maxLength:240,description:'A feature of that target; an unregistered name is kept as a spot.'})),spot:Type.Optional(spot()),relation:Type.Optional(name()),
        sense:Type.Optional(sense()),access:Type.Optional(Type.Union([Type.Literal('clear'),Type.Literal('limited'),Type.Literal('blocked')])),scope:Type.Optional(observedFact()),
        facts:Type.Array(Type.String({minLength:1}),{description:'What the investigator perceives, as short facts in order.'}),
        view:Type.Optional(Type.String({minLength:1,maxLength:600,description:'For another place: the window, door or line of sight it is perceived through.'})),reason:Type.Optional(observedFact()),
        people:Type.Optional(Type.Array(name(),{maxItems:8,description:'Existing people perceived at the target.'})),situations:Type.Optional(Type.Array(ObservedSituation,{maxItems:4})),
        relations:Type.Optional(relations),additions},{additionalProperties:false,description:'Record what the investigator perceives now: material for the author and continuity for later looks.'}),
]);
export const PlaceChange=Type.Union(PlaceEffect.anyOf.map(effect=>{
    const description=(effect as typeof effect & {description?:string}).description;
    return Type.Object(Object.fromEntries(Object.entries(effect.properties).filter(([key])=>key!=='kind')),{additionalProperties:false,...(description?{description}:{})});
}));
const inspect=Type.Object({using_skill,action:Type.Literal('inspect'),name:Type.Optional(name()),at:Type.Optional(name()),spot:Type.Optional(spot()),relation:Type.Optional(name()),sense:Type.Optional(sense()),
    need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false,description:'Read a place, or earlier observations of a target; changes nothing.'});
/** Write branches first: a provider that falls back to the first union branch must not turn a move into a read. */
export const NativePlaceParameters=Type.Union([
    ...PlaceChange.anyOf.map(branch=>Type.Object({...branch.properties,using_skill},{additionalProperties:false,...((branch as {description?:string}).description?{description:(branch as {description?:string}).description}:{})})),
    inspect,
]);
export const PlaceParameters=Type.Union([
    ...NativePlaceParameters.anyOf,
    Type.Object({using_skill,op:Type.Literal('inspect'),name:Type.Optional(name()),at:Type.Optional(name()),spot:Type.Optional(spot()),relation:Type.Optional(name()),sense:Type.Optional(sense()),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false}),
    Type.Object({using_skill,op:Type.Literal('submit'),change:PlaceChange},{additionalProperties:false}),
]);
export type LocationEffect=Static<typeof PlaceEffect>;
/** §250: the whole grammar is in the declared schemas; this read only says so. */
export const PLACE_CONTRACT_GUIDE='Every place field is declared in the place tool and in output commands. Put the selected route in one output, in order: a place move for each stop, a time command for each wait, a place observe for what is perceived. A place receipt lists in adjusted any field the kernel repaired.';

/** An applicable location provider owns party movement before provider conversion. */
export function locationCommandOwner<T extends Record<string,any>>(parameters:T):T {
    if(!parameters.properties?.commands)return parameters;
    const projected=structuredClone(parameters);
    for(const commands of projected.properties.commands.anyOf??[projected.properties.commands]){
        const variants=commands.items?.anyOf;
        if(Array.isArray(variants)&&variants.some(variant=>variant.properties?.kind?.const==='place'))
            commands.items.anyOf=variants.filter(variant=>variant.properties?.kind?.const!=='move');
    }
    const ownership='Party movement and perception use kind place with its action. Issued destinations are reference material; a place move can visit a compatible unlisted place with minimal additions.';
    const previous=projected.description;
    const description=typeof previous==='string'&&previous.length
        ?previous.endsWith(ownership)?previous:`${previous}\n${ownership}`
        :ownership;
    return legibleClosedSchema({...projected,description});
}

/** Request-only native grammar; complete validation always uses PlaceEffect. */
export function locationCommandEntry<T extends Record<string,any>>(parameters:T):T {
    if(!parameters.properties?.commands)return parameters;
    const projected=structuredClone(parameters);
    for(const commands of projected.properties.commands.anyOf??[projected.properties.commands]){
        const variants=commands.items?.anyOf;
        if(!Array.isArray(variants)||!variants.some(variant=>variant.properties?.kind?.const==='place'))continue;
        commands.items.anyOf=[...variants.filter(variant=>variant.properties?.kind?.const!=='place'),Type.Object({kind:Type.Literal('place'),
            action:Type.Union(PlaceEffect.anyOf.map(effect=>effect.properties.action))},{additionalProperties:true,description:'Location action with the same fields as the place tool.'})];
    }
    return projected;
}
