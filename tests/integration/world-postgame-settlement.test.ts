// Migrated from tests/kernel/test_postgame_settlement.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CONTENT_DIR,RpcClient,campaign_dir,narrate,open_turn,read_json,first_success,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {development,RuleTables} from "./world-production-support.ts";
const __file__=new URL('../../tests/kernel/test_postgame_settlement.py',import.meta.url).pathname;






export async function end_session(client:any,call_id:any,fields:any={}){
return (await pyMethod(client,"table",["resolve"],{"call_id":call_id,"action":({["intent"]:"montage",["goal"]:"Account for the source-reviewed conclusion.",["method"]:"",["decision"]:"development:end-session",...fields})}));
}
Object.defineProperty(end_session,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false},{"name":"fields","rest":true,"varargs":false}]});
export async function legacy_completed(client:any){
let call_id:any,_:any,ordinal:any,directory:any,world:any,meta:any;

(await pyInvoke(open_turn,[client],{}));
const __unpack712=(await pyInvoke(first_success,[client,"t1-c"],{"intent":"investigate","goal":"Inspect the desk.","method":"Spot Hidden"}));call_id=__unpack712[0];_=__unpack712[1];
ordinal=pyAdd((await pyInvoke(pyInt,[pyAt((await pyMethod(call_id,"split",["-c"],{})),1)],{})),1);
(await pyInvoke(narrate,[client,`t1-c${ordinal}`,"调查结束。"],{}));
directory=(await pyInvoke(campaign_dir,[client.workspace],{}));
world=(await pyInvoke(read_json,[pyDivide(directory,"world.json")],{}));
world["ending"]=({["summary"]:"The prior release closed the investigation.",["turn"]:1});
(await pyMethod((pyDivide(directory,"world.json")),"write_text",[(await pyMethod(json,"dumps",[world],{}))],{}));
meta=(await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{}));
(await pyMethod(meta,"update",[],{"status":"completed","ending":pyAt(world,"ending")}));
(await pyMethod((pyDivide(directory,"campaign.json")),"write_text",[(await pyMethod(json,"dumps",[meta],{}))],{}));
return [directory,world];
}
Object.defineProperty(legacy_completed,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false}]});
export async function test_ending_requires_accounting_and_source_expression_uses_existing_frozen_plan(kernel:any){
let directory:any,before:any,error:any,result:any,outcome:any,capsule:any,replay:any;
(await pyInvoke(open_turn,[kernel],{}));
directory=(await pyInvoke(campaign_dir,[kernel.workspace],{}));
before=(await pyMethod((pyDivide(directory,"world.json")),"read_bytes",[],{}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5}),({["kind"]:"ending",["scope"]:"campaign",["summary"]:"The investigation is over."})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"reason"),"ending_settlement_required"):__left})())),"tests/kernel/test_postgame_settlement.py:38 assert error['code'] == 'needs' and error['details']['reason'] == 'ending_settlement_required'");
assert.ok(pyBool(pyContains(pyAt(error,"fix"),"development:end-session")),"tests/kernel/test_postgame_settlement.py:39 assert 'development:end-session' in error['fix']");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"world.json")),"read_bytes",[],{})),before)),"tests/kernel/test_postgame_settlement.py:40 assert (directory / 'world.json').read_bytes() == before");
result=(await pyInvoke(end_session,[kernel,"t1-c1"],{"scenario_san_reward_expr":"100D1"}));
outcome=pyAt(result,"outcome");
assert.ok(pyBool(pyEqual(pyAt(pyAt(outcome,"scenario_san_reward_roll"),"total"),100)),"tests/kernel/test_postgame_settlement.py:43 assert outcome['scenario_san_reward_roll']['total'] == 100");
assert.ok(pyBool(pyEqual(pyAt(outcome,"san_after"),99)),"tests/kernel/test_postgame_settlement.py:44 assert outcome['san_after'] == 99");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"investigator"})),"san"),99)),"tests/kernel/test_postgame_settlement.py:45 assert kernel.table('look', focus='investigator')['san'] == 99");
capsule=(await pyMethod(development,"load_ending_capsule",[directory,pyAt(outcome,"ending_id")],{}));
assert.ok(pyBool(pyEqual(pyAt(capsule,"scenario_san_reward_expr"),"100D1")),"tests/kernel/test_postgame_settlement.py:47 assert capsule['scenario_san_reward_expr'] == '100D1'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(capsule,"development_inputs"),"thomas-hayes"),"deterministic_plan"),"scenario_san_reward"),"total"),100)),"tests/kernel/test_postgame_settlement.py:48 assert capsule['development_inputs']['thomas-hayes']['deterministic_plan']['scenario_san_reward']['total'] == 100");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"ending",["scope"]:"campaign",["summary"]:"The investigation is over."})]}));
(await pyInvoke(narrate,[kernel,"t1-c3","调查结束。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"核对结算。"}));
replay=(await pyInvoke(end_session,[kernel,"t2-c1"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(replay,"outcome"),"ending_id"),pyAt(outcome,"ending_id"))),"tests/kernel/test_postgame_settlement.py:53 assert replay['outcome']['ending_id'] == outcome['ending_id']");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(replay,"outcome"),"status"),"replayed");return pyBool(__left)?pyEqual(pyAt(replay,"effects"),[]):__left})())),"tests/kernel/test_postgame_settlement.py:54 assert replay['outcome']['status'] == 'replayed' and replay['effects'] == []");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(development,"list_endings",[directory],{}))],{})),1)),"tests/kernel/test_postgame_settlement.py:55 assert len(development.list_endings(directory)) == 1");
}
Object.defineProperty(test_ending_requires_accounting_and_source_expression_uses_existing_frozen_plan,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ending_requires_accounting_and_source_expression_uses_existing_frozen_plan"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ending_requires_accounting_and_source_expression_uses_existing_frozen_plan(await kernel(t,{}));});
export async function test_late_accounting_preserves_ending_and_cannot_repeat_or_replace_reward(kernel:any){
let directory:any,world:any,old_record:any,before:any,result:any,outcome:any,capsule:any,after:any,replay:any,error:any,client:any,again:any;
const __unpack3074=(await pyInvoke(legacy_completed,[kernel],{}));directory=__unpack3074[0];world=__unpack3074[1];
old_record=(await pyMethod((pyDivide(directory,"turns/0001.json")),"read_bytes",[],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"请补齐遗漏的结算。"}));
before=(await pyMethod(kernel,"table",["look"],{"focus":"investigator"}));
result=(await pyInvoke(end_session,[kernel,"t2-c1"],{"scenario_san_reward_expr":"1D8"}));
outcome=pyAt(result,"outcome");
capsule=(await pyMethod(development,"load_ending_capsule",[directory,pyAt(outcome,"ending_id")],{}));
assert.ok(pyBool(pyEqual(pyAt(capsule,"campaign_ending_turn"),1)),"tests/kernel/test_postgame_settlement.py:66 assert capsule['campaign_ending_turn'] == 1");
assert.ok(pyBool(pyAt(pyAt(pyAt(capsule,"development_inputs"),"thomas-hayes"),"skills_checked")),"tests/kernel/test_postgame_settlement.py:67 assert capsule['development_inputs']['thomas-hayes']['skills_checked']");
assert.ok(pyBool((await (async()=>{const __term0=1;const __term1=pyAt(pyAt(outcome,"scenario_san_reward_roll"),"total");const __term2=8;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())),"tests/kernel/test_postgame_settlement.py:68 assert 1 <= outcome['scenario_san_reward_roll']['total'] <= 8");
after=(await pyMethod(kernel,"table",["look"],{"focus":"investigator"}));
assert.ok(pyBool(pyLess(pyAt(before,"san"),pyAt(after,"san"))),"tests/kernel/test_postgame_settlement.py:70 assert after['san'] > before['san']");
assert.ok(pyBool(pyEqual((await pyInvoke(read_json,[pyDivide(directory,"world.json")],{})),world)),"tests/kernel/test_postgame_settlement.py:71 assert read_json(directory / 'world.json') == world");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{})),"status"),"completed")),"tests/kernel/test_postgame_settlement.py:72 assert read_json(directory / 'campaign.json')['status'] == 'completed'");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"turns/0001.json")),"read_bytes",[],{})),old_record)),"tests/kernel/test_postgame_settlement.py:73 assert (directory / 'turns/0001.json').read_bytes() == old_record");
assert.ok(pyBool(pyAt((await pyInvoke(end_session,[kernel,"t2-c1"],{"scenario_san_reward_expr":"1D8"})),"replayed")),"tests/kernel/test_postgame_settlement.py:74 assert end_session(kernel, 't2-c1', scenario_san_reward_expr='1D8')['replayed']");
replay=(await pyInvoke(end_session,[kernel,"t2-c2"],{"scenario_san_reward_expr":"1D8"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(replay,"outcome"),"status"),"replayed");return pyBool(__left)?pyEqual(pyAt(replay,"effects"),[]):__left})())),"tests/kernel/test_postgame_settlement.py:76 assert replay['outcome']['status'] == 'replayed' and replay['effects'] == []");
error=(await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t2-c3","action":({["intent"]:"montage",["goal"]:"Change rewards.",["method"]:"",["decision"]:"development:end-session",["scenario_san_reward_expr"]:"10D8"})}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"idempotency_conflict");return pyBool(__left)?pyContains(pyAt(error,"message"),"frozen"):__left})())),"tests/kernel/test_postgame_settlement.py:79 assert error['code'] == 'idempotency_conflict' and 'frozen' in error['message']");
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["look"],{"focus":"investigator"})),after)),"tests/kernel/test_postgame_settlement.py:80 assert kernel.table('look', focus='investigator') == after");
(await pyInvoke(narrate,[kernel,"t2-c4","遗漏的结算已经补齐，原结局保持不变。"],{}));
client=(new RpcClient(kernel.workspace));
try{(await pyMethod(client,"table",["open"],{}));
(await pyMethod(client,"table",["player_input"],{"text":"再核对一次。"}));
again=(await pyInvoke(end_session,[client,"t3-c1"],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(again,"outcome"),"ending_id"),pyAt(outcome,"ending_id"));return pyBool(__left)?pyEqual(pyAt(again,"effects"),[]):__left})())),"tests/kernel/test_postgame_settlement.py:87 assert again['outcome']['ending_id'] == outcome['ending_id'] and again['effects'] == []");
assert.ok(pyBool(pyEqual((await pyMethod(client,"table",["look"],{"focus":"investigator"})),after)),"tests/kernel/test_postgame_settlement.py:88 assert client.table('look', focus='investigator') == after");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(development,"list_endings",[directory],{}))],{})),1)),"tests/kernel/test_postgame_settlement.py:89 assert len(development.list_endings(directory)) == 1");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"turns/0001.json")),"read_bytes",[],{})),old_record)),"tests/kernel/test_postgame_settlement.py:90 assert (directory / 'turns/0001.json').read_bytes() == old_record");}finally{(await pyMethod(client,"close",[],{}));}
}
Object.defineProperty(test_late_accounting_preserves_ending_and_cannot_repeat_or_replace_reward,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_late_accounting_preserves_ending_and_cannot_repeat_or_replace_reward"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_late_accounting_preserves_ending_and_cannot_repeat_or_replace_reward(await kernel(t,{}));});
export async function test_postgame_allowlist_blocks_adventure_and_routing_overrides(kernel:any){
let directory:any,world:any,effect:any,extra:any,action:any,invalid:any;
const __unpack5197=(await pyInvoke(legacy_completed,[kernel],{}));directory=__unpack5197[0];world=__unpack5197[1];
(await pyMethod(kernel,"table",["player_input"],{"text":"核对结算。"}));
for(effect of pyIterable([({["kind"]:"time",["minutes"]:5}),({["kind"]:"ending",["summary"]:"Replace ending."}),({["kind"]:"flag",["name"]:"new-adventure",["value"]:true})])){
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[effect]})),"code"),"campaign_not_ready")),"tests/kernel/test_postgame_settlement.py:100 assert kernel.table_err('apply', call_id='t2-c1', effects=[effect])['code'] == 'campaign_not_ready'");
}
for(extra of pyIterable([({["decision"]:"core-check:ordinary-check"}),({["push"]:true}),({["luck"]:1}),({["target"]:"Steven Knott"}),({["intent"]:"investigate"})])){
action=({["intent"]:"montage",["goal"]:"Continue the adventure.",["method"]:"",["decision"]:"development:end-session",...extra});
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t2-c1","action":action})),"code"),"campaign_not_ready")),"tests/kernel/test_postgame_settlement.py:105 assert kernel.table_err('resolve', call_id='t2-c1', action=action)['code'] == 'campaign_not_ready'");
}
assert.ok(pyBool(pyEqual((await pyInvoke(read_json,[pyDivide(directory,"world.json")],{})),world)),"tests/kernel/test_postgame_settlement.py:106 assert read_json(directory / 'world.json') == world");
invalid=(await pyMethod(kernel,"table_err",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"montage",["goal"]:"Account.",["method"]:"",["decision"]:"development:end-session",["scenario_san_reward_expr"]:"not-dice"})}));
assert.ok(pyBool(pyEqual(pyAt(invalid,"code"),"invalid_params")),"tests/kernel/test_postgame_settlement.py:109 assert invalid['code'] == 'invalid_params'");
assert.ok(pyBool(pyEqual((await pyMethod(development,"list_endings",[directory],{})),[])),"tests/kernel/test_postgame_settlement.py:110 assert development.list_endings(directory) == []");
(await pyMethod(kernel,"table",["ask"],{"call_id":"t2-c2","kind":"story","prompt":"先核对哪部分？","options":["源奖励","成长"]}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"先核对源奖励。"})),"state"),"open")),"tests/kernel/test_postgame_settlement.py:112 assert kernel.table('player_input', text='先核对源奖励。')['state'] == 'open'");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{})),"status"),"completed")),"tests/kernel/test_postgame_settlement.py:113 assert read_json(directory / 'campaign.json')['status'] == 'completed'");
}
Object.defineProperty(test_postgame_allowlist_blocks_adventure_and_routing_overrides,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_postgame_allowlist_blocks_adventure_and_routing_overrides"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_postgame_allowlist_blocks_adventure_and_routing_overrides(await kernel(t,{}));});
export async function test_completed_pending_settlement_reuses_the_frozen_source_reward(kernel:any){
let directory:any,_:any,sheet:any,tables:any,capsule:any,result:any;
const __unpack6697=(await pyInvoke(legacy_completed,[kernel],{}));directory=__unpack6697[0];_=__unpack6697[1];
sheet=(await pyInvoke(read_json,[pyDivide(directory,"party/thomas-hayes.json")],{}));
tables=(await pyInvoke(RuleTables,[pyDivide(CONTENT_DIR,"rulesets/coc7/rules-json")],{}));
capsule=(await pyMethod(development,"build_ending_capsule",[tables,directory,({["scene_id"]:"commission-briefing",["kind"]:"conclusion",["decision_id"]:"t1-c90",["investigator_ids"]:["thomas-hayes"],["scenario_san_reward_expr"]:"1D8"}),({["thomas-hayes"]:sheet})],{"luck_recovery_gate":null,"captured_at":"2026-01-01T00:00:00Z"}));
(await pyMethod(development,"persist_ending_capsule",[directory,capsule],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"恢复待完成的结算。"}));
result=(await pyMethod(kernel,"table",["resolve"],{"call_id":"t2-c1","action":({["intent"]:"montage",["goal"]:"Finish pending accounting.",["method"]:"",["decision"]:"development:settle-ending"})}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"ending_id"),pyAt(capsule,"ending_id"))),"tests/kernel/test_postgame_settlement.py:128 assert result['outcome']['ending_id'] == capsule['ending_id']");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"outcome"),"scenario_san_reward_roll"),pyAt(pyAt(pyAt(pyAt(capsule,"development_inputs"),"thomas-hayes"),"deterministic_plan"),"scenario_san_reward"))),"tests/kernel/test_postgame_settlement.py:129 assert result['outcome']['scenario_san_reward_roll'] == capsule['development_inputs']['thomas-hayes']['deterministic_plan']['scenario_san_reward']");
assert.ok(pyBool(pyEqual((await pyMethod(development,"pending_settlements",[directory],{})),[])),"tests/kernel/test_postgame_settlement.py:130 assert development.pending_settlements(directory) == []");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(end_session,[kernel,"t2-c2"],{})),"outcome"),"status"),"replayed")),"tests/kernel/test_postgame_settlement.py:131 assert end_session(kernel, 't2-c2')['outcome']['status'] == 'replayed'");
}
Object.defineProperty(test_completed_pending_settlement_reuses_the_frozen_source_reward,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_completed_pending_settlement_reuses_the_frozen_source_reward"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_completed_pending_settlement_reuses_the_frozen_source_reward(await kernel(t,{}));});
