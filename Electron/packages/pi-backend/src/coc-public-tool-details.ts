/** Closed public activity metadata for the same live and restored play steps (§237.1). */
import {mechanicsEntry} from './coc-view.js';

type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const PLAY_TOOLS=new Set(['look','lookup','recall','resolve','apply','ask','narrate','output']);
// These are protocol codes, not classifications of diagnostic prose.
const ERROR_CODES=new Set(['invalid_params','unknown_method','not_implemented','campaign_not_found','campaign_not_ready',
  'turn_state','idempotency_conflict','needs','needs_choice','unknown_entity','not_reachable','not_here','not_owned',
  'revision_conflict','commit_failed','operation_in_progress','internal','blocked']);
const MECHANIC_FIELDS:Readonly<Record<string,readonly string[]>>={
  roll:['skill','roll','target','threshold','difficulty','level','passed','pushed','bonus','penalty'],
  dice:['label','expression','faces','total'],
  change:['resource','before','after'],
  condition:['gained','lost','standing','incapacitated'],
  scene:['minutes'],
  time:['minutes'],
  item:['name','label','quantity','adopted'],
  cash:['before','after','currency'],
};

/** Summarize only the already-projected mechanics field, never outcomes or raw receipts. */
function mechanicsOf(value:unknown):Row[]{
  if(!Array.isArray(value))return [];
  // Reuse the public card's visibility boundary before choosing summary fields.
  const entry=mechanicsEntry({type:'custom',customType:'coc-mechanics',data:{mechanics:value}});
  const mechanics=row(entry?.presentation?.details).mechanics;
  if(!Array.isArray(mechanics))return [];
  return mechanics.flatMap(value=>{
    const item=row(value),kind=typeof item.kind==='string'?item.kind:'';
    const fields=MECHANIC_FIELDS[kind];
    if(!fields||item.visibility!==undefined&&item.visibility!=='public'&&item.visibility!=='concealed')return [];
    // A concealed check may be named but its figures, outcome and target stay private.
    const allowed=item.visibility==='concealed'?(kind==='roll'?['skill']:kind==='dice'?['label']:[]):fields;
    const out:Row={kind};
    for(const key of allowed){
      const value=item[key];
      if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))out[key]=value;
      else if(Array.isArray(value)&&value.every(part=>typeof part==='string'||typeof part==='number'&&Number.isFinite(part)))out[key]=[...value];
    }
    return [out];
  });
}

/** No input, private result text, diagnostic message or arbitrary details crosses this boundary. */
export function publicPlayToolResult(toolName:unknown,result:unknown,isError:unknown,delivered?:unknown):{content:string}{
  const details=row(row(result).details),error=row(details.coc_error);
  const failed=isError===true||Object.keys(error).length>0;
  const code=typeof error.code==='string'&&ERROR_CODES.has(error.code)?error.code:'unknown';
  const mechanics=mechanicsOf(delivered??details.mechanics);
  return {content:JSON.stringify({tool:typeof toolName==='string'&&PLAY_TOOLS.has(toolName)?toolName:'tool',
    status:failed?'failed':'completed',...(failed?{error_code:code}:{}),...(mechanics.length?{mechanics}:{})})};
}

type DeliveredToolResult={toolCallId:string;content:string;cardIds:string[];campaign:string};
/** Derive summaries only from the selected parent chain and its already-delivered public cards. */
export function deliveredPlayToolResults(selected:readonly any[]):Map<string,DeliveredToolResult>{
  const summaries=new Map<string,DeliveredToolResult>();
  let campaign:string|undefined,play=false;
  let tools:any[]=[];
  const starts=new Map<string,Row>();
  const delivered=new Map<string,Map<string,unknown>>();
  for(const entry of selected){
    if(entry?.customType==='coc-session'){
      campaign=typeof entry.data?.campaign==='string'?entry.data.campaign:undefined;
      play=entry.data?.mode==='play';tools=[];starts.clear();delivered.clear();
    }
    if(entry?.type==='message'&&entry.message?.role==='user'){tools=[];starts.clear();delivered.clear();}
    if(!play)continue;
    const message=entry?.message,details=row(message?.details);
    if(entry?.type==='message'&&message?.role==='toolResult'&&typeof entry.id==='string'
      &&typeof message.toolCallId==='string'&&message.isError!==true&&!Object.keys(row(details.coc_error)).length
      &&Array.isArray(details.receipts)&&details.receipts.every(id=>typeof id==='string'))tools.push(entry);
    const frame=row(entry?.data);
    if(campaign&&entry?.customType==='coc-final-delivery'&&frame.version===1&&frame.event==='start'
      &&frame.campaign===campaign&&typeof frame.delivery_id==='string'&&frame.delivery_id
      &&Number.isSafeInteger(frame.turn)&&typeof frame.worldline==='string'&&frame.worldline
      &&Number.isSafeInteger(frame.loop))starts.set(frame.delivery_id,frame);
    if(entry?.customType!=='coc-mechanics'||typeof entry.id!=='string'||!Array.isArray(frame.mechanics))continue;
    const start=typeof frame.final_stream_id==='string'?starts.get(frame.final_stream_id):undefined;
    if(!start||frame.turn!==start.turn)continue;
    for(const tool of tools){
      const receipts=new Set<string>(tool.message.details.receipts);
      const matches=frame.mechanics.filter(value=>typeof row(value).receipt==='string'&&receipts.has(row(value).receipt as string));
      if(!mechanicsOf(matches).length)continue;
      const seen=delivered.get(tool.id)??new Map<string,unknown>();
      for(const item of matches)seen.set(row(item).receipt as string,item);
      delivered.set(tool.id,seen);
      const previous=summaries.get(tool.id);
      summaries.set(tool.id,{toolCallId:tool.message.toolCallId,campaign:campaign!,
        content:publicPlayToolResult(tool.message.toolName,{details:tool.message.details},false,[...seen.values()]).content,
        cardIds:[...new Set([...(previous?.cardIds??[]),entry.id])]});
    }
  }
  return summaries;
}
