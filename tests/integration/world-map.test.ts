// Migrated from tests/kernel/test_map.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exactlyOne} from './world-native-support.ts';
import {kernel} from './support.ts';
import {OPENING_SCENE,campaign_dir,create_campaign,narrate,open_turn,read_json,os,subprocess,stat,pyInvoke,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,copy,pyRound,Counter} from "./world-native-support.ts";
import {fork,switchValue} from "./world-worldline.test.ts";
const __file__=new URL('../../tests/kernel/test_map.py',import.meta.url).pathname;





export let MAP:any="player-corbitt-house-map";
export let KEEPER_BASEMENT:any="corbitt-house-keeper-map-basement";
export let PLAN_HANDOUT:any="the-haunting-corbitt-house-investigator-map";
export let TEXT_HANDOUT:any="globe-unpublished-1918";
export let INVESTIGATOR:any="thomas-hayes";
export let FIXTURE:any=pyDivide((await pyInvoke(Path,[__file__],{})).parent,"fixtures/bundle-tiny/assets/map-dock.png");
export async function world(kernel:any){
return (await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json")],{}));
}
Object.defineProperty(world,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function party(kernel:any){
return (await pyInvoke(read_json,[pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"party"),`${INVESTIGATOR}.json`)],{}));
}
Object.defineProperty(party,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function install_local_map_bytes(kernel:any,keeper_basement:any=false){
let bytes:any,target:any,basement:any;
(await pyMethod(kernel,"ok",["module.register",({["module_id"]:"the-haunting"})],{}));
bytes=(await pyMethod(FIXTURE,"read_bytes",[],{}));
target=pyDivide(kernel.workspace,".coc/modules/the-haunting/assets/player/corbitt-house-investigator-map.png");
(await pyMethod(target.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(target,"write_bytes",[bytes],{}));
if(pyBool(!pyBool(keeper_basement))){return target;}
basement=pyDivide(kernel.workspace,".coc/modules/the-haunting/assets/source/corbitt-house-keeper-map-basement.jpg");
(await pyMethod(basement.parent,"mkdir",[],{"parents":true,"exist_ok":true}));
(await pyMethod(basement,"write_bytes",[bytes],{}));
return [target,basement];
}
Object.defineProperty(install_local_map_bytes,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"keeper_basement","rest":false,"varargs":false}]});
export async function reveal(regions:any,label:any="科比特宅邸地图",why:any="Seen from where they stand.",labels:any={}){
let region_labels:any,level_labels:any,levels:any;
region_labels=(await (async()=>{const __left=(await pyMethod(labels,"pop",["region_labels",null],{}));return pyBool(__left)?__left:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(regions)){__rows.push([region,region]);}return __rows;})()))})());
level_labels=(await pyMethod(labels,"pop",["level_labels",null],{}));
if(pyBool((level_labels===null))){levels=({["ground-entry-hall"]:"Ground Floor",["ground-living-room"]:"Ground Floor",["ground-dining-room"]:"Ground Floor",["ground-kitchen"]:"Ground Floor",["basement-storage"]:"Basement",["hidden-cellar"]:"Basement",["upper-west-bedroom"]:"Upper Story",["upper-middle-bedroom"]:"Upper Story",["upper-east-bedroom"]:"Upper Story",["upper-landing"]:"Upper Story"});
level_labels=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(regions)){if(pyBool(pyContains(levels,region))){__rows.push([pyAt(levels,region),region]);}}return __rows;})()));
level_labels=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const level of pyIterable(level_labels)){__rows.push([level,level]);}return __rows;})()));}
return ({["kind"]:"map",["name"]:MAP,["regions"]:regions,["region_labels"]:region_labels,["level_labels"]:level_labels,["label"]:label,["why"]:why,...labels});
}
Object.defineProperty(reveal,"__pySignature",{value:[{"name":"regions","rest":false,"varargs":false},{"name":"label","rest":false,"varargs":false},{"name":"why","rest":false,"varargs":false},{"name":"labels","rest":true,"varargs":false}]});
export async function known_flags(kernel:any){
let row:any;
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map"})),"maps"))){if(pyBool(pyEqual(pyAt(item,"name"),MAP))){__rows.push(item);}}return __rows;})())));
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(row,"regions"))){__rows.push([pyAt(region,"name"),pyAt(region,"known")]);}return __rows;})()));
}
Object.defineProperty(known_flags,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
export async function test_map_reveal_records_only_named_regions_and_projects_a_host_view(kernel:any){
let target:any,catalog:any,row:any,applied:any,state:any,current:any,delivered:any,projected:any;
target=(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我从门口往里看，记下眼前能见的门厅。"],{}));
catalog=(await pyMethod(kernel,"table",["look"],{"focus":"map"}));
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(catalog,"maps"))){if(pyBool(pyEqual(pyAt(item,"name"),MAP))){__rows.push(item);}}return __rows;})())));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(row,"regions"))){__rows.push(pyAt(region,"name"));}return __rows;})()),["upper-west-bedroom","upper-middle-bedroom","upper-east-bedroom","upper-landing","ground-entry-hall","ground-living-room","ground-dining-room","ground-kitchen","basement-storage","hidden-cellar"])),"tests/kernel/test_map.py:70 assert [region[\"name\"] for region in row[\"regions\"]] == [\n        \"upper-west-bedroom\", \"upper-middle-bedroom\", \"upper-east-bedroom\", \"upper-landing\",\n        \"ground-entry-hall\", \"ground-living-room\", \"ground-dining-room\", \"ground-kitchen\",\n        \"basement-storage\", \"hidden-cellar\",\n    ]");
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(row,"regions"))){__rows.push(pyAt(region,"known"));}return __rows;})()))))),"tests/kernel/test_map.py:75 assert not any(region[\"known\"] for region in row[\"regions\"])");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"map",["name"]:MAP,["regions"]:["ground-entry-hall"],["region_labels"]:({["ground-entry-hall"]:"一层门厅"}),["level_labels"]:({["Ground Floor"]:"一层"}),["label"]:"科比特宅邸地图",["why"]:"The investigators can now see the ground floor layout."})]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t1"])),"tests/kernel/test_map.py:83 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t1\"]");
assert.ok(pyBool((pyAt(pyAt(pyAt(applied,"map_views"),0),"available")===true)),"tests/kernel/test_map.py:84 assert applied[\"map_views\"][0][\"available\"] is True");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(applied,"map_views"),0),"render"),"layers"),[({["region"]:"ground-entry-hall",["label"]:"一层门厅",["level"]:"一层",["source_asset"]:MAP,["placement"]:[0.12,0.49,0.93,0.59],["source_box"]:[0.12,0.49,0.93,0.59],["redactions"]:[],["path"]:(await pyInvoke(pyStr,[target],{})),["media_type"]:"image/png"})])),"tests/kernel/test_map.py:85 assert applied[\"map_views\"][0][\"render\"][\"layers\"] == [{\n        \"region\": \"ground-entry-hall\", \"label\": \"一层门厅\", \"level\": \"一层\",\n        \"source_asset\": MAP, \"placement\": [0.12, 0.49, 0.93, 0.59], \"source_box\": [0.12, 0.49, 0.93, 0.59],\n        \"redactions\": [], \"path\": str(target), \"media_type\": \"image/png\",\n    }]");
state=(await pyInvoke(world,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(state,"map_knowledge"),({[MAP]:["ground-entry-hall"]}))),"tests/kernel/test_map.py:91 assert state[\"map_knowledge\"] == {MAP: [\"ground-entry-hall\"]}");
assert.ok(pyBool(pyEqual(pyAt(state,"active_scene"),OPENING_SCENE)),"tests/kernel/test_map.py:92 assert state[\"active_scene\"] == OPENING_SCENE");
assert.ok(pyBool(pyEqual(pyAt(state,"discovered_clues"),[])),"tests/kernel/test_map.py:93 assert state[\"discovered_clues\"] == []");
assert.ok(pyBool(!pyContains(state,"handouts_shown")),"tests/kernel/test_map.py:94 assert \"handouts_shown\" not in state");
current=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool(pyEqual(pyAt(current,"label"),"科比特宅邸地图")),"tests/kernel/test_map.py:97 assert current[\"label\"] == \"科比特宅邸地图\"");
assert.ok(pyBool(pyEqual(pyAt(current,"regions"),[({["id"]:"ground-entry-hall",["label"]:"一层门厅",["level"]:"一层"})])),"tests/kernel/test_map.py:98 assert current[\"regions\"] == [{\"id\": \"ground-entry-hall\", \"label\": \"一层门厅\", \"level\": \"一层\"}]");
delivered=(await pyInvoke(narrate,[kernel,"t1-c2","你把眼前已经确认的格局记了下来。"],{}));
projected=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(item,"kind"),"map"))){__rows.push(item);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(projected,"map"),MAP)),"tests/kernel/test_map.py:101 assert projected[\"map\"] == MAP");
assert.ok(pyBool(pyEqual(pyAt(projected,"regions"),[({["id"]:"ground-entry-hall",["label"]:"一层门厅",["level"]:"一层"})])),"tests/kernel/test_map.py:102 assert projected[\"regions\"] == [{\"id\": \"ground-entry-hall\", \"label\": \"一层门厅\", \"level\": \"一层\"}]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(projected,"path");return pyBool(__left)?!pyContains(projected,"render"):__left})())),"tests/kernel/test_map.py:103 assert \"path\" not in projected and \"render\" not in projected");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(projected,"source_asset");return pyBool(__left)?!pyContains(projected,"redactions"):__left})())),"tests/kernel/test_map.py:104 assert \"source_asset\" not in projected and \"redactions\" not in projected");
}
Object.defineProperty(test_map_reveal_records_only_named_regions_and_projects_a_host_view,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_map_reveal_records_only_named_regions_and_projects_a_host_view"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_map_reveal_records_only_named_regions_and_projects_a_host_view(await kernel(t,{}));});
export async function test_observation_without_movement_reveals_only_the_seen_region(kernel:any){
let before:any,sheet:any,applied:any,state:any,flags:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我站在门外，从窗户看进客厅，并不进去。"],{}));
before=(await pyInvoke(world,[kernel],{}));
sheet=(await pyInvoke(party,[kernel],{}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-living-room"]],{"region_labels":({["ground-living-room"]:"客厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"They looked through the window without entering."}))]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t1"])),"tests/kernel/test_map.py:118 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t1\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(pyAt(pyAt(pyAt(pyAt(applied,"map_views"),0),"render"),"layers"))){__rows.push(pyAt(layer,"region"));}return __rows;})()),["ground-living-room"])),"tests/kernel/test_map.py:119 assert [layer[\"region\"] for layer in applied[\"map_views\"][0][\"render\"][\"layers\"]] == [\"ground-living-room\"]");
state=(await pyInvoke(world,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(state,"map_knowledge"),({[MAP]:["ground-living-room"]}))),"tests/kernel/test_map.py:121 assert state[\"map_knowledge\"] == {MAP: [\"ground-living-room\"]}");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(state,"active_scene");const __term1=pyAt(before,"active_scene");const __term2=OPENING_SCENE;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:122 assert state[\"active_scene\"] == before[\"active_scene\"] == OPENING_SCENE");
assert.ok(pyBool(pyEqual(pyAt(state,"visited_scenes"),pyAt(before,"visited_scenes"))),"tests/kernel/test_map.py:123 assert state[\"visited_scenes\"] == before[\"visited_scenes\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"clock"),pyAt(before,"clock"))),"tests/kernel/test_map.py:124 assert state[\"clock\"] == before[\"clock\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"discovered_clues"),pyAt(before,"discovered_clues"))),"tests/kernel/test_map.py:125 assert state[\"discovered_clues\"] == before[\"discovered_clues\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(party,[kernel],{})),sheet)),"tests/kernel/test_map.py:126 assert party(kernel) == sheet");
flags=(await pyInvoke(known_flags,[kernel],{}));
assert.ok(pyBool((pyAt(flags,"ground-living-room")===true)),"tests/kernel/test_map.py:128 assert flags[\"ground-living-room\"] is True");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(flags,"ground-entry-hall")===false);return pyBool(__left)?(pyAt(flags,"hidden-cellar")===false):__left})())),"tests/kernel/test_map.py:129 assert flags[\"ground-entry-hall\"] is False and flags[\"hidden-cellar\"] is False");
}
Object.defineProperty(test_observation_without_movement_reveals_only_the_seen_region,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_observation_without_movement_reveals_only_the_seen_region"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_observation_without_movement_reveals_only_the_seen_region(await kernel(t,{}));});
export async function test_a_limited_plan_does_not_disclose_omitted_or_secret_regions(kernel:any){
let applied:any,known:any,flags:any,view:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"诺特把一张只画了底层房间的平面图推过来。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"handout",["name"]:PLAN_HANDOUT,["label"]:"调查员平面图"})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({}))),"tests/kernel/test_map.py:136 assert world(kernel)[\"map_knowledge\"] == {}");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"handouts_shown"),[PLAN_HANDOUT])),"tests/kernel/test_map.py:137 assert world(kernel)[\"handouts_shown\"] == [PLAN_HANDOUT]");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(reveal,[["ground-entry-hall","ground-living-room","ground-dining-room","ground-kitchen"]],{"region_labels":({["ground-entry-hall"]:"门厅",["ground-living-room"]:"客厅",["ground-dining-room"]:"餐厅",["ground-kitchen"]:"厨房"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"The plan shows the ground-floor rooms and omits the hidden cellar."}))]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t1"])),"tests/kernel/test_map.py:148 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t1\"]");
known=pyAt(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),MAP);
assert.ok(pyBool(pyEqual(known,["ground-entry-hall","ground-living-room","ground-dining-room","ground-kitchen"])),"tests/kernel/test_map.py:150 assert known == [\"ground-entry-hall\", \"ground-living-room\", \"ground-dining-room\", \"ground-kitchen\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(known,"hidden-cellar");return pyBool(__left)?!pyContains(known,"basement-storage"):__left})())),"tests/kernel/test_map.py:151 assert \"hidden-cellar\" not in known and \"basement-storage\" not in known");
flags=(await pyInvoke(known_flags,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(flags,"hidden-cellar")===false);return pyBool(__left)?(pyAt(flags,"upper-landing")===false):__left})())),"tests/kernel/test_map.py:153 assert flags[\"hidden-cellar\"] is False and flags[\"upper-landing\"] is False");
view=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})())),(await pyInvoke(pySet,[known],{})))),"tests/kernel/test_map.py:155 assert {region[\"id\"] for region in view[\"regions\"]} == set(known)");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(pyAt(pyAt(view,"render"),"layers"))){__rows.push(pyEqual(pyAt(layer,"source_asset"),MAP));}return __rows;})())))),"tests/kernel/test_map.py:156 assert all(layer[\"source_asset\"] == MAP for layer in view[\"render\"][\"layers\"])");
}
Object.defineProperty(test_a_limited_plan_does_not_disclose_omitted_or_secret_regions,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_limited_plan_does_not_disclose_omitted_or_secret_regions"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_limited_plan_does_not_disclose_omitted_or_secret_regions(await kernel(t,{}));});
export async function test_hearing_a_place_name_does_not_write_map_knowledge(kernel:any){
let view:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"诺特说宅子里有个隐秘地窖，但没有画出它。"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({}))),"tests/kernel/test_map.py:162 assert world(kernel)[\"map_knowledge\"] == {}");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const known of pyIterable((await pyMethod((await pyInvoke(known_flags,[kernel],{})),"values",[],{})))){__rows.push((known===false));}return __rows;})())))),"tests/kernel/test_map.py:163 assert all(known is False for known in known_flags(kernel).values())");
view=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(view,"regions"),[]);return pyBool(__left)?(pyAt(view,"available")===false):__left})());return pyBool(__left)?pyEqual(pyAt(pyAt(view,"render"),"layers"),[]):__left})())),"tests/kernel/test_map.py:165 assert view[\"regions\"] == [] and view[\"available\"] is False and view[\"render\"][\"layers\"] == []");
}
Object.defineProperty(test_hearing_a_place_name_does_not_write_map_knowledge,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_hearing_a_place_name_does_not_write_map_knowledge"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_hearing_a_place_name_does_not_write_map_knowledge(await kernel(t,{}));});
export async function test_secret_region_uses_reviewed_alternate_source_correspondence(kernel:any){
let player:any,basement:any,storage:any,applied:any,living:any,layer:any,delivered:any,projected:any;
const __unpack8114=(await pyInvoke(install_local_map_bytes,[kernel],{"keeper_basement":true}));player=__unpack8114[0];basement=__unpack8114[1];
(await pyInvoke(open_turn,[kernel,"我们在地下室储藏间找到暗门，这才看见隐秘地窖。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["basement-storage"]],{"region_labels":({["basement-storage"]:"地下室储藏"}),"level_labels":({["Basement"]:"地下室"}),"why":"They entered the visible basement storage."}))]}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({[MAP]:["basement-storage"]}))),"tests/kernel/test_map.py:177 assert world(kernel)[\"map_knowledge\"] == {MAP: [\"basement-storage\"]}");
storage=pyAt(pyAt(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0),"render"),"layers"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(storage,"region"),"basement-storage");return pyBool(__left)?pyEqual(pyAt(storage,"source_asset"),MAP):__left})())),"tests/kernel/test_map.py:179 assert storage[\"region\"] == \"basement-storage\" and storage[\"source_asset\"] == MAP");
assert.ok(pyBool(pyEqual(pyAt(storage,"path"),(await pyInvoke(pyStr,[player],{})))),"tests/kernel/test_map.py:180 assert storage[\"path\"] == str(player)");
assert.ok(pyBool(!pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0),"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})())),"hidden-cellar")),"tests/kernel/test_map.py:181 assert \"hidden-cellar\" not in {region[\"id\"] for region in kernel.table(\"look\", focus=\"map\", name=MAP)[\"map_views\"][0][\"regions\"]}");
(await pyInvoke(narrate,[kernel,"t1-c2","储藏间的格局已经记下，暗门还只是一条缝。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我们打开暗门，走进调查员地图上没有的那间。"}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[(await pyInvoke(reveal,[["hidden-cellar"]],{"region_labels":({["hidden-cellar"]:"隐秘地窖"}),"level_labels":({["Basement"]:"地下室"}),"why":"They found the compartment omitted from the investigator map."}))]}));
assert.ok(pyBool(!pyContains(applied,"map_views")),"tests/kernel/test_map.py:193 assert \"map_views\" not in applied");
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t2"])),"tests/kernel/test_map.py:194 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t2\"]");
living=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool(pyEqual(pyAt(living,"presentation"),"update")),"tests/kernel/test_map.py:196 assert living[\"presentation\"] == \"update\"");
layer=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(pyAt(living,"render"),"layers"))){if(pyBool(pyEqual(pyAt(item,"region"),"hidden-cellar"))){__rows.push(item);}}return __rows;})())));
assert.ok(pyBool(pyEqual(pyAt(layer,"source_asset"),KEEPER_BASEMENT)),"tests/kernel/test_map.py:198 assert layer[\"source_asset\"] == KEEPER_BASEMENT");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(layer,"path");const __term1=(await pyInvoke(pyStr,[basement],{}));const __term2=(await pyInvoke(pyStr,[player],{}));return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"!=");})())),"tests/kernel/test_map.py:199 assert layer[\"path\"] == str(basement) != str(player)");
assert.ok(pyBool(pyEqual(pyAt(layer,"source_box"),[0.0,0.0,0.58,1.0])),"tests/kernel/test_map.py:200 assert layer[\"source_box\"] == [0.0, 0.0, 0.58, 1.0]");
assert.ok(pyBool(pyEqual(pyAt(layer,"placement"),[0.08,0.73,0.48,0.98])),"tests/kernel/test_map.py:201 assert layer[\"placement\"] == [0.08, 0.73, 0.48, 0.98]");
assert.ok(pyBool(!pyEqual(pyAt(layer,"source_box"),pyAt(layer,"placement"))),"tests/kernel/test_map.py:202 assert layer[\"source_box\"] != layer[\"placement\"]");
assert.ok(pyBool(pyEqual(pyAt(layer,"redactions"),[[0.4,0.27,0.68,0.5],[0.12,0.46,0.93,0.63]])),"tests/kernel/test_map.py:203 assert layer[\"redactions\"] == [[0.4, 0.27, 0.68, 0.5], [0.12, 0.46, 0.93, 0.63]]");
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),MAP),["basement-storage","hidden-cellar"])),"tests/kernel/test_map.py:204 assert world(kernel)[\"map_knowledge\"][MAP] == [\"basement-storage\", \"hidden-cellar\"]");
delivered=(await pyInvoke(narrate,[kernel,"t2-c2","隐秘的那一间这才出现在已经记下的格局里。"],{}));
projected=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(item,"kind"),"map"))){__rows.push(item);}}return __rows;})())));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(projected,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})())),new Set(["hidden-cellar"]))),"tests/kernel/test_map.py:207 assert {region[\"id\"] for region in projected[\"regions\"]} == {\"hidden-cellar\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(projected,"presentation"),"update");return pyBool(__left)?pyEqual(pyAt(projected,"document"),"none"):__left})())),"tests/kernel/test_map.py:208 assert projected[\"presentation\"] == \"update\" and projected[\"document\"] == \"none\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(projected,"revealed"))){__rows.push(pyAt(region,"id"));}return __rows;})()),["hidden-cellar"])),"tests/kernel/test_map.py:209 assert [region[\"id\"] for region in projected[\"revealed\"]] == [\"hidden-cellar\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(projected,"revealed"),0),"label"),"隐秘地窖")),"tests/kernel/test_map.py:210 assert projected[\"revealed\"][0][\"label\"] == \"隐秘地窖\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=!pyContains(projected,"path");return pyBool(__left)?!pyContains(projected,"render"):__left})());return pyBool(__left)?!pyContains(projected,"redactions"):__left})())),"tests/kernel/test_map.py:211 assert \"path\" not in projected and \"render\" not in projected and \"redactions\" not in projected");
}
Object.defineProperty(test_secret_region_uses_reviewed_alternate_source_correspondence,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_secret_region_uses_reviewed_alternate_source_correspondence"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_secret_region_uses_reviewed_alternate_source_correspondence(await kernel(t,{}));});
export async function test_knowledge_is_retained_after_leaving_and_replays_idempotently(kernel:any){
let first:any,replay:any,again:any,current:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我看清门厅后离开。"],{}));
first=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"一层门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"They saw the entry hall."}))]}));
replay=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"一层门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"They saw the entry hall."}))]}));
assert.ok(pyBool(pyEqual(replay,({...first,["replayed"]:true}))),"tests/kernel/test_map.py:229 assert replay == {**first, \"replayed\": True}");
again=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"一层门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"They confirm the same hall."}))]}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({[MAP]:["ground-entry-hall"]}))),"tests/kernel/test_map.py:236 assert world(kernel)[\"map_knowledge\"] == {MAP: [\"ground-entry-hall\"]}");
assert.ok(pyBool(pyEqual(pyAt(again,"receipts"),["map:player-corbitt-house-map-t1-2"])),"tests/kernel/test_map.py:237 assert again[\"receipts\"] == [\"map:player-corbitt-house-map-t1-2\"]");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"move",["to"]:"hall-of-records",["travel_minutes"]:30})]}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"active_scene"),"hall-of-records")),"tests/kernel/test_map.py:239 assert world(kernel)[\"active_scene\"] == \"hall-of-records\"");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({[MAP]:["ground-entry-hall"]}))),"tests/kernel/test_map.py:240 assert world(kernel)[\"map_knowledge\"] == {MAP: [\"ground-entry-hall\"]}");
current=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(current,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),["ground-entry-hall"])),"tests/kernel/test_map.py:242 assert [region[\"id\"] for region in current[\"regions\"]] == [\"ground-entry-hall\"]");
}
Object.defineProperty(test_knowledge_is_retained_after_leaving_and_replays_idempotently,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_knowledge_is_retained_after_leaving_and_replays_idempotently"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_knowledge_is_retained_after_leaving_and_replays_idempotently(await kernel(t,{}));});
export async function test_map_apply_grants_no_movement_clue_or_item(kernel:any){
let handed:any,authored:any,before:any,sheet:any,applied:any,state:any,path:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我把看到的门厅记在脑子里。"],{}));
handed=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"handout",["name"]:TEXT_HANDOUT,["label"]:"未刊稿"})]}));
authored=(await pyMethod((await pyInvoke(Path,[pyAt(pyAt(handed,"attachment"),"path")],{})),"read_text",[],{"encoding":"utf-8"}));
before=(await pyInvoke(world,[kernel],{}));
sheet=(await pyInvoke(party,[kernel],{}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"一层门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"They remember the hall they already saw."}))]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t1"])),"tests/kernel/test_map.py:258 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t1\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(pyAt(pyAt(applied,"receipts"),0),"move");return pyBool(__left)?!pyContains(pyAt(pyAt(applied,"receipts"),0),"clue"):__left})())),"tests/kernel/test_map.py:259 assert \"move\" not in applied[\"receipts\"][0] and \"clue\" not in applied[\"receipts\"][0]");
state=(await pyInvoke(world,[kernel],{}));
assert.ok(pyBool(pyEqual(pyAt(state,"active_scene"),pyAt(before,"active_scene"))),"tests/kernel/test_map.py:261 assert state[\"active_scene\"] == before[\"active_scene\"]");
assert.ok(pyBool(pyEqual(pyAt(state,"visited_scenes"),pyAt(before,"visited_scenes"))),"tests/kernel/test_map.py:262 assert state[\"visited_scenes\"] == before[\"visited_scenes\"]");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(state,"discovered_clues");const __term1=pyAt(before,"discovered_clues");const __term2:any[]=[];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:263 assert state[\"discovered_clues\"] == before[\"discovered_clues\"] == []");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(state,"handouts_shown");const __term1=pyAt(before,"handouts_shown");const __term2=[TEXT_HANDOUT];return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:264 assert state[\"handouts_shown\"] == before[\"handouts_shown\"] == [TEXT_HANDOUT]");
assert.ok(pyBool(pyEqual(pyAt(state,"clock"),pyAt(before,"clock"))),"tests/kernel/test_map.py:265 assert state[\"clock\"] == before[\"clock\"]");
assert.ok(pyBool(pyEqual((await pyInvoke(party,[kernel],{})),sheet)),"tests/kernel/test_map.py:266 assert party(kernel) == sheet");
path=pyDivide(pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"handouts"),`${TEXT_HANDOUT}.md`);
assert.ok(pyBool(pyEqual((await pyMethod(path,"read_text",[],{"encoding":"utf-8"})),authored)),"tests/kernel/test_map.py:268 assert path.read_text(encoding=\"utf-8\") == authored");
}
Object.defineProperty(test_map_apply_grants_no_movement_clue_or_item,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_map_apply_grants_no_movement_clue_or_item"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_map_apply_grants_no_movement_clue_or_item(await kernel(t,{}));});
export async function test_bad_map_region_rolls_back_the_entire_apply_batch(kernel:any){
let before:any,error:any,unlabeled:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel],{}));
before=(await pyInvoke(world,[kernel],{}));
error=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"time",["minutes"]:30}),({["kind"]:"map",["name"]:MAP,["regions"]:["secret-attic"],["label"]:"地图",["region_labels"]:({["secret-attic"]:"阁楼"}),["level_labels"]:({}),["why"]:"Guessed."}),({["kind"]:"clue",["clue"]:"knott-commission"})]}));
assert.ok(pyBool(pyEqual(pyAt(error,"code"),"unknown_entity")),"tests/kernel/test_map.py:280 assert error[\"code\"] == \"unknown_entity\"");
assert.ok(pyBool(pyEqual((await pyInvoke(world,[kernel],{})),before)),"tests/kernel/test_map.py:281 assert world(kernel) == before");
unlabeled=(await pyMethod(kernel,"table_err",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"map",["name"]:MAP,["regions"]:["ground-entry-hall"],["label"]:"地图",["region_labels"]:({}),["level_labels"]:({}),["why"]:"Seen."})]}));
assert.ok(pyBool(pyEqual(pyAt(unlabeled,"code"),"invalid_params")),"tests/kernel/test_map.py:287 assert unlabeled[\"code\"] == \"invalid_params\"");
assert.ok(pyBool(pyEqual((await pyInvoke(world,[kernel],{})),before)),"tests/kernel/test_map.py:288 assert world(kernel) == before");
}
Object.defineProperty(test_bad_map_region_rolls_back_the_entire_apply_batch,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_bad_map_region_rolls_back_the_entire_apply_batch"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_bad_map_region_rolls_back_the_entire_apply_batch(await kernel(t,{}));});
export async function test_map_knowledge_is_isolated_across_worldline_switches(kernel:any){


(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我记下门厅。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"Seen on main."}))]}));
(await pyInvoke(narrate,[kernel,"t1-c2","门厅的格局留在记忆里。"],{}));
(await pyInvoke(fork,[kernel,2,"side"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我在另一条路看见客厅。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[(await pyInvoke(reveal,[["ground-living-room"]],{"region_labels":({["ground-living-room"]:"客厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"Seen on side."}))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),MAP),["ground-entry-hall","ground-living-room"])),"tests/kernel/test_map.py:307 assert world(kernel)[\"map_knowledge\"][MAP] == [\"ground-entry-hall\", \"ground-living-room\"]");
(await pyInvoke(narrate,[kernel,"t3-c2","另一条路也留下一点记号。"],{}));
(await pyInvoke(switchValue,[kernel,4,"main"],{}));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),MAP),["ground-entry-hall"])),"tests/kernel/test_map.py:310 assert world(kernel)[\"map_knowledge\"][MAP] == [\"ground-entry-hall\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0),"regions"))){__rows.push(pyAt(r,"id"));}return __rows;})()),["ground-entry-hall"])),"tests/kernel/test_map.py:311 assert [r[\"id\"] for r in kernel.table(\"look\", focus=\"map\", name=MAP)[\"map_views\"][0][\"regions\"]] == [\"ground-entry-hall\"]");
}
Object.defineProperty(test_map_knowledge_is_isolated_across_worldline_switches,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_map_knowledge_is_isolated_across_worldline_switches"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_map_knowledge_is_isolated_across_worldline_switches(await kernel(t,{}));});
export async function test_legacy_save_without_map_fields_is_conservative_and_recoverable(kernel:any){
let state_path:any,state:any,view:any,applied:any;

(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我看向门厅。"],{}));
state_path=pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json");
state=(await pyInvoke(read_json,[state_path],{}));
(await pyMethod(state,"pop",["map_knowledge",null],{}));
(await pyMethod(state,"pop",["map_labels",null],{}));
(await pyMethod(state_path,"write_text",[(await pyMethod(json,"dumps",[state],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
view=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(view,"regions"),[]);return pyBool(__left)?(pyAt(view,"available")===false):__left})())),"tests/kernel/test_map.py:324 assert view[\"regions\"] == [] and view[\"available\"] is False");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"门厅"}),"level_labels":({["Ground Floor"]:"一层"}),"why":"Explicitly seen after loading an old save."}))]}));
assert.ok(pyBool(pyEqual(pyAt(applied,"receipts"),["map:player-corbitt-house-map-t1"])),"tests/kernel/test_map.py:328 assert applied[\"receipts\"] == [\"map:player-corbitt-house-map-t1\"]");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(world,[kernel],{})),"map_knowledge"),({[MAP]:["ground-entry-hall"]}))),"tests/kernel/test_map.py:329 assert world(kernel)[\"map_knowledge\"] == {MAP: [\"ground-entry-hall\"]}");
}
Object.defineProperty(test_legacy_save_without_map_fields_is_conservative_and_recoverable,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_legacy_save_without_map_fields_is_conservative_and_recoverable"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_legacy_save_without_map_fields_is_conservative_and_recoverable(await kernel(t,{}));});
export async function test_map_knowledge_is_campaign_scoped(kernel:any){
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"map",["name"]:MAP,["regions"]:["ground-entry-hall"],["label"]:"宅邸地图",["region_labels"]:({["ground-entry-hall"]:"一层门厅"}),["level_labels"]:({["Ground Floor"]:"一层"}),["why"]:"Seen from the entry."})]}));
(await pyInvoke(create_campaign,[kernel,"other-table"],{}));
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide((await pyInvoke(campaign_dir,[kernel.workspace,"other-table"],{})),"world.json")],{})),"map_knowledge"),({}))),"tests/kernel/test_map.py:340 assert read_json(campaign_dir(kernel.workspace, \"other-table\") / \"world.json\")[\"map_knowledge\"] == {}");
}
Object.defineProperty(test_map_knowledge_is_campaign_scoped,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_map_knowledge_is_campaign_scoped"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_map_knowledge_is_campaign_scoped(await kernel(t,{}));});
export async function test_first_arrival_presents_the_depicted_player_map(kernel:any){
let applied:any,view:any,delivered:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我们去科比特宅。"],{}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"科比特宅"})]}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(applied,"receipts"))){__rows.push((await pyMethod(item,"startswith",["map:player-corbitt-house-map"],{})));}return __rows;})())))),"tests/kernel/test_map.py:349 assert any(item.startswith(\"map:player-corbitt-house-map\") for item in applied[\"receipts\"])");
assert.ok(pyBool(pyContains(pyAt((await pyInvoke(world,[kernel],{})),"maps_presented"),MAP)),"tests/kernel/test_map.py:350 assert MAP in world(kernel)[\"maps_presented\"]");
assert.ok(pyBool(pyEqual((await pyMethod((await pyInvoke(world,[kernel],{})),"get",["map_knowledge",({})],{})),({}))),"tests/kernel/test_map.py:351 assert world(kernel).get(\"map_knowledge\", {}) == {}");
view=pyAt(pyAt(applied,"map_views"),0);
assert.ok(pyBool(pyEqual(pyAt(view,"map"),MAP)),"tests/kernel/test_map.py:353 assert view[\"map\"] == MAP");
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),"hidden-cellar")),"tests/kernel/test_map.py:354 assert \"hidden-cellar\" not in [region[\"id\"] for region in view[\"regions\"]]");
assert.ok(pyBool(pyContains((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),"ground-entry-hall")),"tests/kernel/test_map.py:355 assert \"ground-entry-hall\" in [region[\"id\"] for region in view[\"regions\"]]");
delivered=(await pyInvoke(narrate,[kernel,"t1-c2","宅子立在暮色里，门廊的木板在脚下轻轻一响。"],{}));
assert.ok(pyBool(pyContains(((await (async()=>{const __left=(await pyMethod(delivered,"get",["marked_text"],{}));return pyBool(__left)?__left:""})())),"{{map:player-corbitt-house-map")),"tests/kernel/test_map.py:357 assert \"{{map:player-corbitt-house-map\" in (delivered.get(\"marked_text\") or \"\")");
assert.ok(pyBool(!pyContains(pyAt(delivered,"rendered_text"),"{{")),"tests/kernel/test_map.py:358 assert \"{{\" not in delivered[\"rendered_text\"]");
}
Object.defineProperty(test_first_arrival_presents_the_depicted_player_map,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_first_arrival_presents_the_depicted_player_map"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_first_arrival_presents_the_depicted_player_map(await kernel(t,{}));});
export async function test_returning_does_not_present_the_map_again(kernel:any){
let again:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"我们去科比特宅。"],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"科比特宅"})]}));
(await pyInvoke(narrate,[kernel,"t1-c2","宅子立在暮色里。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我们先回镇上再过来。"}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t3-c1","effects":[({["kind"]:"move",["to"]:OPENING_SCENE,["travel_minutes"]:20,["label"]:"委托处"})]}));
(await pyInvoke(narrate,[kernel,"t3-c2","你们回到了镇上。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"再去那栋宅子。"}));
again=(await pyMethod(kernel,"table",["apply"],{"call_id":"t5-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"科比特宅"})]}));
assert.ok(pyBool(!pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(again,"receipts"))){__rows.push((await pyMethod(item,"startswith",["map:"],{})));}return __rows;})()))))),"tests/kernel/test_map.py:377 assert not any(item.startswith(\"map:\") for item in again[\"receipts\"])");
}
Object.defineProperty(test_returning_does_not_present_the_map_again,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_returning_does_not_present_the_map_again"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_returning_does_not_present_the_map_again(await kernel(t,{}));});
export async function test_an_arrival_on_a_map_already_granted_is_an_update_and_look_reads_the_living_map(kernel:any){
let first:any,arrived:any,delivered:any,row:any,added:any,flags:any,view:any;

(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"隔着篱笆，我先看清了门厅。"],{}));
first=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"region_labels":({["ground-entry-hall"]:"一层门厅"}),"level_labels":({["Ground Floor"]:"一层"})}))]}));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(first,"map_views"),0),"map"),MAP)),pyStr("the first picture of the map is a card"));
(await pyInvoke(narrate,[kernel,"t1-c2","门厅的轮廓记下了。"],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"我们坐车去科比特宅。"}));
arrived=(await pyMethod(kernel,"table",["apply"],{"call_id":"t2-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"科比特宅"})]}));
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(arrived,"receipts"))){__rows.push((await pyMethod(item,"startswith",["map:player-corbitt-house-map"],{})));}return __rows;})())))),"tests/kernel/test_map.py:392 assert any(item.startswith(\"map:player-corbitt-house-map\") for item in arrived[\"receipts\"])");
assert.ok(pyBool(!pyContains(arrived,"map_views")),pyStr("a map the table holds is not pictured again"));
delivered=(await pyInvoke(narrate,[kernel,"t2-c2","宅子立在暮色里。"],{}));
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(delivered,"mechanics"))){if(pyBool(pyEqual(pyAt(item,"kind"),"map"))){__rows.push(item);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"presentation"),"update");return pyBool(__left)?pyEqual(pyAt(row,"document"),"none"):__left})())),"tests/kernel/test_map.py:396 assert row[\"presentation\"] == \"update\" and row[\"document\"] == \"none\"");
added=(await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(row,"revealed"))){__rows.push(pyAt(region,"id"));}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=!pyContains(added,"ground-entry-hall");return pyBool(__left)?pyContains(added,"ground-kitchen"):__left})())),"tests/kernel/test_map.py:398 assert \"ground-entry-hall\" not in added and \"ground-kitchen\" in added");
assert.ok(pyBool(!pyContains(added,"hidden-cellar")),pyStr("the Keeper's secret is not revealed by arriving"));
flags=(await pyInvoke(known_flags,[kernel],{}));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyAt(flags,"ground-entry-hall");return pyBool(__left)?pyAt(flags,"ground-kitchen"):__left})());return pyBool(__left)?pyAt(flags,"basement-storage"):__left})())),"tests/kernel/test_map.py:401 assert flags[\"ground-entry-hall\"] and flags[\"ground-kitchen\"] and flags[\"basement-storage\"]");
assert.ok(pyBool((pyAt(flags,"hidden-cellar")===false)),"tests/kernel/test_map.py:402 assert flags[\"hidden-cellar\"] is False");
view=pyAt(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map","name":MAP})),"map_views"),0);
assert.ok(pyBool(pyEqual(pyAt(view,"presentation"),"update")),"tests/kernel/test_map.py:404 assert view[\"presentation\"] == \"update\"");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})())),new Set((await (async()=>{const __rows:any[]=[];for(const [name,known] of pyIterable((await pyMethod(flags,"items",[],{})))){if(pyBool(known)){__rows.push(name);}}return __rows;})())))),"tests/kernel/test_map.py:405 assert {region[\"id\"] for region in view[\"regions\"]} == {name for name, known in flags.items() if known}");
}
Object.defineProperty(test_an_arrival_on_a_map_already_granted_is_an_update_and_look_reads_the_living_map,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_arrival_on_a_map_already_granted_is_an_update_and_look_reads_the_living_map"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_arrival_on_a_map_already_granted_is_an_update_and_look_reads_the_living_map(await kernel(t,{}));});
export async function test_table_maps_is_empty_until_a_map_is_seen(kernel:any){
(await pyInvoke(install_local_map_bytes,[kernel],{"keeper_basement":true}));
(await pyInvoke(create_campaign,[kernel],{}));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["maps"],{})),({["maps"]:[]}))),"tests/kernel/test_map.py:411 assert kernel.table(\"maps\") == {\"maps\": []}");
}
Object.defineProperty(test_table_maps_is_empty_until_a_map_is_seen,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_maps_is_empty_until_a_map_is_seen"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_is_empty_until_a_map_is_seen(await kernel(t,{}));});
export async function test_table_maps_arrival_reads_only_the_presented_player_safe_regions(kernel:any){
let applied:any,arrival:any,maps:any,view:any,ids:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"We travel to the house."],{}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"The house"})]}));
arrival=pyAt(pyAt(applied,"map_views"),0);
maps=pyAt((await pyMethod(kernel,"table",["maps"],{})),"maps");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[maps],{})),1)),"tests/kernel/test_map.py:423 assert len(maps) == 1");
view=pyAt(maps,0);
assert.ok(pyBool(pyEqual((await pyInvoke(pySet,[view],{})),new Set(["map","name","label","words","regions","levels","source_revision","render"]))),"tests/kernel/test_map.py:425 assert set(view) == {\"map\", \"name\", \"label\", \"words\", \"regions\", \"levels\", \"source_revision\", \"render\"}");
assert.ok(pyBool(pyEqual(pyAt(view,"map"),MAP)),"tests/kernel/test_map.py:426 assert view[\"map\"] == MAP");
assert.ok(pyBool(pyEqual(pyAt(view,"words"),"source")),"tests/kernel/test_map.py:427 assert view[\"words\"] == \"source\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(view,"label");const __term1=pyAt(view,"name");const __term2=pyAt(arrival,"label");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:428 assert view[\"label\"] == view[\"name\"] == arrival[\"label\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"source_revision"),pyAt(arrival,"source_revision"))),"tests/kernel/test_map.py:429 assert view[\"source_revision\"] == arrival[\"source_revision\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"regions"),pyAt(arrival,"regions"))),"tests/kernel/test_map.py:430 assert view[\"regions\"] == arrival[\"regions\"]");
ids=(await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})());
assert.ok(pyBool(pyEqual(ids,["upper-west-bedroom","upper-middle-bedroom","upper-east-bedroom","upper-landing","ground-entry-hall","ground-living-room","ground-dining-room","ground-kitchen","basement-storage"])),"tests/kernel/test_map.py:432 assert ids == [\n        \"upper-west-bedroom\", \"upper-middle-bedroom\", \"upper-east-bedroom\", \"upper-landing\",\n        \"ground-entry-hall\", \"ground-living-room\", \"ground-dining-room\", \"ground-kitchen\",\n        \"basement-storage\",\n    ]");
assert.ok(pyBool(!pyContains(ids,"hidden-cellar")),"tests/kernel/test_map.py:437 assert \"hidden-cellar\" not in ids");
assert.ok(pyBool(pyEqual(pyAt(view,"levels"),["Upper Story","Ground Floor","Basement"])),"tests/kernel/test_map.py:438 assert view[\"levels\"] == [\"Upper Story\", \"Ground Floor\", \"Basement\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(view,"render"),"layers"),pyAt(pyAt(arrival,"render"),"layers"))),"tests/kernel/test_map.py:439 assert view[\"render\"][\"layers\"] == arrival[\"render\"][\"layers\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(pyAt(pyAt(view,"render"),"layers"))){__rows.push(pyAt(layer,"region"));}return __rows;})()),ids)),"tests/kernel/test_map.py:440 assert [layer[\"region\"] for layer in view[\"render\"][\"layers\"]] == ids");
}
Object.defineProperty(test_table_maps_arrival_reads_only_the_presented_player_safe_regions,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_maps_arrival_reads_only_the_presented_player_safe_regions"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_arrival_reads_only_the_presented_player_safe_regions(await kernel(t,{}));});
export async function test_table_maps_reveal_reads_only_granted_regions_in_authored_order(kernel:any){
let target:any,applied:any,maps:any,view:any,layers:any;
target=(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"I note the two rooms I have seen without approaching the house."],{}));
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall","upper-west-bedroom"]],{"label":"My house plan","region_labels":({["ground-entry-hall"]:"Front hall",["upper-west-bedroom"]:"West room"}),"level_labels":({["Ground Floor"]:"Entry level",["Upper Story"]:"Sleeping level"})}))]}));
assert.ok(pyBool(!pyContains((await pyMethod((await pyInvoke(world,[kernel],{})),"get",["maps_presented",[]],{})),MAP)),"tests/kernel/test_map.py:451 assert MAP not in world(kernel).get(\"maps_presented\", [])");
maps=pyAt((await pyMethod(kernel,"table",["maps"],{})),"maps");
assert.ok(pyBool(pyEqual((await pyInvoke(pyLen,[maps],{})),1)),"tests/kernel/test_map.py:453 assert len(maps) == 1");
view=pyAt(maps,0);
assert.ok(pyBool(pyEqual(pyAt(view,"map"),MAP)),"tests/kernel/test_map.py:455 assert view[\"map\"] == MAP");
assert.ok(pyBool(pyEqual(pyAt(view,"name"),pyAt(pyAt(pyAt(applied,"map_views"),0),"name"))),"tests/kernel/test_map.py:456 assert view[\"name\"] == applied[\"map_views\"][0][\"name\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"label"),"My house plan")),"tests/kernel/test_map.py:457 assert view[\"label\"] == \"My house plan\"");
assert.ok(pyBool(pyEqual(pyAt(view,"words"),"play_language")),"tests/kernel/test_map.py:458 assert view[\"words\"] == \"play_language\"");
assert.ok(pyBool(pyEqual(pyAt(view,"regions"),[({["id"]:"upper-west-bedroom",["label"]:"West room",["level"]:"Sleeping level"}),({["id"]:"ground-entry-hall",["label"]:"Front hall",["level"]:"Entry level"})])),"tests/kernel/test_map.py:459 assert view[\"regions\"] == [\n        {\"id\": \"upper-west-bedroom\", \"label\": \"West room\", \"level\": \"Sleeping level\"},\n        {\"id\": \"ground-entry-hall\", \"label\": \"Front hall\", \"level\": \"Entry level\"},\n    ]");
assert.ok(pyBool(pyEqual(pyAt(view,"levels"),["Sleeping level","Entry level"])),"tests/kernel/test_map.py:463 assert view[\"levels\"] == [\"Sleeping level\", \"Entry level\"]");
layers=pyAt(pyAt(view,"render"),"layers");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(layers)){__rows.push(({["id"]:pyAt(layer,"region"),["label"]:pyAt(layer,"label"),["level"]:pyAt(layer,"level")}));}return __rows;})()),pyAt(view,"regions"))),"tests/kernel/test_map.py:465 assert [{\"id\": layer[\"region\"], \"label\": layer[\"label\"], \"level\": layer[\"level\"]} for layer in layers] == view[\"regions\"]");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(layers)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(layer,"path"),(await pyInvoke(pyStr,[target],{})));return pyBool(__left)?pyEqual(pyAt(layer,"source_asset"),MAP):__left})()));}return __rows;})())))),"tests/kernel/test_map.py:466 assert all(layer[\"path\"] == str(target) and layer[\"source_asset\"] == MAP for layer in layers)");
assert.ok(pyBool(pyEqual(pyAt(view,"source_revision"),pyAt(pyAt(pyAt(applied,"map_views"),0),"source_revision"))),"tests/kernel/test_map.py:467 assert view[\"source_revision\"] == applied[\"map_views\"][0][\"source_revision\"]");
}
Object.defineProperty(test_table_maps_reveal_reads_only_granted_regions_in_authored_order,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_maps_reveal_reads_only_granted_regions_in_authored_order"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_reveal_reads_only_granted_regions_in_authored_order(await kernel(t,{}));});
export async function test_table_maps_does_not_list_unseen_maps_or_keeper_source_assets(kernel:any){
let _:any,basement:any,applied:any,maps:any,layer:any;
const __unpack24096=(await pyInvoke(install_local_map_bytes,[kernel],{"keeper_basement":true}));_=__unpack24096[0];basement=__unpack24096[1];
(await pyInvoke(open_turn,[kernel,"I read the handout, then discover the hidden room."],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"handout",["name"]:PLAN_HANDOUT,["label"]:"The plan"})]}));
assert.ok(pyBool(pyEqual((await pyMethod(kernel,"table",["maps"],{})),({["maps"]:[]}))),"tests/kernel/test_map.py:476 assert kernel.table(\"maps\") == {\"maps\": []}");
applied=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(reveal,[["hidden-cellar"]],{"label":"My house plan","region_labels":({["hidden-cellar"]:"Secret room"}),"level_labels":({["Basement"]:"Below ground"})}))]}));
maps=pyAt((await pyMethod(kernel,"table",["maps"],{})),"maps");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const view of pyIterable(maps)){__rows.push(pyAt(view,"map"));}return __rows;})()),[MAP])),"tests/kernel/test_map.py:482 assert [view[\"map\"] for view in maps] == [MAP]");
assert.ok(pyBool(!pyContains((await (async()=>{const __rows:any[]=[];for(const view of pyIterable(maps)){__rows.push(pyAt(view,"map"));}return __rows;})()),KEEPER_BASEMENT)),"tests/kernel/test_map.py:483 assert KEEPER_BASEMENT not in [view[\"map\"] for view in maps]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(pyAt(maps,0),"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),["hidden-cellar"])),"tests/kernel/test_map.py:484 assert [region[\"id\"] for region in maps[0][\"regions\"]] == [\"hidden-cellar\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(maps,0),"render"),pyAt(pyAt(pyAt(applied,"map_views"),0),"render"))),"tests/kernel/test_map.py:485 assert maps[0][\"render\"] == applied[\"map_views\"][0][\"render\"]");
layer=pyAt(pyAt(pyAt(pyAt(maps,0),"render"),"layers"),0);
assert.ok(pyBool(pyEqual(pyAt(layer,"source_asset"),KEEPER_BASEMENT)),"tests/kernel/test_map.py:487 assert layer[\"source_asset\"] == KEEPER_BASEMENT");
assert.ok(pyBool(pyEqual(pyAt(layer,"path"),(await pyInvoke(pyStr,[basement],{})))),"tests/kernel/test_map.py:488 assert layer[\"path\"] == str(basement)");
assert.ok(pyBool(pyEqual(pyAt(layer,"redactions"),[[0.4,0.27,0.68,0.5],[0.12,0.46,0.93,0.63]])),"tests/kernel/test_map.py:489 assert layer[\"redactions\"] == [[0.4, 0.27, 0.68, 0.5], [0.12, 0.46, 0.93, 0.63]]");
}
Object.defineProperty(test_table_maps_does_not_list_unseen_maps_or_keeper_source_assets,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_maps_does_not_list_unseen_maps_or_keeper_source_assets"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_does_not_list_unseen_maps_or_keeper_source_assets(await kernel(t,{}));});
export async function test_table_maps_unions_arrival_and_grants_without_partial_words(kernel:any){
let arrival:any,authored:any,view:any;
(await pyInvoke(install_local_map_bytes,[kernel],{"keeper_basement":true}));
(await pyInvoke(open_turn,[kernel,"We arrive, then discover the hidden room."],{}));
arrival=pyAt(pyAt((await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground",["via"]:"hired car",["travel_minutes"]:20,["label"]:"The house"})]})),"map_views"),0);
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[(await pyInvoke(reveal,[["ground-entry-hall","hidden-cellar"]],{"label":"My house plan","region_labels":({["ground-entry-hall"]:"Front hall",["hidden-cellar"]:"Secret room"}),"level_labels":({["Ground Floor"]:"Entry level",["Basement"]:"Below ground"})}))]}));
authored=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map"})),"maps"))){if(pyBool(pyEqual(pyAt(item,"name"),MAP))){__rows.push(item);}}return __rows;})())));
[view]=exactlyOne(pyAt((await pyMethod(kernel,"table",["maps"],{})),"maps"));
assert.ok(pyBool(pyEqual(pyAt(view,"words"),"source")),"tests/kernel/test_map.py:506 assert view[\"words\"] == \"source\"");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(view,"label");const __term1=pyAt(authored,"display_name");const __term2=pyAt(arrival,"label");return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:507 assert view[\"label\"] == authored[\"display_name\"] == arrival[\"label\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"regions"),(await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(authored,"regions"))){__rows.push(({["id"]:pyAt(region,"name"),["label"]:pyAt(region,"label"),["level"]:pyAt(region,"level")}));}return __rows;})()))),"tests/kernel/test_map.py:508 assert view[\"regions\"] == [\n        {\"id\": region[\"name\"], \"label\": region[\"label\"], \"level\": region[\"level\"]}\n        for region in authored[\"regions\"]\n    ]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(view,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),pyAdd((await (async()=>{const __rows:any[]=[];for(const region of pyIterable(pyAt(arrival,"regions"))){__rows.push(pyAt(region,"id"));}return __rows;})()),["hidden-cellar"]))),"tests/kernel/test_map.py:512 assert [region[\"id\"] for region in view[\"regions\"]] == [region[\"id\"] for region in arrival[\"regions\"]] + [\"hidden-cellar\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"levels"),["Upper Story","Ground Floor","Basement"])),"tests/kernel/test_map.py:513 assert view[\"levels\"] == [\"Upper Story\", \"Ground Floor\", \"Basement\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const layer of pyIterable(pyAt(pyAt(view,"render"),"layers"))){__rows.push(({["id"]:pyAt(layer,"region"),["label"]:pyAt(layer,"label"),["level"]:pyAt(layer,"level")}));}return __rows;})()),pyAt(view,"regions"))),"tests/kernel/test_map.py:514 assert [{\"id\": layer[\"region\"], \"label\": layer[\"label\"], \"level\": layer[\"level\"]} for layer in view[\"render\"][\"layers\"]] == view[\"regions\"]");
}
Object.defineProperty(test_table_maps_unions_arrival_and_grants_without_partial_words,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_table_maps_unions_arrival_and_grants_without_partial_words"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_unions_arrival_and_grants_without_partial_words(await kernel(t,{}));});
export async function test_table_maps_incomplete_stored_words_fall_back_together(kernel:any,field:any,missing:any){
let authored:any,region:any,state:any,labels:any,view:any,layer:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"I note the hall."],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"label":"My house plan","region_labels":({["ground-entry-hall"]:"Front hall"}),"level_labels":({["Ground Floor"]:"Entry level"})}))]}));
authored=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt((await pyMethod(kernel,"table",["look"],{"focus":"map"})),"maps"))){if(pyBool(pyEqual(pyAt(item,"name"),MAP))){__rows.push(item);}}return __rows;})())));
region=(await pyNext((await (async()=>{const __rows:any[]=[];for(const item of pyIterable(pyAt(authored,"regions"))){if(pyBool(pyEqual(pyAt(item,"name"),"ground-entry-hall"))){__rows.push(item);}}return __rows;})())));
state=(await pyInvoke(world,[kernel],{}));
labels=pyAt(pyAt(state,"map_labels"),MAP);
if(pyBool(pyEqual(field,"title"))){labels["title"]=missing;}else if(pyBool(pyEqual(field,"region"))){pyAt(labels,"regions")["ground-entry-hall"]=missing;}else{pyAt(labels,"levels")["Ground Floor"]=missing;}
(await pyMethod((pyDivide((await pyInvoke(campaign_dir,[kernel.workspace],{})),"world.json")),"write_text",[(await pyMethod(json,"dumps",[state],{}))],{"encoding":"utf-8"}));
[view]=exactlyOne(pyAt((await pyMethod(kernel,"table",["maps"],{})),"maps"));
assert.ok(pyBool(pyEqual(pyAt(view,"words"),"source")),"tests/kernel/test_map.py:539 assert view[\"words\"] == \"source\"");
assert.ok(pyBool(pyEqual(pyAt(view,"label"),pyAt(authored,"display_name"))),"tests/kernel/test_map.py:540 assert view[\"label\"] == authored[\"display_name\"]");
assert.ok(pyBool(pyEqual(pyAt(view,"regions"),[({["id"]:pyAt(region,"name"),["label"]:pyAt(region,"label"),["level"]:pyAt(region,"level")})])),"tests/kernel/test_map.py:541 assert view[\"regions\"] == [{\"id\": region[\"name\"], \"label\": region[\"label\"], \"level\": region[\"level\"]}]");
assert.ok(pyBool(pyEqual(pyAt(view,"levels"),[pyAt(region,"level")])),"tests/kernel/test_map.py:542 assert view[\"levels\"] == [region[\"level\"]]");
[layer]=exactlyOne(pyAt(pyAt(view,"render"),"layers"));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(layer,"label"),pyAt(region,"label"));return pyBool(__left)?pyEqual(pyAt(layer,"level"),pyAt(region,"level")):__left})())),"tests/kernel/test_map.py:544 assert layer[\"label\"] == region[\"label\"] and layer[\"level\"] == region[\"level\"]");
}
Object.defineProperty(test_table_maps_incomplete_stored_words_fall_back_together,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"field","rest":false,"varargs":false},{"name":"missing","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian(pyCartesian([{}],pyParametrize("field",["title","region","level"])),pyParametrize("missing",[null,"","   "]))).entries())test("test_table_maps_incomplete_stored_words_fall_back_together"+((pyCartesian(pyCartesian([{}],pyParametrize("field",["title","region","level"])),pyParametrize("missing",[null,"","   "]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_incomplete_stored_words_fall_back_together(await kernel(t,{}),row["field"],row["missing"]);});
export async function test_table_maps_is_byte_for_byte_read_only_in_an_open_turn(kernel:any,legacy:any){
let root:any,state:any,before:any,first:any,between:any,second:any,after:any;
(await pyInvoke(install_local_map_bytes,[kernel],{}));
(await pyInvoke(open_turn,[kernel,"I note the hall."],{}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[(await pyInvoke(reveal,[["ground-entry-hall"]],{"label":"My house plan","region_labels":({["ground-entry-hall"]:"Front hall"}),"level_labels":({["Ground Floor"]:"Entry level"})}))]}));
(await pyInvoke(narrate,[kernel,"t1-c2","The hall is on your plan."],{}));
(await pyMethod(kernel,"table",["player_input"],{"text":"I check the plan."}));
root=(await pyInvoke(campaign_dir,[kernel.workspace],{}));
if(pyBool(legacy)){state=(await pyInvoke(world,[kernel],{}));
(await pyMethod(state,"pop",["scene_trail",null],{}));
(await pyMethod((pyDivide(root,"world.json")),"write_text",[(await pyMethod(json,"dumps",[state],{}))],{"encoding":"utf-8"}));}
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(root,"turn.json")],{})),"state"),"open")),"tests/kernel/test_map.py:562 assert read_json(root / \"turn.json\")[\"state\"] == \"open\"");
before=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(path,"relative_to",[root],{}))],{})),(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
first=(await pyMethod(kernel,"table",["maps"],{}));
between=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(path,"relative_to",[root],{}))],{})),(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
second=(await pyMethod(kernel,"table",["maps"],{}));
after=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const path of pyIterable((await pyMethod(root,"rglob",["*"],{})))){if(pyBool((await pyMethod(path,"is_file",[],{})))){__rows.push([(await pyInvoke(pyStr,[(await pyMethod(path,"relative_to",[root],{}))],{})),(await pyMethod(path,"read_bytes",[],{}))]);}}return __rows;})()));
assert.ok(pyBool(pyEqual(first,second)),"tests/kernel/test_map.py:568 assert first == second");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(first,"maps"),0),"map"),MAP)),"tests/kernel/test_map.py:569 assert first[\"maps\"][0][\"map\"] == MAP");
assert.ok(pyBool((await (async()=>{const __term0=before;const __term1=between;const __term2=after;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,"==");})())),"tests/kernel/test_map.py:570 assert before == between == after");
assert.ok(pyBool(pyEqual(pyAt((await pyInvoke(read_json,[pyDivide(root,"turn.json")],{})),"state"),"open")),"tests/kernel/test_map.py:571 assert read_json(root / \"turn.json\")[\"state\"] == \"open\"");
}
Object.defineProperty(test_table_maps_is_byte_for_byte_read_only_in_an_open_turn,"__pySignature",{value:[{"name":"kernel","rest":false,"varargs":false},{"name":"legacy","rest":false,"varargs":false}]});
if(process.argv[1]===import.meta.filename)for(const [index,row] of (pyCartesian([{}],pyParametrize("legacy",[false,true]))).entries())test("test_table_maps_is_byte_for_byte_read_only_in_an_open_turn"+((pyCartesian([{}],pyParametrize("legacy",[false,true]))).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_table_maps_is_byte_for_byte_read_only_in_an_open_turn(await kernel(t,{}),row["legacy"]);});
