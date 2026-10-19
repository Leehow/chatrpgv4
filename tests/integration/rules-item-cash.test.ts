// Migrated from tests/kernel/test_apply_item_cash.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {native,tables} from './rules-engine-support.ts';
import {CONFRONTATION_PATH,resolve,resolve_err,walk_to_confrontation} from './rules-families.test.ts';
const {sheetSkillValue:sheet_skill_value,investigatorCombatParticipant:investigator_combat_participant,resolveInvestigatorWeapon:resolve_investigator_weapon,weaponOptions:options_of}=native;
import {CAMPAIGN,CONTENT_DIR,RpcClient,campaign_dir,narrate_opening,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";









export let INVESTIGATOR:any="thomas-hayes";
export let INV_NAME:any="托马斯·海斯";
export let RULES:any=pyDivide(pyDivide(pyDivide(CONTENT_DIR,"rulesets"),"coc7"),"rules-json");
export let SHOTGUN:any="shotgun_12g";
export async function sheet(client:any){
return (await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"party"),`${INVESTIGATOR}.json`)));
}
export async function events_of(client:any,event_type:any){
return (await (async()=>{const __rows:any[]=[];for(const e of pyIterable((await read_jsonl(pyDivide((await campaign_dir(client.workspace)),"events.jsonl"))))){if(pyBool(pyEqual(pyAt(e,"type"),event_type))){__rows.push(e);}}return __rows;})());
}
export async function receipts_of(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
}
export async function give_shotgun(client:any,call_id:any="t1-c1",extra:any={}){
return (await pyMethod(client,"table",["apply"],{"call_id":call_id,"effects":[({["kind"]:"item",["name"]:"Winchester shotgun",["from"]:"Knott",["weapon"]:SHOTGUN,["label"]:"温彻斯特霰弹枪",["why"]:"诺特从柜子里取出来",...extra})]}));
}

