/** Summarize retained real-driver evidence. This never drives or fabricates a player. */
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const lines=path=>existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const sum=(rows,field)=>rows.reduce((n,row)=>n+(Number.isFinite(row[field])?row[field]:0),0);
const round=n=>Math.round(n*1000)/1000;
const countBy=(rows,key)=>{const result={};for(const row of rows){const value=key(row);if(value)result[value]=(result[value]??0)+1;}return result;};
export function report(runDirectory){
  const directory=resolve(runDirectory),events=lines(join(directory,'events.jsonl'));
  const telemetry=events.filter(row=>row.entry?.customType==='coc-telemetry').map(row=>({...row.entry.data,_at:row._recv_at}));
  const residency=lines(join(directory,'workspace/.coc/context-residency-prototype.jsonl'));
  const turns=readdirSync(directory).filter(file=>/^turn-\d+\.json$/.test(file)).map(file=>JSON.parse(readFileSync(join(directory,file),'utf8'))).sort((a,b)=>a.turn-b.turn);
  const perInput=turns.map(turn=>{
    const from=Date.parse(turn.started_at),until=Date.parse(turn.ended_at),within=time=>{const at=Date.parse(time);return at>=from&&at<=until;};
    const rows=events.filter(row=>within(row._recv_at)),ts=telemetry.filter(row=>within(row._at));
    const cache=ts.filter(row=>row.lane==='anthropic-cache'&&row.phase==='usage');
    const prepared=residency.filter(row=>within(row.at)&&row.event==='projected');
    const preparation=residency.filter(row=>within(row.at)&&['projected','omitted','fallback'].includes(row.event));
    const authored=ts.filter(row=>['isolated-expression','final-output'].includes(row.lane)&&row.event==='written');
    const first=rows.find(row=>row.entry?.customType==='coc-final-delivery'&&row.entry.data?.event==='delta'&&row.entry.data?.delta);
    const requests=ts.filter(row=>row.lane==='anthropic-cache'&&row.phase==='request');
    const main=rows.filter(row=>row.type==='message_end'&&row.message?.role==='assistant');
    const journal=ts.filter(row=>row.lane==='context'&&row.event==='request_journal');
    const providerCalls=ts.filter(row=>row.lane==='provider-call');
    const providerTiming=providerCalls.map(call=>{
      const ended=Date.parse(call._at),started=ended-call.ms;
      const response=ts.find(row=>row.lane==='provider-response'&&Date.parse(row._at)>=started&&Date.parse(row._at)<=ended);
      const wait=response?Date.parse(response._at)-started:null;
      return {total_ms:call.ms,header_wait_ms:wait,after_headers_ms:wait===null?null:call.ms-wait,stop_reason:call.stop_reason};
    });
    const kernel=ts.filter(row=>row.lane==='kernel-rpc');
    const continuous=ts.filter(row=>row.lane==='continuous-turn');
    const admission=ts.filter(row=>row.lane==='admission');
    return {input:turn.turn,player_text:turn.player_text,settle:turn.settle_class,wall_seconds:turn.wall_seconds,
      readiness_seconds:turn.timings?.readiness_wait_seconds,keeper_seconds:turn.timings?.keeper_wait_seconds,
      first_public_seconds:first?round((Date.parse(first._recv_at)-from)/1000):null,output_chars:turn.final_text?.length??0,
      tools:countBy(turn.tools??[],row=>row.name),material_reads:(turn.tools??[]).filter(row=>['look','lookup','recall'].includes(row.name)).length,
      rejected_tools:countBy((turn.tools??[]).filter(row=>row.is_error),row=>row.name),
      native_search_calls:sum(ts.filter(row=>row.lane==='native-search'&&row.event==='response'),'calls'),
      main_requests:requests.length,main_completions:main.length,uncached_input_tokens:sum(cache,'input'),cache_read_tokens:sum(cache,'read'),
      cache_write_tokens:cache.length&&cache.every(row=>Number.isFinite(row.write))?sum(cache,'write'):null,
      main_output_tokens:sum(main.map(row=>row.message.usage??{}),'output'),
      main_provider_timing:{calls:providerTiming,cumulative_ms:sum(providerTiming,'total_ms'),
        header_wait_ms:providerTiming.every(row=>row.header_wait_ms!==null)?sum(providerTiming,'header_wait_ms'):null,
        after_headers_ms:providerTiming.every(row=>row.after_headers_ms!==null)?sum(providerTiming,'after_headers_ms'):null},
      kernel_rpc:{calls:kernel.length,cumulative_ms:sum(kernel,'total_ms'),by_method:countBy(kernel,row=>row.method)},
      final_author_ms:sum(authored,'ms'),author_models:[...new Set(authored.flatMap(row=>row.actual_models??[row.model]).filter(Boolean))],
      main_reasoning_efforts:[...new Set(ts.flatMap(row=>row.lane==='provider-request'?[row.reasoning_effort]
        :row.lane==='stage3-wire'&&row.event==='request'?[row.effort]:[]).filter(Boolean))],
      response_replay_restorations:sum(journal,'restored_response_texts'),
      protocol_wire:ts.filter(row=>row.lane==='stage3-wire').map(row=>({event:row.event,request:row.request,
        effort:row.effort,assistant_replay:row.assistant_replay,blocks:row.blocks,text_bytes:row.text_bytes,tool_bytes:row.tool_bytes,stop_reason:row.stop_reason})),
      auxiliary_requests:countBy(ts.filter(row=>row.lane==='lane-call'&&row.phase==='request'),row=>row.subsession),
      turn_decisions:{native_rounds:continuous.filter(row=>['decision','decision_unavailable'].includes(row.event)).length,
        native_ms:sum(continuous.filter(row=>row.event==='decision'),'ms'),
        selected:continuous.filter(row=>row.event==='decision').flatMap(row=>row.selected??[]),
        executions:continuous.filter(row=>row.event==='execution').map(row=>({status:row.status,selected:row.selected})),
        admission_calls:sum(admission,'jev_calls'),admission_reuses:admission.filter(row=>row.reused).length,
        admission_results:admission.map(row=>({ok:row.ok,verdict:row.verdict,reason:row.reason,reused:row.reused,
          probability:row.line_admit_probabilities,ms:row.ms}))},
      journal_requests:journal.length,journal_resets:countBy(journal,row=>row.reset),
      journal_reclaimed_bytes:sum(journal,'reclaimed_bytes'),
      degraded_requests:ts.filter(row=>row.lane==='context'&&row.event==='request'&&row.reason).map(row=>({reason:row.reason,capacity:row.capacity})),
      residency:{projections:prepared.length,owner_reads:sum(preparation,'owner_reads'),additional_catalog_reads:sum(preparation,'owner_reads'),
        reuse_projections:prepared.filter(row=>row.stage!==2&&row.owner_reads===0).length,
        unchanged_owner_projection_observations:prepared.filter(row=>row.stage===2).length,
        preparation_ms:sum(preparation,'ms'),net_added_bytes:prepared.map(row=>row.after_bytes-row.before_bytes),
        verified_deliveries:residency.filter(row=>within(row.at)&&row.event==='delivered'&&row.delivered===true).length,
        failed_deliveries:residency.filter(row=>within(row.at)&&row.event==='delivered'&&row.delivered!==true).length,
        fallbacks:residency.filter(row=>within(row.at)&&row.event==='fallback')},
      errors:main.filter(row=>row.message.stopReason==='error').map(row=>row.message.errorMessage)};
  });
  return {directory,actual_models:[...new Set([...events.filter(row=>row.type==='message_end'&&row.message?.model).map(row=>row.message.provider+'/'+row.message.model),
      ...telemetry.flatMap(row=>[...(row.actual_models??[]),...(typeof row.model==='string'&&row.model.includes('/')?[row.model]:[])])])],
    actual_reasoning_efforts:[...new Set(telemetry.flatMap(row=>[row.reasoning_effort,row.lane_thinking_effective,
      ...(row.lane==='stage3-wire'?[row.effort]:[])]).filter(Boolean))],
    all_run_residency:{owner_reads:sum(residency,'owner_reads'),preparation_ms:sum(residency.filter(row=>['projected','omitted','fallback'].includes(row.event)),'ms'),
      projections:residency.filter(row=>row.event==='projected').length,verified_deliveries:residency.filter(row=>row.event==='delivered'&&row.delivered===true).length},
    automatic_opening_excluded_from_player_inputs:true,per_input:perInput,
    aggregate:{inputs:perInput.length,settled:perInput.filter(row=>row.settle==='settled').length,wall_seconds:round(sum(perInput,'wall_seconds')),
      keeper_seconds:round(sum(perInput,'keeper_seconds')),main_requests:sum(perInput,'main_requests'),material_reads:sum(perInput,'material_reads'),
      main_provider_ms:perInput.reduce((total,row)=>total+row.main_provider_timing.cumulative_ms,0),
      main_header_wait_ms:perInput.every(row=>row.main_provider_timing.header_wait_ms!==null)?perInput.reduce((total,row)=>total+row.main_provider_timing.header_wait_ms,0):null,
      main_output_tokens:sum(perInput,'main_output_tokens'),final_author_ms:sum(perInput,'final_author_ms'),
      rejected_tool_calls:perInput.reduce((total,row)=>total+Object.values(row.rejected_tools).reduce((n,count)=>n+count,0),0),
      uncached_input_tokens:sum(perInput,'uncached_input_tokens'),cache_read_tokens:sum(perInput,'cache_read_tokens'),
      cache_write_tokens:perInput.every(row=>row.cache_write_tokens!==null)?sum(perInput,'cache_write_tokens'):null,
      journal_reclaimed_bytes:sum(perInput,'journal_reclaimed_bytes'),output_chars:sum(perInput,'output_chars')},
    limitations:['Automatic opening is a warmup, excluded from per-input aggregates.','Cache writes are null when the provider omitted the field; normalized adapter zero is not evidence of zero writes.',
      'Added-byte figures use the existing local requestSize estimate, not actual provider wire bytes or tokens.',
      'Stage 2 observes issued owner projections. Zero additional catalog reads is not an avoided native owner read or a new residency cache hit.',
      'Tokens cover observed main requests, not an invented all-role billing total.','Separate live conversations can diverge; these are exploratory samples, not a causal speedup estimate.']};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [output,...runs]=process.argv.slice(2);if(!output||!runs.length)throw Error('Usage: node report.mjs OUTPUT.json RUN_DIRECTORY...');
  const result={created_at:new Date().toISOString(),runs:runs.map(report)};writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.runs.map(run=>({directory:run.directory,...run.aggregate})),null,2));
}
