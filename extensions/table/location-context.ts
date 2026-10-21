/** Request-only location detail: canonical validators and raw messages stay complete. */
import {Type} from 'typebox';
import {locationCommandEntry,locationCommandOwner,LocationTravelBand,PlaceChange} from '../../shared/place-structures.ts';
import {legibleClosedSchema} from '../../shared/native-schema.ts';
type Row=Record<string,any>;
/** Demand-only canonical names; semantic matching and creation still belong to the Keeper. */
export function locationIdentityContext(read:Row):Row|undefined {
    const candidates=read.catalogue??read.candidates;
    if(!Array.isArray(candidates))return;
    return {authority:'Partial identity references only, not access, player knowledge or an exhaustive world. Compare the requested place by meaning with these authored/registered identities before creating. Reuse the canonical name for the same place; translated display wording does not create another place. Distinct compatible unlisted places remain possible. Inspect a named target when identity or scale is uncertain.',
        current:read.place?.name??read.current,
        candidates:candidates.slice(0,24).map((candidate:Row)=>Object.fromEntries(['name','display_name','kind','origin','identity','place','feature','summary'].filter(key=>candidate[key]!==undefined).map(key=>[key,structuredClone(candidate[key])]))) };
}
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const action=Type.String({enum:['move','establish','feature','relate','observe']});
const read=Type.Object({using_skill:Type.Optional(Type.String()),action:Type.Literal('inspect'),name:Type.Optional(Type.String()),at:Type.Optional(Type.String()),spot:Type.Optional(Type.String()),relation:Type.Optional(Type.String()),sense:Type.Optional(Type.Union([Type.Literal('sight'),Type.Literal('hearing')])),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false,not:{required:['at','spot']}});
const entry={type:'object',properties:{...legibleClosedSchema(PlaceChange).properties,...read.properties,action:Type.String({enum:['inspect',...action.enum]}),
 to:Type.String({description:'Write destination; inspect uses name.'}),spot:Type.String({description:'Descriptive local position without fixture registration; use spot or exact registered at, never both. It grants no passage, fixture state or new place.'}),relation:Type.String(),via:Type.String({description:'Required for a new/unregistered route, including entry to a new room; describe the selected passage. May be omitted only for a registered/retraced route.'}),travel_band:LocationTravelBand,state:Type.String(),passable:Type.Boolean()},required:['action'],additionalProperties:true,
 anyOf:[read,Type.Object({using_skill:Type.Optional(Type.String()),action},{additionalProperties:true})]};
/** One explicit action survives serializers that omit root union guards. */
function describeModes(schema:Row,complete=false):Row {
 const projected=structuredClone(schema);
 projected.properties.action.description='inspect reads name/at/spot/relation/sense/need, never to/via/additions. move requires to and, for a new/unregistered route, via; optional at or spot, relation and additions. at references a registered feature; spot describes a compatible local position without creating a fixture. Keep action:"move" when correcting a route. A separately selected view still needs observe with scope/facts. establish requires additions:[{name,features:[{name,description}]}]. feature requires to and at, optional state/passable (existing feature; no description field). relate uses directed SpatialPoint pairs with place and optional at or spot, relation. observe: to/sense/access/scope/facts; optional target at or spot/relation, view/people/situations/additions. people requires existing canonical identities, never uncommitted new_N slots. Existing-place additions omit description and every registered feature. No op or change wrapper. Inspect need contract gives nested fields.';
 if(complete)projected.properties.action.description=projected.properties.action.description.replace('Inspect need contract gives nested fields.','All nested location fields are declared in this request. Inspect only genuinely missing state or grammar.');
 return projected;
}
/** Explicit properties keep object unions legible to provider tool serializers. */
function declarationObject(schema:Row,documentRoot=true):Row {
    if(!Array.isArray(schema.anyOf)||!schema.anyOf.every((branch:Row)=>branch.type==='object'))return schema;
    schema={...schema,anyOf:schema.anyOf.map((branch:Row)=>branch.properties?.action?.const==='observe'?{
        ...branch,properties:Object.fromEntries(Object.entries(branch.properties).filter(([key])=>key!=='relations')),
        ...(branch.required?{required:branch.required.filter((key:string)=>key!=='relations')}:{})}:branch)};
    const properties:Row={},variants=new Map<string,Map<string,unknown>>();
    for(const branch of schema.anyOf)for(const [key,value] of Object.entries(branch.properties??{})){
        if(!variants.has(key))variants.set(key,new Map());
        // Only the array schema's own annotation differs; nested data fields stay intact.
        const shape=object(value)&&value.type==='array'?Object.fromEntries(Object.entries(value).filter(([name])=>name!=='description')):value;
        const choices=variants.get(key)!,fingerprint=JSON.stringify(shape);
        if(!choices.has(fingerprint))choices.set(fingerprint,value);
    }
    for(const [key,values] of variants)properties[key]=values.size===1?[...values.values()][0]:Type.Union([...values.values()] as any);
    for(const key of Object.keys(properties))properties[key]=declarationObject(properties[key],false);
    const required=(schema.anyOf[0].required??[]).filter((key:string)=>schema.anyOf.every((branch:Row)=>(branch.required??[]).includes(key)));
    // Shared assertions remain explicit to generation without duplicating nested grammar.
    const branches=schema.anyOf.map((branch:Row)=>({type:'object',properties:Object.fromEntries(Object.entries(branch.properties??{}).map(([key,value]:[string,any])=>
        [key,documentRoot&&value.const===undefined&&variants.get(key)?.size===1?{$ref:'#/properties/'+key}:value])),
        required:branch.required??[],additionalProperties:branch.additionalProperties??true}));
    return {...schema,type:'object',properties,required,anyOf:branches,additionalProperties:false};
}

