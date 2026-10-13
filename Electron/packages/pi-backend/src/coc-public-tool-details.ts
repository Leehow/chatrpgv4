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
export function publicPlayToolResult(toolName:unknown,result:unknown,isError:unknown):{content:string}{
  const details=row(row(result).details),error=row(details.coc_error);
  const failed=isError===true||Object.keys(error).length>0;
  const code=typeof error.code==='string'&&ERROR_CODES.has(error.code)?error.code:'unknown';
  const mechanics=mechanicsOf(details.mechanics);
  return {content:JSON.stringify({tool:typeof toolName==='string'&&PLAY_TOOLS.has(toolName)?toolName:'tool',
    status:failed?'failed':'completed',...(failed?{error_code:code}:{}),...(mechanics.length?{mechanics}:{})})};
}
