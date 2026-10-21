// Migrated from tests/kernel/test_temporal_context.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel,ROOT} from './support.ts';
import {join} from 'node:path';
import {campaign_dir,create_campaign,open_turn,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter,copy,pyReversed,math} from "./setup-native-support.ts";





export async function activity(fields:any={}){
return (await pyDict(({"summary":"The established local situation.","basis":"established",...fields})));
}
export async function apply(client:any,ordinal:any,...effects:any[]){
return (await pyMethod(client,"table",["apply"],{"call_id":`t1-c${ordinal}`,"effects":(await pyList(effects))}));
}
export async function scene(fields:any={}){
return (await pyDict(({"kind":"scene","name":"here","activity":(await activity(({...fields}))),"why":"The local practice was established."})));
}
export async function world(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json")));
}
export async function person(client:any){
return pyAt(pyAt(pyAt((await pyMethod(client,"table",["capsule"],{})),"present"),0),"name");
}
export async function npc(name:any,state:any,basis:any="observed"){
return (await pyDict(({"kind":"npc","name":name,"activity":(await pyDict(({"summary":"The person's actual activity.","basis":basis,"wakefulness":state}))),"why":"An actual local event changed their activity."})));
}
export async function test_old_save_projects_need_without_inventing_records(kernel:any){
let capsule:any,temporal:any,entry:any;
(await open_turn(kernel,"I look around."));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
temporal=pyAt(pyAt(capsule,"where"),"temporal");
assert.ok(pyBool((pyAt(temporal,"review_required")===true)),"tests/kernel/test_temporal_context.py:36 assert temporal[\"review_required\"] is True");
assert.ok(pyBool(pyEqual(pyAt(temporal,"review_reasons"),["unassessed"])),"tests/kernel/test_temporal_context.py:37 assert temporal[\"review_reasons\"] == [\"unassessed\"]");
assert.ok(pyBool(!pyContains((await world(kernel)),"scene_activity")),"tests/kernel/test_temporal_context.py:38 assert \"scene_activity\" not in world(kernel)");
assert.ok(pyBool(!pyContains((await world(kernel)),"npc_activity")),"tests/kernel/test_temporal_context.py:39 assert \"npc_activity\" not in world(kernel)");
assert.ok(pyBool(pyContains(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"scene"})),"where"),"temporal")),"tests/kernel/test_temporal_context.py:40 assert \"temporal\" in kernel.table(\"look\", focus=\"scene\")[\"where\"]");
assert.ok(pyBool(pyAt(capsule,"present")),pyStr("The old save has an ordinary person to reassess."));
for(entry of pyIterable(pyAt(capsule,"present"))){
assert.ok(pyBool(pyEqual(pyAt(entry,"activity"),(await pyDict(({"current":false,"review_required":true,"review_reasons":["unassessed"]}))))),"tests/kernel/test_temporal_context.py:43 assert entry[\"activity\"] == dict(current=False, review_required=True, review_reasons=[\"unassessed\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":pyAt(entry,"name")})),"activity"),pyAt(entry,"activity"))),"tests/kernel/test_temporal_context.py:44 assert kernel.table(\"look\", focus=\"npc\", name=entry[\"name\"])[\"activity\"] == entry[\"activity\"]");
}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_old_save_projects_need_without_inventing_records"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_old_save_projects_need_without_inventing_records(await kernel(t,{}));});
export async function test_precise_review_boundary_inside_same_day_part_does_not_auto_close(kernel:any){
let before:any,after:any;
(await open_turn(kernel,"I wait until late afternoon."));
(await apply(kernel,1,(await pyDict(({"kind":"time","until":(await pyDict(({"days":0,"time":"16:55"}))),"why":"The chosen wait elapsed."})))));
(await apply(kernel,2,(await scene(({"service":"open","crowd":"active","review_after_minutes":5})))));
before=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool((pyAt(before,"current")===true)),"tests/kernel/test_temporal_context.py:52 assert before[\"current\"] is True");
(await apply(kernel,3,(await pyDict(({"kind":"time","minutes":5,"why":"Five minutes actually passed."})))));
after=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool(pyEqual(pyAt(pyAt(after,"recorded_clock"),"day_part"),pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"clock"),"day_part"))),"tests/kernel/test_temporal_context.py:55 assert after[\"recorded_clock\"][\"day_part\"] == kernel.table(\"capsule\")[\"where\"][\"clock\"][\"day_part\"]");
assert.ok(pyBool(pyEqual(pyAt(after,"review_reasons"),["review_boundary_reached"])),"tests/kernel/test_temporal_context.py:56 assert after[\"review_reasons\"] == [\"review_boundary_reached\"]");
assert.ok(pyBool((pyAt(after,"current")===false)),"tests/kernel/test_temporal_context.py:57 assert after[\"current\"] is False");
assert.ok(pyBool(pyEqual(pyAt(after,"service"),"open")),pyStr("An old fact is retained, not a newly invented closure."));
(await apply(kernel,4,(await scene(({"service":"closed","crowd":"quiet"})))));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal"),"service"),"closed")),"tests/kernel/test_temporal_context.py:60 assert kernel.table(\"capsule\")[\"where\"][\"temporal\"][\"service\"] == \"closed\"");
assert.ok(pyBool((pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal"),"current")===true)),"tests/kernel/test_temporal_context.py:61 assert kernel.table(\"capsule\")[\"where\"][\"temporal\"][\"current\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_precise_review_boundary_inside_same_day_part_does_not_auto_close"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_precise_review_boundary_inside_same_day_part_does_not_auto_close(await kernel(t,{}));});
export async function test_night_changes_applicability_not_the_recorded_world(kernel:any){
let old_scene:any,view:any;
(await open_turn(kernel,"I wait overnight."));
(await apply(kernel,1,(await scene(({"service":"open","crowd":"active"})))));
old_scene=pyAt((await world(kernel)),"active_scene");
(await apply(kernel,2,(await pyDict(({"kind":"time","until":(await pyDict(({"days":1,"time":"03:00"}))),"why":"The selected interval elapsed."})))));
view=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool(pyLessEqual(new Set(["day_changed","day_part_changed"]),(await pySet(pyAt(view,"review_reasons"))))),"tests/kernel/test_temporal_context.py:70 assert {\"day_changed\", \"day_part_changed\"} <= set(view[\"review_reasons\"])");
assert.ok(pyBool((pyAt(view,"current")===false)),"tests/kernel/test_temporal_context.py:71 assert view[\"current\"] is False");
assert.ok(pyBool(pyEqual(pyAt((await world(kernel)),"active_scene"),old_scene)),"tests/kernel/test_temporal_context.py:72 assert world(kernel)[\"active_scene\"] == old_scene");
assert.ok(pyBool(pyEqual(pyAt(view,"service"),"open")),"tests/kernel/test_temporal_context.py:73 assert view[\"service\"] == \"open\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_night_changes_applicability_not_the_recorded_world"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_night_changes_applicability_not_the_recorded_world(await kernel(t,{}));});
export async function test_awakened_person_survives_routine_guess_and_five_minutes(kernel:any){
let name:any,refused:any,card:any,named:any;
(await open_turn(kernel,"I knock on the door."));
name=(await person(kernel));
(await apply(kernel,1,(await npc(name,"asleep"))));
(await apply(kernel,2,(await npc(name,"awake","established"))));
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[(await npc(name,"asleep","inferred"))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"reason"),"activity_basis")),"tests/kernel/test_temporal_context.py:82 assert refused[\"details\"][\"reason\"] == \"activity_basis\"");
(await apply(kernel,3,(await pyDict(({"kind":"time","minutes":5,"why":"Five minutes of the encounter passed."})))));
card=(await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"present"))){if(pyBool(pyEqual(pyAt(p,"name"),name))){__rows.push(p);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(card,"activity"),"wakefulness"),"awake")),"tests/kernel/test_temporal_context.py:85 assert card[\"activity\"][\"wakefulness\"] == \"awake\"");
assert.ok(pyBool((pyAt(pyAt(card,"activity"),"current")===true)),"tests/kernel/test_temporal_context.py:86 assert card[\"activity\"][\"current\"] is True");
named=(await pyMethod(kernel,"table",["look"],{"focus":"npc","name":name}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(named,"activity"),"wakefulness"),"awake")),"tests/kernel/test_temporal_context.py:88 assert named[\"activity\"][\"wakefulness\"] == \"awake\"");
assert.ok(pyBool(!pyContains((await pyMethod((await pyMethod(named,"get",["state",({})],{})),"get",["conditions",[]],{})),"unconscious")),"tests/kernel/test_temporal_context.py:89 assert \"unconscious\" not in named.get(\"state\", {}).get(\"conditions\", [])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_awakened_person_survives_routine_guess_and_five_minutes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_awakened_person_survives_routine_guess_and_five_minutes(await kernel(t,{}));});
export async function test_inferred_account_lands_once_the_observed_record_no_longer_applies(kernel:any){
let stale:any,night:any,landed:any,view:any,receipt:any;

(await open_turn(kernel,"I come back to my room in the evening."));
(await apply(kernel,1,(await scene(({"service":"open","crowd":"quiet","review_after_minutes":180})))));
(await apply(kernel,2,(await pyDict(({"kind":"time","until":(await pyDict(({"days":1,"time":"21:00"}))),"why":"The day passed elsewhere."})))));
stale=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(stale,"current")===false);return pyBool(__left)?pyContains(pyAt(stale,"review_reasons"),"day_changed"):__left})())),"tests/kernel/test_temporal_context.py:99 assert stale[\"current\"] is False and \"day_changed\" in stale[\"review_reasons\"]");
night=(await pyDict(({"kind":"scene","name":"here","activity":(await pyDict(({"summary":"Night in the house; the room lamp is lit.","basis":"inferred","service":"limited","crowd":"quiet","review_after_minutes":480}))),"why":"The investigator returned at night."})));
landed=(await apply(kernel,3,night));
assert.ok(pyBool(pyAt(landed,"receipts")),"tests/kernel/test_temporal_context.py:103 assert landed[\"receipts\"]");
view=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"basis"),"inferred");return pyBool(__left)?(pyAt(view,"current")===true):__left})())),"tests/kernel/test_temporal_context.py:105 assert view[\"basis\"] == \"inferred\" and view[\"current\"] is True");
receipt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"turn.json"))),"receipts"))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(r,"get",["kind"],{})),"scene");return pyBool(__left)?pyEqual((await pyMethod(r,"get",["call_id"],{})),"t1-c3"):__left})()))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(pyAt(receipt,"previous"),"basis"),"established")),pyStr("The observed history stays in the receipt."));
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_inferred_account_lands_once_the_observed_record_no_longer_applies"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_inferred_account_lands_once_the_observed_record_no_longer_applies(await kernel(t,{}));});
export async function test_time_earlier_in_the_batch_decides_whether_the_record_still_applies(kernel:any){
let noon:any,refused:any,landed:any;

(await open_turn(kernel,"I read until noon."));
(await apply(kernel,1,(await pyDict(({"kind":"time","until":(await pyDict(({"days":0,"time":"10:30"}))),"why":"Morning."})))));
(await apply(kernel,2,(await scene(({"service":"open","crowd":"active","review_after_minutes":180})))));
noon=(await pyDict(({"kind":"scene","name":"here","activity":(await pyDict(({"summary":"Noon readers remain at the long tables.","basis":"inferred","service":"open","crowd":"active"}))),"why":"Reading ran to noon."})));
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[noon]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(refused,"details"),"reason"),"activity_basis")),pyStr("Still current: the established record guards."));
landed=(await apply(kernel,4,(await pyDict(({"kind":"time","until":(await pyDict(({"days":0,"time":"13:30"}))),"why":"Reading ran past noon."}))),noon));
assert.ok(pyBool(pyAt(landed,"receipts")),"tests/kernel/test_temporal_context.py:121 assert landed[\"receipts\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_time_earlier_in_the_batch_decides_whether_the_record_still_applies"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_time_earlier_in_the_batch_decides_whether_the_record_still_applies(await kernel(t,{}));});
export async function test_invalid_activity_rolls_back_time_and_scene_atomically(kernel:any){
let before:any,invalid:any,refused:any;
(await open_turn(kernel,"I look around."));
before=(await world(kernel));
invalid=(await npc((await person(kernel)),"impossible_state"));
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[(await pyDict(({"kind":"time","minutes":7}))),(await scene(({"service":"closed"}))),invalid]}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"invalid_params")),"tests/kernel/test_temporal_context.py:129 assert refused[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await world(kernel)),before)),"tests/kernel/test_temporal_context.py:130 assert world(kernel) == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_invalid_activity_rolls_back_time_and_scene_atomically"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_invalid_activity_rolls_back_time_and_scene_atomically(await kernel(t,{}));});
export async function test_context_effects_replay_without_moving_or_transferring_objects(kernel:any){
let before:any,first:any,replayed:any,after:any;
(await open_turn(kernel,"I look through the window."));
before=(await world(kernel));
first=(await apply(kernel,1,(await scene(({"service":"closed","crowd":"quiet"})))));
replayed=(await apply(kernel,1,(await scene(({"service":"closed","crowd":"quiet"})))));
assert.ok(pyBool(((await pyMethod(replayed,"pop",["replayed"],{}))===true)),"tests/kernel/test_temporal_context.py:138 assert replayed.pop(\"replayed\") is True");
assert.ok(pyBool(pyEqual(replayed,first)),"tests/kernel/test_temporal_context.py:139 assert replayed == first");
after=(await world(kernel));
assert.ok(pyBool(pyEqual(pyAt(after,"active_scene"),pyAt(before,"active_scene"))),"tests/kernel/test_temporal_context.py:141 assert after[\"active_scene\"] == before[\"active_scene\"]");
assert.ok(pyBool(pyEqual((await pyMethod(after,"get",["npc_presence"],{})),(await pyMethod(before,"get",["npc_presence"],{})))),"tests/kernel/test_temporal_context.py:142 assert after.get(\"npc_presence\") == before.get(\"npc_presence\")");
assert.ok(pyBool(pyEqual((await pyMethod(after,"get",["objects"],{})),(await pyMethod(before,"get",["objects"],{})))),"tests/kernel/test_temporal_context.py:143 assert after.get(\"objects\") == before.get(\"objects\")");
assert.ok(pyBool(pyEqual(pyAt(after,"clock"),pyAt(before,"clock"))),"tests/kernel/test_temporal_context.py:144 assert after[\"clock\"] == before[\"clock\"]");
assert.ok(pyBool(pyEqual(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [key,value] of pyIterable((await pyMethod(after,"items",[],{})))){if(pyBool(!pyEqual(key,"scene_activity"))){__rows.push([key,value]);}}return __rows;})())),before)),"tests/kernel/test_temporal_context.py:145 assert {key: value for key, value in after.items() if key != \"scene_activity\"} == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_context_effects_replay_without_moving_or_transferring_objects"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_context_effects_replay_without_moving_or_transferring_objects(await kernel(t,{}));});
export async function test_effect_order_binds_resulting_clock(kernel:any){
let view:any;
(await open_turn(kernel,"I wait until night."));
(await apply(kernel,1,(await pyDict(({"kind":"time","until":(await pyDict(({"days":0,"time":"23:30"})))}))),(await scene(({"service":"closed","crowd":"quiet"})))));
view=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal");
assert.ok(pyBool(pyEqual(pyAt(view,"recorded_clock"),pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"clock"))),"tests/kernel/test_temporal_context.py:152 assert view[\"recorded_clock\"] == kernel.table(\"capsule\")[\"where\"][\"clock\"]");
assert.ok(pyBool((pyAt(view,"current")===true)),"tests/kernel/test_temporal_context.py:153 assert view[\"current\"] is True");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_effect_order_binds_resulting_clock"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_effect_order_binds_resulting_clock(await kernel(t,{}));});
export async function test_leaving_person_marks_record_for_review_without_erasing_observation(kernel:any){
let name:any,view:any;
(await open_turn(kernel,"I say goodbye."));
name=(await person(kernel));
(await apply(kernel,1,(await npc(name,"awake"))));
(await apply(kernel,2,(await pyDict(({"kind":"npc","name":name,"to":"away","why":"They left."})))));
view=pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc","name":name})),"activity");
assert.ok(pyBool(pyEqual(pyAt(view,"wakefulness"),"awake")),"tests/kernel/test_temporal_context.py:162 assert view[\"wakefulness\"] == \"awake\"");
assert.ok(pyBool((pyAt(view,"current")===false)),"tests/kernel/test_temporal_context.py:163 assert view[\"current\"] is False");
assert.ok(pyBool(pyContains(pyAt(view,"review_reasons"),"scene_changed")),"tests/kernel/test_temporal_context.py:164 assert \"scene_changed\" in view[\"review_reasons\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_leaving_person_marks_record_for_review_without_erasing_observation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_leaving_person_marks_record_for_review_without_erasing_observation(await kernel(t,{}));});
export async function test_opening_context_initializes_only_active_scene(kernel:any){
let refused:any;
(await create_campaign(kernel));
(await pyMethod(kernel,"table",["open"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t0-c1","effects":[(await scene(({"service":"limited","crowd":"quiet"})))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"where"),"temporal"),"service"),"limited")),"tests/kernel/test_temporal_context.py:171 assert kernel.table(\"capsule\")[\"where\"][\"temporal\"][\"service\"] == \"limited\"");
refused=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t0-c2","effects":[(await pyDict((await scene(({"service":"closed"}))),({"name":"hall-of-records"})))]}));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"invalid_params")),"tests/kernel/test_temporal_context.py:173 assert refused[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_opening_context_initializes_only_active_scene"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_opening_context_initializes_only_active_scene(await kernel(t,{}));});
export async function test_daily_life_table_is_mod_owned_and_disabled_strategy_keeps_world_facts(kernel:any){
let name:any,tables:any,daily:any,capsule:any;
(await open_turn(kernel,"I knock."));
name=(await person(kernel));
(await apply(kernel,1,(await npc(name,"awake","observed")),(await scene(({"service":"closed","crowd":"quiet"})))));
tables=pyAt((await pyMethod(kernel,"ok",["mods.temporal_context",({["campaign"]:"c1"})],{})),"tables");
daily=(await pyNext((await (async()=>{const __rows:any[]=[];for(const table of pyIterable(tables)){if(pyBool(pyEqual(pyAt(table,"mod"),"daily-life"))){__rows.push(table);}}return __rows;})())));
assert.ok(pyBool(pyLessEqual(new Set(["residential-rest","residential-night-street","night-entertainment"]),new Set((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(daily,"items"))){__rows.push(pyAt(item,"id"));}return __rows;})())))),"tests/kernel/test_temporal_context.py:182 assert {\"residential-rest\", \"residential-night-street\", \"night-entertainment\"} <= {item[\"id\"] for item in daily[\"items\"]}");
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"The resident remains awake, and the public counter is closed."}));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:"c1",["id"]:"daily-life",["enabled"]:false})],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I wait a moment."}));
capsule=(await pyMethod(kernel,"table",["capsule"],{}));
assert.ok(pyBool(!pyContains(pyAt(capsule,"mods"),"temporal_context")),"tests/kernel/test_temporal_context.py:187 assert \"temporal_context\" not in capsule[\"mods\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"ok",["mods.temporal_context",({["campaign"]:"c1"})],{})),"tables"),[])),"tests/kernel/test_temporal_context.py:188 assert kernel.ok(\"mods.temporal_context\", {\"campaign\": \"c1\"})[\"tables\"] == []");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(capsule,"where"),"temporal"),"service"),"closed")),"tests/kernel/test_temporal_context.py:189 assert capsule[\"where\"][\"temporal\"][\"service\"] == \"closed\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(capsule,"present"))){if(pyBool(pyEqual(pyAt(p,"name"),name))){__rows.push(p);}}return __rows;})()))),"activity"),"wakefulness"),"awake")),"tests/kernel/test_temporal_context.py:190 assert next(p for p in capsule[\"present\"] if p[\"name\"] == name)[\"activity\"][\"wakefulness\"] == \"awake\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_daily_life_table_is_mod_owned_and_disabled_strategy_keeps_world_facts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_daily_life_table_is_mod_owned_and_disabled_strategy_keeps_world_facts(await kernel(t,{}));});
export async function test_daily_life_guidance_does_not_displace_existing_package_instructions(kernel:any){
// Keep the original full-instruction fixture; sections 242 and 247 test the always-indexed packages.
await kernel.ok("mods.defaults",{id:"enhanced-locations",enabled:false});
await kernel.ok("mods.defaults",{id:"quick-settlement",enabled:false});
let instructions:any,daily:any,host:any;
(await open_turn(kernel,"I look around."));
instructions=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"mods"),"instructions");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(instructions)){__rows.push(pyEqual(pyAt(item,"mod"),"daily-life"));}return __rows;})()))))),"tests/kernel/test_temporal_context.py:196 assert not any(item[\"mod\"] == \"daily-life\" for item in instructions)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(instructions)){__rows.push(pyEqual(pyAt(item,"form"),"full"));}return __rows;})())))),"tests/kernel/test_temporal_context.py:197 assert all(item[\"form\"] == \"full\" for item in instructions)");
daily=(await pyNext((await (async()=>{const __rows:any[]=[];for(const table of pyIterable(pyAt((await pyMethod(kernel,"ok",["mods.temporal_context",({["campaign"]:"c1"})],{})),"tables"))){if(pyBool(pyEqual(pyAt(table,"mod"),"daily-life"))){__rows.push(table);}}return __rows;})())));
assert.ok(pyBool(pyContains(pyAt(daily,"guidance"),"where.temporal")),"tests/kernel/test_temporal_context.py:199 assert \"where.temporal\" in daily[\"guidance\"]");
host=(await pyMethod(kernel,"ok",["mods.context",({["campaign"]:"c1"})],{}));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(host,"instructions"))){__rows.push(pyEqual(pyAt(item,"form"),"full"));}return __rows;})())))),"tests/kernel/test_temporal_context.py:201 assert all(item[\"form\"] == \"full\" for item in host[\"instructions\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_daily_life_guidance_does_not_displace_existing_package_instructions"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_daily_life_guidance_does_not_displace_existing_package_instructions(await kernel(t,{}));});
export async function test_temporal_threshold_uses_the_configured_numeric_setting(kernel:any){
let tables:any;
(await create_campaign(kernel));
(await pyMethod(kernel,"ok",["mods.configure",({["campaign"]:"c1",["id"]:"daily-life",["settings"]:({["threshold"]:0.8})})],{}));
tables=pyAt((await pyMethod(kernel,"ok",["mods.temporal_context",({["campaign"]:"c1"})],{})),"tables");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const table of pyIterable(tables)){if(pyBool(pyEqual(pyAt(table,"mod"),"daily-life"))){__rows.push(table);}}return __rows;})()))),"threshold"),0.8)),"tests/kernel/test_temporal_context.py:208 assert next(table for table in tables if table[\"mod\"] == \"daily-life\")[\"threshold\"] == 0.8");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_temporal_threshold_uses_the_configured_numeric_setting"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_temporal_threshold_uses_the_configured_numeric_setting(await kernel(t,{}));});
export async function test_temporal_table_validation_rejects_duplicate_items_before_install(kernel:any,tmp_path:any){
let source:any,package_value:any,manifest:any,table:any,error:any;
source=Path(join(ROOT,'mods/daily-life'));
package_value=pyDivide(tmp_path,"invalid-life");
(await pyMethod(shutil,"copytree",[source,package_value],{}));
manifest=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(package_value,"mod.json")),"read_text",[],{}))],{}));
manifest["id"]="invalid-life";
manifest["default_enabled"]=false;
(await pyMethod((pyDivide(package_value,"mod.json")),"write_text",[(await pyMethod(json,"dumps",[manifest],{}))],{}));
table=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(package_value,"contexts.json")),"read_text",[],{}))],{}));
(await pyMethod(pyAt(table,"items"),"append",[pyAt(pyAt(table,"items"),0)],{}));
(await pyMethod((pyDivide(package_value,"contexts.json")),"write_text",[(await pyMethod(json,"dumps",[table],{}))],{}));
error=(await pyMethod(kernel,"err",["mods.install",({["path"]:(await pyStr(package_value))})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"invalid_params")),"tests/kernel/test_temporal_context.py:223 assert error[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyContains(pyAt(error,"message"),"distinct semantic slugs")),"tests/kernel/test_temporal_context.py:224 assert \"distinct semantic slugs\" in error[\"message\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_temporal_table_validation_rejects_duplicate_items_before_install"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_temporal_table_validation_rejects_duplicate_items_before_install(await kernel(t,{}),temporary);});
