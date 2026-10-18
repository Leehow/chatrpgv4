// Migrated from tests/kernel/test_voice_bench.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,narrate,narrate_opening,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";


export let CAST:any=["王铁柱","周敬之","刘桂芝","小豆子","赵巡长","陈买办","铁口张","玛丽·斯通","哑巴老崔"];
export async function create(client:any){
return (await pyMethod(client,"ok",["campaign.create",({["id"]:CAMPAIGN,["module"]:"voice-bench",["pregen"]:"shen-zhiwei",["play_language"]:"zh-Hans"})],{}));
}
export async function test_the_bench_opens_on_nine_people_and_the_capsule_keeps_every_name(kernel:any){
(await create(kernel));
// This baseline measures the original dossiers; enabled portrayal tables have their own crowded-room test.
await kernel.ok('mods.configure',{campaign:CAMPAIGN,id:'natural-npc',enabled:false});
(await narrate_opening(kernel,"雨夜。三义茶馆里坐满了人。"));
let capsule:any=pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我找个空位坐下，先看看屋里都有谁。"})),"capsule");
assert.ok(pyBool(pyEqual(pyAt(pyAt(capsule,"where"),"scene"),"sanyi-teahouse")),"tests/kernel/test_voice_bench.py:18 assert capsule[\"where\"][\"scene\"] == \"sanyi-teahouse\"");
let present:any=pyAt(capsule,"present");
const fullLook = (await kernel.table('look', {focus:'npc'})).present;
for (const person of present) {
  const full = fullLook.find((row:any) => row.name === person.name);
  assert.ok(full, 'Every original present actor remains available through the full native look');
  assert.equal(person.id, full.id, 'Budget fitting retains the registered native identity');
}
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(present)){if(pyBool(true))__rows.push(pyAt(p,"name"));}return __rows;})()))),(await pySorted(CAST)))),"tests/kernel/test_voice_bench.py:20 assert sorted(p[\"name\"] for p in present) == sorted(CAST)");
let full:any=(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(present)){if(pyBool(!pyBool((await pyMethod(p,"get",["truncated"],{})))))__rows.push(p);}return __rows;})());
let stubs:any=(await (async()=>{const __rows:any[]=[];for(const p of pyIterable(present)){if(pyBool((await pyMethod(p,"get",["truncated"],{}))))__rows.push(p);}return __rows;})());
for(const person of stubs){assert.match(person.ref,/^npc_[1-9][0-9]*$/);assert.equal(typeof person.name_known,'boolean');assert.equal(typeof person.display_name,'string');}
const legacyStubs = stubs.map(({id,ref,name_known,display_name,...person}:any) => person);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyLessEqual(4,(await pyLen(full)));return pyBool(__left)?stubs:__left})());return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(legacyStubs)){if(pyBool(true))__rows.push(pyEqual((await pySet(p)),new Set(["name","truncated","untold","activity"])));}return __rows;})()))):__left})())),"tests/kernel/test_voice_bench.py:25 assert len(full) >= 4 and stubs and all(set(p) == {\"name\", \"truncated\", \"untold\", \"activity\"} for p in stubs)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(present)){if(pyBool(true))__rows.push(pyEqual(pyAt(p,"activity"),({["current"]:false,["review_required"]:true,["review_reasons"]:["unassessed"]})));}return __rows;})())))),"tests/kernel/test_voice_bench.py:26 assert all(p[\"activity\"] == {\"current\": False, \"review_required\": True, \"review_reasons\": [\"unassessed\"]} for p in present)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(stubs)){if(pyBool(true))__rows.push((await (async()=>{const __left=(await pyMethod(pyAt(pyAt(p,"untold"),"say_name"),"startswith",["{{name:"],{}));return pyBool(__left)?!pyContains(pyAt(p,"untold"),"use"):__left})()));}return __rows;})())))),"tests/kernel/test_voice_bench.py:27 assert all(p[\"untold\"][\"say_name\"].startswith(\"{{name:\") and \"use\" not in p[\"untold\"] for p in stubs)");
assert.ok(pyBool(pyContains(pyAt(capsule,"truncated"),"present")),"tests/kernel/test_voice_bench.py:28 assert \"present\" in capsule[\"truncated\"]");
assert.ok(pyBool(pyEqual(pyAt(capsule,"voices"),[])),"tests/kernel/test_voice_bench.py:29 assert capsule[\"voices\"] == []");
assert.ok(pyBool(pyEqual((await pySorted((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"npc"})),"present"))){if(pyBool(true))__rows.push(pyAt(p,"name"));}return __rows;})()))),(await pySorted(CAST)))),"tests/kernel/test_voice_bench.py:31 assert sorted(p[\"name\"] for p in kernel.table(\"look\", focus=\"npc\")[\"present\"]) == sorted(CAST)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_bench_opens_on_nine_people_and_the_capsule_keeps_every_name"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_bench_opens_on_nine_people_and_the_capsule_keeps_every_name(await kernel(t,{}));});
export async function test_the_lane_is_offered_the_room_one_person_at_a_time_with_the_masks_taken(kernel:any){
(await create(kernel));
(await narrate_opening(kernel,"雨夜。三义茶馆里坐满了人。"));
assert.ok(pyBool(pyContains(CAST,pyAt(pyAt((await pyMethod(kernel,"ok",["voice.job",({["campaign"]:CAMPAIGN})],{})),"npc"),"name"))),"tests/kernel/test_voice_bench.py:39 assert kernel.ok(\"voice.job\", {\"campaign\": CAMPAIGN})[\"npc\"][\"name\"] in CAST");
(await pyMethod(kernel,"table",["player_input"],{"text":"我找个空位坐下。"}));
(await narrate(kernel,"t1-c1","屋里很吵。"));
const __unpack2403=[[],[]];let offered:any=__unpack2403[0];let masks:any=__unpack2403[1];
while(pyBool(true)){let packet:any=(await pyMethod(kernel,"ok",["voice.job",({["campaign"]:CAMPAIGN})],{}));
if(pyBool((pyAt(packet,"job_id")===null))){break;}
assert.ok(pyBool(pyEqual(pyAt(packet,"taken_masks"),masks)),"tests/kernel/test_voice_bench.py:47 assert packet[\"taken_masks\"] == masks");
let name:any=pyAt(pyAt(packet,"npc"),"name");
(await pyMethod(offered,"append",[name],{}));
if(pyBool(pyEqual(name,"哑巴老崔"))){(await pyMethod(kernel,"ok",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["voice"]:null,["reason"]:"does_not_speak"})],{}));
continue;}
let mask:any=`${name}的面具。`;
(await pyMethod(kernel,"ok",["voice.submit",({["campaign"]:CAMPAIGN,["job_id"]:pyAt(packet,"job_id"),["voice"]:({["mask"]:mask,["exchanges"]:[`${mask}一`,`${mask}二`,`${mask}三`]})})],{}));
(await pyMethod(masks,"append",[mask],{}));}
assert.ok(pyBool(pyEqual((await pySorted(offered)),(await pySorted(CAST)))),"tests/kernel/test_voice_bench.py:56 assert sorted(offered) == sorted(CAST)");
let voices:any=pyAt(pyAt((await pyMethod(kernel,"table",["player_input"],{"text":"我听他们说话。"})),"capsule"),"voices");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const v of pyIterable(voices)){if(pyBool(true))__rows.push(pyAt(v,"name"));}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const n of pyIterable(offered)){if(pyBool(!pyEqual(n,"哑巴老崔")))__rows.push(n);}return __rows;})()))),"tests/kernel/test_voice_bench.py:58 assert [v[\"name\"] for v in voices] == [n for n in offered if n != \"哑巴老崔\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const v of pyIterable(voices)){if(pyBool(true))__rows.push((await (async()=>{const __left=pyEqual(pyAt(v,"mask"),`${pyAt(v,"name")}的面具。`);return pyBool(__left)?pyEqual((await pyLen(pyAt(v,"in exchange"))),3):__left})()));}return __rows;})())))),"tests/kernel/test_voice_bench.py:59 assert all(v[\"mask\"] == f\"{v['name']}的面具。\" and len(v[\"in exchange\"]) == 3 for v in voices)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_lane_is_offered_the_room_one_person_at_a_time_with_the_masks_taken"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_lane_is_offered_the_room_one_person_at_a_time_with_the_masks_taken(await kernel(t,{}));});
