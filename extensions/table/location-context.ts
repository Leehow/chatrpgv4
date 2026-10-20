/** Request-only location detail: canonical validators and raw messages stay complete. */
import {Type} from 'typebox';
import {locationCommandEntry,locationCommandOwner} from '../../shared/place-structures.ts';
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
const read=Type.Object({using_skill:Type.Optional(Type.String()),action:Type.Literal('inspect'),name:Type.Optional(Type.String()),at:Type.Optional(Type.String()),sense:Type.Optional(Type.Union([Type.Literal('sight'),Type.Literal('hearing')])),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract'),Type.Literal('observation')]))},{additionalProperties:false});
const entry={type:'object',properties:{...read.properties,action:Type.String({enum:['inspect',...action.enum]})},required:['action'],additionalProperties:true,
 anyOf:[read,Type.Object({using_skill:Type.Optional(Type.String()),action},{additionalProperties:true})]};
/** One explicit action survives serializers that omit root union guards. */
function describeModes(schema:Row):Row {
 const projected=structuredClone(schema);
 projected.properties.action.description='Choose one action. inspect only reads name/at/sense/need. move, establish, feature, relate or observe directly commits that typed change. Example: {"action":"move","to":"here","at":"window","relation":"beside"}. No op or change wrapper. Inspect need contract supplies exact action fields.';
 return projected;
}
/** Explicit properties keep object unions legible to provider tool serializers. */
function declarationObject(schema:Row):Row {
    if(!Array.isArray(schema.anyOf)||!schema.anyOf.every((branch:Row)=>branch.type==='object'))return schema;
    schema={...schema,anyOf:schema.anyOf.map((branch:Row)=>branch.properties?.action?.const==='observe'?Type.Omit(branch as any,['relations'],{additionalProperties:false}):branch)};
    const properties:Row={},variants=new Map<string,Map<string,unknown>>();
    for(const branch of schema.anyOf)for(const [key,value] of Object.entries(branch.properties??{})){
        if(!variants.has(key))variants.set(key,new Map());
        variants.get(key)!.set(JSON.stringify(value),value);
    }
    for(const [key,values] of variants)properties[key]=values.size===1?[...values.values()][0]:Type.Union([...values.values()] as any);
    for(const key of Object.keys(properties))properties[key]=declarationObject(properties[key]);
    const required=(schema.anyOf[0].required??[]).filter((key:string)=>schema.anyOf.every((branch:Row)=>(branch.required??[]).includes(key)));
    const branches=schema.anyOf.map((branch:Row)=>({type:'object',properties:Object.fromEntries(Object.entries(branch.properties??{}).map(([key,value]:[string,any])=>
        [key,value.const!==undefined||Array.isArray(value.enum)?value:{}])),required:branch.required??[],additionalProperties:branch.additionalProperties??true}));
    return {...schema,type:'object',properties,required,anyOf:branches,additionalProperties:false};
}

/** Like the existing apply capability envelope: the registered full validator is never changed. */
export function locationToolDeclarations<T extends {name:string;parameters:any;description?:string}>(tools:readonly T[],detail=false):T[] {
    return tools.map(tool=>{
        if(tool.name==='place'){
            if(tool.parameters?.properties?.op?.const==='inspect')return {...tool,parameters:detail?legibleClosedSchema(tool.parameters):tool.parameters};
            const native={anyOf:(tool.parameters.anyOf??[]).filter((branch:Row)=>branch.properties?.action)};
            return {...tool,parameters:describeModes(detail?legibleClosedSchema(declarationObject(native)):entry)};
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