export async function test_item_with_a_weapon_profile_reaches_the_sheet_the_line_and_the_event(kernel:any){
let result:any,weapons:any,profile:any,after:any,entry:any,row:any,receipt:any,event:any,narrated:any;
(await open_turn(kernel,"我接过枪。"));
result=(await give_shotgun(kernel));
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["item:winchester-shotgun-t1-c1"])),"tests/kernel/test_apply_item_cash.py:49 assert result[\"receipts\"] == [\"item:winchester-shotgun-t1-c1\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(result,"world"),"clock"),({["minutes"]:0}))),"tests/kernel/test_apply_item_cash.py:50 assert result[\"world\"][\"clock\"] == {\"minutes\": 0}");
weapons=(await json_weapons());
profile=pyAt(weapons,SHOTGUN);
after=(await sheet(kernel));
entry=pyAt(pyAt(after,"equipment"),(-1));
assert.ok(pyBool(pyEqual(entry,({["name"]:"Winchester shotgun",["quantity"]:1,["turn"]:1,["from"]:"Steven Knott",["label"]:"温彻斯特霰弹枪",["weapon"]:SHOTGUN}))),"tests/kernel/test_apply_item_cash.py:56 assert entry == {\"name\": \"Winchester shotgun\", \"quantity\": 1, \"turn\": 1, \"from\": \"Steven Knott\",\n                     \"label\": \"温彻斯特霰弹枪\", \"weapon\": SHOTGUN}");
assert.ok(pyBool(pyEqual(pySlice(pyAt(after,"equipment"),undefined,(-1)),pyAt((await read_json(pyDivide(pyDivide(pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"pregens"),INVESTIGATOR),"character.json"))),"equipment"))),"tests/kernel/test_apply_item_cash.py:59 assert after[\"equipment\"][:-1] == read_json(CONTENT_DIR / \"starters\" / \"the-haunting\" / \"pregens\" / INVESTIGATOR / \"character.json\")[\"equipment\"]");
row=pyAt(pyAt(after,"weapons"),(-1));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(row,"weapon_id"),SHOTGUN);return pyBool(__left)?pyEqual(pyAt(row,"name"),"Winchester shotgun"):__left;})());return pyBool(__left)?pyEqual(pyAt(row,"label"),"温彻斯特霰弹枪"):__left;})())),"tests/kernel/test_apply_item_cash.py:61 assert row[\"weapon_id\"] == SHOTGUN and row[\"name\"] == \"Winchester shotgun\" and row[\"label\"] == \"温彻斯特霰弹枪\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"skill"),pyAt(profile,"skill"));return pyBool(__left)?pyEqual(pyAt(row,"damage"),pyAt(profile,"damage_die")):__left;})())),"tests/kernel/test_apply_item_cash.py:63 assert row[\"skill\"] == profile[\"skill\"] and row[\"damage\"] == profile[\"damage_die\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"ammo"),pyAt(profile,"magazine"));return pyBool(__left)?pyEqual(pyAt(row,"malfunction"),pyAt(profile,"malfunction")):__left;})())),"tests/kernel/test_apply_item_cash.py:64 assert row[\"ammo\"] == profile[\"magazine\"] and row[\"malfunction\"] == profile[\"malfunction\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"range"),`${pyAt(profile,"base_range_yards")} yards`);return pyBool(__left)?pyEqual(pyAt(row,"attacks"),pyAt(profile,"uses_per_round")):__left;})())),"tests/kernel/test_apply_item_cash.py:65 assert row[\"range\"] == f\"{profile['base_range_yards']} yards\" and row[\"attacks\"] == profile[\"uses_per_round\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"profile"),pyAt(profile,"display_name"));return pyBool(__left)?pyEqual(pyAt(row,"turn"),1):__left;})())),"tests/kernel/test_apply_item_cash.py:66 assert row[\"profile\"] == profile[\"display_name\"] and row[\"turn\"] == 1");
receipt=pyAt((await receipts_of(kernel)),"item:winchester-shotgun-t1-c1");
assert.ok(pyBool(pyEqual(receipt,({...receipt,["kind"]:"item",["name"]:"Winchester shotgun",["label"]:"温彻斯特霰弹枪",["subject"]:INVESTIGATOR,["subject_label"]:INV_NAME,["from"]:"Steven Knott",["weapon"]:SHOTGUN,["quantity"]:1,["before"]:0,["after"]:1,["why"]:"诺特从柜子里取出来"}))),"tests/kernel/test_apply_item_cash.py:69 assert receipt == {**receipt, \"kind\": \"item\", \"name\": \"Winchester shotgun\", \"label\": \"温彻斯特霰弹枪\",\n                       \"subject\": INVESTIGATOR, \"subject_label\": INV_NAME, \"from\": \"Steven Knott\", \"weapon\": SHOTGUN,\n                       \"quantity\": 1, \"before\": 0, \"after\": 1, \"why\": \"诺特从柜子里取出来\"}");
event=pyAt((await events_of(kernel,"item-transferred")),(-1));
assert.ok(pyBool(pyEqual(pyAt(event,"receipt"),"item:winchester-shotgun-t1-c1")),"tests/kernel/test_apply_item_cash.py:73 assert event[\"receipt\"] == \"item:winchester-shotgun-t1-c1\"");
assert.ok(pyBool(pyEqual(pyAt(event,"data"),({["name"]:"Winchester shotgun",["to"]:INVESTIGATOR,["quantity"]:1,["from"]:"Steven Knott",["weapon"]:SHOTGUN}))),"tests/kernel/test_apply_item_cash.py:74 assert event[\"data\"] == {\"name\": \"Winchester shotgun\", \"to\": INVESTIGATOR, \"quantity\": 1, \"from\": \"Steven Knott\",\n                             \"weapon\": SHOTGUN}");
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"诺特把枪递过来。\n\n枪很沉。"}));
assert.ok(pyBool(pyEqual(pyAt(narrated,"rendered_text"),"诺特把枪递过来。\n\n枪很沉。")),"tests/kernel/test_apply_item_cash.py:78 assert narrated[\"rendered_text\"] == \"诺特把枪递过来。\\n\\n枪很沉。\"");
assert.ok(pyBool(pyEqual(pyAt(narrated,"mechanics"),[({["kind"]:"item",["marker"]:"item:winchester-shotgun",["receipt"]:"item:winchester-shotgun-t1-c1",["name"]:"Winchester shotgun",["quantity"]:1,["to"]:INVESTIGATOR,["label"]:"温彻斯特霰弹枪",["to_label"]:INV_NAME,["from"]:"Steven Knott",["weapon"]:SHOTGUN,["call"]:"t1-c1"})])),"tests/kernel/test_apply_item_cash.py:79 assert narrated[\"mechanics\"] == [{\"kind\": \"item\", \"marker\": \"item:winchester-shotgun\", \"receipt\": \"item:winchester-shotgun-t1-c1\", \"name\": \"Winchester shotgun\",\n                                      \"quantity\": 1, \"to\": INVESTIGATOR, \"label\": \"温彻斯特霰弹枪\", \"to_label\": INV_NAME,\n                                      \"from\": \"Steven Knott\", \"weapon\": SHOTGUN, \"call\": \"t1-c1\"}]");
assert.ok(pyBool(pyContains(pyAt(pyAt(narrated,"facts"),"committed"),`Item: ${INV_NAME} gains 温彻斯特霰弹枪`)),"tests/kernel/test_apply_item_cash.py:82 assert f\"Item: {INV_NAME} gains 温彻斯特霰弹枪\" in narrated[\"facts\"][\"committed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_item_with_a_weapon_profile_reaches_the_sheet_the_line_and_the_event"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_item_with_a_weapon_profile_reaches_the_sheet_the_line_and_the_event(await kernel(t,{}));});
export async function test_item_without_a_weapon_is_kit_and_quantities_merge(kernel:any){
let first:any,again:any,entries:any,logged:any,narrated:any;
(await open_turn(kernel));
first=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"shotgun shells",["quantity"]:6})]}));
assert.ok(pyBool(pyEqual(pyAt(first,"receipts"),["item:shotgun-shells-t1-c1"])),"tests/kernel/test_apply_item_cash.py:88 assert first[\"receipts\"] == [\"item:shotgun-shells-t1-c1\"]");
again=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"item",["name"]:"Shotgun Shells",["quantity"]:4})]}));
assert.ok(pyBool(pyEqual(pyAt(again,"receipts"),["item:shotgun-shells-t1-c2"])),"tests/kernel/test_apply_item_cash.py:90 assert again[\"receipts\"] == [\"item:shotgun-shells-t1-c2\"]");
entries=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt((await sheet(kernel)),"equipment"))){if(pyBool((await pyIsInstance(e,pyDict)))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual(entries,[({["name"]:"shotgun shells",["quantity"]:10,["turn"]:1})])),"tests/kernel/test_apply_item_cash.py:92 assert entries == [{\"name\": \"shotgun shells\", \"quantity\": 10, \"turn\": 1}]");
assert.ok(pyBool(pyEqual((await pyLen(pyAt((await sheet(kernel)),"weapons"))),1)),"tests/kernel/test_apply_item_cash.py:93 assert len(sheet(kernel)[\"weapons\"]) == 1");
logged=(await receipts_of(kernel));
assert.ok(pyBool(pyEqual([pyAt(pyAt(logged,"item:shotgun-shells-t1-c1"),"before"),pyAt(pyAt(logged,"item:shotgun-shells-t1-c1"),"after")],[0,6])),"tests/kernel/test_apply_item_cash.py:95 assert (logged[\"item:shotgun-shells-t1-c1\"][\"before\"], logged[\"item:shotgun-shells-t1-c1\"][\"after\"]) == (0, 6)");
assert.ok(pyBool(pyEqual([pyAt(pyAt(logged,"item:shotgun-shells-t1-c2"),"before"),pyAt(pyAt(logged,"item:shotgun-shells-t1-c2"),"after")],[6,10])),"tests/kernel/test_apply_item_cash.py:96 assert (logged[\"item:shotgun-shells-t1-c2\"][\"before\"], logged[\"item:shotgun-shells-t1-c2\"][\"after\"]) == (6, 10)");
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"他数了数子弹。"}));
assert.ok(pyBool(pyEqual(pyAt(narrated,"rendered_text"),"他数了数子弹。")),"tests/kernel/test_apply_item_cash.py:98 assert narrated[\"rendered_text\"] == \"他数了数子弹。\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(narrated,"mechanics"))){__rows.push([pyAt(m,"name"),pyAt(m,"quantity")]);}return __rows;})()),[["shotgun shells",6],["Shotgun Shells",4]])),"tests/kernel/test_apply_item_cash.py:100 assert [(m[\"name\"], m[\"quantity\"]) for m in narrated[\"mechanics\"]] == [(\"shotgun shells\", 6), (\"Shotgun Shells\", 4)]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_item_without_a_weapon_is_kit_and_quantities_merge"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_item_without_a_weapon_is_kit_and_quantities_merge(await kernel(t,{}));});
export async function test_unknown_weapon_profile_is_needs_with_the_eras_ids_and_the_batch_does_not_write(kernel:any){
let error:any,needs:any,weapons:any,module_rows:any,by_name:any;
(await open_turn(kernel));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5}),({["kind"]:"item",["name"]:"Winchester shotgun",["weapon"]:"winchester"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(error,"details"),"index"),1):__left;})())),"tests/kernel/test_apply_item_cash.py:108 assert error[\"code\"] == \"needs\" and error[\"details\"][\"index\"] == 1");
needs=pyAt(pyAt(error,"details"),"needs");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(needs,"field"),"weapon");return pyBool(__left)?(await pyMethod(pyAt(needs,"source"),"endswith",["weapons.json"],{})):__left;})())),"tests/kernel/test_apply_item_cash.py:110 assert needs[\"field\"] == \"weapon\" and needs[\"source\"].endswith(\"weapons.json\")");
weapons=(await json_weapons());
assert.ok(pyBool(pyContains(pyAt(needs,"options"),SHOTGUN)),"tests/kernel/test_apply_item_cash.py:112 assert SHOTGUN in needs[\"options\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(weapons,"shotgun_12g_pump");return pyBool(__left)?!pyContains(pyAt(needs,"options"),"shotgun_12g_pump"):__left;})())),"tests/kernel/test_apply_item_cash.py:114 assert \"shotgun_12g_pump\" in weapons and \"shotgun_12g_pump\" not in needs[\"options\"]");
module_rows=new Set((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt((await read_json(pyDivide(RULES,"the-haunting.json"))),"weapons"))){__rows.push(pyAt(w,"weapon_id"));}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyLessEqual((await pySet(pyAt(needs,"options"))),pyUnion((await pySet(weapons)),module_rows));return pyBool(__left)?pyIntersection((await pySet(pyAt(needs,"options"))),module_rows):__left;})())),"tests/kernel/test_apply_item_cash.py:117 assert set(needs[\"options\"]) <= set(weapons) | module_rows and set(needs[\"options\"]) & module_rows");
assert.ok(pyBool(pyLessEqual((await pySet(pyAt(needs,"close"))),pyUnion((await pySet(pyAt(needs,"options"))),(await pySet(weapons))))),"tests/kernel/test_apply_item_cash.py:118 assert set(needs[\"close\"]) <= set(needs[\"options\"]) | set(weapons)");
assert.ok(pyBool(pyEqual(pyAt((await read_json(pyDivide((await campaign_dir(kernel.workspace)),"world.json"))),"clock"),({["minutes"]:0}))),"tests/kernel/test_apply_item_cash.py:120 assert read_json(campaign_dir(kernel.workspace) / \"world.json\")[\"clock\"] == {\"minutes\": 0}");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt((await sheet(kernel)),"equipment"))){__rows.push((await pyIsInstance(e,pyDict)));}return __rows;})()))))),"tests/kernel/test_apply_item_cash.py:121 assert not any(isinstance(e, dict) for e in sheet(kernel)[\"equipment\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_apply_item_cash.py:122 assert kernel.table(\"status\")[\"receipts\"] == []");
by_name=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"sawn-off",["weapon"]:pyAt(pyAt(weapons,"shotgun_12g_sawed_off"),"display_name")})]}));
assert.ok(pyBool(pyEqual(pyAt(by_name,"receipts"),["item:sawn-off-t1-c1"])),"tests/kernel/test_apply_item_cash.py:126 assert by_name[\"receipts\"] == [\"item:sawn-off-t1-c1\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"weapons"),(-1)),"weapon_id"),"shotgun_12g_sawed_off")),"tests/kernel/test_apply_item_cash.py:127 assert sheet(kernel)[\"weapons\"][-1][\"weapon_id\"] == \"shotgun_12g_sawed_off\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"item",["name"]:"x",["quantity"]:0})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:128 assert kernel.table_err(\"apply\", call_id=\"t1-c2\", effects=[{\"kind\": \"item\", \"name\": \"x\", \"quantity\": 0}])[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"item",["name"]:"x",["to"]:"nobody"})]})),"code"),"unknown_entity")),"tests/kernel/test_apply_item_cash.py:129 assert kernel.table_err(\"apply\", call_id=\"t1-c2\", effects=[{\"kind\": \"item\", \"name\": \"x\", \"to\": \"nobody\"}])[\"code\"] == \"unknown_entity\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unknown_weapon_profile_is_needs_with_the_eras_ids_and_the_batch_does_not_write"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unknown_weapon_profile_is_needs_with_the_eras_ids_and_the_batch_does_not_write(await kernel(t,{}));});

export async function test_loss_needs_the_item_on_the_sheet_and_takes_the_weapon_row_with_it(kernel:any){
let missing:any,lost:any,receipt:any,too_many:any,gone:any,after:any,narrated:any;
(await open_turn(kernel));
missing=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"lantern",["quantity"]:(-1)})]}));
// Loss diagnostics retain the original fields plus the staged transaction boundary.
assert.equal(missing.code,'invalid_params');
const {transaction_state:transactionState,...lossDetails}=missing.details;
assert.equal(transactionState,'uncommitted');
assert.deepEqual(lossDetails,{index:0,name:'lantern',held:0,quantity:-1});
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"shotgun shells",["quantity"]:6})]}));
lost=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"item",["name"]:"shotgun shells",["quantity"]:(-2),["why"]:"打空两发"})]}));
assert.ok(pyBool(pyEqual(pyAt(lost,"receipts"),["item:shotgun-shells-t1-c2"])),"tests/kernel/test_apply_item_cash.py:141 assert lost[\"receipts\"] == [\"item:shotgun-shells-t1-c2\"]");
receipt=pyAt((await receipts_of(kernel)),"item:shotgun-shells-t1-c2");
assert.ok(pyBool(pyEqual([pyAt(receipt,"quantity"),pyAt(receipt,"before"),pyAt(receipt,"after")],[(-2),6,4])),"tests/kernel/test_apply_item_cash.py:143 assert (receipt[\"quantity\"], receipt[\"before\"], receipt[\"after\"]) == (-2, 6, 4)");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt((await sheet(kernel)),"equipment"))){if(pyBool((await pyIsInstance(e,pyDict)))){__rows.push(e);}}return __rows;})()),[({["name"]:"shotgun shells",["quantity"]:4,["turn"]:1})])),"tests/kernel/test_apply_item_cash.py:144 assert [e for e in sheet(kernel)[\"equipment\"] if isinstance(e, dict)] == [{\"name\": \"shotgun shells\", \"quantity\": 4, \"turn\": 1}]");
too_many=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"item",["name"]:"shotgun shells",["quantity"]:(-5)})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(too_many,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(too_many,"details"),"held"),4):__left;})())),"tests/kernel/test_apply_item_cash.py:146 assert too_many[\"code\"] == \"invalid_params\" and too_many[\"details\"][\"held\"] == 4");
(await give_shotgun(kernel,"t1-c3",({})));
assert.ok(pyBool(pyEqual((await weapon_options(kernel)),[".38 Revolver","Winchester shotgun","unarmed"])),"tests/kernel/test_apply_item_cash.py:149 assert weapon_options(kernel) == [\".38 Revolver\", \"Winchester shotgun\", \"unarmed\"]");
gone=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"item",["name"]:"温彻斯特霰弹枪",["quantity"]:(-1)})]}));
assert.ok(pyBool(pyEqual(pyAt(gone,"receipts"),["item:t1-c4"])),"tests/kernel/test_apply_item_cash.py:152 assert gone[\"receipts\"] == [\"item:t1-c4\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await receipts_of(kernel)),"item:t1-c4"),"name"),"温彻斯特霰弹枪")),"tests/kernel/test_apply_item_cash.py:153 assert receipts_of(kernel)[\"item:t1-c4\"][\"name\"] == \"温彻斯特霰弹枪\"");
after=(await sheet(kernel));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(after,"equipment"))){__rows.push((await (async()=>{const __left=(await pyIsInstance(e,pyDict));return pyBool(__left)?pyEqual(pyAt(e,"name"),"Winchester shotgun"):__left;})()));}return __rows;})()))))),"tests/kernel/test_apply_item_cash.py:155 assert not any(isinstance(e, dict) and e[\"name\"] == \"Winchester shotgun\" for e in after[\"equipment\"])");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const w of pyIterable(pyAt(after,"weapons"))){__rows.push(pyAt(w,"weapon_id"));}return __rows;})()),["revolver_38_or_9mm"])),"tests/kernel/test_apply_item_cash.py:156 assert [w[\"weapon_id\"] for w in after[\"weapons\"]] == [\"revolver_38_or_9mm\"]");
assert.ok(pyBool(pyEqual((await weapon_options(kernel)),[".38 Revolver","unarmed"])),"tests/kernel/test_apply_item_cash.py:157 assert weapon_options(kernel) == [\".38 Revolver\", \"unarmed\"]");
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c5","text":"枪掉进了河里。"}));
assert.ok(pyBool(pyEqual(pyAt(narrated,"rendered_text"),"枪掉进了河里。")),"tests/kernel/test_apply_item_cash.py:159 assert narrated[\"rendered_text\"] == \"枪掉进了河里。\"");
assert.ok(pyBool(pyContains(pyAt(narrated,"mechanics"),({["kind"]:"item",["marker"]:"item",["receipt"]:"item:t1-c4",["name"]:"温彻斯特霰弹枪",["label"]:"温彻斯特霰弹枪",["quantity"]:(-1),["to"]:INVESTIGATOR,["to_label"]:INV_NAME,["call"]:"t1-c4"}))),"tests/kernel/test_apply_item_cash.py:160 assert {\"kind\": \"item\", \"marker\": \"item\", \"receipt\": \"item:t1-c4\", \"name\": \"温彻斯特霰弹枪\", \"label\": \"温彻斯特霰弹枪\", \"quantity\": -1,\n            \"to\": INVESTIGATOR, \"to_label\": INV_NAME, \"call\": \"t1-c4\"} in narrated[\"mechanics\"]");
assert.ok(pyBool(pyContains(pyAt(pyAt(narrated,"facts"),"committed"),`Item: ${INV_NAME} loses shotgun shells x2`)),"tests/kernel/test_apply_item_cash.py:162 assert f\"Item: {INV_NAME} loses shotgun shells x2\" in narrated[\"facts\"][\"committed\"]");
(await pyMethod(kernel,"table",["player_input"],{"text":"继续。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"item",["name"]:".38 Revolver",["quantity"]:(-1)})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt((await sheet(kernel)),"weapons"),[]);return pyBool(__left)?pyEqual((await weapon_options(kernel)),["unarmed"]):__left;})())),"tests/kernel/test_apply_item_cash.py:167 assert sheet(kernel)[\"weapons\"] == [] and weapon_options(kernel) == [\"unarmed\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_loss_needs_the_item_on_the_sheet_and_takes_the_weapon_row_with_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_loss_needs_the_item_on_the_sheet_and_takes_the_weapon_row_with_it(await kernel(t,{}));});

export async function test_a_given_shotgun_resolves_and_combat_counts_its_own_magazine_and_skill(tmp_path:any){
let client:any,n:any,scene:any,options:any,attack:any,defend:any,roll:any,profile:any,ammo:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await open_turn(client,"我举起霰弹枪。"));
(await give_shotgun(client));
for([n,scene] of pyIterable((await pyEnumerate(CONFRONTATION_PATH,({"start":2}))))){
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"move",["to"]:scene})]}));
}
n=pyAdd(2,(await pyLen(CONFRONTATION_PATH)));
options=(await resolve_err(client,`t1-c${n}`,({"intent":"combat","goal":"开枪","method":"射击","target":"Walter Corbitt"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(options,"details"),"needs"),"options"),[".38 Revolver","Winchester shotgun","unarmed"])),"tests/kernel/test_apply_item_cash.py:182 assert options[\"details\"][\"needs\"][\"options\"] == [\".38 Revolver\", \"Winchester shotgun\", \"unarmed\"]");
assert.ok(pyBool(pyEqual(pyAt((await resolve_err(client,`t1-c${n}`,({"intent":"combat","goal":"开枪","method":"射击","target":"Walter Corbitt","weapon":"Tommy gun"}))),"code"),"needs")),"tests/kernel/test_apply_item_cash.py:183 assert resolve_err(client, f\"t1-c{n}\", intent=\"combat\", goal=\"开枪\", method=\"射击\", target=\"Walter Corbitt\",\n                           weapon=\"Tommy gun\")[\"code\"] == \"needs\"");
attack=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"朝科比特开枪","method":"用霰弹枪","target":"Walter Corbitt","weapon":"温彻斯特霰弹枪"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(attack,"outcome"),"attack_kind"),"firearm_attack");return pyBool(__left)?(pyAt(pyAt(attack,"outcome"),"started")===true):__left;})())),"tests/kernel/test_apply_item_cash.py:187 assert attack[\"outcome\"][\"attack_kind\"] == \"firearm_attack\" and attack[\"outcome\"][\"started\"] is True");
defend=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"他迎着枪口","method":"","actor":"Walter Corbitt","defense":"none"})));
roll=pyAt(pyAt(pyAt(defend,"outcome"),"rolls"),0);
profile=pyAt((await json_weapons()),SHOTGUN);
assert.ok(pyBool(pyEqual(pyAt(roll,"skill"),pyAt(profile,"skill"))),"tests/kernel/test_apply_item_cash.py:194 assert roll[\"skill\"] == profile[\"skill\"]");
assert.ok(pyBool(pyEqual(pyAt(roll,"target"),pyAt(pyAt((await json_skills()),"Firearms (Rifle/Shotgun)"),"base_chance"))),"tests/kernel/test_apply_item_cash.py:195 assert roll[\"target\"] == json_skills()[\"Firearms (Rifle/Shotgun)\"][\"base_chance\"]");
ammo=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(defend,"effects"))){if(pyBool(pyEqual(pyAt(e,"kind"),"ammo"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual(ammo,[({["kind"]:"ammo",["subject"]:INVESTIGATOR,["before"]:pyAt(profile,"magazine"),["after"]:pySubtract(pyAt(profile,"magazine"),1),["weapon"]:SHOTGUN})])),"tests/kernel/test_apply_item_cash.py:197 assert ammo == [{\"kind\": \"ammo\", \"subject\": INVESTIGATOR, \"before\": profile[\"magazine\"],\n                         \"after\": profile[\"magazine\"] - 1, \"weapon\": SHOTGUN}]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(defend,"outcome"),"damage"),0),"expression"),pyAt(profile,"damage_die"))),"tests/kernel/test_apply_item_cash.py:199 assert defend[\"outcome\"][\"damage\"][0][\"expression\"] == profile[\"damage_die\"]");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_given_shotgun_resolves_and_combat_counts_its_own_magazine_and_skill"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_given_shotgun_resolves_and_combat_counts_its_own_magazine_and_skill(temporary);});
export async function test_sheet_skill_value_matches_the_weapon_tables_spelling_and_falls_back_to_the_rulebook_base(){
let weapons:any,skills:any,spelled_by_weapons:any,on_sheet:any,off_sheet:any,shotgun:any,labelled:any;

const __unpack12793=[(await json_weapons()),(await json_skills())];assert.equal(__unpack12793.length,2,"Original tuple unpacking requires exact arity");weapons=__unpack12793[0];skills=__unpack12793[1];
spelled_by_weapons=pyAt(pyAt(weapons,SHOTGUN),"skill");
assert.ok(pyBool(!pyEqual(spelled_by_weapons,"Firearms (Rifle/Shotgun)")),"tests/kernel/test_apply_item_cash.py:208 assert spelled_by_weapons != \"Firearms (Rifle/Shotgun)\"");
on_sheet=({["id"]:"x",["era"]:"1920s",["skills"]:({["Firearms (Rifle/Shotgun)"]:40,["Firearms (Handgun)"]:70})});
assert.ok(pyBool(pyEqual((await sheet_skill_value(tables,on_sheet,spelled_by_weapons)),40)),"tests/kernel/test_apply_item_cash.py:210 assert sheet_skill_value(tables, on_sheet, spelled_by_weapons) == 40");
off_sheet=({["id"]:"x",["era"]:"1920s",["skills"]:({["Firearms (Handgun)"]:70})});
assert.ok(pyBool(pyEqual((await sheet_skill_value(tables,off_sheet,spelled_by_weapons)),pyAt(pyAt(skills,"Firearms (Rifle/Shotgun)"),"base_chance"))),"tests/kernel/test_apply_item_cash.py:212 assert sheet_skill_value(tables, off_sheet, spelled_by_weapons) == skills[\"Firearms (Rifle/Shotgun)\"][\"base_chance\"]");
assert.ok(pyBool(((await sheet_skill_value(tables,off_sheet,"Firearms (Death Ray)"))===null)),"tests/kernel/test_apply_item_cash.py:213 assert sheet_skill_value(tables, off_sheet, \"Firearms (Death Ray)\") is None");
shotgun=({...pyAt(weapons,SHOTGUN),["weapon_id"]:SHOTGUN});
assert.ok(pyBool(pyEqual(pyAt((await investigator_combat_participant(tables,off_sheet,shotgun)),"firearms_skill"),25)),"tests/kernel/test_apply_item_cash.py:215 assert investigator_combat_participant(tables, off_sheet, shotgun)[\"firearms_skill\"] == 25");
assert.ok(pyBool(pyEqual(pyAt((await investigator_combat_participant(tables,on_sheet,shotgun)),"firearms_skill"),40)),"tests/kernel/test_apply_item_cash.py:216 assert investigator_combat_participant(tables, on_sheet, shotgun)[\"firearms_skill\"] == 40");
labelled=({["id"]:"x",["skills"]:({}),["weapons"]:[({["weapon_id"]:SHOTGUN,["name"]:"Winchester shotgun",["label"]:"温彻斯特霰弹枪"})]});
assert.ok(pyBool(pyEqual(pyAt((await resolve_investigator_weapon(tables,labelled,"温彻斯特霰弹枪")),"weapon_id"),SHOTGUN)),"tests/kernel/test_apply_item_cash.py:219 assert resolve_investigator_weapon(tables, labelled, \"温彻斯特霰弹枪\")[\"weapon_id\"] == SHOTGUN");
assert.ok(pyBool(pyEqual(pyAt((await resolve_investigator_weapon(tables,labelled,"winchester-shotgun")),"weapon_id"),SHOTGUN)),"tests/kernel/test_apply_item_cash.py:220 assert resolve_investigator_weapon(tables, labelled, \"winchester-shotgun\")[\"weapon_id\"] == SHOTGUN");
assert.ok(pyBool(pyEqual(pyAt((await resolve_investigator_weapon(tables,labelled,"12-gauge Shotgun (2B)")),"weapon_id"),SHOTGUN)),"tests/kernel/test_apply_item_cash.py:221 assert resolve_investigator_weapon(tables, labelled, \"12-gauge Shotgun (2B)\")[\"weapon_id\"] == SHOTGUN");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sheet_skill_value_matches_the_weapon_tables_spelling_and_falls_back_to_the_rulebook_base"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sheet_skill_value_matches_the_weapon_tables_spelling_and_falls_back_to_the_rulebook_base();});

export async function test_cash_builds_the_finance_block_from_the_era_table_and_moves_it(kernel:any){
let before:any,table:any,tier:any,start:any,result:any,after:any,receipt:any,event:any,both:any,broke:any,text:any,narrated:any,diff:any;
(await open_turn(kernel,"我收下定金。"));
before=(await sheet(kernel));
assert.ok(pyBool((await (async()=>{const __left=!pyContains(before,"finance");return pyBool(__left)?pyEqual(pyAt(before,"cash"),"15 dollars"):__left;})())),"tests/kernel/test_apply_item_cash.py:229 assert \"finance\" not in before and before[\"cash\"] == \"15 dollars\"");
table=(await read_json(pyDivide(RULES,"cash-assets.json")));
tier=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(table,"periods"),"1920s"))){if(pyBool((await (async()=>{const __term0=pyAt(row,"credit_rating_min");const __term1=pyAt(before,"credit_rating");const __term2=pyAt(row,"credit_rating_max");return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()))){__rows.push(row);}}return __rows;})())));
start=pyMultiply(pyAt(before,"credit_rating"),pyAt(tier,"cash_multiplier"));
result=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:20,["source"]:"found",["why"]:"诺特的定金"})]}));
assert.ok(pyBool(pyEqual(pyAt(result,"receipts"),["cash:t1-c1"])),"tests/kernel/test_apply_item_cash.py:235 assert result[\"receipts\"] == [\"cash:t1-c1\"]");
after=(await sheet(kernel));
assert.ok(pyBool(pyEqual(pyAt(pyAt(after,"finance"),"cash"),({["amount"]:pyAdd(start,20),["currency"]:pyAt(table,"currency"),["formula"]:`CR x ${pyAt(tier,"cash_multiplier")}`}))),"tests/kernel/test_apply_item_cash.py:237 assert after[\"finance\"][\"cash\"] == {\"amount\": start + 20, \"currency\": table[\"currency\"], \"formula\": f\"CR x {tier['cash_multiplier']}\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(after,"finance"),"living_standard"),pyAt(tier,"living_standard"));return pyBool(__left)?pyEqual(pyAt(pyAt(after,"finance"),"source"),"cash-assets.periods.1920s"):__left;})())),"tests/kernel/test_apply_item_cash.py:238 assert after[\"finance\"][\"living_standard\"] == tier[\"living_standard\"] and after[\"finance\"][\"source\"] == \"cash-assets.periods.1920s\"");
assert.ok(pyBool(pyEqual(pyAt(after,"cash"),`${pyAdd(start,20)} ${pyAt(table,"currency")}`)),"tests/kernel/test_apply_item_cash.py:239 assert after[\"cash\"] == f\"{start + 20} {table['currency']}\"");
receipt=pyAt((await receipts_of(kernel)),"cash:t1-c1");
assert.ok(pyBool(pyEqual(receipt,({...receipt,["kind"]:"cash",["resource"]:"cash",["subject"]:INVESTIGATOR,["subject_label"]:INV_NAME,["before"]:start,["after"]:pyAdd(start,20),["delta"]:20,["currency"]:pyAt(table,"currency"),["source"]:"found",["why"]:"诺特的定金"}))),"tests/kernel/test_apply_item_cash.py:241 assert receipt == {**receipt, \"kind\": \"cash\", \"resource\": \"cash\", \"subject\": INVESTIGATOR, \"subject_label\": INV_NAME,\n                       \"before\": start, \"after\": start + 20, \"delta\": 20, \"currency\": table[\"currency\"],\n                       \"source\": \"found\", \"why\": \"诺特的定金\"}");
assert.ok(pyBool(!pyContains(receipt,"label")),"tests/kernel/test_apply_item_cash.py:244 assert \"label\" not in receipt");
event=pyAt((await events_of(kernel,"resource-changed")),(-1));
assert.ok(pyBool(pyEqual(pyAt(event,"receipt"),"cash:t1-c1")),"tests/kernel/test_apply_item_cash.py:246 assert event[\"receipt\"] == \"cash:t1-c1\"");
assert.ok(pyBool(pyEqual(pyAt(event,"data"),({["resource"]:"cash",["subject"]:INVESTIGATOR,["before"]:start,["after"]:pyAdd(start,20),["delta"]:20,["why"]:"诺特的定金"}))),"tests/kernel/test_apply_item_cash.py:247 assert event[\"data\"] == {\"resource\": \"cash\", \"subject\": INVESTIGATOR, \"before\": start, \"after\": start + 20, \"delta\": 20,\n                             \"why\": \"诺特的定金\"}");
both=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"cash",["delta"]:(-5),["source"]:"found"}),({["kind"]:"cash",["delta"]:(-5),["source"]:"found"})]}));
assert.ok(pyBool(pyEqual(pyAt(both,"receipts"),["cash:t1-c2","cash:t1-c2-2"])),"tests/kernel/test_apply_item_cash.py:251 assert both[\"receipts\"] == [\"cash:t1-c2\", \"cash:t1-c2-2\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),pyAdd(start,10))),"tests/kernel/test_apply_item_cash.py:252 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start + 10");
broke=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"cash",["delta"]:(-(pyAdd(start,11))),["source"]:"found"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(broke,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(broke,"details"),"before"),pyAdd(start,10)):__left;})())),"tests/kernel/test_apply_item_cash.py:254 assert broke[\"code\"] == \"invalid_params\" and broke[\"details\"][\"before\"] == start + 10");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),pyAdd(start,10))),"tests/kernel/test_apply_item_cash.py:255 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start + 10");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"cash",["delta"]:0,["source"]:"found"})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:256 assert kernel.table_err(\"apply\", call_id=\"t1-c3\", effects=[{\"kind\": \"cash\", \"delta\": 0, \"source\": \"found\"}])[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"cash",["delta"]:"1.5",["source"]:"found"})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:257 assert kernel.table_err(\"apply\", call_id=\"t1-c3\", effects=[{\"kind\": \"cash\", \"delta\": \"1.5\", \"source\": \"found\"}])[\"code\"] == \"invalid_params\"");
text="他数了钱，又付了车费。";
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":text}));
assert.ok(pyBool(pyEqual(pyAt(narrated,"rendered_text"),text)),"tests/kernel/test_apply_item_cash.py:263 assert narrated[\"rendered_text\"] == text");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt(narrated,"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"cash"))){__rows.push(m);}}return __rows;})()),(await (async()=>{const __rows:any[]=[];for(const [marker,receipt_id,call_id,b,a] of pyIterable([["cash","cash:t1-c1","t1-c1",start,pyAdd(start,20)],["cash-2","cash:t1-c2","t1-c2",pyAdd(start,20),pyAdd(start,15)],["cash-3","cash:t1-c2-2","t1-c2",pyAdd(start,15),pyAdd(start,10)]])){__rows.push(({["kind"]:"cash",["marker"]:marker,["receipt"]:receipt_id,["subject"]:INVESTIGATOR,["subject_label"]:INV_NAME,["before"]:b,["after"]:a,["currency"]:pyAt(table,"currency"),["source"]:"found",["call"]:call_id,...((pyBool(pyEqual(call_id,"t1-c1"))?({["purpose"]:"诺特的定金"}):({})))}));}return __rows;})()))),"tests/kernel/test_apply_item_cash.py:264 assert [m for m in narrated[\"mechanics\"] if m[\"kind\"] == \"cash\"] == [\n        {\"kind\": \"cash\", \"marker\": marker, \"receipt\": receipt_id, \"subject\": INVESTIGATOR, \"subject_label\": INV_NAME, \"before\": b, \"after\": a,\n         \"currency\": table[\"currency\"], \"source\": \"found\", \"call\": call_id,\n         **({\"purpose\": \"诺特的定金\"} if call_id == \"t1-c1\" else {})}\n        for marker, receipt_id, call_id, b, a in ((\"cash\", \"cash:t1-c1\", \"t1-c1\", start, start + 20),\n                                                  (\"cash-2\", \"cash:t1-c2\", \"t1-c2\", start + 20, start + 15),\n                                                  (\"cash-3\", \"cash:t1-c2-2\", \"t1-c2\", start + 15, start + 10))]");
assert.ok(pyBool(pyContains(pyAt(pyAt(narrated,"facts"),"committed"),`cash: ${INV_NAME} ${start} -> ${pyAdd(start,20)}`)),"tests/kernel/test_apply_item_cash.py:271 assert f\"cash: {INV_NAME} {start} -> {start + 20}\" in narrated[\"facts\"][\"committed\"]");
(await pyMethod(kernel,"table",["player_input"],{"text":"继续。"}));
diff=(await pyMethod(kernel,"table",["recall"],{"what":"history","diff":[0,1]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(diff,"from"),0);return pyBool(__left)?pyEqual(pyAt(diff,"to"),1):__left;})())),"tests/kernel/test_apply_item_cash.py:275 assert diff[\"from\"] == 0 and diff[\"to\"] == 1");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(diff,"diff"))){if(pyBool(pyEqual(pyAt(r,"kind"),"resource"))){__rows.push(r);}}return __rows;})()),[({["kind"]:"resource",["subject"]:INVESTIGATOR,["resource"]:"cash",["from"]:start,["to"]:pyAdd(start,10)})])),"tests/kernel/test_apply_item_cash.py:276 assert [r for r in diff[\"diff\"] if r[\"kind\"] == \"resource\"] == [\n        {\"kind\": \"resource\", \"subject\": INVESTIGATOR, \"resource\": \"cash\", \"from\": start, \"to\": start + 10}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_cash_builds_the_finance_block_from_the_era_table_and_moves_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_cash_builds_the_finance_block_from_the_era_table_and_moves_it(await kernel(t,{}));});
export async function json_weapons(){
return pyAt((await read_json(pyDivide(RULES,"weapons.json"))),"weapons");
}
export async function json_skills(){
return pyAt((await read_json(pyDivide(RULES,"skills.json"))),"skills");
}
export async function weapon_options(client:any){

return (await options_of((await sheet(client))));
}
export async function test_improvised_object_keeps_name_and_uses_selected_profile(kernel:any){
let n:any,result:any;

(await open_turn(kernel));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"item",["name"]:"sledgehammer",["weapon"]:"club_large"})]}));
n=(await walk_to_confrontation(kernel,2));
result=(await resolve(kernel,`t1-c${n}`,({"intent":"combat","target":"Walter Corbitt","weapon":"sledgehammer","defense":"none","goal":"strike","method":"swing the hammer"})));
assert.ok(pyBool(pyAt(result,"receipts")),"tests/kernel/test_apply_item_cash.py:301 assert result[\"receipts\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_improvised_object_keeps_name_and_uses_selected_profile"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_improvised_object_keeps_name_and_uses_selected_profile(await kernel(t,{}));});

