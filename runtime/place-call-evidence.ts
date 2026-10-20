/** One bounded location protocol comparison per turn; observation only, never repair. */
import {createHash} from 'node:crypto';
type Row=Record<string,any>;
export function createPlaceCallEvidence(record:(row:Row)=>void){
 let turn:number|undefined,raw:Row|undefined,normalized=false,prepared=false,requested=false;
 const enter=(next:number)=>{if(turn!==next){turn=next;raw=undefined;normalized=false;prepared=false;requested=false;}};
 const bounded=(value:unknown)=>{
  try{
   const json=JSON.stringify(value??null),bytes=Buffer.byteLength(json);
   return bytes<=8192?{arguments:JSON.parse(json)}:{omitted:true,bytes,sha256:createHash('sha256').update(json).digest('hex')};
  }catch{return {unavailable:true};}
 };
 const emit=(row:Row)=>{try{record({lane:'place-protocol',turn,...row});}catch{/* Diagnostics never decide a tool result. */}};
 return {
  request(payload:Row,next:number){
   enter(next);if(requested||!payload||!Array.isArray(payload.tools))return;
   const tool=(payload.tools??[]).find((row:Row)=>(row.function?.name??row.name)==='place');
   if(!tool)return;requested=true;const schema=tool.input_schema??tool.parameters??tool.function?.parameters??{};
   emit({phase:'request_schema',fields:Object.keys(schema.properties??{}),required:schema.required??[],action:bounded(schema.properties?.action),root_union_branches:(schema.anyOf??schema.oneOf??[]).length});
  },
  provider(event:Row,next:number){
   enter(next);if(event.api!=='anthropic-messages')return;
   const data=event.data??{};
   if(!raw&&data.type==='content_block_start'&&data.content_block?.type==='tool_use'&&data.content_block.name==='place')
    raw={id:data.content_block.id,index:data.index,provider:event.provider,model:event.model,initial:bounded(data.content_block.input),chunks:'',bytes:0,hash:createHash('sha256')};
   if(!raw||data.index!==raw.index||raw.done)return;
   if(data.type==='content_block_delta'&&data.delta?.type==='input_json_delta'){
    const chunk=String(data.delta.partial_json??'');raw.bytes+=Buffer.byteLength(chunk);raw.hash.update(chunk);
    if(raw.bytes<=8192)raw.chunks+=chunk;else raw.chunks='';
   }
   if(data.type==='content_block_stop'){
    raw.done=true;let delta:Row;
    if(raw.bytes>8192)delta={omitted:true,bytes:raw.bytes,sha256:raw.hash.digest('hex')};
    else try{delta=raw.chunks?bounded(JSON.parse(raw.chunks)):{absent:true};}catch{delta={invalid_json:true,bytes:raw.bytes};}
    emit({phase:'provider',tool_call_id:raw.id,provider:raw.provider,model:raw.model,initial:raw.initial,delta});
   }
  },
  message(message:Row,next:number){
   enter(next);if(normalized||message.role!=='assistant')return;
   const call=(message.content??[]).find((block:Row)=>block.type==='toolCall'&&block.name==='place');if(!call)return;
   normalized=true;emit({phase:'normalized',tool_call_id:call.id,raw_tool_call_id:raw?.id??null,raw_block_observed:!!raw,...bounded(call.arguments)});
  },
  prepare(args:unknown,next:number){enter(next);if(prepared)return;prepared=true;emit({phase:'prepare',raw_tool_call_id:raw?.id??null,...bounded(args)});},
 };
}
