/** Bounded request-only history. Canonical state and the stored Pi transcript are never edited. */
import {customMessage,pairedTools,requestSize,type Row} from './context-policy.ts';

const SNAPSHOTS=new Set(['coc-context-brief','coc-capsule','coc-history','coc-clerk','coc-capsule-update','coc-prescreen','coc-workspace']);
const REVISION_HEAD='This is the current request context. Initial snapshots name their context_type; the initial context_brief is coc-context-brief. Apply these revisions in order: sections replace top-level fields, removed deletes fields, value replaces the whole snapshot, and patch applies RFC 6902 operations to that snapshot. Later values supersede earlier values, including book and package instructions. Retired context types no longer supply current state or instructions. The latest active capsule and its latest active capsule update define current state. Earlier player inputs, instructions and tool traffic are historical; do not repeat their actions or settlements.';
type State={key:string;turn:number;budget:number;messages:Row[];snapshots:Map<string,Row>;native:Map<string,string>;opaque:Set<string>};
type Input={key:string;turn:number;messages:Row[];budget:number};

function jsonSnapshot(message:Row):Row|undefined{
  if(message.role!=='custom'||!SNAPSHOTS.has(message.customType)||typeof message.content!=='string')return;
  try{const value=JSON.parse(message.content);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}
}
function nativeKey(message:Row,turn:number,index:number):string{
  if(message.role==='toolResult')return `result:${message.toolCallId}`;
  const calls=message.role==='assistant'&&Array.isArray(message.content)
    ?message.content.filter((block:Row)=>block.type==='toolCall').map((block:Row)=>block.id):[];
  return calls.length?`calls:${JSON.stringify(calls)}`:`${turn}:${message.role}:${message.timestamp??index}`;
}
const nativeValue=(message:Row)=>JSON.stringify([message.role,message.content,message.toolCallId,message.toolName,message.isError,message.thinkingLevel]);
const record=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pointer=(path:string,key:string)=>path+'/'+key.replaceAll('~','~0').replaceAll('/','~1');
/** Structural JSON Patch only: no language, relevance or content interpretation. */
function patchValues(before:any,after:any,path='',patch:Row[]=[]):Row[]{
  if(JSON.stringify(before)===JSON.stringify(after))return patch;
  if(record(before)&&record(after)){
    for(const key of Object.keys(before))if(!Object.hasOwn(after,key))patch.push({op:'remove',path:pointer(path,key)});
    for(const [key,value] of Object.entries(after)){
      if(!Object.hasOwn(before,key))patch.push({op:'add',path:pointer(path,key),value});
      else patchValues(before[key],value,pointer(path,key),patch);
    }
  }else if(Array.isArray(before)&&Array.isArray(after)&&before.length<=after.length
    &&(before.length===after.length||before.every((value,index)=>JSON.stringify(value)===JSON.stringify(after[index])))){
    for(let index=0;index<before.length;index++)patchValues(before[index],after[index],pointer(path,String(index)),patch);
    for(const value of after.slice(before.length))patch.push({op:'add',path:path+'/-',value});
  }else patch.push({op:'replace',path,value:after});
  return patch;
}

