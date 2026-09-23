/**
 * Extract the live Keeper's turn-3 baseline from the App's retained session file and campaign record.
 * Read-only. Writes fixtures/<name>/baseline.json.
 *
 *   node experiments/single-loop-routing/baseline.mjs --fixture turn3
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LIVE_HOME,readFixture} from './fixture.mjs';

const name=process.argv[process.argv.indexOf('--fixture')+1]||'turn3';
const {dir,turn}=readFixture(name);
const session=join(LIVE_HOME,'agent/ui-sessions/play',turn.session.directory,turn.session.file);
const rows=readFileSync(session,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
const telemetry=row=>row.type==='custom'&&row.customType==='coc-telemetry'?row.data??{}:undefined;
const start=rows.findIndex(row=>row.message?.role==='user'&&row.timestamp===turn.session.user_message_at);
if(start<0)throw new Error('turn input message not found');
const end=rows.findIndex((row,index)=>index>start&&telemetry(row)?.event==='turn-closed');
const calls=[],tools=[],admissions=[];let pendingCall;
for(const row of rows.slice(start,end+2)){
  const data=telemetry(row);
  if(data?.lane==='provider-call')pendingCall=data;
  if(data?.lane==='admission')admissions.push({verb:data.verb,verdict:data.verdict,ms:data.ms});
  if(data?.tool&&data.call_id)tools.push({tool:data.tool,call_id:data.call_id,ms:data.ms,ok:data.ok});
  const message=row.message;
  if(message?.role==='assistant'){
    calls.push({at:row.timestamp,provider_ms:pendingCall?.ms??null,stop_reason:message.stopReason,model:message.model,
      usage:{input:message.usage?.input??null,output:message.usage?.output??null,cache_read:message.usage?.cacheRead??null},
      tool_calls:(message.content??[]).filter(part=>part.type==='toolCall').map(part=>({name:part.name,arguments:part.arguments}))});
    pendingCall=undefined;
  }
}
const actions=[];
for(const call of calls)for(const tool of call.tool_calls){
  if(tool.name==='apply')for(const effect of tool.arguments.effects??[])actions.push({verb:'apply',kind:effect.kind,
    target:effect.to??effect.who??effect.clue??effect.name??null,...(effect.minutes??effect.travel_minutes?{minutes:effect.minutes??effect.travel_minutes}:{})});
  else if(tool.name==='resolve'){const action=tool.arguments.action??{};actions.push({verb:'resolve',decision:action.decision??null,skill:action.skill??null,
    target:action.target??null,intent:action.intent??null,modifiers:action.modifiers??null});}
  else actions.push({verb:tool.name});
}
if(calls.at(-1)?.stop_reason==='stop'&&!calls.at(-1).tool_calls.length)actions.push({verb:'narrate',implicit:true});
const repo=join(LIVE_HOME,'.coc/repos',`${turn.campaign}.git`);
const record=JSON.parse(spawnSync('git',['--git-dir',repo,'show',`${turn.commit_after}:turns/${String(turn.turn).padStart(4,'0')}.json`],{encoding:'utf8',maxBuffer:64*1024*1024}).stdout);
const userAt=Date.parse(rows[start].timestamp),closedAt=Date.parse(rows[end].timestamp);
const baseline={source:{session:`agent/ui-sessions/play/${turn.session.directory}/${turn.session.file}`,record:`.coc/repos/${turn.campaign}.git ${turn.commit_after}:turns/${String(turn.turn).padStart(4,'0')}.json`},
  keeper_model:calls[0]?.model??null,player_text_recorded:record.player_text,
  llm_calls:calls.length,llm_ms_total:calls.reduce((sum,call)=>sum+(call.provider_ms??0),0),
  wall_ms:closedAt-userAt,wall_from:rows[start].timestamp,wall_to:rows[end].timestamp,
  calls,tools,admissions,actions,receipts:record.receipts.map(receipt=>({id:receipt.id,kind:receipt.kind,
    ...(receipt.kind==='move'?{to:receipt.to,minutes:receipt.minutes}:{}),...(receipt.kind==='roll'?{decision:receipt.decision??null,skill:receipt.skill??null,npc:receipt.npc??null,level:receipt.level??null}:{}),
    ...(receipt.kind==='person'?{who:receipt.who}:{}),...(receipt.kind==='clue'?{clue:receipt.clue}:{}),...(receipt.kind==='handout'?{handout:receipt.handout}:{}),
    ...(receipt.kind==='time'?{minutes:receipt.minutes}:{})}))};
writeFileSync(join(dir,'baseline.json'),JSON.stringify(baseline,null,1)+'\n');
console.log(JSON.stringify({llm_calls:baseline.llm_calls,llm_ms_total:baseline.llm_ms_total,wall_ms:baseline.wall_ms,actions:baseline.actions.length}));
