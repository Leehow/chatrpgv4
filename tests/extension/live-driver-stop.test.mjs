import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Daemon,PiProcess,DriverLog} from '../play/driver.ts';

test('stopping an in-flight transport wakes the turn and records final totals', {timeout:10000}, async t=>{
  const root=mkdtempSync(join(tmpdir(),'live-driver-stop-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  // This child only implements RPC acknowledgements. It supplies no Keeper decisions or prose.
  const script=String.raw`let buffer=''; process.stdin.on('data',chunk=>{buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){const request=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      process.stdout.write(JSON.stringify({type:'response',id:request.id,success:true,data:request.type==='get_state'?{isStreaming:false,isCompacting:false,pendingMessageCount:0}:{}})+'\n');
      if(request.type==='prompt')process.stdout.write(JSON.stringify({type:'agent_start'})+'\n');}});`;
  const daemon=new Daemon('unit-transport-stop-'+randomUUID(),'not-a-campaign');
  const fixtureDir=daemon.dir;t.after(()=>rmSync(fixtureDir,{recursive:true,force:true}));
  daemon.dir=root;daemon.daemon_json_path=join(root,'daemon.json');daemon.heartbeat_path=join(root,'heartbeat.json');
  daemon.log=new DriverLog(join(root,'driver.log'));
  const child=new PiProcess(process.execPath,['--input-type=module','--eval',script],join(root,'stderr.log'),join(root,'events.jsonl'),daemon.log);
  daemon.pi=child;t.after(()=>child.terminate());
  const turn=daemon.handle_turn('transport unit input',600);
  const deadline=Date.now()+5000;
  while(!child.turn_queue?.items.some(row=>row.type==='agent_start')&&!readFileSyncIfPresent(join(root,'events.jsonl')).includes('agent_start')){
    assert.ok(Date.now()<deadline,'The real child never acknowledged the prompt');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const began=Date.now(),stop=await daemon.handle_stop(),result=await turn;
  assert.ok(Date.now()-began<3000,'Stop waited for the 600-second player timeout');
  assert.equal(child.alive(),false);assert.equal(daemon.turn_in_progress,false);
  assert.equal(result.summary.stop_reason,'pi_died');assert.equal(result.summary.settle_class,'empty');
  assert.equal(result.summary.final_text,'');assert.deepEqual(result.summary.tools,[]);
  assert.equal(stop.final.totals.wall_seconds,result.summary.wall_seconds);
  assert.ok(stop.final.totals.wall_seconds>0);
  assert.equal(JSON.parse(readFileSync(join(root,'final.json'))).totals.wall_seconds,result.summary.wall_seconds);
  assert.ok(!readFileSync(join(root,'events.jsonl'),'utf8').includes('pi_process_closed'),'Internal wake must not masquerade as a Pi event');
});
function readFileSyncIfPresent(path){try{return readFileSync(path,'utf8');}catch{return '';}}

test('a previous input settling after prompt acknowledgement cannot finish the queued player input',{timeout:10000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'live-driver-admission-'));
  // Protocol scheduling only: no real campaign, model or Keeper decisions.
  const script=String.raw`const emit=row=>process.stdout.write(JSON.stringify(row)+'\n');let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const req=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);emit({type:'response',id:req.id,success:true,data:req.type==='get_state'?{isStreaming:false,pendingMessageCount:0}:{}});if(req.type!=='prompt')continue;
    emit({type:'agent_start'});emit({type:'tool_execution_start',toolCallId:'previous',toolName:'look',args:{}});emit({type:'tool_execution_end',toolCallId:'previous',result:{content:[]}});emit({type:'message_end',message:{role:'custom',customType:'coc-delivery',display:true,content:'Previous input delivery',details:{coc_delivery:true}}});emit({type:'agent_settled'});
    setTimeout(()=>{emit({type:'message_end',message:{role:'user',content:[{type:'text',text:req.message}]}});emit({type:'agent_start'});emit({type:'tool_execution_start',toolCallId:'current',toolName:'look',args:{phase:'current'}});emit({type:'tool_execution_end',toolCallId:'current',result:{content:[]}});emit({type:'message_end',message:{role:'custom',customType:'coc-delivery',display:true,content:'Current input delivery',details:{coc_delivery:true}}});emit({type:'agent_settled'});},100);
  }});`;
  const daemon=new Daemon('unit-transport-admission-'+randomUUID(),'not-a-campaign'),fixtureDir=daemon.dir;
  daemon.dir=root;daemon.daemon_json_path=join(root,'daemon.json');daemon.heartbeat_path=join(root,'heartbeat.json');daemon.log=new DriverLog(join(root,'driver.log'));
  const child=new PiProcess(process.execPath,['--input-type=module','--eval',script],join(root,'stderr.log'),join(root,'events.jsonl'),daemon.log);
  daemon.pi=child;t.after(async()=>{await child.terminate();rmSync(root,{recursive:true,force:true});rmSync(fixtureDir,{recursive:true,force:true});});
  const result=await daemon.handle_turn('The current transport input',8);
  assert.equal(result.summary.final_text,'Current input delivery');
  assert.deepEqual(result.summary.tools.map(tool=>tool.args.phase),['current']);
  assert.equal(result.summary.input_observed,true);assert.ok(result.summary.startup_events>=4);
  assert.equal(result.summary.stale_settles,1);
});
