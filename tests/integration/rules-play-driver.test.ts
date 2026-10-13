// Migrated from tests/play/test_driver.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {replay_turn,importlib,SimpleNamespace,pyMethod,resetDriver} from './rules-driver-support.ts';
import {captureOutput} from './rules-play-support.ts';
const DRIVER=ROOT+'/tests/play/driver.ts';

import {pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";
















export async function test_repair_agent_clears_end_fallback_and_delivered_text_wins(){
let result:any;
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.01,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"Rejected draft"})]})})],[.02,({["type"]:"agent_end"})],[.027,({["type"]:"agent_start"})],[2,({["type"]:"tool_execution_start",["toolName"]:"narrate",["toolCallId"]:"repair",["args"]:({})})],[3,({["type"]:"tool_execution_end",["toolName"]:"narrate",["toolCallId"]:"repair",["result"]:({["content"]:[({["type"]:"text",["text"]:(await pyMethod(json,"dumps",[({["rendered_text"]:"Accepted delivery"})],{}))})]})})],[3.01,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"An untrusted wrapper"})]})})],[3.02,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"wall_seconds"),3.02)),"tests/play/test_driver.py:78 assert result[\"wall_seconds\"] == 3.02");
assert.ok(pyBool(pyEqual(pyAt(result,"stop_reason"),"agent_settled")),"tests/play/test_driver.py:79 assert result[\"stop_reason\"] == \"agent_settled\"");
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"Accepted delivery")),"tests/play/test_driver.py:80 assert result[\"final_text\"] == \"Accepted delivery\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_repair_agent_clears_end_fallback_and_delivered_text_wins"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_repair_agent_clears_end_fallback_and_delivered_text_wins();});
export async function test_rejected_implicit_draft_is_not_a_final_response(){
let result:any;
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"Unpublished draft"})]})})],[.2,({["type"]:"entry_appended",["entry"]:({["customType"]:"coc-telemetry",["data"]:({["tool"]:"narrate",["implicit"]:true,["ok"]:false})})})],[.3,({["type"]:"agent_end"})],[.4,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"")),"tests/play/test_driver.py:91 assert result[\"final_text\"] == \"\"");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"empty")),"tests/play/test_driver.py:92 assert result[\"settle_class\"] == \"empty\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_rejected_implicit_draft_is_not_a_final_response"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_rejected_implicit_draft_is_not_a_final_response();});
export async function review_notice(overrides:any={}){
return ({["role"]:"custom",["customType"]:"coc-delivery",["display"]:true,["content"]:"This turn could not be published. Settled actions remain recorded.",["details"]:({["coc_delivery"]:true,["turn"]:8,["review_unavailable"]:true,["streak"]:0,["service"]:false}),...overrides});
}
export async function test_check_notice_does_not_replace_embedded_apply_narration(){
let notice:any,prose:any,body:any,result:any;
notice=(await review_notice(({"details":({["coc_delivery"]:true,["turn"]:1,["check_selection_unresolved"]:true})})));
prose=pyMultiply("The room remains quiet. ",240);
body=({["narrate_in_apply"]:true,["rendered_text"]:prose,["mechanics"]:[({["kind"]:"time",["minutes"]:1})]});
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:notice})],[.2,({["type"]:"tool_execution_start",["toolName"]:"apply",["toolCallId"]:"write",["args"]:({})})],[.3,({["type"]:"tool_execution_end",["toolName"]:"apply",["toolCallId"]:"write",["isError"]:false,["result"]:({["content"]:[({["type"]:"text",["text"]:(await pyMethod(json,"dumps",[body],{}))})],["details"]:body})})],[.4,({["type"]:"agent_end"})]]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"kind"),"narrate")),"tests/play/test_driver.py:114 assert result[\"delivery\"][\"kind\"] == \"narrate\"");
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),(await pyMethod(prose,"strip",[],{})))),"tests/play/test_driver.py:115 assert result[\"final_text\"] == prose.strip()");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"rendered_text"),prose)),"tests/play/test_driver.py:116 assert result[\"delivery\"][\"rendered_text\"] == prose");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"mechanics"),pyAt(body,"mechanics"))),"tests/play/test_driver.py:117 assert result[\"delivery\"][\"mechanics\"] == body[\"mechanics\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(notice,"content"),["details"]:pyAt(notice,"details")})])),"tests/play/test_driver.py:118 assert result[\"notices\"] == [{\"content\": notice[\"content\"], \"details\": notice[\"details\"]}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_check_notice_does_not_replace_embedded_apply_narration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_check_notice_does_not_replace_embedded_apply_narration();});
export async function test_notice_cannot_shadow_confirmed_implicit_narration(){
let notice:any,accepted:any,result:any;
notice=(await review_notice(({"details":({["coc_delivery"]:true,["turn"]:1,["check_selection_unresolved"]:true})})));
for(accepted of pyIterable([true,false])){
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:notice})],[.2,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"The door is open."})]})})],[.3,({["type"]:"entry_appended",["entry"]:({["customType"]:"coc-telemetry",["data"]:({["tool"]:"narrate",["implicit"]:true,["ok"]:accepted})})})],[.4,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),((pyBool(accepted)?"The door is open.":pyAt(notice,"content"))))),"tests/play/test_driver.py:131 assert result[\"final_text\"] == (\"The door is open.\" if accepted else notice[\"content\"])");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(notice,"content"),["details"]:pyAt(notice,"details")})])),"tests/play/test_driver.py:132 assert result[\"notices\"] == [{\"content\": notice[\"content\"], \"details\": notice[\"details\"]}]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_notice_cannot_shadow_confirmed_implicit_narration"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_notice_cannot_shadow_confirmed_implicit_narration();});
export async function test_late_provider_notice_preserves_confirmed_implicit_narration(accepted:any,event_type:any,field:any){
let notice:any,result:any;
notice=(await review_notice(({"content":"The request failed after 72 seconds and was retried.","details":({["coc_delivery"]:true,["turn"]:1,["provider_outage"]:true,["terminal"]:false})})));
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"entry_appended",["entry"]:({["customType"]:"coc-telemetry",["data"]:({["tool"]:"narrate",["implicit"]:true,["ok"]:accepted})})})],[.2,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"The librarian takes the request to the closed stacks."})]})})],[.3,({["type"]:event_type,[field]:notice})],[.4,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),((pyBool(accepted)?"The librarian takes the request to the closed stacks.":pyAt(notice,"content"))))),"tests/play/test_driver.py:149 assert result[\"final_text\"] == (\"The librarian takes the request to the closed stacks.\" if accepted else notice[\"content\"])");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(notice,"content"),["details"]:pyAt(notice,"details")})])),"tests/play/test_driver.py:150 assert result[\"notices\"] == [{\"content\": notice[\"content\"], \"details\": notice[\"details\"]}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("accepted",[true,false])),pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).entries())test("test_late_provider_notice_preserves_confirmed_implicit_narration"+((pyCartesian(pyCartesian([{}],pyParametrize("accepted",[true,false])),pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_late_provider_notice_preserves_confirmed_implicit_narration(row["accepted"],row["event_type"],row["field"]);});
export async function test_implicit_confirmation_does_not_survive_a_repair_run(){
let notice:any,result:any;
notice=(await review_notice(({"details":({["coc_delivery"]:true,["turn"]:1,["provider_outage"]:true,["terminal"]:false})})));
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"entry_appended",["entry"]:({["customType"]:"coc-telemetry",["data"]:({["tool"]:"narrate",["implicit"]:true,["ok"]:true})})})],[.2,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"Prior leg."})]})})],[.3,({["type"]:"agent_start"})],[.4,({["type"]:"message_end",["message"]:notice})],[.5,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(notice,"content"))),"tests/play/test_driver.py:164 assert result[\"final_text\"] == notice[\"content\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(notice,"content"),["details"]:pyAt(notice,"details")})])),"tests/play/test_driver.py:165 assert result[\"notices\"] == [{\"content\": notice[\"content\"], \"details\": notice[\"details\"]}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_implicit_confirmation_does_not_survive_a_repair_run"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_implicit_confirmation_does_not_survive_a_repair_run();});
export async function failed_narrate_events(){
return [[0,({["type"]:"agent_start"})],[.1,({["type"]:"tool_execution_start",["toolName"]:"narrate",["toolCallId"]:"draft",["args"]:({})})],[.2,({["type"]:"tool_execution_end",["toolName"]:"narrate",["toolCallId"]:"draft",["isError"]:true,["result"]:({["content"]:[({["type"]:"text",["text"]:"Continuity review is paused; no draft was approved"})]})})],[.3,({["type"]:"agent_end"})]];
}
export async function test_failed_narrate_then_visible_review_notice_is_settled(event_type:any,field:any,monkeypatch:any,capsys:any){
let notice:any,result:any,spec:any,module:any;
notice=(await review_notice());
result=(await replay_turn(pyAdd((await failed_narrate_events()),[[.4,({["type"]:event_type,[field]:notice})],[.5,({["type"]:"agent_settled"})]])));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(notice,"content"))),"tests/play/test_driver.py:185 assert result[\"final_text\"] == notice[\"content\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:186 assert result[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(result,"stop_reason"),"agent_settled")),"tests/play/test_driver.py:187 assert result[\"stop_reason\"] == \"agent_settled\"");
assert.ok(pyBool(pyEqual(pyAt(result,"delivery"),({["kind"]:"notice",["rendered_text"]:pyAt(notice,"content"),["mechanics"]:[],["pending_choice"]:null,["details"]:pyAt(notice,"details")}))),"tests/play/test_driver.py:188 assert result[\"delivery\"] == {\"kind\": \"notice\", \"rendered_text\": notice[\"content\"],\n                                  \"mechanics\": [], \"pending_choice\": None, \"details\": notice[\"details\"]}");
assert.ok(pyBool((pyAt(pyAt(result,"delivery"),"details")!==pyAt(notice,"details"))),"tests/play/test_driver.py:190 assert result[\"delivery\"][\"details\"] is not notice[\"details\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(notice,"content"),["details"]:pyAt(notice,"details")})])),"tests/play/test_driver.py:191 assert result[\"notices\"] == [{\"content\": notice[\"content\"], \"details\": notice[\"details\"]}]");
assert.ok(pyBool((pyAt(pyAt(pyAt(result,"notices"),0),"details")!==pyAt(notice,"details"))),"tests/play/test_driver.py:192 assert result[\"notices\"][0][\"details\"] is not notice[\"details\"]");
spec=(await pyMethod(importlib.util,"spec_from_file_location",["driver_notice_cli",DRIVER],{}));
module=(await pyMethod(importlib.util,"module_from_spec",[spec],{}));
(await pyMethod(spec.loader,"exec_module",[module],{}));
(await pyMethod(monkeypatch,"setattr",[module,"rpc_call",(...args:any[])=>({["ok"]:true,["summary"]:({...result,["turn"]:8})})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(module,"cmd_turn",[(await SimpleNamespace(({"run":"notice-replay","text":"Continue.","timeout":10})))],{})),0)),"tests/play/test_driver.py:198 assert module.cmd_turn(SimpleNamespace(run=\"notice-replay\", text=\"Continue.\", timeout=10)) == 0");
assert.ok(pyBool(pyEqual((await pyMethod((await pyMethod(capsys,"readouterr",[],{})).out,"count",[pyAt(notice,"content")],{})),1)),"tests/play/test_driver.py:199 assert capsys.readouterr().out.count(notice[\"content\"]) == 1");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).entries())test("test_failed_narrate_then_visible_review_notice_is_settled"+((pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_failed_narrate_then_visible_review_notice_is_settled(row["event_type"],row["field"],pyMonkeypatch(t),captureOutput(t));});
export async function test_hidden_or_unmarked_custom_messages_are_not_delivery(overrides:any,event_type:any,field:any){
let result:any;
result=(await replay_turn(pyAdd((await failed_narrate_events()),[[.4,({["type"]:event_type,[field]:(await review_notice(({...overrides})))})],[.5,({["type"]:"agent_settled"})]])));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"")),"tests/play/test_driver.py:214 assert result[\"final_text\"] == \"\"");
assert.ok(pyBool((pyAt(result,"delivery")===null)),"tests/play/test_driver.py:215 assert result[\"delivery\"] is None");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"undelivered_with_tools")),"tests/play/test_driver.py:216 assert result[\"settle_class\"] == \"undelivered_with_tools\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("overrides",[({["display"]:false}),({["display"]:null}),({["display"]:1}),({["customType"]:"coc-capsule"}),({["details"]:null}),({["details"]:({})}),({["details"]:({["coc_delivery"]:false})}),({["details"]:({["coc_delivery"]:1})}),({["content"]:[({["type"]:"text",["text"]:"Not string content"})]})])),pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).entries())test("test_hidden_or_unmarked_custom_messages_are_not_delivery"+((pyCartesian(pyCartesian([{}],pyParametrize("overrides",[({["display"]:false}),({["display"]:null}),({["display"]:1}),({["customType"]:"coc-capsule"}),({["details"]:null}),({["details"]:({})}),({["details"]:({["coc_delivery"]:false})}),({["details"]:({["coc_delivery"]:1})}),({["content"]:[({["type"]:"text",["text"]:"Not string content"})]})])),pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_hidden_or_unmarked_custom_messages_are_not_delivery(row["overrides"],row["event_type"],row["field"]);});
export async function setup_opening_message(overrides:any={}){
return ({["role"]:"custom",["customType"]:"coc-setup-opening",["display"]:true,["content"]:"Autumn 1920, a landlord's office in Boston. \"Who are you?\"",["details"]:({["kind"]:"setup-opening"}),...overrides});
}
export async function setup_opening_turn(opening:any){
return [[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:({["role"]:"user",["content"]:[({["type"]:"text",["text"]:"Hello."})]})})],[.2,({["type"]:"message_end",["message"]:opening})],[.3,({["type"]:"entry_appended",["entry"]:opening})],[.4,({["type"]:"message_end",["message"]:({["role"]:"assistant",["content"]:[({["type"]:"text",["text"]:"What do you do for a living?"})]})})],[.5,({["type"]:"agent_end"})],[.6,({["type"]:"agent_settled"})]];
}
export async function test_setup_opening_shown_by_the_host_reaches_the_turn_and_its_printout(monkeypatch:any,capsys:any){
let opening:any,result:any,spec:any,module:any,out:any;

opening=(await setup_opening_message());
result=(await replay_turn((await setup_opening_turn(opening))));
assert.ok(pyBool(pyEqual(pyAt(result,"setup_opening"),pyAt(opening,"content"))),pyStr("once, although it arrived as a message and as an entry"));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"What do you do for a living?")),pyStr("final_text stays the guide's reply"));
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:243 assert result[\"settle_class\"] == \"settled\"");
spec=(await pyMethod(importlib.util,"spec_from_file_location",["driver_opening_cli",DRIVER],{}));
module=(await pyMethod(importlib.util,"module_from_spec",[spec],{}));
(await pyMethod(spec.loader,"exec_module",[module],{}));
(await pyMethod(monkeypatch,"setattr",[module,"rpc_call",(...args:any[])=>({["ok"]:true,["summary"]:({...result,["turn"]:1})})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(module,"cmd_turn",[(await SimpleNamespace(({"run":"opening-replay","text":"Hello.","timeout":10})))],{})),0)),"tests/play/test_driver.py:249 assert module.cmd_turn(SimpleNamespace(run=\"opening-replay\", text=\"Hello.\", timeout=10)) == 0");
out=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyLess((await pyMethod(out,"index",[pyAt(opening,"content")],{})),(await pyMethod(out,"index",[pyAt(result,"final_text")],{})))),pyStr("the story is printed before the reply"));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_setup_opening_shown_by_the_host_reaches_the_turn_and_its_printout"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_setup_opening_shown_by_the_host_reaches_the_turn_and_its_printout(pyMonkeypatch(t),captureOutput(t));});
export async function test_hidden_or_other_custom_messages_are_not_a_setup_opening(overrides:any){
let result:any;
result=(await replay_turn((await setup_opening_turn((await setup_opening_message(({...overrides})))))));
assert.ok(pyBool(!pyContains(result,"setup_opening")),"tests/play/test_driver.py:258 assert \"setup_opening\" not in result");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("overrides",[({["display"]:false}),({["customType"]:"coc-capsule"}),({["content"]:""}),({["content"]:[({["type"]:"text",["text"]:"Not string content"})]})]))).entries())test("test_hidden_or_other_custom_messages_are_not_a_setup_opening"+((pyCartesian([{}],pyParametrize("overrides",[({["display"]:false}),({["customType"]:"coc-capsule"}),({["content"]:""}),({["content"]:[({["type"]:"text",["text"]:"Not string content"})]})]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_hidden_or_other_custom_messages_are_not_a_setup_opening(row["overrides"]);});
export async function test_other_event_shapes_are_not_notice_delivery(event:any){
let result:any;
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,event],[.2,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),"")),"tests/play/test_driver.py:274 assert result[\"final_text\"] == \"\"");
assert.ok(pyBool((pyAt(result,"delivery")===null)),"tests/play/test_driver.py:275 assert result[\"delivery\"] is None");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"empty")),"tests/play/test_driver.py:276 assert result[\"settle_class\"] == \"empty\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("event",[({["type"]:"message_start",["message"]:(await review_notice())}),({["type"]:"message_end",["message"]:(await review_notice(({"role":"user"})))}),({["type"]:"message_end",["message"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod((await review_notice()),"items",[],{})))){if(pyBool(!pyEqual(key,"details"))){__rows.push([key,value]);}}return __rows;})()))}),({["type"]:"message_end",["message"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod((await review_notice()),"items",[],{})))){if(pyBool(!pyEqual(key,"display"))){__rows.push([key,value]);}}return __rows;})()))}),({["type"]:"message_update",["message"]:({["role"]:"assistant",["display"]:false}),["assistantMessageEvent"]:({["type"]:"text_delta",["delta"]:"Hidden draft"})}),({["type"]:"message_end",["message"]:(await review_notice(({"role":"assistant","display":false,"content":[({["type"]:"text",["text"]:"Hidden assistant text"})]})))}),({["type"]:"entry_appended",["entry"]:({["type"]:"message",["message"]:(await review_notice())})})]))).entries())test("test_other_event_shapes_are_not_notice_delivery"+((pyCartesian([{}],pyParametrize("event",[({["type"]:"message_start",["message"]:(await review_notice())}),({["type"]:"message_end",["message"]:(await review_notice(({"role":"user"})))}),({["type"]:"message_end",["message"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod((await review_notice()),"items",[],{})))){if(pyBool(!pyEqual(key,"details"))){__rows.push([key,value]);}}return __rows;})()))}),({["type"]:"message_end",["message"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod((await review_notice()),"items",[],{})))){if(pyBool(!pyEqual(key,"display"))){__rows.push([key,value]);}}return __rows;})()))}),({["type"]:"message_update",["message"]:({["role"]:"assistant",["display"]:false}),["assistantMessageEvent"]:({["type"]:"text_delta",["delta"]:"Hidden draft"})}),({["type"]:"message_end",["message"]:(await review_notice(({"role":"assistant","display":false,"content":[({["type"]:"text",["text"]:"Hidden assistant text"})]})))}),({["type"]:"entry_appended",["entry"]:({["type"]:"message",["message"]:(await review_notice())})})]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_other_event_shapes_are_not_notice_delivery(row["event"]);});
export async function test_successful_delivery_overrides_earlier_notice(tool:any){
let body:any,result:any;
body=({["rendered_text"]:"The clerk opens the ledger.",["mechanics"]:[({["kind"]:"check"})],["pending_choice"]:(pyBool(pyEqual(tool,"ask"))?({["kind"]:"choice"}):null)});
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:(await review_notice())})],[.2,({["type"]:"tool_execution_start",["toolName"]:tool,["toolCallId"]:"published",["args"]:({})})],[.3,({["type"]:"tool_execution_end",["toolName"]:tool,["toolCallId"]:"published",["result"]:({["content"]:[({["type"]:"text",["text"]:(await pyMethod(json,"dumps",[body],{}))})]})})],[.4,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(body,"rendered_text"))),"tests/play/test_driver.py:291 assert result[\"final_text\"] == body[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"delivery"),({["kind"]:tool,...body}))),"tests/play/test_driver.py:292 assert result[\"delivery\"] == {\"kind\": tool, **body}");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:293 assert result[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt((await review_notice()),"content"),["details"]:pyAt((await review_notice()),"details")})])),"tests/play/test_driver.py:294 assert result[\"notices\"] == [{\"content\": review_notice()[\"content\"], \"details\": review_notice()[\"details\"]}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("tool",["narrate","ask"]))).entries())test("test_successful_delivery_overrides_earlier_notice"+((pyCartesian([{}],pyParametrize("tool",["narrate","ask"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_successful_delivery_overrides_earlier_notice(row["tool"]);});
export async function test_host_publication_preserves_structured_story(event_type:any,field:any,supplemental:any,monkeypatch:any,capsys:any){
let body:any,publication:any,result:any,spec:any,module:any,output:any;
body=({["rendered_text"]:"The clerk opens the ledger.",["mechanics"]:[({["kind"]:"check"})],["pending_choice"]:({["kind"]:"choice"})});
publication=(pyBool(supplemental)?(await review_notice()):(await review_notice(({"content":pyAt(body,"rendered_text"),"details":({["coc_delivery"]:true,["turn"]:8})}))));
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"tool_execution_start",["toolName"]:"ask",["toolCallId"]:"story",["args"]:({})})],[.2,({["type"]:"tool_execution_end",["toolName"]:"ask",["toolCallId"]:"story",["result"]:({["content"]:[({["type"]:"text",["text"]:(await pyMethod(json,"dumps",[body],{}))})]})})],[.3,({["type"]:event_type,[field]:publication})],[.4,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(body,"rendered_text"))),"tests/play/test_driver.py:312 assert result[\"final_text\"] == body[\"rendered_text\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"delivery"),({["kind"]:"ask",...body}))),"tests/play/test_driver.py:313 assert result[\"delivery\"] == {\"kind\": \"ask\", **body}");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:314 assert result[\"settle_class\"] == \"settled\"");
if(pyBool(supplemental)){assert.ok(pyBool(pyEqual(pyAt(result,"notices"),[({["content"]:pyAt(publication,"content"),["details"]:pyAt(publication,"details")})])),"tests/play/test_driver.py:316 assert result[\"notices\"] == [{\"content\": publication[\"content\"], \"details\": publication[\"details\"]}]");}else{assert.ok(pyBool(!pyContains(result,"notices")),"tests/play/test_driver.py:318 assert \"notices\" not in result");}
spec=(await pyMethod(importlib.util,"spec_from_file_location",["driver_publication_cli",DRIVER],{}));
module=(await pyMethod(importlib.util,"module_from_spec",[spec],{}));
(await pyMethod(spec.loader,"exec_module",[module],{}));
(await pyMethod(monkeypatch,"setattr",[module,"rpc_call",(...args:any[])=>({["ok"]:true,["summary"]:({...result,["turn"]:8})})],{}));
assert.ok(pyBool(pyEqual((await pyMethod(module,"cmd_turn",[(await SimpleNamespace(({"run":"publication-replay","text":"Continue.","timeout":10})))],{})),0)),"tests/play/test_driver.py:324 assert module.cmd_turn(SimpleNamespace(run=\"publication-replay\", text=\"Continue.\", timeout=10)) == 0");
output=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool(pyEqual((await pyMethod(output,"count",[pyAt(body,"rendered_text")],{})),1)),"tests/play/test_driver.py:326 assert output.count(body[\"rendered_text\"]) == 1");
if(pyBool(supplemental)){assert.ok(pyBool(pyEqual((await pyMethod(output,"count",[pyAt(publication,"content")],{})),1)),"tests/play/test_driver.py:328 assert output.count(publication[\"content\"]) == 1");
assert.ok(pyBool(pyLess((await pyMethod(output,"index",[pyAt(body,"rendered_text")],{})),(await pyMethod(output,"index",[pyAt(publication,"content")],{})))),"tests/play/test_driver.py:329 assert output.index(body[\"rendered_text\"]) < output.index(publication[\"content\"])");}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]])),pyParametrize("supplemental",[false,true]))).entries())test("test_host_publication_preserves_structured_story"+((pyCartesian(pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]])),pyParametrize("supplemental",[false,true]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_host_publication_preserves_structured_story(row["event_type"],row["field"],row["supplemental"],pyMonkeypatch(t),captureOutput(t));});
export async function test_host_narrative_without_tool_result(event_type:any,field:any,earlier_notice:any){
let story:any,events:any,result:any;
story=(await review_notice(({"content":"The door opens.","details":({["coc_delivery"]:true,["turn"]:8})})));
events=[[0,({["type"]:"agent_start"})]];
if(pyBool(earlier_notice)){(await pyMethod(events,"append",[[.1,({["type"]:event_type,[field]:(await review_notice())})]],{}));}
result=(await replay_turn(pyAdd(events,[[.2,({["type"]:event_type,[field]:story})],[.3,({["type"]:"agent_settled"})]])));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(story,"content"))),"tests/play/test_driver.py:340 assert result[\"final_text\"] == story[\"content\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"delivery"),({["kind"]:"narrate",["rendered_text"]:pyAt(story,"content"),["mechanics"]:[],["pending_choice"]:null,["details"]:pyAt(story,"details")}))),"tests/play/test_driver.py:341 assert result[\"delivery\"] == {\"kind\": \"narrate\", \"rendered_text\": story[\"content\"],\n                                  \"mechanics\": [], \"pending_choice\": None, \"details\": story[\"details\"]}");
assert.ok(pyBool((pyAt(pyAt(result,"delivery"),"details")!==pyAt(story,"details"))),"tests/play/test_driver.py:343 assert result[\"delivery\"][\"details\"] is not story[\"details\"]");
assert.ok(pyBool(pyEqual(pyAt(result,"settle_class"),"settled")),"tests/play/test_driver.py:344 assert result[\"settle_class\"] == \"settled\"");
assert.ok(pyBool(pyEqual((await pyBool((await pyMethod(result,"get",["notices"],{})))),earlier_notice)),"tests/play/test_driver.py:345 assert bool(result.get(\"notices\")) == earlier_notice");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]])),pyParametrize("earlier_notice",[false,true]))).entries())test("test_host_narrative_without_tool_result"+((pyCartesian(pyCartesian([{}],pyParametrize("event_type,field",[["message_end","message"],["entry_appended","entry"]])),pyParametrize("earlier_notice",[false,true]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_host_narrative_without_tool_result(row["event_type"],row["field"],row["earlier_notice"]);});
export async function test_closed_notice_markers_preserve_nested_details(marker:any){
let notice:any,result:any;
notice=(await review_notice(({"details":({["coc_delivery"]:true,["turn"]:8,[marker]:({["reason"]:["held"]})})})));
result=(await replay_turn([[0,({["type"]:"message_end",["message"]:notice})],[.1,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"kind"),"notice")),"tests/play/test_driver.py:356 assert result[\"delivery\"][\"kind\"] == \"notice\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"notices"),0),"details"),pyAt(notice,"details"))),"tests/play/test_driver.py:357 assert result[\"notices\"][0][\"details\"] == notice[\"details\"]");
(await pyMethod(pyAt(pyAt(pyAt(notice,"details"),marker),"reason"),"append",["changed"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(result,"notices"),0),"details"),marker),({["reason"]:["held"]}))),"tests/play/test_driver.py:359 assert result[\"notices\"][0][\"details\"][marker] == {\"reason\": [\"held\"]}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(result,"delivery"),"details"),marker),({["reason"]:["held"]}))),"tests/play/test_driver.py:360 assert result[\"delivery\"][\"details\"][marker] == {\"reason\": [\"held\"]}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("marker",["provider_outage","commit_unavailable","delivery_cut_short","refused_effect","preparation_wait","resend_held","turn_unfinished","standing_conditions","input_refused","empty_input","review_unavailable"]))).entries())test("test_closed_notice_markers_preserve_nested_details"+((pyCartesian([{}],pyParametrize("marker",["provider_outage","commit_unavailable","delivery_cut_short","refused_effect","preparation_wait","resend_held","turn_unfinished","standing_conditions","input_refused","empty_input","review_unavailable"]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_closed_notice_markers_preserve_nested_details(row["marker"]);});
export async function test_multiple_notices_preserve_first_primary_and_persist_in_order(tmp_path:any,monkeypatch:any,capsys:any){
let first:any,second:any,result:any,spec:any,module:any,daemon:any,response:any,output:any;
const __unpack19580=[(await review_notice()),(await review_notice(({"content":"The service remains paused."})))];assert.equal(__unpack19580.length,2,"Original tuple unpacking requires exact arity");first=__unpack19580[0];second=__unpack19580[1];
result=(await replay_turn(pyAdd((await failed_narrate_events()),[[.4,({["type"]:"message_end",["message"]:first})],[.5,({["type"]:"message_end",["message"]:second})],[.6,({["type"]:"agent_settled"})]])));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAt(first,"content"))),"tests/play/test_driver.py:370 assert result[\"final_text\"] == first[\"content\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"rendered_text"),pyAt(first,"content"))),"tests/play/test_driver.py:371 assert result[\"delivery\"][\"rendered_text\"] == first[\"content\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const notice of pyIterable(pyAt(result,"notices"))){__rows.push(pyAt(notice,"content"));}return __rows;})()),[pyAt(first,"content"),pyAt(second,"content")])),"tests/play/test_driver.py:372 assert [notice[\"content\"] for notice in result[\"notices\"]] == [first[\"content\"], second[\"content\"]]");
spec=(await pyMethod(importlib.util,"spec_from_file_location",["driver_notice_persistence",DRIVER],{}));
module=(await pyMethod(importlib.util,"module_from_spec",[spec],{}));
(await pyMethod(spec.loader,"exec_module",[module],{}));
daemon=(await pyMethod(module.Daemon,"__new__",[module.Daemon],{}));
const __unpack20333=["notice-replay",tmp_path];assert.equal(__unpack20333.length,2,"Original tuple unpacking requires exact arity");daemon.run_id=__unpack20333[0];daemon.dir=String(__unpack20333[1]);
daemon._write_heartbeat=(...args:any[])=>null;
daemon.log=(await SimpleNamespace(({"write":(...args:any[])=>null})));
response=(await pyMethod(daemon,"_finalize_turn",[8,"Continue.",(await pyMethod(module,"now_iso",[],{})),(await pyMethod(module.time,"monotonic",[],{})),pyAt(result,"tools"),pyAt(result,"final_text"),pyAt(result,"settle_class"),pyAt(result,"stop_reason")],{"delivery":pyAt(result,"delivery"),"notices":pyAt(result,"notices")}));
assert.ok(pyBool(pyEqual(pyAt((await JSON.parse(pyDivide(tmp_path,"turn-8.json").read_text())),"notices"),pyAt(result,"notices"))),"tests/play/test_driver.py:383 assert read_json(tmp_path / \"turn-8.json\")[\"notices\"] == result[\"notices\"]");
(await pyMethod(monkeypatch,"setattr",[module,"rpc_call",(...args:any[])=>response],{}));
assert.ok(pyBool(pyEqual((await pyMethod(module,"cmd_turn",[(await SimpleNamespace(({"run":"notice-replay","text":"Continue.","timeout":10})))],{})),0)),"tests/play/test_driver.py:385 assert module.cmd_turn(SimpleNamespace(run=\"notice-replay\", text=\"Continue.\", timeout=10)) == 0");
output=(await pyMethod(capsys,"readouterr",[],{})).out;
assert.ok(pyBool((await (async()=>{const __term0=(await pyMethod(output,"count",[pyAt(first,"content")],{}));const __term1=(await pyMethod(output,"count",[pyAt(second,"content")],{}));const __term2=1;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/play/test_driver.py:387 assert output.count(first[\"content\"]) == output.count(second[\"content\"]) == 1");
assert.ok(pyBool(pyLess((await pyMethod(output,"index",[pyAt(first,"content")],{})),(await pyMethod(output,"index",[pyAt(second,"content")],{})))),"tests/play/test_driver.py:388 assert output.index(first[\"content\"]) < output.index(second[\"content\"])");
(await pyMethod(daemon,"_finalize_turn",[9,"Continue.",(await pyMethod(module,"now_iso",[],{})),(await pyMethod(module.time,"monotonic",[],{})),[],"Story.","settled","agent_settled"],{}));
assert.ok(pyBool(!pyContains((await JSON.parse(pyDivide(tmp_path,"turn-9.json").read_text())),"notices")),"tests/play/test_driver.py:391 assert \"notices\" not in read_json(tmp_path / \"turn-9.json\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_multiple_notices_preserve_first_primary_and_persist_in_order"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_multiple_notices_preserve_first_primary_and_persist_in_order(temporary,pyMonkeypatch(t),captureOutput(t));});
export async function test_resumed_work_that_never_finishes_times_out(){
let result:any;
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"agent_end"})],[.2,({["type"]:"agent_start"})]],3));
assert.ok(pyBool(pyEqual(pyAt(result,"stop_reason"),"timeout")),"tests/play/test_driver.py:397 assert result[\"stop_reason\"] == \"timeout\"");
assert.ok(pyBool(pyEqual(pyAt(result,"wall_seconds"),3)),"tests/play/test_driver.py:398 assert result[\"wall_seconds\"] == 3");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_resumed_work_that_never_finishes_times_out"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_resumed_work_that_never_finishes_times_out();});
export async function test_mixed_reference_reply_survives_later_story_and_duplicate_custom_projection(){
let reply:any,result:any;
reply=({["role"]:"custom",["customType"]:"coc-delivery",["display"]:true,["content"]:"That is the NPC's guess, not an established fact.",["details"]:({["coc_delivery"]:true,["reference_reply"]:true,["turn"]:1})});
result=(await replay_turn([[0,({["type"]:"agent_start"})],[.1,({["type"]:"message_end",["message"]:reply})],[.2,({["type"]:"entry_appended",["entry"]:reply})],[.3,({["type"]:"tool_execution_start",["toolCallId"]:"output1",["toolName"]:"output",["args"]:({})})],[.4,({["type"]:"tool_execution_end",["toolCallId"]:"output1",["toolName"]:"output",["isError"]:false,["result"]:({["content"]:[({["type"]:"text",["text"]:(await pyMethod(json,"dumps",[({["rendered_text"]:"Knott answers your question.",["mechanics"]:[]})],{}))})]})})],[.5,({["type"]:"agent_end"})],[.6,({["type"]:"agent_settled"})]]));
assert.ok(pyBool(pyEqual(pyAt(result,"final_text"),pyAdd(pyAt(reply,"content"),"\n\nKnott answers your question."))),"tests/play/test_driver.py:1149 assert result[\"final_text\"] == reply[\"content\"] + \"\\n\\nKnott answers your question.\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"delivery"),"rendered_text"),"Knott answers your question.")),"tests/play/test_driver.py:1150 assert result[\"delivery\"][\"rendered_text\"] == \"Knott answers your question.\"");
assert.ok(pyBool(pyEqual(pyAt(result,"reference_replies"),[pyAt(reply,"content")])),"tests/play/test_driver.py:1151 assert result[\"reference_replies\"] == [reply[\"content\"]]");
assert.ok(pyBool(!pyBool((await pyMethod(result,"get",["notices"],{})))),"tests/play/test_driver.py:1152 assert not result.get(\"notices\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_mixed_reference_reply_survives_later_story_and_duplicate_custom_projection"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);resetDriver(t);await test_mixed_reference_reply_survives_later_story_and_duplicate_custom_projection();});
