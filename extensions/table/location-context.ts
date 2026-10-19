/** Request-only location detail: canonical validators and raw messages stay complete. */
import {Type} from 'typebox';
type Row=Record<string,any>;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const action=Type.Union([Type.Literal('move'),Type.Literal('establish'),Type.Literal('feature')]);
const entry=Type.Object({using_skill:Type.Optional(Type.String()),op:Type.Union([Type.Literal('inspect'),Type.Literal('submit')]),
    name:Type.Optional(Type.String()),need:Type.Optional(Type.Union([Type.Literal('context'),Type.Literal('contract')])),
    change:Type.Optional(Type.Object({action},{additionalProperties:true,description:'Typed location change; inspect need contract supplies its exact schema. Complete valid calls execute directly.'}))},{additionalProperties:false});

/** Like the existing apply capability envelope: the registered full validator is never changed. */
export function locationToolDeclarations<T extends {name:string;parameters:any;description?:string}>(tools:readonly T[]):T[] {
    return tools.map(tool=>{
        if(tool.name==='place')return {...tool,parameters:entry};
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
        const marker=object(message.details)?message.details.location_inspection:undefined;
        if(message.role!=='toolResult'||message.toolName!=='place'||!object(marker)||!Number.isInteger(marker.turn)||marker.turn>=turn)return message;
        const content=[{type:'text',text:JSON.stringify({location_inspection:{turn:marker.turn,need:marker.need,status:'historical_detail_omitted'},
            note:'Past location inspection detail is omitted from this request. Current position and state come from the current capsule; inspect the named place again if needed.'})}];
        omittedBytes+=Math.max(0,Buffer.byteLength(JSON.stringify(message.content))-Buffer.byteLength(JSON.stringify(content)));
        return {...message,content,details:{location_inspection:marker}};
    }),get omittedBytes(){return omittedBytes;}};
}
