import type {ReaderPriority} from './reader.ts';
/** Run exact-source retrieval / one final guide through the existing native Pi source driver. */
import{createHash,randomUUID}from'node:crypto';
import{mkdir,readFile,writeFile}from'node:fs/promises';
import{join,dirname}from'node:path';
import type{HostRuntime}from'../../runtime/host.ts';
import type{TaskProviderBudget}from'../../runtime/jev/provider-budget.ts';
import{validateReferencePacket,type SourceReferencePacket}from'../../kernel-ts/modules/reference-contract.ts';
type Row=Record<string,any>;
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export type ReferenceResult={packet:SourceReferencePacket;text?:string;workDir:string;receipt:Row;ms:number};
export async function runSourceReference(input:{runtime:HostRuntime;source:{pdf:string;cache:string;file_sha256:string;page_count:number};moduleId:string;kind:'guidance'|'lookup';
 focus?:string;question?:string;language?:string;materializePlace?:boolean;knownNodes?:Row[];packet?:SourceReferencePacket;providerBudget?:TaskProviderBudget;priority?:ReaderPriority;model:{id:string;thinking?:string};signal?:AbortSignal;record?:(row:Row)=>void}):Promise<ReferenceResult>{
 const began=Date.now(),cwd=join(dirname(input.source.pdf),'work','source-reference-'+randomUUID());await mkdir(cwd,{recursive:true});
 const task={purpose:input.kind==='guidance'?'guidance':'answer',source_reference:input.kind,module_id:input.moduleId,
  focus:input.focus??'',question:input.question??'',play_language:input.language??'en',materialize_place:input.materializePlace===true,known_nodes:input.knownNodes??[],...(input.packet?{source_reference_packet:input.packet}:{}),source:{page_count:input.source.page_count,file_sha256:input.source.file_sha256}};
 const bytes=JSON.stringify(task)+'\n';await writeFile(join(cwd,'task.json'),bytes);let submitted=false;
 const run=await input.runtime.runTask({kind:'reader',request:{cwd,prompt:{phase:'read',reference:input.kind},source:input.source,providerBudget:input.providerBudget,priority:input.priority,
  brief:input.kind==='guidance'?'Use the original source packet supplied by the host. Write only the final public introduction and question with submit_reference_guidance.':'Retrieve original source excerpts. The host completes this task without a generated answer.',
  model:input.model.id,thinking:input.model.thinking,maxRequests:3,timeoutMs:120000,eventLog:join(cwd,'events.jsonl'),
  tools:'read,write,edit,bash,pdf'+(input.kind==='guidance'?',submit_reference_guidance':''),
  onEvent(event){if(event.type==='tool_execution_end'&&event.toolName==='submit_reference_guidance'&&!event.isError&&event.result?.details?.kind==='source_reference_ready')submitted=true;}
 }},input.signal);
 await writeFile(join(cwd,'run-result.json'),JSON.stringify(run)+'\n');
 if(!run.ok||input.kind==='guidance'&&!submitted)throw Error(run.error??'Native source reference did not complete its checked final step');
 const receipt=JSON.parse(await readFile(join(cwd,'source-reference-complete.json'),'utf8')),packetBytes=await readFile(join(cwd,'source-reference.json'));
 if(receipt.protocol!=='source-reference-v1'||receipt.source_sha256!==input.source.file_sha256||receipt.task_sha256!==digest(bytes)||receipt.packet_sha256!==digest(packetBytes))throw Error('Source reference receipt does not match its immutable task');
 const packet=validateReferencePacket(JSON.parse(packetBytes.toString()),input.source.page_count,input.source.file_sha256);
 let text:string|undefined;if(input.kind==='guidance'){text=await readFile(join(cwd,'reference-guidance.txt'),'utf8');if(receipt.kind!=='guidance'||receipt.text_sha256!==digest(text))throw Error('Final guidance differs from its checked text');}
 else if(receipt.kind!=='excerpts')throw Error('Source lookup returned another artifact kind');
 const ms=Date.now()-began;input.record?.({lane:'source-reference',event:'complete',module_id:input.moduleId,kind:input.kind,ms,excerpts:packet.excerpts.length,usage:run.usage});
 return {packet,text,workDir:cwd,receipt,ms};
}