/** Like the existing apply capability envelope: the registered full validator is never changed. */
export function locationToolDeclarations<T extends {name:string;parameters:any;description?:string}>(tools:readonly T[],detail=false):T[] {
    return tools.map(tool=>{
        if(tool.name==='place'){
            if(tool.parameters?.properties?.op?.const==='inspect')return {...tool,parameters:detail?legibleClosedSchema(tool.parameters):tool.parameters};
            const native={anyOf:(tool.parameters.anyOf??[]).filter((branch:Row)=>branch.properties?.action)};
            const description=detail?'Complete location parameters are already declared for this request. Execute complete calls directly; inspect only missing state or genuinely missing grammar. '+(tool.description??'').replace('Exact fields are supplied by {action:"inspect",need:"contract"}. ',''):tool.description;
            return {...tool,...(detail?{description}:{}),parameters:describeModes(detail?legibleClosedSchema(declarationObject(native)):entry,detail)};
        }
        if(tool.name==='output')return {...tool,parameters:detail?locationCommandOwner(tool.parameters):locationCommandEntry(tool.parameters)};
        if(tool.name!=='apply'||!Array.isArray(tool.parameters?.properties?.effects?.items?.anyOf))return tool;
        const projected=structuredClone(tool),variants=projected.parameters.properties.effects.items.anyOf as Row[];
        const location=variants.filter(variant=>['move','place'].includes(variant.properties?.kind?.const??variant.properties?.kind?.enum?.[0]));
        if(!location.length)return tool;
        projected.parameters.properties.effects.items.anyOf=variants.filter(variant=>!location.includes(variant));
        projected.parameters.properties.effects.items.anyOf.push(Type.Object({kind:Type.Union([Type.Literal('move'),Type.Literal('place')])},
            {additionalProperties:true,description:'Location fields are supplied by place inspect need contract. Prefer the separate place tool; mixed atomic batches use the same validated handler.'}));
        return projected;
    });
}

/** Keep tool pairing and assistant continuations; omit only host-owned past location detail. */
export function projectLocationInspections(messages:readonly Row[],turn:number):{messages:Row[];omittedBytes:number} {
    let omittedBytes=0;
    return {messages:messages.map(message=>{
        const disclosure=object(message.details)?message.details.location_disclosure:undefined;
        if(message.role==='toolResult'&&object(disclosure)&&Number.isInteger(disclosure.turn)&&disclosure.turn<turn&&Number.isInteger(disclosure.index)&&Array.isArray(message.content)){
            const block=message.content[disclosure.index];
            if(block?.type==='text')try{
                const detail=JSON.parse(block.text);
                if(detail.kind==='disclosed_detail'){
                    const content=message.content.map((value:Row,index:number)=>index===disclosure.index?{...value,text:JSON.stringify({...detail,
                        ...(Array.isArray(detail.package_sections)&&typeof disclosure.package==='string'?{package_sections:detail.package_sections.filter((section:Row)=>section.package!==disclosure.package)}:{}),
                        ...(Array.isArray(detail.capability_detail)?{capability_detail:detail.capability_detail.filter((card:Row)=>!['place','place-change'].includes(card.name))}:{}),
                        location_detail:'Historical host location detail omitted; inspect again when needed.'})}:value);
                    omittedBytes+=Math.max(0,Buffer.byteLength(JSON.stringify(message.content))-Buffer.byteLength(JSON.stringify(content)));
                    message={...message,content};
                }
            }catch{/* An unrecognized block stays intact. */}
        }
        const marker=object(message.details)?message.details.location_inspection:undefined;
        if(message.role!=='toolResult'||message.toolName!=='place'||!object(marker)||!Number.isInteger(marker.turn)||marker.turn>=turn)return message;
        const content=[{type:'text',text:JSON.stringify({location_inspection:{turn:marker.turn,need:marker.need,status:'historical_detail_omitted'},
            note:'Past location inspection detail is omitted from this request. Current position and state come from the current capsule; inspect the named place again if needed.'})}];
        omittedBytes+=Math.max(0,Buffer.byteLength(JSON.stringify(message.content))-Buffer.byteLength(JSON.stringify(content)));
        return {...message,content,details:{location_inspection:marker}};
    }),get omittedBytes(){return omittedBytes;}};
}
