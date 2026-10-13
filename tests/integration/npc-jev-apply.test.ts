// Migrated from tests/kernel/test_jev_apply.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,campaign_dir,git_log,narrate,open_turn,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";





export async function options(client:any){
return (await pyMethod(client,"ok",["table.apply.options",({["campaign"]:CAMPAIGN})],{}));
}
export async function fingerprint(client:any){
let root:any=(await campaign_dir(client.workspace));
return ({["files"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{}))))__rows.push([(await pyMethod((await pyMethod(path,"relative_to",[root],{})),"as_posix",[],{})),(await pyMethod((await pyMethod(hashlib,"sha256",[(await pyMethod(path,"read_bytes",[],{}))],{})),"hexdigest",[],{}))]);}return __rows;})())),["git"]:(await git_log(client.workspace))});
}
export async function test_apply_options_is_read_only_unique_and_derived_from_current_graph_state(kernel:any){
(await open_turn(kernel));
let before:any=(await fingerprint(kernel));
let snapshot:any=(await options(kernel));
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_apply.py:32 assert fingerprint(kernel) == before");
assert.ok(pyBool(pyEqual(pyAt(snapshot,"version"),1)),"tests/kernel/test_jev_apply.py:33 assert snapshot[\"version\"] == 1");
assert.ok(pyBool((await (async()=>{const __left=pyAt(snapshot,"revision");return pyBool(__left)?pyAt(snapshot,"world_revision"):__left})())),"tests/kernel/test_jev_apply.py:34 assert snapshot[\"revision\"] and snapshot[\"world_revision\"]");
let aliases:any=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"candidates"))){if(pyBool(true))__rows.push(pyAt(row,"alias"));}return __rows;})());
assert.ok(pyBool(pyEqual(aliases,(await (async()=>{const __rows:any[]=[];for(const index of pyIterable((await pyRange((await pyLen(aliases)))))){if(pyBool(true))__rows.push(`effect:${index}`);}return __rows;})()))),"tests/kernel/test_jev_apply.py:36 assert aliases == [f\"effect:{index}\" for index in range(len(aliases))]");
assert.ok(pyBool(pyEqual((await pyLen(aliases)),(await pyLen((await pySet(aliases)))))),"tests/kernel/test_jev_apply.py:37 assert len(aliases) == len(set(aliases))");
let effects:any=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"candidates"))){if(pyBool(true))__rows.push(pyAt(row,"effect"));}return __rows;})());
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const effect of pyIterable(effects)){if(pyBool(true))__rows.push(pyContains([new Set(["kind","clue"]),new Set(["kind","to"])],(await pySet(effect))));}return __rows;})())))),"tests/kernel/test_jev_apply.py:39 assert all(set(effect) in ({\"kind\", \"clue\"}, {\"kind\", \"to\"}) for effect in effects)");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const effect of pyIterable(effects)){if(pyBool(true))__rows.push(pyAt(effect,"kind"));}return __rows;})())),new Set(["clue","move"]))),"tests/kernel/test_jev_apply.py:40 assert {effect[\"kind\"] for effect in effects} == {\"clue\", \"move\"}");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const effect of pyIterable(effects)){if(pyBool(pyEqual(pyAt(effect,"kind"),"clue")))__rows.push(pyAt(effect,"clue"));}return __rows;})())),new Set(["knott-commission","knott-research-leads","knott-macario-summary","knott-keys"]))),"tests/kernel/test_jev_apply.py:41 assert {effect[\"clue\"] for effect in effects if effect[\"kind\"] == \"clue\"} == {\n        \"knott-commission\", \"knott-research-leads\", \"knott-macario-summary\", \"knott-keys\",\n    }");
assert.ok(pyBool(pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const effect of pyIterable(effects)){if(pyBool(pyEqual(pyAt(effect,"kind"),"move")))__rows.push(pyAt(effect,"to"));}return __rows;})())),"hall-of-records")),"tests/kernel/test_jev_apply.py:44 assert \"hall-of-records\" in {effect[\"to\"] for effect in effects if effect[\"kind\"] == \"move\"}");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"candidates"))){if(pyBool(true))__rows.push(pyContains(new Set(["authored_candidate_not_discovered","available_route_not_player_choice"]),pyAt(pyAt(row,"description"),"authority")));}return __rows;})())))),"tests/kernel/test_jev_apply.py:45 assert all(row[\"description\"][\"authority\"] in\n               {\"authored_candidate_not_discovered\", \"available_route_not_player_choice\"}\n               for row in snapshot[\"candidates\"])");
assert.ok(pyBool(pyEqual(pyAt(snapshot,"context"),({...pyAt(snapshot,"context"),["scene"]:"Knott's Office",["pending_choice"]:null,["session"]:null,["present"]:["Steven Knott"],["current_receipts"]:[]}))),"tests/kernel/test_jev_apply.py:48 assert snapshot[\"context\"] == {**snapshot[\"context\"], \"scene\": \"Knott's Office\",\n                                    \"pending_choice\": None, \"session\": None,\n                                    \"present\": [\"Steven Knott\"], \"current_receipts\": []}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(snapshot,"context"),"coverage"),"effect_families"),["clue","move","source_presence"])),"tests/kernel/test_jev_apply.py:51 assert snapshot[\"context\"][\"coverage\"][\"effect_families\"] == [\"clue\", \"move\", \"source_presence\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_options_is_read_only_unique_and_derived_from_current_graph_state"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_options_is_read_only_unique_and_derived_from_current_graph_state(await kernel(t,{}));});
export async function test_apply_options_removes_discovered_clue_and_reports_current_receipt_without_writing(kernel:any){
(await open_turn(kernel));
let applied:any=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission"})]}));
let before:any=(await fingerprint(kernel));
let snapshot:any=(await options(kernel));
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_apply.py:61 assert fingerprint(kernel) == before");
assert.ok(pyBool(!pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"candidates"))){if(pyBool(true))__rows.push((await pyMethod(pyAt(row,"effect"),"get",["clue"],{})));}return __rows;})())),"knott-commission")),"tests/kernel/test_jev_apply.py:62 assert \"knott-commission\" not in {row[\"effect\"].get(\"clue\") for row in snapshot[\"candidates\"]}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(snapshot,"context"),"current_receipts"),[({["kind"]:"clue",["clue"]:"knott-commission",["from"]:null})])),"tests/kernel/test_jev_apply.py:63 assert snapshot[\"context\"][\"current_receipts\"] == [{\"kind\": \"clue\", \"clue\": \"knott-commission\", \"from\": None}]");
assert.ok(pyBool(pyAt(snapshot,"world_revision")),"tests/kernel/test_jev_apply.py:64 assert snapshot[\"world_revision\"]");
assert.ok(pyBool(pyAt(applied,"receipts")),"tests/kernel/test_jev_apply.py:65 assert applied[\"receipts\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_options_removes_discovered_clue_and_reports_current_receipt_without_writing"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_options_removes_discovered_clue_and_reports_current_receipt_without_writing(await kernel(t,{}));});
export async function test_apply_options_rejects_foreign_closed_and_extra_requests(kernel:any){
(await open_turn(kernel));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.apply.options",({["campaign"]:"other"})],{})),"code"),"campaign_not_found")),"tests/kernel/test_jev_apply.py:70 assert kernel.err(\"table.apply.options\", {\"campaign\": \"other\"})[\"code\"] == \"campaign_not_found\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.apply.options",({})],{})),"code"),"invalid_params")),"tests/kernel/test_jev_apply.py:71 assert kernel.err(\"table.apply.options\", {})[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.apply.options",({["campaign"]:CAMPAIGN,["extra"]:true})],{})),"code"),"invalid_params")),"tests/kernel/test_jev_apply.py:72 assert kernel.err(\"table.apply.options\", {\"campaign\": CAMPAIGN, \"extra\": True})[\"code\"] == \"invalid_params\"");
(await narrate(kernel,"t1-c1","The turn closes without an effect."));
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"err",["table.apply.options",({["campaign"]:CAMPAIGN})],{})),"code"),"campaign_not_ready")),"tests/kernel/test_jev_apply.py:74 assert kernel.err(\"table.apply.options\", {\"campaign\": CAMPAIGN})[\"code\"] == \"campaign_not_ready\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_options_rejects_foreign_closed_and_extra_requests"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_options_rejects_foreign_closed_and_extra_requests(await kernel(t,{}));});
export async function test_existing_apply_batch_remains_atomic_and_exactly_replayable(kernel:any){
(await open_turn(kernel));
let before:any=(await fingerprint(kernel));
let refused:any=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5}),({["kind"]:"clue",["clue"]:"not-an-authored-clue"})]}));
assert.ok(pyBool(pyContains(new Set(["invalid_params","unknown_entity"]),pyAt(refused,"code"))),"tests/kernel/test_jev_apply.py:83 assert refused[\"code\"] in {\"invalid_params\", \"unknown_entity\"}");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_apply.py:84 assert fingerprint(kernel) == before");
let result:any=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5})]}));
let written:any=(await fingerprint(kernel));
let replay:any=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:5})]}));
assert.ok(pyBool(pyEqual(replay,({...result,["replayed"]:true}))),"tests/kernel/test_jev_apply.py:89 assert replay == {**result, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),written)),"tests/kernel/test_jev_apply.py:90 assert fingerprint(kernel) == written");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_existing_apply_batch_remains_atomic_and_exactly_replayable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_existing_apply_batch_remains_atomic_and_exactly_replayable(await kernel(t,{}));});
export async function test_fulfillment_metadata_is_never_silently_ignored_or_allowed_to_apply_effects(kernel:any){
(await open_turn(kernel));
let before:any=(await fingerprint(kernel));
for(const [ordinal,fulfillment] of pyIterable((await pyEnumerate([({["kind"]:"unknown-binding",["candidate"]:"effect:0"}),({["kind"]:"clue",["candidate"]:"effect:0",["claim"]:"not yet validated"})],({"start":1}))))){
let error:any=(await pyMethod(kernel,"err",["table.apply",({["campaign"]:CAMPAIGN,["call_id"]:`t1-c${ordinal}`,["effects"]:[({["kind"]:"clue",["clue"]:"knott-commission"})],["_fulfillments"]:[fulfillment]})],{}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"needs")),"tests/kernel/test_jev_apply.py:102 assert error[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(error,"details"),"reason"),"unsupported_terms")),"tests/kernel/test_jev_apply.py:103 assert error[\"details\"][\"reason\"] == \"unsupported_terms\"");
assert.ok(pyBool(pyEqual((await fingerprint(kernel)),before)),"tests/kernel/test_jev_apply.py:104 assert fingerprint(kernel) == before");
}
let accepted:any=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-commission"})]}));
assert.ok(pyBool(pyAt(accepted,"receipts")),"tests/kernel/test_jev_apply.py:108 assert accepted[\"receipts\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_fulfillment_metadata_is_never_silently_ignored_or_allowed_to_apply_effects"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_fulfillment_metadata_is_never_silently_ignored_or_allowed_to_apply_effects(await kernel(t,{}));});
export async function _haunting_scene(handle:any){
let graph:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"module-graph.json")),"read_text",["utf-8"],{}))],{}));
let nodes:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(true))__rows.push([pyAt(node,"node_id"),node]);}return __rows;})()));
return [nodes,pyAt(nodes,`scene-${handle}`),pyAt(pyAt(pyAt(pyAt(nodes,`scene-${handle}`),"properties"),"runtime_projection"),"record")];
}
export async function _move(snapshot:any,to:any){
const __unpack5461=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(snapshot,"candidates"))){if(pyBool(pyEqual(pyAt(row,"effect"),({["kind"]:"move",["to"]:to}))))__rows.push(row);}return __rows;})());let row:any=__unpack5461[0];
return pyAt(row,"description");
}
export async function test_move_row_says_what_the_place_is_from_the_graph_and_the_world(kernel:any){

(await open_turn(kernel));
const __unpack5986=(await _haunting_scene("previous-tenants"));let _:any=__unpack5986[0];let node:any=__unpack5986[1];let record:any=__unpack5986[2];
let identity:any=pyAt(record,"destination_identity");
let description:any=(await _move((await options(kernel)),"previous-tenants"));
assert.ok(pyBool((await (async()=>{const __term0=pyAt(description,"display_name");const __term1=pyAt(identity,"canonical_name");const __term2="Roxbury Sanitarium";return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_jev_apply.py:131 assert description[\"display_name\"] == identity[\"canonical_name\"] == \"Roxbury Sanitarium\"");
let destination:any=pyAt(description,"destination");
assert.ok(pyBool(pyEqual(pyAt(destination,"names"),(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(pyAt(identity,"aliases"))){if(pyBool(!pyEqual(name,pyAt(identity,"canonical_name"))))__rows.push(name);}return __rows;})()))),"tests/kernel/test_jev_apply.py:133 assert destination[\"names\"] == [name for name in identity[\"aliases\"] if name != identity[\"canonical_name\"]]");
assert.ok(pyBool(pyEqual(pyAt(destination,"where"),pyAt(record,"location_tags"))),"tests/kernel/test_jev_apply.py:134 assert destination[\"where\"] == record[\"location_tags\"]");
assert.ok(pyBool(pyEqual(pyAt(destination,"people"),["Gabriela Macario","Vittorio Macario"])),"tests/kernel/test_jev_apply.py:135 assert destination[\"people\"] == [\"Gabriela Macario\", \"Vittorio Macario\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyEqual(pyAt(node,"summary"),pyAt(node,"name"));return pyBool(__left)?pyEqual(pyAt(destination,"summary"),pyAt(node,"summary")):__left})())),"tests/kernel/test_jev_apply.py:136 assert node[\"summary\"] != node[\"name\"] and destination[\"summary\"] == node[\"summary\"]");
let morgue:any=pyAt((await _move((await options(kernel)),"newspaper-morgue")),"destination");
assert.ok(pyBool((await (async()=>{const __left=pyAt(morgue,"things");return pyBool(__left)?(await pyAll((await (async()=>{const __rows:any[]=[];for(const thing of pyIterable(pyAt(morgue,"things"))){if(pyBool(true))__rows.push((await pyIsInstance(thing,pyStr)));}return __rows;})()))):__left})())),"tests/kernel/test_jev_apply.py:139 assert morgue[\"things\"] and all(isinstance(thing, str) for thing in morgue[\"things\"])");
assert.ok(pyBool(!pyContains(pyAt((await _move((await options(kernel)),"central-library")),"destination"),"people")),"tests/kernel/test_jev_apply.py:140 assert \"people\" not in _move(options(kernel), \"central-library\")[\"destination\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_move_row_says_what_the_place_is_from_the_graph_and_the_world"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_move_row_says_what_the_place_is_from_the_graph_and_the_world(await kernel(t,{}));});
export async function test_unmet_unlock_names_the_clue_its_words_and_where_the_book_puts_it(kernel:any){

(await open_turn(kernel));
const __unpack7280=(await _haunting_scene("commission-briefing"));let nodes:any=__unpack7280[0];let _:any=__unpack7280[1];let briefing:any=__unpack7280[2];
let clue:any=pyAt(nodes,"clue-knott-research-leads");
let cues:any=(await (async()=>{const __rows:any[]=[];for(const aff of pyIterable(pyAt(briefing,"affordances"))){if(pyBool(pyEqual((await pyMethod(aff,"get",["clue_id"],{})),"clue-knott-research-leads")))__rows.push(pyAt(aff,"cue"));}return __rows;})());
let unlock:any=pyAt((await _move((await options(kernel)),"previous-tenants")),"unlock_when");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(unlock,"met")===false);return pyBool(__left)?pyEqual(pyAt(unlock,"condition"),"clue_discovered: knott-research-leads"):__left})())),"tests/kernel/test_jev_apply.py:152 assert unlock[\"met\"] is False and unlock[\"condition\"] == \"clue_discovered: knott-research-leads\"");
assert.ok(pyBool(pyEqual(pyAt(unlock,"clue"),({["clue"]:"knott-research-leads",["says"]:pyAt(clue,"summary"),["found_at"]:[({["scene"]:"commission-briefing",["display_name"]:"Knott's Office",["cues"]:cues})]}))),"tests/kernel/test_jev_apply.py:153 assert unlock[\"clue\"] == {\"clue\": \"knott-research-leads\", \"says\": clue[\"summary\"],\n                              \"found_at\": [{\"scene\": \"commission-briefing\", \"display_name\": \"Knott's Office\", \"cues\": cues}]}");
assert.ok(pyBool(cues),pyStr("the book grants the clue at the office"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"})]}));
assert.ok(pyBool(pyEqual(pyAt((await _move((await options(kernel)),"previous-tenants")),"unlock_when"),({["condition"]:"clue_discovered: knott-research-leads",["met"]:true}))),"tests/kernel/test_jev_apply.py:158 assert _move(options(kernel), \"previous-tenants\")[\"unlock_when\"] == {\"condition\": \"clue_discovered: knott-research-leads\", \"met\": True}");
let house:any=(await _move((await options(kernel)),"corbitt-house-ground"));
assert.ok(pyBool(pyEqual(pyAt(house,"display_name"),"The Corbitt House")),"tests/kernel/test_jev_apply.py:161 assert house[\"display_name\"] == \"The Corbitt House\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(house,"unlock_when"),"clue"),"clue"),"knott-keys")),"tests/kernel/test_jev_apply.py:162 assert house[\"unlock_when\"][\"clue\"][\"clue\"] == \"knott-keys\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(house,"unlock_when"),"clue"),"says"),pyAt(pyAt(nodes,"clue-knott-keys"),"summary"))),"tests/kernel/test_jev_apply.py:163 assert house[\"unlock_when\"][\"clue\"][\"says\"] == nodes[\"clue-knott-keys\"][\"summary\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unmet_unlock_names_the_clue_its_words_and_where_the_book_puts_it"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unmet_unlock_names_the_clue_its_words_and_where_the_book_puts_it(await kernel(t,{}));});
export async function test_clue_row_carries_the_books_cues_for_it_in_this_scene(kernel:any){

(await open_turn(kernel));
const __unpack8839=(await _haunting_scene("commission-briefing"));let _:any=__unpack8839[0];_=__unpack8839[1];let briefing:any=__unpack8839[2];
let rows:any=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await options(kernel)),"candidates"))){if(pyBool(pyEqual(pyAt(pyAt(row,"effect"),"kind"),"clue")))__rows.push([pyAt(pyAt(row,"effect"),"clue"),pyAt(row,"description")]);}return __rows;})()));
assert.ok(pyBool(rows),pyStr("the office issues its clues"));
for(const [handle,description] of pyIterable((await pyMethod(rows,"items",[],{})))){
let cues:any=(await (async()=>{const __rows:any[]=[];for(const aff of pyIterable(pyAt(briefing,"affordances"))){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(aff,"get",["clue_id"],{})),`clue-${handle}`);return pyBool(__left)?__left:pyContains(((await (async()=>{const __left=(await pyMethod(aff,"get",["grants_clue_ids"],{}));return pyBool(__left)?__left:[]})())),`clue-${handle}`)})())))__rows.push(pyAt(aff,"cue"));}return __rows;})());
assert.ok(pyBool(pyEqual((await pyMethod(description,"get",["cues",[]],{})),cues)),pyStr(handle));
}
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,"knott-keys"),"cues"),["Accept the commission explicitly and take the key, address, and cash advance."])),"tests/kernel/test_jev_apply.py:177 assert rows[\"knott-keys\"][\"cues\"] == [\"Accept the commission explicitly and take the key, address, and cash advance.\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_clue_row_carries_the_books_cues_for_it_in_this_scene"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_clue_row_carries_the_books_cues_for_it_in_this_scene(await kernel(t,{}));});
export async function test_unmet_unlock_says_the_place_and_its_entrance_exist_from_where_the_party_is(kernel:any){

(await open_turn(kernel));
let unlock:any=pyAt((await _move((await options(kernel)),"newspaper-morgue")),"unlock_when");
assert.ok(pyBool((pyAt(unlock,"met")===false)),"tests/kernel/test_jev_apply.py:185 assert unlock[\"met\"] is False");
assert.ok(pyBool(pyEqual(pyAt(unlock,"exists"),({["place"]:true,["entrance"]:true,["from"]:"commission-briefing",["from_place"]:"Knott's Office"}))),"tests/kernel/test_jev_apply.py:186 assert unlock[\"exists\"] == {\"place\": True, \"entrance\": True, \"from\": \"commission-briefing\", \"from_place\": \"Knott's Office\"}");
let house:any=pyAt((await _move((await options(kernel)),"corbitt-house-ground")),"display_name");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"clue",["clue"]:"knott-research-leads"}),({["kind"]:"clue",["clue"]:"knott-keys"})]}));
assert.ok(pyBool(!pyContains(pyAt((await _move((await options(kernel)),"newspaper-morgue")),"unlock_when"),"exists")),"tests/kernel/test_jev_apply.py:190 assert \"exists\" not in _move(options(kernel), \"newspaper-morgue\")[\"unlock_when\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground"})]}));
let basement:any=pyAt((await _move((await options(kernel)),"basement-rites")),"unlock_when");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(basement,"met")===false);return pyBool(__left)?pyEqual(pyAt(pyAt(basement,"clue"),"clue"),"corbitt-diaries"):__left})())),"tests/kernel/test_jev_apply.py:193 assert basement[\"met\"] is False and basement[\"clue\"][\"clue\"] == \"corbitt-diaries\"");
assert.ok(pyBool(pyEqual(pyAt(basement,"exists"),({["place"]:true,["entrance"]:true,["from"]:"corbitt-house-ground",["from_place"]:house}))),"tests/kernel/test_jev_apply.py:194 assert basement[\"exists\"] == {\"place\": True, \"entrance\": True, \"from\": \"corbitt-house-ground\", \"from_place\": house}");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_unmet_unlock_says_the_place_and_its_entrance_exist_from_where_the_party_is"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_unmet_unlock_says_the_place_and_its_entrance_exist_from_where_the_party_is(await kernel(t,{}));});
export async function test_destination_people_by_this_tables_name_and_things_without_the_places_media(kernel:any){

(await open_turn(kernel,"I wait for the man to speak."));
let label:any="The man with the keys";
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"person",["who"]:"Steven Knott",["name"]:label}),({["kind"]:"clue",["clue"]:"knott-research-leads"})]}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"move",["to"]:"central-library"})]}));
let back:any=pyAt((await _move((await options(kernel)),"commission-briefing")),"destination");
assert.ok(pyBool(pyEqual(pyAt(back,"people"),[label])),"tests/kernel/test_jev_apply.py:206 assert back[\"people\"] == [label]");
const __unpack11558=(await _haunting_scene("corbitt-house-ground"));let nodes:any=__unpack11558[0];let _:any=__unpack11558[1];_=__unpack11558[2];
let graph:any=(await pyMethod(json,"loads",[(await pyMethod((pyDivide(pyDivide(pyDivide(CONTENT_DIR,"starters"),"the-haunting"),"module-graph.json")),"read_text",["utf-8"],{}))],{}));
let held:any=(await (async()=>{const __rows:any[]=[];for(const rel of pyIterable(pyAt(graph,"relations"))){if(pyBool((await (async()=>{const __left=(await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(rel,"to_node_id"),"scene-corbitt-house-ground");return pyBool(__left)?pyContains(["depicts","discoverable-at","located-in"],pyAt(rel,"relation_kind")):__left})());return pyBool(__left)?pyContains(nodes,pyAt(rel,"from_node_id")):__left})());return pyBool(__left)?!pyEqual(pyAt(pyAt(nodes,pyAt(rel,"from_node_id")),"node_kind"),"clue"):__left})())))__rows.push(pyAt(nodes,pyAt(rel,"from_node_id")));}return __rows;})());
let other:any=new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(held)){if(pyBool(!pyEqual(pyAt(node,"node_kind"),"asset")))__rows.push(pyAt(node,"name"));}return __rows;})()));
let media:any=pySubtract(new Set((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(held)){if(pyBool(pyEqual(pyAt(node,"node_kind"),"asset")))__rows.push(pyAt(node,"name"));}return __rows;})())),other);
assert.ok(pyBool(media),pyStr("the house has maps or pictures of its own, so the filter is under test"));
let things:any=pyAt(pyAt((await _move((await options(kernel)),"corbitt-house-ground")),"destination"),"things");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=things;return pyBool(__left)?pyLessEqual((await pySet(things)),other):__left})());return pyBool(__left)?!pyBool(pyIntersection(media,(await pySet(things)))):__left})())),"tests/kernel/test_jev_apply.py:217 assert things and set(things) <= other and not media & set(things)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_destination_people_by_this_tables_name_and_things_without_the_places_media"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_destination_people_by_this_tables_name_and_things_without_the_places_media(await kernel(t,{}));});