export let LUNCH:any="eq.1920s.meals.meals_out.lunch";
export async function test_a_cash_amount_needs_a_source_and_a_cited_price_is_resolved_from_the_printed_list(kernel:any){
let start:any,bare:any,invented:any,foreign:any,printed:any,ok:any,receipt:any;

(await open_turn(kernel,"我自己付这一顿。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c0","effects":[({["kind"]:"cash",["delta"]:20,["source"]:"found",["why"]:"诺特的定金"})]}));
start=pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount");
bare=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-6.3),["why"]:"一顿便饭"})]}));
assert.ok(pyBool(pyEqual(pyAt(bare,"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:323 assert bare[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(bare,"details"),"supported"),["price","quote","found"])),"tests/kernel/test_apply_item_cash.py:324 assert bare[\"details\"][\"supported\"] == [\"price\", \"quote\", \"found\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(bare,"fix"),"price_id");return pyBool(__left)?pyContains(pyAt(bare,"fix"),"balance, not a price"):__left;})())),"tests/kernel/test_apply_item_cash.py:325 assert \"price_id\" in bare[\"fix\"] and \"balance, not a price\" in bare[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),start)),"tests/kernel/test_apply_item_cash.py:326 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start");
invented=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-6.3),["source"]:"price",["price_id"]:"eq.1920s.meals.meals_out.plain_meal"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(invented,"code"),"invalid_params");return pyBool(__left)?pyEqual(pyAt(pyAt(invented,"details"),"price_id"),"eq.1920s.meals.meals_out.plain_meal"):__left;})())),"tests/kernel/test_apply_item_cash.py:331 assert invented[\"code\"] == \"invalid_params\" and invented[\"details\"][\"price_id\"] == \"eq.1920s.meals.meals_out.plain_meal\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-6.3),["source"]:"price"})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:332 assert kernel.table_err(\"apply\", call_id=\"t1-c1\", effects=[{\"kind\": \"cash\", \"delta\": -6.3, \"source\": \"price\"}])[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),start)),"tests/kernel/test_apply_item_cash.py:333 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-6.3),["source"]:"quote"})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:337 assert kernel.table_err(\"apply\", call_id=\"t1-c1\", effects=[{\"kind\": \"cash\", \"delta\": -6.3, \"source\": \"quote\"}])[\"code\"] == \"invalid_params\"");
foreign=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-0.5),["source"]:"quote",["with"]:"steven-knott",["currency"]:"sol",["why"]:"半个索尔"})]}));
assert.ok(pyBool(pyEqual(pyAt(foreign,"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:343 assert foreign[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt(foreign,"details"),({...pyAt(foreign,"details"),["declared"]:"sol",["held"]:"USD"}))),"tests/kernel/test_apply_item_cash.py:344 assert foreign[\"details\"] == {**foreign[\"details\"], \"declared\": \"sol\", \"held\": \"USD\"}");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(foreign,"message"),"does not convert");return pyBool(__left)?__left:pyContains((await pyStr(foreign)),"does not convert");})())),"tests/kernel/test_apply_item_cash.py:345 assert \"does not convert\" in foreign[\"message\"] or \"does not convert\" in str(foreign)");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),start)),"tests/kernel/test_apply_item_cash.py:346 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start");
printed=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await read_json(pyDivide(RULES,"equipment.json"))),"records"))){if(pyBool(pyEqual(pyAt(r,"price_id"),LUNCH))){__rows.push(r);}}return __rows;})())));
ok=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"cash",["delta"]:(-pyAt(pyAt(printed,"price"),"amount")),["source"]:"price",["price_id"]:LUNCH,["category"]:"living",["currency"]:"USD",["why"]:"科达诺酒吧一顿便饭"})]}));
assert.ok(pyBool(pyEqual(pyAt(ok,"receipts"),["cash:t1-c2"])),"tests/kernel/test_apply_item_cash.py:354 assert ok[\"receipts\"] == [\"cash:t1-c2\"]");
receipt=pyAt((await receipts_of(kernel)),"cash:t1-c2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"source"),"price");return pyBool(__left)?pyEqual(pyAt(receipt,"price_id"),LUNCH):__left;})())),"tests/kernel/test_apply_item_cash.py:356 assert receipt[\"source\"] == \"price\" and receipt[\"price_id\"] == LUNCH");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"price_name"),pyAt(printed,"name"));return pyBool(__left)?pyEqual(pyAt(receipt,"price_era"),pyAt(printed,"era")):__left;})())),"tests/kernel/test_apply_item_cash.py:357 assert receipt[\"price_name\"] == printed[\"name\"] and receipt[\"price_era\"] == printed[\"era\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"source_amount"),pyAt(pyAt(printed,"price"),"amount"));return pyBool(__left)?pyEqual(pyAt(receipt,"source_currency"),pyAt(pyAt(printed,"price"),"currency")):__left;})())),"tests/kernel/test_apply_item_cash.py:358 assert receipt[\"source_amount\"] == printed[\"price\"][\"amount\"] and receipt[\"source_currency\"] == printed[\"price\"][\"currency\"]");
assert.ok(pyBool(pyEqual(pyAt(receipt,"source_display"),pyAt(pyAt(printed,"price"),"source_display"))),"tests/kernel/test_apply_item_cash.py:359 assert receipt[\"source_display\"] == printed[\"price\"][\"source_display\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(receipt,"source_provenance"),"print_page"),pyAt(pyAt(printed,"provenance"),"print_page"))),"tests/kernel/test_apply_item_cash.py:360 assert receipt[\"source_provenance\"][\"print_page\"] == printed[\"provenance\"][\"print_page\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),start)),"tests/kernel/test_apply_item_cash.py:361 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == start");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_cash_amount_needs_a_source_and_a_cited_price_is_resolved_from_the_printed_list"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_cash_amount_needs_a_source_and_a_cited_price_is_resolved_from_the_printed_list(await kernel(t,{}));});
export async function test_spending_level_settles_an_occasional_purchase_without_debiting_cash(kernel:any){
let printed:any,price:any,result:any,receipt:any,settled:any,narrated:any,card:any,too_much:any;

(await open_turn(kernel,"我吃完午饭就继续调查。"));
printed=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await read_json(pyDivide(RULES,"equipment.json"))),"records"))){if(pyBool(pyEqual(pyAt(r,"price_id"),LUNCH))){__rows.push(r);}}return __rows;})())));
price=pyAt(pyAt(printed,"price"),"amount");
result=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:(-price),["source"]:"price",["price_id"]:LUNCH,["settlement"]:"spending_level",["currency"]:"USD",["why"]:"一顿普通午饭"})]}));
receipt=pyAt((await receipts_of(kernel)),pyAt(pyAt(result,"receipts"),0));
assert.ok(pyBool(pyEqual(pyAt(receipt,"settlement"),"spending_level")),"tests/kernel/test_apply_item_cash.py:378 assert receipt[\"settlement\"] == \"spending_level\"");
assert.ok(pyBool(pyEqual(pyAt(receipt,"purchase_amount"),price)),"tests/kernel/test_apply_item_cash.py:379 assert receipt[\"purchase_amount\"] == price");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(receipt,"delta"),0);return pyBool(__left)?pyEqual(pyAt(receipt,"before"),pyAt(receipt,"after")):__left;})())),"tests/kernel/test_apply_item_cash.py:380 assert receipt[\"delta\"] == 0 and receipt[\"before\"] == receipt[\"after\"]");
assert.ok(pyBool(pyEqual(pyAt(receipt,"spending_level"),pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"spending_level"),"amount"))),"tests/kernel/test_apply_item_cash.py:381 assert receipt[\"spending_level\"] == sheet(kernel)[\"finance\"][\"spending_level\"][\"amount\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount"),pyAt(receipt,"before"))),"tests/kernel/test_apply_item_cash.py:382 assert sheet(kernel)[\"finance\"][\"cash\"][\"amount\"] == receipt[\"before\"]");
settled=pyAt((await events_of(kernel,"purchase-settled")),(-1));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(settled,"receipt"),pyAt(receipt,"id"));return pyBool(__left)?pyEqual(pyAt(pyAt(settled,"data"),"amount"),price):__left;})())),"tests/kernel/test_apply_item_cash.py:384 assert settled[\"receipt\"] == receipt[\"id\"] and settled[\"data\"][\"amount\"] == price");
narrated=(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c2","text":"午饭很快吃完，你重新走上街。"}));
card=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(narrated,"mechanics"))){if(pyBool(pyEqual(pyAt(row,"kind"),"cash"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(card,"settlement"),"spending_level");return pyBool(__left)?pyEqual(pyAt(card,"purchase_amount"),price):__left;})())),"tests/kernel/test_apply_item_cash.py:388 assert card[\"settlement\"] == \"spending_level\" and card[\"purchase_amount\"] == price");
assert.ok(pyBool(pyEqual(pyAt(card,"before"),pyAt(card,"after"))),"tests/kernel/test_apply_item_cash.py:389 assert card[\"before\"] == card[\"after\"]");
(await pyMethod(kernel,"table",["player_input"],{"text":"继续。"}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"prices_paid"),(-1)),({["turn"]:1,["amount"]:price,["currency"]:"USD",["source"]:"price",["settlement"]:"spending_level",["price_id"]:LUNCH,["why"]:"一顿普通午饭"}))),"tests/kernel/test_apply_item_cash.py:391 assert kernel.table(\"capsule\")[\"known\"][\"prices_paid\"][-1] == {\n        \"turn\": 1, \"amount\": price, \"currency\": \"USD\", \"source\": \"price\",\n        \"settlement\": \"spending_level\", \"price_id\": LUNCH, \"why\": \"一顿普通午饭\",\n    }");
too_much=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"cash",["delta"]:(-(pyAdd(pyAt(receipt,"spending_level"),1))),["source"]:"quote",["with"]:"steven-knott",["settlement"]:"spending_level",["why"]:"超过消费等级的服务"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(too_much,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(too_much,"details"),"spending_level"),pyAt(receipt,"spending_level")):__left;})())),"tests/kernel/test_apply_item_cash.py:400 assert too_much[\"code\"] == \"needs\" and too_much[\"details\"][\"spending_level\"] == receipt[\"spending_level\"]");
assert.ok(pyBool(pyContains(pyAt(too_much,"fix"),"wait for the player")),"tests/kernel/test_apply_item_cash.py:401 assert \"wait for the player\" in too_much[\"fix\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table_err",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"cash",["delta"]:1,["source"]:"found",["settlement"]:"spending_level"})]})),"code"),"invalid_params")),"tests/kernel/test_apply_item_cash.py:402 assert kernel.table_err(\"apply\", call_id=\"t2-c1\", effects=[{\n        \"kind\": \"cash\", \"delta\": 1, \"source\": \"found\", \"settlement\": \"spending_level\",\n    }])[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_spending_level_settles_an_occasional_purchase_without_debiting_cash"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_spending_level_settles_an_occasional_purchase_without_debiting_cash(await kernel(t,{}));});
export async function test_the_capsule_tells_the_keeper_the_balance_and_what_this_table_has_already_charged(kernel:any){
let known:any,amount:any,paid:any;

(await open_turn(kernel,"我数了数兜里的钱。"));
assert.ok(pyBool(!pyContains(pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"investigator"),"cash")),"tests/kernel/test_apply_item_cash.py:415 assert \"cash\" not in kernel.table(\"capsule\")[\"known\"][\"investigator\"]");
assert.ok(pyBool(!pyContains(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"prices_paid")),"tests/kernel/test_apply_item_cash.py:416 assert \"prices_paid\" not in kernel.table(\"capsule\")[\"known\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"cash",["delta"]:20,["source"]:"found",["why"]:"诺特的定金"})]}));
known=pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known");
amount=pyAt(pyAt(pyAt((await sheet(kernel)),"finance"),"cash"),"amount");
assert.ok(pyBool(pyEqual(pyAt(pyAt(known,"investigator"),"cash"),({["amount"]:amount,["currency"]:"USD"}))),"tests/kernel/test_apply_item_cash.py:421 assert known[\"investigator\"][\"cash\"] == {\"amount\": amount, \"currency\": \"USD\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(known,"investigator"),"living"),"standard"),pyAt(pyAt((await sheet(kernel)),"finance"),"living_standard"))),"tests/kernel/test_apply_item_cash.py:422 assert known[\"investigator\"][\"living\"][\"standard\"] == sheet(kernel)[\"finance\"][\"living_standard\"]");
assert.ok(pyBool(!pyContains(known,"prices_paid")),"tests/kernel/test_apply_item_cash.py:423 assert \"prices_paid\" not in known");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"cash",["delta"]:(-1),["source"]:"quote",["category"]:"living",["with"]:"steven-knott",["why"]:"旅馆一晚"})]}));
(await pyMethod(kernel,"table",["narrate"],{"call_id":"t1-c3","text":"她把钱放在柜台上，掌柜点了点头。"}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我再看一眼账。"}));
paid=pyAt(pyAt((await pyMethod(kernel,"table",["capsule"],{})),"known"),"prices_paid");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(paid)){__rows.push(Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const [k,v] of pyIterable((await pyMethod(row,"items",[],{})))){if(pyBool(!pyEqual(k,"turn"))){__rows.push([k,v]);}}return __rows;})())));}return __rows;})()),[({["amount"]:1,["currency"]:"USD",["source"]:"quote",["settlement"]:"living_standard",["with"]:"Steven Knott",["why"]:"旅馆一晚"})])),"tests/kernel/test_apply_item_cash.py:430 assert [{k: v for k, v in row.items() if k != \"turn\"} for row in paid] == [\n        {\"amount\": 1, \"currency\": \"USD\", \"source\": \"quote\", \"settlement\": \"living_standard\", \"with\": \"Steven Knott\", \"why\": \"旅馆一晚\"}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_capsule_tells_the_keeper_the_balance_and_what_this_table_has_already_charged"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_capsule_tells_the_keeper_the_balance_and_what_this_table_has_already_charged(await kernel(t,{}));});
