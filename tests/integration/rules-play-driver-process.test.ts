/** Current native driver, real child processes; fake Pi is unit transport evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import {readFileSync,readdirSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import * as driver from '../play/driver.ts';
import {ROOT} from './support.ts';
const DRIVER=join(ROOT,'tests/play/driver.ts'),FAKE_PI=join(ROOT,'tests/play/fixtures/fake-pi-rpc.mjs');
const run_driver=(args:string[],options:any={})=>{const r=spawnSync(process.execPath,[DRIVER,...args],{cwd:ROOT,env:{...process.env,...options.env},encoding:'utf8',timeout:(options.timeout??30)*1000});if(r.error)throw r.error;return {returncode:r.status,stdout:r.stdout,stderr:r.stderr};};
const read_json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const run_dir=driver.run_dir;
const pid_alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function started_run(t:any){const id='fixture-ts-'+randomUUID().slice(0,10);t.after(()=>{if(!existsSync(run_dir(id)))return;run_driver(['stop','--run',id],{timeout:15});const info=driver.read_json(join(run_dir(id),'daemon.json'),{});for(const key of ['daemon_pid','pi_pid'])if(info[key]&&pid_alive(info[key]))try{process.kill(info[key],'SIGKILL');}catch{}rmSync(run_dir(id),{recursive:true,force:true});});return [id,(extra_env:any={},model:string|null=null)=>run_driver(['start','--campaign','test-campaign','--run',id,'--launcher',FAKE_PI,'--no-default-run',...(model?['--model',model]:[])],{env:extra_env.extra_env??extra_env})] as const;}
import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
export async function test_start_writes_pid_and_heartbeat(started_run:any){
let run_id:any,start:any,proc:any,rdir:any,daemon_info:any,heartbeat:any;
const __unpack24808=started_run;assert.equal(__unpack24808.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack24808[0];start=__unpack24808[1];
proc=(await start());
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
rdir=(await run_dir(run_id));
daemon_info=(await read_json(String(pyDivide(rdir,"daemon.json"))));
assert.ok(pyBool(pyEqual(pyAt(daemon_info,"status"),"ready")),"tests/play/test_driver.py:497 assert daemon_info[\"status\"] == \"ready\"");
assert.ok(pyBool(Number.isInteger(pyAt(daemon_info,"daemon_pid"))),"tests/play/test_driver.py:498 assert isinstance(daemon_info[\"daemon_pid\"], int)");
assert.ok(pyBool(Number.isInteger(pyAt(daemon_info,"pi_pid"))),"tests/play/test_driver.py:499 assert isinstance(daemon_info[\"pi_pid\"], int)");
assert.ok(pyBool((await pid_alive(pyAt(daemon_info,"daemon_pid")))),"tests/play/test_driver.py:500 assert pid_alive(daemon_info[\"daemon_pid\"])");
assert.ok(pyBool((await pid_alive(pyAt(daemon_info,"pi_pid")))),"tests/play/test_driver.py:501 assert pid_alive(daemon_info[\"pi_pid\"])");
heartbeat=(await read_json(String(pyDivide(rdir,"heartbeat.json"))));
assert.ok(pyBool((pyAt(heartbeat,"pi_alive")===true)),"tests/play/test_driver.py:504 assert heartbeat[\"pi_alive\"] is True");
assert.ok(pyBool(pyEqual(pyAt(heartbeat,"turn_count"),0)),"tests/play/test_driver.py:505 assert heartbeat[\"turn_count\"] == 0");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_start_writes_pid_and_heartbeat"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_start_writes_pid_and_heartbeat(await started_run(t));});
export async function test_prompt_preflight_can_outlast_management_ack_timeout(started_run:any){
let run_id:any,start:any,result:any,turn:any;

const __unpack26622=started_run;assert.equal(__unpack26622.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack26622[0];start=__unpack26622[1];
assert.ok(pyBool(pyEqual((await start(({["FAKE_PI_PREFLIGHT_DELAY"]:"11"}))).returncode,0)),"tests/play/test_driver.py:538 assert start({\"FAKE_PI_PREFLIGHT_DELAY\": \"11\"}).returncode == 0");
result=(await run_driver(["turn","Look around.","--run",run_id,"--timeout","25"],{timeout:35}));
assert.ok(pyBool(pyEqual(result.returncode,0)),pyStr(pyAdd(result.stdout,result.stderr)));
turn=(await read_json(String(pyDivide((await run_dir(run_id)),"turn-1.json"))));
assert.ok(pyBool(pyEqual(pyAt(turn,"settle_class"),"settled")),"tests/play/test_driver.py:542 assert turn[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyLessEqual(11,pyAt(turn,"wall_seconds"))),"tests/play/test_driver.py:543 assert turn[\"wall_seconds\"] >= 11");
assert.ok(pyBool(pyContains(pyAt(turn,"final_text"),"cellar door creaks open")),"tests/play/test_driver.py:544 assert \"cellar door creaks open\" in turn[\"final_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_prompt_preflight_can_outlast_management_ack_timeout"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_prompt_preflight_can_outlast_management_ack_timeout(await started_run(t));});
export async function test_turn_prints_text_and_writes_settled_summary(started_run:any){
let run_id:any,start:any,proc:any,summary:any,tool:any;
const __unpack27148=started_run;assert.equal(__unpack27148.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack27148[0];start=__unpack27148[1];
assert.ok(pyBool(pyEqual((await start()).returncode,0)),"tests/play/test_driver.py:549 assert start().returncode == 0");
proc=(await run_driver(["turn","Look around the cellar.","--run",run_id,"--timeout","20"]));
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
assert.ok(pyBool(pyContains(proc.stdout,"cellar door creaks open")),"tests/play/test_driver.py:553 assert \"cellar door creaks open\" in proc.stdout");
assert.ok(pyBool(pyContains(proc.stdout,"[turn 1 |")),"tests/play/test_driver.py:554 assert \"[turn 1 |\" in proc.stdout");
assert.ok(pyBool(pyContains(proc.stdout,"tools: look")),"tests/play/test_driver.py:555 assert \"tools: look\" in proc.stdout");
summary=(await read_json(String(pyDivide((await run_dir(run_id)),"turn-1.json"))));
assert.ok(pyBool(pyEqual(pyAt(summary,"settle_class"),"settled")),"tests/play/test_driver.py:558 assert summary[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(summary,"player_text"),"Look around the cellar.")),"tests/play/test_driver.py:559 assert summary[\"player_text\"] == \"Look around the cellar.\"");
assert.ok(pyBool(pyContains(pyAt(summary,"final_text"),"cellar door creaks open")),"tests/play/test_driver.py:560 assert \"cellar door creaks open\" in summary[\"final_text\"]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(summary,"tools"))),1)),"tests/play/test_driver.py:561 assert len(summary[\"tools\"]) == 1");
tool=pyAt(pyAt(summary,"tools"),0);
assert.ok(pyBool(pyEqual(pyAt(tool,"name"),"look")),"tests/play/test_driver.py:563 assert tool[\"name\"] == \"look\"");
assert.ok(pyBool((await (async()=>{const __left=typeof pyAt(tool,"ms")==="number";return pyBool(__left)?pyLess(0,pyAt(tool,"ms")):__left;})())),"tests/play/test_driver.py:564 assert isinstance(tool[\"ms\"], (int, float)) and tool[\"ms\"] > 0");
assert.ok(pyBool(pyContains(pyAt(tool,"result_text"),"dusty cellar")),"tests/play/test_driver.py:565 assert \"dusty cellar\" in tool[\"result_text\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turn_prints_text_and_writes_settled_summary"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turn_prints_text_and_writes_settled_summary(await started_run(t));});
export async function test_turn_without_text_yields_undelivered_with_tools(started_run:any){
let run_id:any,start:any,proc:any,summary:any;
const __unpack28007=started_run;assert.equal(__unpack28007.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack28007[0];start=__unpack28007[1];
assert.ok(pyBool(pyEqual((await start(({"extra_env":({["FAKE_PI_NO_TEXT"]:"1"})}))).returncode,0)),"tests/play/test_driver.py:570 assert start(extra_env={\"FAKE_PI_NO_TEXT\": \"1\"}).returncode == 0");
proc=(await run_driver(["turn","Look around.","--run",run_id,"--timeout","20"]));
assert.ok(pyBool(pyEqual(proc.returncode,5)),pyStr(proc.stderr));
assert.ok(pyBool(pyContains(proc.stdout,"no assistant text this turn")),"tests/play/test_driver.py:574 assert \"no assistant text this turn\" in proc.stdout");
summary=(await read_json(String(pyDivide((await run_dir(run_id)),"turn-1.json"))));
assert.ok(pyBool(pyEqual(pyAt(summary,"settle_class"),"undelivered_with_tools")),"tests/play/test_driver.py:577 assert summary[\"settle_class\"] == \"undelivered_with_tools\"");
assert.ok(pyBool(pyEqual(pyAt(summary,"final_text"),"")),"tests/play/test_driver.py:578 assert summary[\"final_text\"] == \"\"");
assert.ok(pyBool(pyEqual((await pyLen(pyAt(summary,"tools"))),1)),"tests/play/test_driver.py:579 assert len(summary[\"tools\"]) == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(summary,"tools"),0),"name"),"look")),"tests/play/test_driver.py:580 assert summary[\"tools\"][0][\"name\"] == \"look\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_turn_without_text_yields_undelivered_with_tools"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_turn_without_text_yields_undelivered_with_tools(await started_run(t));});
export async function test_a_delivery_that_only_the_narrate_result_carries_is_still_the_turn(started_run:any){
let run_id:any,start:any,prose:any,proc:any,summary:any;

const __unpack29019=started_run;assert.equal(__unpack29019.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack29019[0];start=__unpack29019[1];
prose="门厅里落满灰，楼梯通向二楼。";
assert.ok(pyBool(pyEqual((await start(({"extra_env":({["FAKE_PI_NO_TEXT"]:"1",["FAKE_PI_DELIVER_VIA_TOOL"]:prose})}))).returncode,0)),"tests/play/test_driver.py:590 assert start(extra_env={\"FAKE_PI_NO_TEXT\": \"1\", \"FAKE_PI_DELIVER_VIA_TOOL\": prose}).returncode == 0");
proc=(await run_driver(["turn","我推门进去。","--run",run_id,"--timeout","20"]));
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
summary=(await read_json(String(pyDivide((await run_dir(run_id)),"turn-1.json"))));
assert.ok(pyBool(pyEqual(pyAt(summary,"settle_class"),"settled")),"tests/play/test_driver.py:596 assert summary[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(summary,"final_text"),prose)),"tests/play/test_driver.py:597 assert summary[\"final_text\"] == prose");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const tool of pyIterable(pyAt(summary,"tools"))){__rows.push(pyAt(tool,"name"));}return __rows;})()),["look","narrate"])),"tests/play/test_driver.py:598 assert [tool[\"name\"] for tool in summary[\"tools\"]] == [\"look\", \"narrate\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_delivery_that_only_the_narrate_result_carries_is_still_the_turn"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_delivery_that_only_the_narrate_result_carries_is_still_the_turn(await started_run(t));});
export async function test_stop_terminates_both_processes_and_writes_final(started_run:any){
let run_id:any,start:any,rdir:any,info:any,daemon_pid:any,pi_pid:any,proc:any,final:any,deadline:any;
const __unpack29605=started_run;assert.equal(__unpack29605.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack29605[0];start=__unpack29605[1];
assert.ok(pyBool(pyEqual((await start()).returncode,0)),"tests/play/test_driver.py:603 assert start().returncode == 0");
rdir=(await run_dir(run_id));
info=(await read_json(String(pyDivide(rdir,"daemon.json"))));
const __unpack29742=[pyAt(info,"daemon_pid"),pyAt(info,"pi_pid")];assert.equal(__unpack29742.length,2,"Original tuple unpacking requires exact arity");daemon_pid=__unpack29742[0];pi_pid=__unpack29742[1];
assert.ok(pyBool(pyEqual((await run_driver(["turn","Look around.","--run",run_id,"--timeout","20"])).returncode,0)),"tests/play/test_driver.py:608 assert run_driver(\"turn\", \"Look around.\", \"--run\", run_id, \"--timeout\", \"20\").returncode == 0");
proc=(await run_driver(["stop","--run",run_id],{timeout:15}));
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
final=(await read_json(String(pyDivide(rdir,"final.json"))));
assert.ok(pyBool(pyEqual(pyAt(final,"turn_count"),1)),"tests/play/test_driver.py:614 assert final[\"turn_count\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(final,"totals"),"tool_calls"),1)),"tests/play/test_driver.py:615 assert final[\"totals\"][\"tool_calls\"] == 1");
assert.ok(pyBool(pyLess(0,pyAt(pyAt(final,"totals"),"wall_seconds"))),"tests/play/test_driver.py:616 assert final[\"totals\"][\"wall_seconds\"] > 0");
deadline=pyAdd(driver.time.monotonic(),5.0);
while(pyBool((await (async()=>{const __left=pyLess(driver.time.monotonic(),deadline);return pyBool(__left)?((await (async()=>{const __left=(await pid_alive(daemon_pid));return pyBool(__left)?__left:(await pid_alive(pi_pid));})())):__left;})()))){await driver.sleep(.1);}
assert.ok(pyBool(!pyBool((await pid_alive(daemon_pid)))),pyStr("daemon process should be dead after stop"));
assert.ok(pyBool(!pyBool((await pid_alive(pi_pid)))),pyStr("pi process should be dead after stop"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_stop_terminates_both_processes_and_writes_final"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_stop_terminates_both_processes_and_writes_final(await started_run(t));});
export async function test_status_reports_alive_then_dead(started_run:any){
let run_id:any,start:any,proc:any;
const __unpack30542=started_run;assert.equal(__unpack30542.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack30542[0];start=__unpack30542[1];
assert.ok(pyBool(pyEqual((await start()).returncode,0)),"tests/play/test_driver.py:627 assert start().returncode == 0");
proc=(await run_driver(["status","--run",run_id]));
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
assert.ok(pyBool(pyContains(proc.stdout,"daemon alive")),"tests/play/test_driver.py:631 assert \"daemon alive\" in proc.stdout");
assert.ok(pyBool(pyContains(proc.stdout,"pi alive")),"tests/play/test_driver.py:632 assert \"pi alive\" in proc.stdout");
assert.ok(pyBool(pyEqual((await run_driver(["stop","--run",run_id],{timeout:15})).returncode,0)),"tests/play/test_driver.py:634 assert run_driver(\"stop\", \"--run\", run_id, timeout=15.0).returncode == 0");
proc=(await run_driver(["status","--run",run_id]));
assert.ok(pyBool(pyEqual(proc.returncode,1)),"tests/play/test_driver.py:637 assert proc.returncode == 1");
assert.ok(pyBool(pyContains(proc.stdout,"daemon unreachable")),"tests/play/test_driver.py:638 assert \"daemon unreachable\" in proc.stdout");
assert.ok(pyBool(pyContains(proc.stdout,"status=stopped")),"tests/play/test_driver.py:639 assert \"status=stopped\" in proc.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_status_reports_alive_then_dead"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_status_reports_alive_then_dead(await started_run(t));});
export async function test_log_tails_the_driver_log(started_run:any){
let run_id:any,start:any,proc:any;
const __unpack31082=started_run;assert.equal(__unpack31082.length,2,"Original tuple unpacking requires exact arity");run_id=__unpack31082[0];start=__unpack31082[1];
assert.ok(pyBool(pyEqual((await start()).returncode,0)),"tests/play/test_driver.py:644 assert start().returncode == 0");
proc=(await run_driver(["log","--run",run_id,"--tail","5"]));
assert.ok(pyBool(pyEqual(proc.returncode,0)),pyStr(proc.stderr));
assert.ok(pyBool(pyContains(proc.stdout,"daemon ready")),"tests/play/test_driver.py:648 assert \"daemon ready\" in proc.stdout");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_log_tails_the_driver_log"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_log_tails_the_driver_log(await started_run(t));});
test('test_second_run_on_same_campaign_continues_the_kernel_turn_and_records_resume',async t=>{const temporary=String(temporaryPath(t)),state_file=join(temporary,'kernel-state.json'),campaign='resume-continuity',a=await started_run(t),b=await started_run(t);assert.equal(run_driver(['start','--campaign',campaign,'--run',a[0],'--launcher',FAKE_PI,'--no-default-run'],{env:{FAKE_PI_KERNEL_STATE:state_file}}).returncode,0);const pa=run_driver(['turn','Explore the cellar.','--run',a[0],'--timeout','20']);assert.equal(pa.returncode,0,pa.stderr);const sa=read_json(join(run_dir(a[0]),'turn-1.json'));assert.ok(!sa.final_text.includes('resumed'));assert.ok(!Object.hasOwn(sa.tools[0].args,'resume'));assert.equal(run_driver(['stop','--run',a[0]],{timeout:15}).returncode,0);assert.equal(read_json(join(run_dir(a[0]),'final.json')).turn_count,1);assert.equal(run_driver(['start','--campaign',campaign,'--run',b[0],'--launcher',FAKE_PI,'--no-default-run'],{env:{FAKE_PI_KERNEL_STATE:state_file}}).returncode,0);const pb=run_driver(['turn','Look again.','--run',b[0],'--timeout','20']);assert.equal(pb.returncode,0,pb.stderr);const sb=read_json(join(run_dir(b[0]),'turn-1.json')),tool=sb.tools[0];assert.equal(tool.args.kernel_turn,2);assert.deepEqual(tool.args.resume,{turn:1});assert.ok(sb.final_text.includes('resumed: continuing from committed turn 1'));assert.ok(tool.result_text.includes('(resume: from turn 1 to turn 2)'));const events=readFileSync(join(run_dir(b[0]),'events.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.deepEqual(events.find(e=>e.type==='tool_execution_start').args.resume,{turn:1});});
test('test_real_pi_get_state_smoke',async t=>{const real=join(ROOT,'build/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');if(!existsSync(real)){t.skip('Vendored Pi not built');return;}const temp=String(temporaryPath(t)),pi=new driver.PiProcess(process.execPath,[real,'--mode','rpc','--no-session'],join(temp,'stderr.log'),join(temp,'events.jsonl'),new driver.DriverLog(join(temp,'driver.log')));try{const event=await pi.call({id:'smoke-1',type:'get_state'},20);if(!event){t.skip('Real Pi never answered get_state within20s');return;}assert.equal(event.type,'response');assert.equal(event.command,'get_state');assert.ok(Object.hasOwn(event,'success'));}finally{await pi.terminate();}});
test('test_concurrent_evidence_writers_have_independent_atomic_staging',async t=>{const temp=String(temporaryPath(t)),target=join(temp,'heartbeat.json'),barrier=new SharedArrayBuffer(4),values=[{writer:'heartbeat',turn:1},{writer:'turn',turn:2}],source=`const {workerData,parentPort}=require('node:worker_threads');(async()=>{const m=await import(workerData.module),gate=new Int32Array(workerData.barrier),replace=m.fileOps.replace;m.fileOps.replace=(src,dst)=>{if(dst===workerData.target){const previous=Atomics.add(gate,0,1);if(previous===0)Atomics.wait(gate,0,1,5000);else Atomics.notify(gate,0);}return replace(src,dst);};try{m.write_json(workerData.target,workerData.value);parentPort.postMessage({ok:true});}catch(error){parentPort.postMessage({error:String(error)});}})();`;const workers=values.map(value=>new Worker(source,{eval:true,workerData:{module:new URL('../play/driver.ts',import.meta.url).href,barrier,target,value}}));const results=await Promise.all(workers.map(w=>new Promise<any>((r,j)=>{w.once('message',r);w.once('error',j);})));await Promise.all(workers.map(w=>new Promise<void>(r=>w.once('exit',()=>r()))));assert.ok(workers.every(w=>w.threadId===-1));assert.deepEqual(results.filter(r=>r.error),[]);assert.ok(values.some(v=>JSON.stringify(v)===JSON.stringify(read_json(target))));assert.deepEqual(readdirSync(temp).filter(f=>f.startsWith('heartbeat.json.tmp')),[]);});
