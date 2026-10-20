/** Enhanced Locations v1: one bounded command at every entrance (contract 242). */
import {Type,type Static} from 'typebox';
import {legibleClosedSchema} from './native-schema.ts';
const name=()=>Type.String({minLength:1,maxLength:240});
const fact=()=>Type.String({minLength:1,maxLength:1200});
const feature=Type.Object({name:name(),description:fact(),state:Type.Optional(fact()),passable:Type.Optional(Type.Boolean())},{additionalProperties:false});
export const PlaceAddition=Type.Object({name:Type.String({minLength:1,maxLength:240,description:'The leaf name, or an already qualified name under within. The parent prefix is never repeated.'}),within:Type.Optional(Type.Union([name(),Type.Null(),Type.Literal('')],{description:'The exact containing place. Omit, use JSON null or an empty string for no registered parent; never the literal string null.'})),description:Type.Optional(fact()),
    features:Type.Optional(Type.Array(feature,{maxItems:16}))},{additionalProperties:false});
const using_skill=Type.Optional(Type.String({description:'Optional exact currently offered skill card name; host-only annotation, never authority.'}));
const additions=Type.Optional(Type.Array(PlaceAddition,{minItems:1,maxItems:12}));
export const SpatialPoint=Type.Object({place:name(),at:Type.Optional(name())},{additionalProperties:false});
const sense=()=>Type.Union([Type.Literal('sight'),Type.Literal('hearing')]);
const observedFact=()=>Type.String({minLength:1,maxLength:600});
const targetFeature=()=>Type.String({minLength:1,maxLength:240,description:'Optional existing feature of the observation target named by to or name. Omit when observing the whole target. The observer window comes from current position or view, never this field.'});
export const PerceptualRelation=Type.Object({from:SpatialPoint,to:SpatialPoint,sense:sense(),description:observedFact()},{additionalProperties:false});
const relations=Type.Array(PerceptualRelation,{minItems:1,maxItems:8});
export const ObservedSituation=Type.Object({name:name(),summary:observedFact(),status:Type.Union([Type.Literal('ongoing'),Type.Literal('ended'),Type.Literal('unknown')]),participants:Type.Optional(Type.Array(name(),{maxItems:8}))},{additionalProperties:false});
export const PlaceEffect=Type.Union([
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('move'),to:name(),at:Type.Optional(Type.String({minLength:1,maxLength:240,description:'An existing local feature in the destination, such as its desk or window.'})),relation:Type.Optional(Type.String({minLength:1,maxLength:240,description:'Relation to the at feature, such as beside; never the containing place. Put containment in additions[].within.'})),
        via:Type.Optional(Type.String({minLength:1,maxLength:240,description:'Describe the selected route when no registered or retraced route exists, including entry to a new room. A missing route is an argument correction, not a nonexistent destination.'})),through:Type.Optional(Type.Object({place:name(),feature:name()},{additionalProperties:false})),travel_band:Type.Optional(name()),travel_minutes:Type.Optional(Type.Integer({minimum:0})),additions},{additionalProperties:false,description:'Move the party to the named place or local feature. For an actual visit to a new place, include its minimal additions in this move.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('establish'),additions:Type.Array(PlaceAddition,{minItems:1,maxItems:12})},{additionalProperties:false,description:'Register observable surroundings only; no party movement. To visit a new room or place, use action move with additions instead.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('feature'),to:name(),at:name(),state:Type.Optional(fact()),passable:Type.Optional(Type.Boolean())},{additionalProperties:false}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('relate'),relations,additions},{additionalProperties:false,description:'Establish minimal directed sight/hearing relations; no movement or player observation.'}),
    Type.Object({kind:Type.Literal('place'),action:Type.Literal('observe'),to:name(),at:Type.Optional(targetFeature()),sense:sense(),access:Type.Union([Type.Literal('clear'),Type.Literal('limited'),Type.Literal('blocked')]),
        scope:observedFact(),facts:Type.Array(observedFact(),{maxItems:6}),view:Type.Optional(Type.String({minLength:1,maxLength:600,description:'Compatible sensory path from the actual current position to this target, through any door or window. Seeds a missing relation; reuses an existing one. Does not move the observer.'})),reason:Type.Optional(observedFact()),people:Type.Optional(Type.Array(name(),{maxItems:8})),situations:Type.Optional(Type.Array(ObservedSituation,{maxItems:4})),
        relations:Type.Optional(relations),additions},{additionalProperties:false,description:'Record actual selected perception from the current position. Missing compatible layout can be supplied inline. People stay at the target; blocked attempts establish no target facts.'}),
]);
export const PlaceChange=Type.Union(PlaceEffect.anyOf.map(effect=>{
    const description=(effect as typeof effect & {description?:string}).description;
    return Type.Object(Object.fromEntries(Object.entries(effect.properties).filter(([key])=>key!=='kind')),{additionalProperties:false,...(description?{description}:{})});
}));
export const NativePlaceParameters=Type.Union([
    Type.Object({using_skill,action:Type.Literal('inspect'),name:Type.Optional(name()),at:Type.Optional(targetFeature()),sense:Type.Optional(sense()),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false}),
    ...PlaceChange.anyOf.map(branch=>Type.Object({...branch.properties,using_skill},{additionalProperties:false})),
]);
export const PlaceParameters=Type.Union([
    ...NativePlaceParameters.anyOf,
    Type.Object({using_skill,op:Type.Literal('inspect'),name:Type.Optional(name()),at:Type.Optional(targetFeature()),sense:Type.Optional(sense()),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false}),
    Type.Object({using_skill,op:Type.Literal('submit'),change:PlaceChange},{additionalProperties:false}),
]);
export type LocationEffect=Static<typeof PlaceEffect>;

/** An applicable location provider owns party movement before provider conversion. */
export function locationCommandOwner<T extends Record<string,any>>(parameters:T):T {
    if(!parameters.properties?.commands)return parameters;
    const projected=structuredClone(parameters);
    for(const commands of projected.properties.commands.anyOf??[projected.properties.commands]){
        const variants=commands.items?.anyOf;
        if(Array.isArray(variants)&&variants.some(variant=>variant.properties?.kind?.const==='place'))
            commands.items.anyOf=variants.filter(variant=>variant.properties?.kind?.const!=='move');
    }
    return legibleClosedSchema({...projected,description:'The location provider owns party movement and observation through kind place and its action. Issued destinations are reference material; a place move can visit a compatible unlisted destination with minimal additions.'});
}

/** Request-only native grammar; complete validation always uses PlaceEffect. */
export function locationCommandEntry<T extends Record<string,any>>(parameters:T):T {
    if(!parameters.properties?.commands)return parameters;
    const projected=structuredClone(parameters);
    for(const commands of projected.properties.commands.anyOf??[projected.properties.commands]){
        const variants=commands.items?.anyOf;
        if(!Array.isArray(variants)||!variants.some(variant=>variant.properties?.kind?.const==='place'))continue;
        commands.items.anyOf=[...variants.filter(variant=>variant.properties?.kind?.const!=='place'),Type.Object({kind:Type.Literal('place'),
            action:Type.Union(PlaceEffect.anyOf.map(effect=>effect.properties.action))},{additionalProperties:true,description:'Location action; place inspect need contract supplies the exact fields. Complete valid calls execute directly.'})];
    }
    return projected;
}