export function createRequestJournal(){
  let committed:State|undefined,pending:State|undefined,resetReason='initial';
  const reset=(reason='initial')=>{committed=undefined;pending=undefined;resetReason=reason;};
  function project(input:Input):{messages:Row[];observation:Row}{
    pending=undefined;
    const counts=new Map<string,number>();
    const rows=input.messages.map(message=>{
      const snapshot=jsonSnapshot(message);
      // Snapshot kinds are singular in the admitted projection. Duplicates use the ordinary path.
      if(snapshot)counts.set(message.customType,(counts.get(message.customType)??0)+1);
      return {message,snapshot};
    });
    if([...counts.values()].some(count=>count!==1)||!pairedTools(input.messages)){
      reset();return{messages:input.messages,observation:{reset:'unsupported_projection'}};
    }
    const checkpoint=(reason:string)=>{
      const state:State={key:input.key,turn:input.turn,budget:input.budget,messages:[],snapshots:new Map(),native:new Map(),opaque:new Set()};
      let index=0;
      for(const {message,snapshot} of rows){
        if(snapshot){
          state.snapshots.set(message.customType,structuredClone(snapshot));
          state.messages.push(message.customType==='coc-context-brief'?structuredClone(message)
            :{...message,content:JSON.stringify({...snapshot,context_type:message.customType})});
        }else{
          state.messages.push(structuredClone(message));
          if(message.role==='custom')state.opaque.add(JSON.stringify([message.customType,message.content]));
          else state.native.set(nativeKey(message,input.turn,index++),nativeValue(message));
        }
      }
      // Tagging is transport metadata and must not defeat the existing request ceiling.
      if(requestSize(state.messages)>input.budget){reset();return{messages:input.messages,observation:{reset:'checkpoint_capacity'}};}
      pending=state;
      return{messages:structuredClone(state.messages),observation:{reset:reason,retained_bytes:0,appended_bytes:requestSize(state.messages)}};
    };
    if(!committed)return checkpoint(resetReason);
    if(committed.key!==input.key)return checkpoint('identity_changed');
    if(input.turn<committed.turn)return checkpoint('turn_rewound');
    const next:State={...committed,turn:input.turn,budget:input.budget,messages:structuredClone(committed.messages),
      snapshots:new Map(committed.snapshots),native:new Map(committed.native),opaque:new Set(committed.opaque)};
    const additions:Row[]=[],updates:Row[]=[],retired:string[]=[];
    let index=0,scope:unknown;
    for(const {message,snapshot} of rows){
      if(snapshot){
        if(snapshot.native_search_scope)scope=snapshot.native_search_scope;
        const previous=next.snapshots.get(message.customType);
        if(!previous)updates.push({context_type:message.customType,value:snapshot});
        else{
          const sections=Object.fromEntries(Object.entries(snapshot).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(previous[key])));
          const removed=Object.keys(previous).filter(key=>!Object.hasOwn(snapshot,key));
          if(Object.keys(sections).length||removed.length){
            const whole={sections,...(removed.length?{removed}:{})},patch={patch:patchValues(previous,snapshot)};
            updates.push({context_type:message.customType,...(JSON.stringify(patch).length<JSON.stringify(whole).length?patch:whole)});
          }
        }
        next.snapshots.set(message.customType,structuredClone(snapshot));
      }else if(message.role==='custom'){
        const key=JSON.stringify([message.customType,message.content]);
        if(!next.opaque.has(key)){next.opaque.add(key);additions.push(structuredClone(message));}
      }else{
        const key=nativeKey(message,input.turn,index++),value=nativeValue(message),previous=next.native.get(key);
        if(previous!==undefined&&previous!==value)return checkpoint('native_message_changed');
        if(previous===undefined){next.native.set(key,value);additions.push(structuredClone(message));}
      }
    }
    for(const key of next.snapshots.keys())if(!counts.has(key)){retired.push(key);next.snapshots.delete(key);}
    // Results stay immediately after their native calls. The revision follows new native traffic.
    if(additions.length||updates.length||retired.length||input.turn!==committed.turn){
      additions.push(customMessage('coc-context-revision',{kind:'context_revision',head:REVISION_HEAD,turn:input.turn,
        updates,...(retired.length?{retired}:{}),...(scope?{native_search_scope:scope}:{})}));
    }
    next.messages.push(...additions);
    if(!pairedTools(next.messages))return checkpoint('tool_pair_changed');
    if(requestSize(next.messages)>input.budget)return checkpoint('capacity');
    pending=next;
    return{messages:structuredClone(next.messages),observation:{retained_bytes:requestSize(committed.messages),
      appended_bytes:requestSize(additions),retained_messages:committed.messages.length}};
  }
  return{project,commit(){if(pending)committed=pending;pending=undefined;},
    complete(message:Row){
      // Tool responses join with their results in the next admitted projection. Never leave a dangling call.
      if(!committed||message.role!=='assistant'||message.stopReason!=='stop'
        ||!Array.isArray(message.content)||message.content.some((block:Row)=>block.type==='toolCall'))return;
      const key=nativeKey(message,committed.turn,committed.native.size);
      if(committed.native.has(key))return;
      if(requestSize([...committed.messages,message])>committed.budget){reset('response_capacity');return;}
      committed.messages.push(structuredClone(message));committed.native.set(key,nativeValue(message));
    },reset};
}
