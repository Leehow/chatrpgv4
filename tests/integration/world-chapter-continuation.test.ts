// Migrated from tests/kernel/test_chapter_continuation.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,narrate,open_turn,read_json,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {development} from "./world-production-support.ts";
import {end_session,legacy_completed} from "./world-postgame-settlement.test.ts";
const __file__=new URL('../../tests/kernel/test_chapter_continuation.py',import.meta.url).pathname;




export async function rewards_on_disk(directory:any){
let root:any;
root=pyDivide(directory,"save/development-settlements");
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable((await pyMethod(root,"rglob",["*.json"],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(p,"relative_to",[root],{}))],{})),(await pyMethod(p,"read_bytes",[],{}))]);}return __rows;})()));
}
Object.defineProperty(rewards_on_disk,"__pySignature",{value:[{"name":"directory","rest":false,"varargs":false}]});
export async function end_effect(scope:any="chapter"){
return ({["kind"]:"ending",["scope"]:scope,["summary"]:"This chapter is resolved."});
}
Object.defineProperty(end_effect,"__pySignature",{value:[{"name":"scope","rest":false,"varargs":false}]});
export async function move_on(client:any,call_id:any){
return (await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"move",["to"]:"hall-of-records",["via"]:"The next investigation begins at the records office.",["travel_minutes"]:0})]}));
}
Object.defineProperty(move_on,"__pySignature",{value:[{"name":"client","rest":false,"varargs":false},{"name":"call_id","rest":false,"varargs":false}]});
export async function test_ending_scope_is_explicit_and_validated_before_world_effects(kernel:any){
let directory:any,before:any,effect:any,error:any;
(await pyInvoke(open_turn,[kernel],{}));
directory=(await pyInvoke(campaign_dir,[kernel.workspace],{}));
before=(await pyMethod((pyDivide(directory,"world.json")),"read_bytes",[],{}));
for(effect of pyIterable([({["kind"]:"ending",["summary"]:"Done."}),(await pyInvoke(end_effect,["unknown"],{}))])){
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:10}),effect]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_chapter_continuation.py:28 assert error['code'] == 'needs'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"ending_scope_required")),"tests/kernel/test_chapter_continuation.py:29 assert error['details']['reason'] == 'ending_scope_required'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"options"),["chapter","campaign"])),"tests/kernel/test_chapter_continuation.py:30 assert error['details']['options'] == ['chapter', 'campaign']");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"world.json")),"read_bytes",[],{})),before)),"tests/kernel/test_chapter_continuation.py:31 assert (directory / 'world.json').read_bytes() == before");
}
}
Object.defineProperty(test_ending_scope_is_explicit_and_validated_before_world_effects,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_ending_scope_is_explicit_and_validated_before_world_effects"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_ending_scope_is_explicit_and_validated_before_world_effects(await kernel(t,{}));});
export async function test_chapter_accounting_replays_until_movement_then_next_session_can_settle(kernel:any){
let directory:any,result:any,closed:any,meta:any,sheet:any,rewards:any,replay:any,new_value:any;
(await pyInvoke(open_turn,[kernel],{}));
directory=(await pyInvoke(campaign_dir,[kernel.workspace],{}));
result=(await pyInvoke(end_session,[kernel,"t1-c1"],{"scenario_san_reward_expr":"1D1"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(end_effect,[],{}))]}));
closed=(await pyInvoke(narrate,[kernel,"t1-c3","这一章结束，旅程仍将继续。"],{}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(closed,"mechanics"))){__rows.push(pyEqual((await pyMethod(row,"get",["family"],{})),"chapter"));}return __rows;})())))),"tests/kernel/test_chapter_continuation.py:40 assert any(row.get('family') == 'chapter' for row in closed['mechanics'])");
meta=(await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(meta,"status"),"active");return pyBool(__left)?pyEqual(pyAt(pyAt(meta,"ending"),"scope"),"chapter"):__left})())),"tests/kernel/test_chapter_continuation.py:42 assert meta['status'] == 'active' and meta['ending']['scope'] == 'chapter'");
sheet=(await pyMethod((pyDivide(directory,"party/thomas-hayes.json")),"read_bytes",[],{}));
rewards=(await pyInvoke(rewards_on_disk,[directory],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"核对上一章，然后继续。"}));
replay=(await pyInvoke(end_session,[kernel,"t2-c1"],{"scenario_san_reward_expr":"1D1"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(replay,"outcome"),"ending_id"),pyAt(pyAt(result,"outcome"),"ending_id"))),"tests/kernel/test_chapter_continuation.py:47 assert replay['outcome']['ending_id'] == result['outcome']['ending_id']");
assert.ok(pyBool(pyEqual(pyAt(replay,"effects"),[])),"tests/kernel/test_chapter_continuation.py:48 assert replay['effects'] == []");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c2","effects":[(await pyInvoke(end_effect,[],{}))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(read_json,[pyDivide(directory,"world.json")],{})),"ending"),"turn"),1)),"tests/kernel/test_chapter_continuation.py:50 assert read_json(directory / 'world.json')['ending']['turn'] == 1");
(await pyMethod(kernel,"table",["ask"],{"call_id":"t2-c3","prompt":"下一步去哪里？","options":["档案馆","先休息"]}));
(await pyMethod(kernel,"table",["player_input"],{"text":"去档案馆。"}));
(await pyInvoke(move_on,[kernel,"t3-c1"],{}));
(await pyInvoke(narrate,[kernel,"t3-c2","你抵达档案馆，新的调查开始了。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{})),"status"),"active")),"tests/kernel/test_chapter_continuation.py:55 assert read_json(directory / 'campaign.json')['status'] == 'active'");
assert.ok(pyBool((pyAt(pyAt((await pyInvoke(read_json,[pyDivide(directory,"world.json")],{})),"ending"),"continued")===true)),"tests/kernel/test_chapter_continuation.py:56 assert read_json(directory / 'world.json')['ending']['continued'] is True");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"party/thomas-hayes.json")),"read_bytes",[],{})),sheet)),"tests/kernel/test_chapter_continuation.py:57 assert (directory / 'party/thomas-hayes.json').read_bytes() == sheet");
assert.ok(pyBool(pyEqual((await pyInvoke(rewards_on_disk,[directory],{})),rewards)),"tests/kernel/test_chapter_continuation.py:58 assert rewards_on_disk(directory) == rewards");
(await pyMethod(kernel,"table",["player_input"],{"text":"新的调查结束，结算这一段。"}));
new_value=(await pyInvoke(end_session,[kernel,"t4-c1"],{}));
assert.ok(pyBool(!pyEqual(pyAt(pyAt(new_value,"outcome"),"ending_id"),pyAt(pyAt(result,"outcome"),"ending_id"))),"tests/kernel/test_chapter_continuation.py:61 assert new['outcome']['ending_id'] != result['outcome']['ending_id']");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[(await pyMethod(development,"list_endings",[directory],{}))],{})),2)),"tests/kernel/test_chapter_continuation.py:62 assert len(development.list_endings(directory)) == 2");
}
Object.defineProperty(test_chapter_accounting_replays_until_movement_then_next_session_can_settle,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_chapter_accounting_replays_until_movement_then_next_session_can_settle"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_chapter_accounting_replays_until_movement_then_next_session_can_settle(await kernel(t,{}));});
export async function test_legacy_chapter_correction_preserves_history_and_rewards_and_survives_restart(kernel:any){
let directory:any,original:any,original_turn:any,settled:any,accounting_turn:any,sheet:any,rewards:any,opened:any,mixed:any,result:any,meta:any,other:any,replay:any;
const __unpack3268=(await pyInvoke(legacy_completed,[kernel],{}));directory=__unpack3268[0];original=__unpack3268[1];
original_turn=(await pyMethod((pyDivide(directory,"turns/0001.json")),"read_bytes",[],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"补齐上一章的结算。"}));
settled=(await pyInvoke(end_session,[kernel,"t2-c1"],{"scenario_san_reward_expr":"1D8"}));
(await pyInvoke(narrate,[kernel,"t2-c2","奖励和成长已经结算。"],{}));
accounting_turn=(await pyMethod((pyDivide(directory,"turns/0002.json")),"read_bytes",[],{}));
sheet=(await pyMethod((pyDivide(directory,"party/thomas-hayes.json")),"read_bytes",[],{}));
rewards=(await pyInvoke(rewards_on_disk,[directory],{}));
opened=(await pyMethod(kernel,"table",["player_input"],{"text":"上一章结束不代表整场战役结束，继续下一章。"}));
assert.ok(pyBool(pyContains(pyAt(pyAt(opened,"capsule"),"head"),"legacy ending has no scope")),"tests/kernel/test_chapter_continuation.py:75 assert 'legacy ending has no scope' in opened['capsule']['head']");
mixed=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t3-c1","effects":[(await pyInvoke(end_effect,[],{})),({["kind"]:"time",["minutes"]:1})]}));
assert.ok(pyBool(pyEqual(pyAt(mixed,"code"),"campaign_not_ready")),"tests/kernel/test_chapter_continuation.py:77 assert mixed['code'] == 'campaign_not_ready'");
result=(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[(await pyInvoke(end_effect,[],{}))]}));
assert.ok(pyBool(pyAt(result,"receipts")),"tests/kernel/test_chapter_continuation.py:79 assert result['receipts']");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{})),"status"),"completed")),"tests/kernel/test_chapter_continuation.py:80 assert read_json(directory / 'campaign.json')['status'] == 'completed'");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t3-c2","effects":[({["kind"]:"time",["minutes"]:1})]})),"code"),"campaign_not_ready")),"tests/kernel/test_chapter_continuation.py:81 assert kernel.table_err('apply', call_id='t3-c2', effects=[{'kind': 'time', 'minutes': 1}])['code'] == 'campaign_not_ready'");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["ask"],{"call_id":"t3-c2","prompt":"继续吗？","options":["继续","暂停"]})),"code"),"invalid_params")),"tests/kernel/test_chapter_continuation.py:82 assert kernel.table_err('ask', call_id='t3-c2', prompt='继续吗？', options=['继续', '暂停'])['code'] == 'invalid_params'");
(await pyInvoke(narrate,[kernel,"t3-c2","秘鲁章节已结算，原来的调查员继续下一章。"],{}));
meta=(await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{}));
assert.ok(pyBool(pyEqual(pyAt(meta,"status"),"active")),"tests/kernel/test_chapter_continuation.py:85 assert meta['status'] == 'active'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(meta,"ending"),"scope"),"chapter")),"tests/kernel/test_chapter_continuation.py:86 assert meta['ending']['scope'] == 'chapter'");
assert.ok(pyBool(pyEqual(pyAt(pyAt(meta,"ending"),"turn"),pyAt(pyAt(original,"ending"),"turn"))),"tests/kernel/test_chapter_continuation.py:87 assert meta['ending']['turn'] == original['ending']['turn']");
assert.ok(pyBool(pyEqual(pyAt(pyAt(meta,"ending"),"summary"),pyAt(pyAt(original,"ending"),"summary"))),"tests/kernel/test_chapter_continuation.py:88 assert meta['ending']['summary'] == original['ending']['summary']");
other=(new RpcClient(kernel.workspace));
try{(await pyMethod(other,"table",["open"],{}));
(await pyMethod(other,"table",["player_input"],{"text":"去下一处调查地点。"}));
replay=(await pyInvoke(end_session,[other,"t4-c1"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(replay,"outcome"),"ending_id"),pyAt(pyAt(settled,"outcome"),"ending_id"))),"tests/kernel/test_chapter_continuation.py:94 assert replay['outcome']['ending_id'] == settled['outcome']['ending_id']");
assert.ok(pyBool(pyEqual(pyAt(replay,"effects"),[])),"tests/kernel/test_chapter_continuation.py:95 assert replay['effects'] == []");
(await pyInvoke(move_on,[other,"t4-c2"],{}));
(await pyInvoke(narrate,[other,"t4-c3","新的调查已经开始。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(directory,"campaign.json")],{})),"status"),"active")),"tests/kernel/test_chapter_continuation.py:98 assert read_json(directory / 'campaign.json')['status'] == 'active'");}finally{(await pyMethod(other,"close",[],{}));}
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"turns/0001.json")),"read_bytes",[],{})),original_turn)),"tests/kernel/test_chapter_continuation.py:101 assert (directory / 'turns/0001.json').read_bytes() == original_turn");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"turns/0002.json")),"read_bytes",[],{})),accounting_turn)),"tests/kernel/test_chapter_continuation.py:102 assert (directory / 'turns/0002.json').read_bytes() == accounting_turn");
assert.ok(pyBool(pyEqual((await pyMethod((pyDivide(directory,"party/thomas-hayes.json")),"read_bytes",[],{})),sheet)),"tests/kernel/test_chapter_continuation.py:103 assert (directory / 'party/thomas-hayes.json').read_bytes() == sheet");
assert.ok(pyBool(pyEqual((await pyInvoke(rewards_on_disk,[directory],{})),rewards)),"tests/kernel/test_chapter_continuation.py:104 assert rewards_on_disk(directory) == rewards");
}
Object.defineProperty(test_legacy_chapter_correction_preserves_history_and_rewards_and_survives_restart,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_legacy_chapter_correction_preserves_history_and_rewards_and_survives_restart"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_legacy_chapter_correction_preserves_history_and_rewards_and_survives_restart(await kernel(t,{}));});
export async function test_explicit_campaign_ending_cannot_be_reclassified(kernel:any){
(await pyInvoke(open_turn,[kernel],{}));
(await pyInvoke(end_session,[kernel,"t1-c1"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(end_effect,["campaign"],{}))]}));
(await pyInvoke(narrate,[kernel,"t1-c3","整场战役已经结束。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"再开一章。"}));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[(await pyInvoke(end_effect,[],{}))]})),"code"),"campaign_not_ready")),"tests/kernel/test_chapter_continuation.py:113 assert kernel.table_err('apply', call_id='t2-c1', effects=[end_effect()])['code'] == 'campaign_not_ready'");
}
Object.defineProperty(test_explicit_campaign_ending_cannot_be_reclassified,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_explicit_campaign_ending_cannot_be_reclassified"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_explicit_campaign_ending_cannot_be_reclassified(await kernel(t,{}));});
export async function test_legacy_correction_requires_existing_accounting(kernel:any){
let directory:any,original:any,error:any;
const __unpack5996=(await pyInvoke(legacy_completed,[kernel],{}));directory=__unpack5996[0];original=__unpack5996[1];
(await pyMethod(kernel,"table",["player_input"],{"text":"继续下一章。"}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[(await pyInvoke(end_effect,[],{}))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"ending_settlement_required")),"tests/kernel/test_chapter_continuation.py:120 assert error['details']['reason'] == 'ending_settlement_required'");
assert.ok(pyBool(pyEqual((await pyInvoke(read_json,[pyDivide(directory,"world.json")],{})),original)),"tests/kernel/test_chapter_continuation.py:121 assert read_json(directory / 'world.json') == original");
}
Object.defineProperty(test_legacy_correction_requires_existing_accounting,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_legacy_correction_requires_existing_accounting"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_legacy_correction_requires_existing_accounting(await kernel(t,{}));});
