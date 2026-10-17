/** Counterfactual packing of identical retained real projections; never a player or Keeper. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {journalRepairSource} from './patch-runtime.mjs';
import {residentSnapshot} from './residency.ts';
import {requestSize,pairedTools} from '../../extensions/table/context-policy.ts';
const sha=value=>createHash('sha256').update(value).digest('hex');
const lines=path=>readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const snapshots=new Set(['coc-context-brief','coc-capsule','coc-history','coc-clerk','coc-capsule-update','coc-prescreen','coc-workspace']);
const visible=messages=>messages.map(({timestamp,...message})=>message);
function prefixOpportunity(previous,current){
  const before=visible(previous??[]),after=visible(current);let count=0;
  while(count<before.length&&count<after.length&&isDeepStrictEqual(before[count],after[count]))count++;
  const kept=count?requestSize(current.slice(0,count)):0;
  return {common_messages:count,common_prefix_bytes:kept,new_suffix_bytes:requestSize(current)-kept};
}

async function factory(source){
  const imports=`import {customMessage,pairedTools,requestSize} from ${JSON.stringify(new URL('../../extensions/table/context-policy.ts',import.meta.url).href)};\n`;
  const {createRequestJournal}=await import('data:text/javascript;base64,'+Buffer.from(imports+source+'\nexport {createRequestJournal};').toString('base64'));
  return createRequestJournal;
}

export async function replayStage2(originalTable,runDirectory){
  const table=readFileSync(originalTable,'utf8');
  const source=table.split('// extensions/table/request-journal.ts\n')[1]?.split('\n// extensions/anthropic-cache/shared/policy.js')[0];
  if(!source)throw Error('Retained journal source seam unavailable');
  const ordinary=(await factory(source))(),repaired=(await factory(journalRepairSource(source,{compiled:true})))();
  const run=resolve(runDirectory),path=join(run,'workspace/.coc/context-residency-projections.jsonl');
  const frames=lines(path),events=lines(join(run,'events.jsonl'));
  let eventIndex=0;
  let previousOrdinary,previousRepaired;
  const observations=[];
  for(const frame of frames){
    while(eventIndex<events.length&&events[eventIndex]._recv_at<=frame.at){
      const row=events[eventIndex++];
      if(row.type==='message_end'&&row.message?.role==='assistant'){
        ordinary.complete(row.message);repaired.complete(row.message);
      }
    }
    const input={key:frame.key,turn:frame.binding.turn,budget:frame.budget,messages:frame.fresh};
    if(typeof input.key!=='string'||!Number.isSafeInteger(input.budget))throw Error('Incomplete retained admission');
    const control=ordinary.project(input),variant=repaired.project(input);
    for(const [arm,result]of [['ordinary',control],['repaired',variant]]){
      if(!pairedTools(result.messages)||requestSize(result.messages)>input.budget)throw Error(arm+' lost pairing or capacity');
      for(const message of input.messages.filter(message=>snapshots.has(message.customType))){
        const current=residentSnapshot(result.messages,message.customType)?.value;
        const expected=JSON.parse(message.content);delete expected.context_type;
        if(!isDeepStrictEqual(current,expected))throw Error(arm+' changed current owner snapshot '+message.customType);
      }
      for(const message of input.messages.filter(message=>message.role!=='custom'))
        if(!result.messages.some(candidate=>isDeepStrictEqual(message,candidate)))throw Error(arm+' lost current native traffic');
    }
    observations.push({sequence:frame.sequence,turn:input.turn,fresh_sha256:sha(JSON.stringify(frame.fresh)),
      ordinary_bytes:requestSize(control.messages),repaired_bytes:requestSize(variant.messages),
      ordinary_reset:control.observation.reset??null,repaired_reset:variant.observation.reset??null,
      ordinary_prefix:prefixOpportunity(previousOrdinary,control.messages),
      repaired_prefix:prefixOpportunity(previousRepaired,variant.messages),
      reclaimed_bytes:variant.observation.reclaimed_bytes??0,focus_changed:variant.observation.focus_changed??false,
      actual_delivery_verified:frame.delivered,
      actual_matches_ordinary:isDeepStrictEqual(visible(frame.outgoing),visible(control.messages)),
      actual_matches_repaired:isDeepStrictEqual(visible(frame.outgoing),visible(variant.messages)),
      current_owner_snapshots_preserved:true,current_native_traffic_preserved:true});
    previousOrdinary=control.messages;previousRepaired=variant.messages;
    ordinary.commit();repaired.commit();
  }
  const sum=key=>observations.reduce((total,row)=>total+row[key],0);
  return {run,original_table_sha256:sha(table),projection_file_sha256:sha(readFileSync(path)),
    kind:'deterministic_same_projection_packing',frames:frames.length,observations,
    aggregate:{ordinary_bytes:sum('ordinary_bytes'),repaired_bytes:sum('repaired_bytes'),reclaimed_bytes:sum('reclaimed_bytes'),
      saved_projection_bytes:sum('ordinary_bytes')-sum('repaired_bytes'),
      ordinary_new_suffix_bytes:observations.reduce((total,row)=>total+row.ordinary_prefix.new_suffix_bytes,0),
      repaired_new_suffix_bytes:observations.reduce((total,row)=>total+row.repaired_prefix.new_suffix_bytes,0),
      reclamations:observations.filter(row=>row.repaired_reset==='residency_reclaim').length,
      actual_matches_ordinary:observations.filter(row=>row.actual_matches_ordinary).length,
      actual_matches_repaired:observations.filter(row=>row.actual_matches_repaired).length,
      all_current_views_preserved:true},
    limitations:['Uses identical real owner projections; no model inference or gameplay is simulated.',
      'Later model actions are held fixed; this is a packer counterfactual, not a causal wall-time prediction.',
      'Projection byte estimates are not provider tokens or billed cache writes.']};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [original,output,...runs]=process.argv.slice(2);if(!output||!runs.length)throw Error('Usage: node replay-stage2.mjs ORIGINAL_TABLE OUTPUT RUN...');
  const results=[];for(const run of runs)results.push(await replayStage2(original,run));
  writeFileSync(output,JSON.stringify({created_at:new Date().toISOString(),results},null,2)+'\n');
  console.log(JSON.stringify(results.map(result=>({run:result.run,frames:result.frames,...result.aggregate})),null,2));
}
