// Migrated from tests/kernel/test_stated_operations.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,CONTENT_DIR,WORKTREE,RpcClient,campaign_dir,read_json,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";








const kpi=await import('../play/kpi.ts');


export let SOURCE:any=({["source_id"]:"pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting",["pdf_index"]:452});
export let SPAN:any="span-page-447-anchor-1";
export let START:any="scene-commission-briefing";
export let LIBRARY:any="scene-central-library";
export let PUSH_LINE:any="The ledge gives way under the second try.";
export let HOUND:any="cellar-hound";
export async function check(path:any,difficulty:any="regular",extra:any={}){
return ({["scope"]:"actor",["values"]:[({["path"]:path,["label"]:pyAt((await pyMethod(path,"split",["."],{})),1)})],["selection"]:"maximum",["difficulty"]:difficulty,...extra});
}
export let RULES:any=({["chapel-floor"]:({["hazard"]:({["trigger"]:({["kind"]:"keeper"}),["steps"]:[(await check("characteristics.Luck",undefined,({"results":({["failure"]:({["effects"]:[({["kind"]:"next_step",["step"]:1})]})})}))),(await check("skills.Jump",undefined,({"results":({["failure"]:({["effects"]:[({["kind"]:"damage",["dice"]:"1D6"})],["book"]:"They land hard below."})}),"push":({["allowed"]:true,["book"]:PUSH_LINE})})))]})}),["bed-flung"]:({["hazard"]:({["trigger"]:({["kind"]:"enter"}),["steps"]:[(await check("skills.Spot Hidden",undefined,({"results":({["failure"]:({["effects"]:[({["kind"]:"next_step",["step"]:1})]})})}))),(await check("skills.Dodge",undefined,({"results":({["failure"]:({["effects"]:[({["kind"]:"damage",["dice"]:"1D6+2"})]})})})))]}),["sanity_loss"]:({["success"]:"1",["failure"]:"1D4"})}),["knott-haggle"]:({["check"]:({["scope"]:"actor-target",["target"]:"npc-steven-knott",["values"]:[({["path"]:"skills.Persuade",["label"]:"Persuade"}),({["path"]:"skills.Credit Rating",["label"]:"Credit Rating",["minimum"]:90})],["selection"]:"approach",["difficulty"]:"hard",["results"]:Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const level of pyIterable(["critical","extreme","hard"])){__rows.push([level,({["effects"]:[({["kind"]:"flag",["flag_id"]:"knott-pays-more",["value"]:true})]})]);}return __rows;})()))})}),["hound-stare"]:({["check"]:({["scope"]:"opposed",["target"]:`creature-${HOUND}`,["values"]:[({["path"]:"characteristics.POW",["label"]:"POW"})],["selection"]:"maximum",["opposing"]:({["values"]:[({["path"]:"characteristics.POW",["label"]:"POW"})],["selection"]:"maximum"}),["difficulty"]:"regular",["results"]:({["failure"]:({["effects"]:[({["kind"]:"sanity_loss",["success"]:"0",["failure"]:"1D3"})]})})})}),["long-search"]:({["time_cost"]:({["amount"]:4,["unit"]:"hour"}),["reward"]:({["cash"]:30})}),["two-falls"]:({["damage"]:({["dice"]:"1D3"}),["hazard"]:({["trigger"]:({["kind"]:"keeper"}),["effects"]:[({["kind"]:"damage",["dice"]:"1D4"})]})}),["dark-fall"]:({["damage"]:({["dice_unstated"]:true})}),["plain-cost"]:({["resource_cost"]:({["resource"]:"mp",["amount"]:1,["per"]:"use"})})});
export let ELSEWHERE:any=({["library-dust"]:({["check"]:(await check("skills.Library Use"))})});
export async function stated(graph:any,kind:any,slug:any,mechanics:any,name:any=null){
(await pyMethod(pyAt(graph,"nodes"),"append",[({["node_id"]:`${kind}-${slug}`,["node_kind"]:kind,["name"]:(await (async()=>{const __left=name;return pyBool(__left)?__left:slug;})()),["visibility"]:"keeper-only",["aliases"]:[],["summary"]:`${slug}.`,["evidence_span_ids"]:[SPAN],["properties"]:({["mechanics"]:mechanics}),["source_refs"]:[SOURCE]})],{}));
}
export async function link(graph:any,kind:any,source:any,target:any){
(await pyMethod(pyAt(graph,"relations"),"append",[({["relation_id"]:`relation-rd03-${(await pyLen(pyAt(graph,"relations")))}`,["relation_kind"]:kind,["from_node_id"]:source,["to_node_id"]:target,["properties"]:({})})],{}));
}
export async function derived_content(root:any){
let path:any,graph:any,slug:any,mechanics:any,threat:any;

(await pyMethod(shutil,"copytree",[CONTENT_DIR,root],{}));
(await pyMethod(shutil,"copytree",[pyDivide(pyDivide(CONTENT_DIR.parent,"mods"),"pushed-roll"),pyDivide(pyDivide(root.parent,"mods"),"pushed-roll")],{}));
path=pyDivide(pyDivide(pyDivide(root,"starters"),"the-haunting"),"module-graph.json");
graph=(await pyMethod(json,"loads",[(await pyMethod(path,"read_text",[],{"encoding":"utf-8"}))],{}));
for([slug,mechanics] of pyIterable((await pyMethod(RULES,"items",[],{})))){
(await stated(graph,"rule",slug,mechanics));
(await link(graph,"uses-rule",START,`rule-${slug}`));
}
for([slug,mechanics] of pyIterable((await pyMethod(ELSEWHERE,"items",[],{})))){
(await stated(graph,"rule",slug,mechanics));
(await link(graph,"uses-rule",LIBRARY,`rule-${slug}`));
}
(await stated(graph,"creature",HOUND,({["profile"]:({["characteristics"]:({["STR"]:60,["CON"]:50,["SIZ"]:50,["DEX"]:70,["POW"]:40}),["derived"]:({["HP"]:10,["MOV"]:10}),["skills"]:({["Fighting (Brawl)"]:45,["Dodge"]:35})})}),"Cellar hound"));
(await link(graph,"present-in",`creature-${HOUND}`,START));
threat=(await pyNext((await (async()=>{const __rows:any[]=[];for(const node of pyIterable(pyAt(graph,"nodes"))){if(pyBool(pyEqual(pyAt(node,"node_id"),"threat-corbitt-haunting"))){__rows.push(node);}}return __rows;})())));
pyAt(pyAt(pyAt(pyAt(pyAt(threat,"properties"),"runtime_projection"),"record"),"clocks"),0)["advances_on"]=[({["kind"]:"enter",["scene"]:"scene-basement-rites"})];
threat["evidence_span_ids"]=(await (async()=>{const __left=(await pyMethod(threat,"get",["evidence_span_ids"],{}));return pyBool(__left)?__left:[SPAN];})());
threat["source_refs"]=(await (async()=>{const __left=(await pyMethod(threat,"get",["source_refs"],{}));return pyBool(__left)?__left:[SOURCE];})());
(await pyMethod(path,"write_text",[(await pyMethod(json,"dumps",[graph],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
return root;
}
async function makeTable(t:any,tmp_path:any){
 const content=await derived_content(pyDivide(tmp_path,'content')),clients:any[]=[];
 t.after(async()=>{for(const client of clients)await client.close();});
 return async(seed:any,text='I look around the office.')=>{
 const client:any=new RpcClient(pyDivide(tmp_path,'s'+seed+'-'+clients.length),{env:{COC_KERNEL_SEED:String(seed)},content});clients.push(client);
 await client.ok('campaign.create',{id:CAMPAIGN,module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
 await client.table('narrate',{call_id:'t0-c1',text:'The opening.'});client.opened=(await client.table('player_input',{text})).capsule;return client;
 };
}
export async function resolve(client:any,call_id:any,action:any={}){
let body:any;
body=({["intent"]:"move",["goal"]:"keep their footing",["method"]:"careful steps",...action});
return (await pyMethod(client,"call",["table.resolve",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["action"]:body})],{}));
}
export async function ok(response:any){
assert.ok(pyBool(pyAt(response,"ok")),pyStr((await pyMethod(response,"get",["error"],{}))));
return pyAt(response,"result");
}
export async function refusal(response:any){
assert.ok(pyBool(!pyBool(pyAt(response,"ok"))),pyStr((await pyMethod(response,"get",["result"],{}))));
return [pyAt(pyAt(response,"error"),"code"),pyAt(pyAt(pyAt(response,"error"),"details"),"reason")];
}
export async function apply(client:any,call_id:any,...effects:any[]){
return (await pyMethod(client,"call",["table.apply",({["campaign"]:CAMPAIGN,["call_id"]:call_id,["effects"]:(await pyList(effects))})],{}));
}
export async function receipts(client:any){
return pyAt((await read_json(pyDivide((await campaign_dir(client.workspace)),"turn.json"))),"receipts");
}
export async function sheet(client:any){
return (await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"party"),"thomas-hayes.json")));
}
export async function world(client:any){
return (await read_json(pyDivide((await campaign_dir(client.workspace)),"world.json")));
}

export let LUCK_FAILS_JUMP_FAILS:any=1;

export let JUMP_FAILS_PUSH:any=1;

export let HAGGLE_PASSES:any=15;

export let STARE_SEED:any=0;


export async function test_a_hazards_steps_are_rolled_when_named_and_nothing_is_applied(table:any){
let client:any,hp:any,luck:any,jump:any,rows:any,landed:any,minted:any,dice:any;
client=(await table(LUCK_FAILS_JUMP_FAILS));
hp=pyAt((await sheet(client)),"current_hp");
luck=(await ok((await resolve(client,"t1-c1",({"rule":"chapel-floor"})))));
assert.ok(pyBool(pyEqual(pyAt(luck,"decision"),"push-luck:luck-roll")),"tests/kernel/test_stated_operations.py:174 assert luck[\"decision\"] == \"push-luck:luck-roll\"");
assert.ok(pyBool(pyEqual(pyAt(luck,"stated"),({["rule"]:"chapel-floor",["step"]:0,["level"]:"failure",["effects"]:[],["next_step"]:1}))),"tests/kernel/test_stated_operations.py:175 assert luck[\"stated\"] == {\"rule\": \"chapel-floor\", \"step\": 0, \"level\": \"failure\", \"effects\": [], \"next_step\": 1}");
jump=(await ok((await resolve(client,"t1-c2",({"rule":"chapel-floor","step":1})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(jump,"decision"),"core-check:ordinary-check");return pyBool(__left)?pyEqual(pyAt(pyAt(jump,"outcome"),"skill"),"Jump"):__left;})())),"tests/kernel/test_stated_operations.py:177 assert jump[\"decision\"] == \"core-check:ordinary-check\" and jump[\"outcome\"][\"skill\"] == \"Jump\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(jump,"stated"),"level"),"failure");return pyBool(__left)?pyEqual(pyAt(pyAt(jump,"stated"),"step"),1):__left;})())),"tests/kernel/test_stated_operations.py:178 assert jump[\"stated\"][\"level\"] == \"failure\" and jump[\"stated\"][\"step\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(pyAt(jump,"stated"),"effects"),[({["kind"]:"damage",["dice"]:"1D6"})])),"tests/kernel/test_stated_operations.py:179 assert jump[\"stated\"][\"effects\"] == [{\"kind\": \"damage\", \"dice\": \"1D6\"}]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(jump,"stated"),"book"),"They land hard below.");return pyBool(__left)?pyEqual(pyAt(pyAt(jump,"stated"),"push"),({["allowed"]:true,["book"]:PUSH_LINE})):__left;})())),"tests/kernel/test_stated_operations.py:180 assert jump[\"stated\"][\"book\"] == \"They land hard below.\" and jump[\"stated\"][\"push\"] == {\"allowed\": True, \"book\": PUSH_LINE}");
assert.ok(pyBool(!pyContains(pyAt(jump,"stated"),"next_step")),"tests/kernel/test_stated_operations.py:181 assert \"next_step\" not in jump[\"stated\"]");
rows=(await receipts(client));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){__rows.push(pyAt(row,"kind"));}return __rows;})()),["roll","roll"])),"tests/kernel/test_stated_operations.py:184 assert [row[\"kind\"] for row in rows] == [\"roll\", \"roll\"]");
assert.ok(pyBool(pyEqual(pyAt((await sheet(client)),"current_hp"),hp)),"tests/kernel/test_stated_operations.py:185 assert sheet(client)[\"current_hp\"] == hp");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,0),"basis"),({["rule"]:"chapel-floor",["step"]:0,["level"]:"failure"}))),"tests/kernel/test_stated_operations.py:186 assert rows[0][\"basis\"] == {\"rule\": \"chapel-floor\", \"step\": 0, \"level\": \"failure\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rows,1),"basis"),({["rule"]:"chapel-floor",["step"]:1,["level"]:"failure"}))),"tests/kernel/test_stated_operations.py:187 assert rows[1][\"basis\"] == {\"rule\": \"chapel-floor\", \"step\": 1, \"level\": \"failure\"}");
landed=(await ok((await apply(client,"t1-c3",({["kind"]:"damage",["stated"]:"chapel-floor",["why"]:"the floor gives"})))));
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
minted=(await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(pyAt(landed,"receipts"))){__rows.push(pyAt(rows,receipt));}return __rows;})());
dice=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(minted)){if(pyBool(pyEqual(pyAt(row,"kind"),"roll"))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(dice,"expression"),"1D6");return pyBool(__left)?(await (async()=>{const __term0=1;const __term1=pyAt(dice,"total");const __term2=6;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})()):__left;})())),"tests/kernel/test_stated_operations.py:193 assert dice[\"expression\"] == \"1D6\" and 1 <= dice[\"total\"] <= 6");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(minted)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(row,"basis"),"stated");return pyBool(__left)?pyEqual(pyAt(row,"stated"),"chapel-floor"):__left;})()));}return __rows;})())))),"tests/kernel/test_stated_operations.py:194 assert all(row[\"basis\"] == \"stated\" and row[\"stated\"] == \"chapel-floor\" for row in minted)");
assert.ok(pyBool(pyEqual(pyAt((await sheet(client)),"current_hp"),pySubtract(hp,pyAt(dice,"total")))),"tests/kernel/test_stated_operations.py:195 assert sheet(client)[\"current_hp\"] == hp - dice[\"total\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_hazards_steps_are_rolled_when_named_and_nothing_is_applied"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_hazards_steps_are_rolled_when_named_and_nothing_is_applied(await makeTable(t,temporary));});
export async function test_stated_beside_an_amount_is_a_conflict_and_the_keepers_own_amount_lands_as_keeper(table:any){
let client:any,conflict:any,own:any,rows:any;
client=(await table(LUCK_FAILS_JUMP_FAILS));
(await ok((await resolve(client,"t1-c1",({"rule":"chapel-floor"})))));
(await ok((await resolve(client,"t1-c2",({"rule":"chapel-floor","step":1})))));
conflict=(await apply(client,"t1-c3",({["kind"]:"damage",["stated"]:"chapel-floor",["dice"]:"2D6"})));
assert.ok(pyBool(pyEqual((await refusal(conflict)),["invalid_params","stated_conflict"])),"tests/kernel/test_stated_operations.py:203 assert refusal(conflict) == (\"invalid_params\", \"stated_conflict\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(conflict,"error"),"details"),"fields"),["dice"])),"tests/kernel/test_stated_operations.py:204 assert conflict[\"error\"][\"details\"][\"fields\"] == [\"dice\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){__rows.push(pyAt(row,"kind"));}return __rows;})()),["roll","roll"])),"tests/kernel/test_stated_operations.py:205 assert [row[\"kind\"] for row in receipts(client)] == [\"roll\", \"roll\"]");
own=(await ok((await apply(client,"t1-c4",({["kind"]:"damage",["dice"]:"2D6"})))));
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(pyAt(own,"receipts"))){__rows.push(pyAt(pyAt(rows,receipt),"basis"));}return __rows;})()),pyMultiply(["keeper"],(await pyLen(pyAt(own,"receipts")))))),"tests/kernel/test_stated_operations.py:209 assert [rows[receipt][\"basis\"] for receipt in own[\"receipts\"]] == [\"keeper\"] * len(own[\"receipts\"])");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const receipt of pyIterable(pyAt(own,"receipts"))){__rows.push(!pyContains(pyAt(rows,receipt),"stated"));}return __rows;})())))),"tests/kernel/test_stated_operations.py:210 assert all(\"stated\" not in rows[receipt] for receipt in own[\"receipts\"])");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(own,"receipts"))){if(pyBool(pyEqual(pyAt(pyAt(rows,r),"kind"),"roll"))){__rows.push(pyAt(rows,r));}}return __rows;})()))),"expression"),"2D6")),"tests/kernel/test_stated_operations.py:211 assert next(rows[r] for r in own[\"receipts\"] if rows[r][\"kind\"] == \"roll\")[\"expression\"] == \"2D6\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_stated_beside_an_amount_is_a_conflict_and_the_keepers_own_amount_lands_as_keeper"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_stated_beside_an_amount_is_a_conflict_and_the_keepers_own_amount_lands_as_keeper(await makeTable(t,temporary));});
export async function test_a_push_continues_the_rule_it_pushes(table:any){
let client:any,first:any,pushed:any,other:any;
client=(await table(JUMP_FAILS_PUSH));
first=(await ok((await resolve(client,"t1-c1",({"rule":"chapel-floor","step":1})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(first,"stated"),"level"),"failure");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(first,"stated"),"push"),"book"),PUSH_LINE):__left;})())),"tests/kernel/test_stated_operations.py:217 assert first[\"stated\"][\"level\"] == \"failure\" and first[\"stated\"][\"push\"][\"book\"] == PUSH_LINE");
pushed=(await ok((await resolve(client,"t1-c2",({"push":true,"stakes":"they fall","method":"a running leap"})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pushed,"stated"),"rule"),"chapel-floor");return pyBool(__left)?pyEqual(pyAt(pyAt(pushed,"stated"),"step"),1):__left;})())),"tests/kernel/test_stated_operations.py:219 assert pushed[\"stated\"][\"rule\"] == \"chapel-floor\" and pushed[\"stated\"][\"step\"] == 1");
assert.ok(pyBool((pyAt(pyAt(pyAt((await receipts(client)),(-1)),"basis"),"pushed")===true)),"tests/kernel/test_stated_operations.py:220 assert receipts(client)[-1][\"basis\"][\"pushed\"] is True");
other=(await table(JUMP_FAILS_PUSH));
(await ok((await resolve(other,"t1-c1",({"rule":"chapel-floor","step":1})))));
assert.ok(pyBool(pyEqual((await refusal((await resolve(other,"t1-c2",({"push":true,"stakes":"x","method":"y","rule":"bed-flung"}))))),["invalid_params","rule_decision"])),"tests/kernel/test_stated_operations.py:224 assert refusal(resolve(other, \"t1-c2\", push=True, stakes=\"x\", method=\"y\", rule=\"bed-flung\")) == (\"invalid_params\", \"rule_decision\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_push_continues_the_rule_it_pushes"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_push_continues_the_rule_it_pushes(await makeTable(t,temporary));});
export async function test_the_check_binds_its_approach_difficulty_and_person(table:any){
let client:any,haggle:any,flagged:any,row:any;
client=(await table(HAGGLE_PASSES));
haggle=(await ok((await resolve(client,"t1-c1",({"rule":"knott-haggle","intent":"social","skill":"Persuade","goal":"a better rate","method":"haggle"})))));
assert.ok(pyBool(pyEqual(pyAt(haggle,"decision"),"core-check:ordinary-check")),"tests/kernel/test_stated_operations.py:231 assert haggle[\"decision\"] == \"core-check:ordinary-check\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(haggle,"outcome"),"skill"),"Persuade");return pyBool(__left)?pyEqual(pyAt(pyAt(haggle,"outcome"),"difficulty"),"hard"):__left;})())),"tests/kernel/test_stated_operations.py:232 assert haggle[\"outcome\"][\"skill\"] == \"Persuade\" and haggle[\"outcome\"][\"difficulty\"] == \"hard\"");
assert.ok(pyBool(pyContains(["critical","extreme","hard"],pyAt(pyAt(haggle,"stated"),"level"))),"tests/kernel/test_stated_operations.py:233 assert haggle[\"stated\"][\"level\"] in (\"critical\", \"extreme\", \"hard\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(haggle,"stated"),"effects"),[({["kind"]:"flag",["name"]:"knott-pays-more",["value"]:true})])),"tests/kernel/test_stated_operations.py:234 assert haggle[\"stated\"][\"effects\"] == [{\"kind\": \"flag\", \"name\": \"knott-pays-more\", \"value\": True}]");
assert.ok(pyBool(!pyContains((await pyMethod((await world(client)),"get",["flags",({})],{})),"knott-pays-more")),"tests/kernel/test_stated_operations.py:236 assert \"knott-pays-more\" not in world(client).get(\"flags\", {})");
flagged=(await ok((await apply(client,"t1-c2",({["kind"]:"flag",["stated"]:"knott-haggle",["why"]:"Knott agrees"})))));
assert.ok(pyBool((pyAt(pyAt((await world(client)),"flags"),"knott-pays-more")===true)),"tests/kernel/test_stated_operations.py:238 assert world(client)[\"flags\"][\"knott-pays-more\"] is True");
row=(await pyNext((await (async()=>{const __rows:any[]=[];for(const r of pyIterable((await receipts(client)))){if(pyBool(pyEqual(pyAt(r,"id"),pyAt(pyAt(flagged,"receipts"),0)))){__rows.push(r);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"basis"),"stated");return pyBool(__left)?pyEqual(pyAt(row,"stated"),"knott-haggle"):__left;})())),"tests/kernel/test_stated_operations.py:240 assert row[\"basis\"] == \"stated\" and row[\"stated\"] == \"knott-haggle\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_check_binds_its_approach_difficulty_and_person"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_check_binds_its_approach_difficulty_and_person(await makeTable(t,temporary));});
export async function test_an_opposed_check_rolls_against_the_opponents_stated_value(table:any){
let client:any,stare:any,outcome:any;
client=(await table(STARE_SEED));
stare=(await ok((await resolve(client,"t1-c1",({"rule":"hound-stare","intent":"investigate","goal":"outstare it","method":"hold its gaze"})))));
assert.ok(pyBool(pyEqual(pyAt(stare,"decision"),"core-check:opposed-check")),"tests/kernel/test_stated_operations.py:246 assert stare[\"decision\"] == \"core-check:opposed-check\"");
outcome=pyAt(stare,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"skill"),"POW");return pyBool(__left)?pyEqual(pyAt(pyAt(outcome,"opponent"),"target"),40):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"opponent_id"),HOUND):__left;})())),"tests/kernel/test_stated_operations.py:248 assert outcome[\"skill\"] == \"POW\" and outcome[\"opponent\"][\"target\"] == 40 and outcome[\"opponent_id\"] == HOUND");
assert.ok(pyBool(pyEqual([pyAt(pyAt(outcome,"investigator"),"level"),pyAt(outcome,"winner")],["regular","opponent"])),"tests/kernel/test_stated_operations.py:250 assert (outcome[\"investigator\"][\"level\"], outcome[\"winner\"]) == (\"regular\", \"opponent\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(stare,"stated"),"level"),"failure")),"tests/kernel/test_stated_operations.py:251 assert stare[\"stated\"][\"level\"] == \"failure\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(stare,"stated"),"effects"),[({["kind"]:"sanity_loss",["san_loss"]:"0/1D3"})])),"tests/kernel/test_stated_operations.py:252 assert stare[\"stated\"][\"effects\"] == [{\"kind\": \"sanity_loss\", \"san_loss\": \"0/1D3\"}]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_opposed_check_rolls_against_the_opponents_stated_value"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_opposed_check_rolls_against_the_opponents_stated_value(await makeTable(t,temporary));});
export async function test_a_luck_roll_named_by_its_decision_settles_on_the_actors_luck(table:any){
let client:any,luck:any;

client=(await table(LUCK_FAILS_JUMP_FAILS));
luck=(await ok((await resolve(client,"t1-c1",({"decision":"push-luck:luck-roll"})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(luck,"decision"),"push-luck:luck-roll");return pyBool(__left)?pyEqual(pyAt(pyAt(luck,"outcome"),"skill"),"LUCK"):__left;})())),"tests/kernel/test_stated_operations.py:259 assert luck[\"decision\"] == \"push-luck:luck-roll\" and luck[\"outcome\"][\"skill\"] == \"LUCK\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(luck,"outcome"),"target"),pyAt((await sheet(client)),"current_luck"))),"tests/kernel/test_stated_operations.py:260 assert luck[\"outcome\"][\"target\"] == sheet(client)[\"current_luck\"]");
assert.ok(pyBool((await (async()=>{const __left=!pyContains(luck,"stated");return pyBool(__left)?!pyContains(pyAt((await receipts(client)),(-1)),"basis"):__left;})())),"tests/kernel/test_stated_operations.py:261 assert \"stated\" not in luck and \"basis\" not in receipts(client)[-1]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_luck_roll_named_by_its_decision_settles_on_the_actors_luck"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_luck_roll_named_by_its_decision_settles_on_the_actors_luck(await makeTable(t,temporary));});

export async function test_every_refusal_by_its_reason_and_none_writes_a_roll(table:any){
let client:any,social:any,missing:any;
client=(await table(HAGGLE_PASSES));
social=({["intent"]:"social",["goal"]:"a better rate",["method"]:"haggle"});
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c1",({"rule":"no-such-rule"}))))),["unknown_entity","rule_unknown"])),"tests/kernel/test_stated_operations.py:270 assert refusal(resolve(client, \"t1-c1\", rule=\"no-such-rule\")) == (\"unknown_entity\", \"rule_unknown\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c2",({"rule":"library-dust"}))))),["not_here","rule_not_here"])),"tests/kernel/test_stated_operations.py:271 assert refusal(resolve(client, \"t1-c2\", rule=\"library-dust\")) == (\"not_here\", \"rule_not_here\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c3",({"rule":"chapel-floor","intent":"idle"}))))),["invalid_params","rule_intent"])),"tests/kernel/test_stated_operations.py:272 assert refusal(resolve(client, \"t1-c3\", rule=\"chapel-floor\", intent=\"idle\")) == (\"invalid_params\", \"rule_intent\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c4",({"rule":"chapel-floor","decision":"core-check:opposed-check"}))))),["invalid_params","rule_decision"])),"tests/kernel/test_stated_operations.py:273 assert refusal(resolve(client, \"t1-c4\", rule=\"chapel-floor\", decision=\"core-check:opposed-check\")) == (\"invalid_params\", \"rule_decision\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c5",({"rule":"chapel-floor","step":2}))))),["invalid_params","rule_step"])),"tests/kernel/test_stated_operations.py:274 assert refusal(resolve(client, \"t1-c5\", rule=\"chapel-floor\", step=2)) == (\"invalid_params\", \"rule_step\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c6",({"rule":"knott-haggle","step":0,...social,"skill":"Persuade"}))))),["invalid_params","rule_step"])),"tests/kernel/test_stated_operations.py:275 assert refusal(resolve(client, \"t1-c6\", rule=\"knott-haggle\", step=0, **social, skill=\"Persuade\")) == (\"invalid_params\", \"rule_step\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c7",({"rule":"plain-cost"}))))),["invalid_params","rule_no_check"])),"tests/kernel/test_stated_operations.py:276 assert refusal(resolve(client, \"t1-c7\", rule=\"plain-cost\")) == (\"invalid_params\", \"rule_no_check\")");
missing=(await resolve(client,"t1-c8",({"rule":"knott-haggle",...social})));
assert.ok(pyBool(pyEqual((await refusal(missing)),["needs","rule_skill"])),"tests/kernel/test_stated_operations.py:278 assert refusal(missing) == (\"needs\", \"rule_skill\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(missing,"error"),"details"),"needs"),"options"),["Persuade","Credit Rating"])),"tests/kernel/test_stated_operations.py:279 assert missing[\"error\"][\"details\"][\"needs\"][\"options\"] == [\"Persuade\", \"Credit Rating\"]");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c9",({"rule":"knott-haggle","skill":"Spot Hidden",...social}))))),["invalid_params","rule_skill"])),"tests/kernel/test_stated_operations.py:280 assert refusal(resolve(client, \"t1-c9\", rule=\"knott-haggle\", skill=\"Spot Hidden\", **social)) == (\"invalid_params\", \"rule_skill\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c10",({"rule":"knott-haggle","skill":"Credit Rating",...social}))))),["invalid_params","rule_minimum"])),"tests/kernel/test_stated_operations.py:281 assert refusal(resolve(client, \"t1-c10\", rule=\"knott-haggle\", skill=\"Credit Rating\", **social)) == (\"invalid_params\", \"rule_minimum\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c11",({"rule":"knott-haggle","skill":"Persuade","target":"Cellar hound",...social}))))),["invalid_params","rule_target"])),"tests/kernel/test_stated_operations.py:282 assert refusal(resolve(client, \"t1-c11\", rule=\"knott-haggle\", skill=\"Persuade\", target=\"Cellar hound\", **social)) == (\"invalid_params\", \"rule_target\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c12",({"rule":"knott-haggle","skill":"Persuade","modifiers":({["difficulty"]:"regular"}),...social}))))),["invalid_params","rule_difficulty"])),"tests/kernel/test_stated_operations.py:283 assert refusal(resolve(client, \"t1-c12\", rule=\"knott-haggle\", skill=\"Persuade\",\n                           modifiers={\"difficulty\": \"regular\"}, **social)) == (\"invalid_params\", \"rule_difficulty\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c13",({"rule":"chapel-floor","obligation":"globe-clippings-access"}))))),["invalid_params","rule_decision"])),"tests/kernel/test_stated_operations.py:285 assert refusal(resolve(client, \"t1-c13\", rule=\"chapel-floor\", obligation=\"globe-clippings-access\")) == (\"invalid_params\", \"rule_decision\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c14",({"step":1}))))),["invalid_params","rule_step"])),"tests/kernel/test_stated_operations.py:286 assert refusal(resolve(client, \"t1-c14\", step=1)) == (\"invalid_params\", \"rule_step\")");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){if(pyBool(pyEqual(pyAt(row,"kind"),"roll"))){__rows.push(row);}}return __rows;})()))),"tests/kernel/test_stated_operations.py:287 assert not [row for row in receipts(client) if row[\"kind\"] == \"roll\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_every_refusal_by_its_reason_and_none_writes_a_roll"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_every_refusal_by_its_reason_and_none_writes_a_roll(await makeTable(t,temporary));});
export async function test_stated_refusals_by_reason(table:any){
let client:any,ambiguous:any;
client=(await table(HAGGLE_PASSES));
assert.ok(pyBool(pyEqual((await refusal((await apply(client,"t1-c1",({["kind"]:"damage",["stated"]:"no-such-rule"}))))),["unknown_entity","stated_unknown"])),"tests/kernel/test_stated_operations.py:292 assert refusal(apply(client, \"t1-c1\", {\"kind\": \"damage\", \"stated\": \"no-such-rule\"})) == (\"unknown_entity\", \"stated_unknown\")");
ambiguous=(await apply(client,"t1-c2",({["kind"]:"damage",["stated"]:"two-falls"})));
assert.ok(pyBool(pyEqual((await refusal(ambiguous)),["invalid_params","stated_ambiguous"])),"tests/kernel/test_stated_operations.py:294 assert refusal(ambiguous) == (\"invalid_params\", \"stated_ambiguous\")");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(ambiguous,"error"),"details"),"choices"),[({["kind"]:"damage",["dice"]:"1D3"}),({["kind"]:"damage",["dice"]:"1D4"})])),"tests/kernel/test_stated_operations.py:295 assert ambiguous[\"error\"][\"details\"][\"choices\"] == [{\"kind\": \"damage\", \"dice\": \"1D3\"}, {\"kind\": \"damage\", \"dice\": \"1D4\"}]");
assert.ok(pyBool(pyEqual((await refusal((await apply(client,"t1-c3",({["kind"]:"time",["stated"]:"two-falls"}))))),["invalid_params","stated_none"])),"tests/kernel/test_stated_operations.py:296 assert refusal(apply(client, \"t1-c3\", {\"kind\": \"time\", \"stated\": \"two-falls\"})) == (\"invalid_params\", \"stated_none\")");
assert.ok(pyBool(pyEqual((await refusal((await apply(client,"t1-c4",({["kind"]:"damage",["stated"]:"dark-fall"}))))),["invalid_params","stated_unstated"])),"tests/kernel/test_stated_operations.py:297 assert refusal(apply(client, \"t1-c4\", {\"kind\": \"damage\", \"stated\": \"dark-fall\"})) == (\"invalid_params\", \"stated_unstated\")");
assert.ok(pyBool(pyEqual((await refusal((await apply(client,"t1-c5",({["kind"]:"move",["to"]:"central-library",["stated"]:"long-search"}))))),["invalid_params","stated_none"])),"tests/kernel/test_stated_operations.py:298 assert refusal(apply(client, \"t1-c5\", {\"kind\": \"move\", \"to\": \"central-library\", \"stated\": \"long-search\"})) == (\"invalid_params\", \"stated_none\")");
assert.ok(pyBool(!pyBool((await receipts(client)))),"tests/kernel/test_stated_operations.py:299 assert not receipts(client)");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_stated_refusals_by_reason"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_stated_refusals_by_reason(await makeTable(t,temporary));});
export async function test_time_threat_and_cash_take_the_nodes_own_amounts(table:any){
let client:any,before:any,time:any,threat:any,cash:any,rows:any,tick:any,paid:any;
client=(await table(HAGGLE_PASSES));
before=pyAt(pyAt((await world(client)),"clock"),"minutes");
time=(await ok((await apply(client,"t1-c1",({["kind"]:"time",["stated"]:"long-search",["why"]:"the stacks"})))));
assert.ok(pyBool(pyEqual(pyAt(pyAt((await world(client)),"clock"),"minutes"),pyAdd(before,240))),"tests/kernel/test_stated_operations.py:306 assert world(client)[\"clock\"][\"minutes\"] == before + 240");
threat=(await ok((await apply(client,"t1-c2",({["kind"]:"threat",["stated"]:"corbitt-haunting",["why"]:"they went in"})))));
cash=(await ok((await apply(client,"t1-c3",({["kind"]:"cash",["stated"]:"long-search",["with"]:"Steven Knott",["why"]:"paid"})))));
rows=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){__rows.push([pyAt(row,"id"),row]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rows,pyAt(pyAt(time,"receipts"),0)),"minutes"),240);return pyBool(__left)?pyEqual(pyAt(pyAt(rows,pyAt(pyAt(time,"receipts"),0)),"basis"),"stated"):__left;})())),"tests/kernel/test_stated_operations.py:310 assert rows[time[\"receipts\"][0]][\"minutes\"] == 240 and rows[time[\"receipts\"][0]][\"basis\"] == \"stated\"");
tick=pyAt(rows,pyAt(pyAt(threat,"receipts"),0));
assert.ok(pyBool(pyEqual([pyAt(tick,"threat"),pyAt(tick,"clock"),pyAt(tick,"after"),pyAt(tick,"stated")],["corbitt-haunting","corbitt-awareness",1,"corbitt-haunting"])),"tests/kernel/test_stated_operations.py:312 assert (tick[\"threat\"], tick[\"clock\"], tick[\"after\"], tick[\"stated\"]) == (\"corbitt-haunting\", \"corbitt-awareness\", 1, \"corbitt-haunting\")");
paid=pyAt(rows,pyAt(pyAt(cash,"receipts"),0));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(paid,"delta"),30);return pyBool(__left)?pyEqual(pyAt(paid,"source"),"quote"):__left;})());return pyBool(__left)?pyEqual(pyAt(paid,"stated"),"long-search"):__left;})())),"tests/kernel/test_stated_operations.py:314 assert paid[\"delta\"] == 30 and paid[\"source\"] == \"quote\" and paid[\"stated\"] == \"long-search\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_time_threat_and_cash_take_the_nodes_own_amounts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_time_threat_and_cash_take_the_nodes_own_amounts(await makeTable(t,temporary));});

export async function test_a_sanity_check_takes_its_pair_from_the_rule(table:any){
let client:any,look:any,result:any,loss:any;
client=(await table(HAGGLE_PASSES));
look=({["intent"]:"investigate",["goal"]:"the bed rears up",["method"]:"watches",["decision"]:"sanity:check",["involuntary"]:"flee"});
result=(await ok((await resolve(client,"t1-c1",({"rule":"bed-flung",...look})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(result,"decision"),"sanity:check");return pyBool(__left)?pyEqual(pyAt(result,"stated"),({["rule"]:"bed-flung",["san_loss"]:"1/1D4"})):__left;})())),"tests/kernel/test_stated_operations.py:324 assert result[\"decision\"] == \"sanity:check\" and result[\"stated\"] == {\"rule\": \"bed-flung\", \"san_loss\": \"1/1D4\"}");
loss=pyAt(pyAt(result,"outcome"),"san_loss");
assert.ok(pyBool((pyBool(pyAt(pyAt(result,"outcome"),"passed"))?(pyEqual(loss,1)):((await (async()=>{const __term0=1;const __term1=loss;const __term2=4;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})())))),"tests/kernel/test_stated_operations.py:326 assert (loss == 1) if result[\"outcome\"][\"passed\"] else (1 <= loss <= 4)");
assert.ok(pyBool(pyEqual(pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){if(pyBool(pyEqual(pyAt(row,"kind"),"roll"))){__rows.push(row);}}return __rows;})()))),"basis"),({["rule"]:"bed-flung"}))),"tests/kernel/test_stated_operations.py:327 assert next(row for row in receipts(client) if row[\"kind\"] == \"roll\")[\"basis\"] == {\"rule\": \"bed-flung\"}");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c2",({"rule":"bed-flung","san_loss":"0/1D6",...look}))))),["invalid_params","stated_conflict"])),"tests/kernel/test_stated_operations.py:328 assert refusal(resolve(client, \"t1-c2\", rule=\"bed-flung\", san_loss=\"0/1D6\", **look)) == (\"invalid_params\", \"stated_conflict\")");
assert.ok(pyBool(pyEqual((await refusal((await resolve(client,"t1-c3",({"rule":"chapel-floor",...look}))))),["invalid_params","stated_none"])),"tests/kernel/test_stated_operations.py:329 assert refusal(resolve(client, \"t1-c3\", rule=\"chapel-floor\", **look)) == (\"invalid_params\", \"stated_none\")");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_sanity_check_takes_its_pair_from_the_rule"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_sanity_check_takes_its_pair_from_the_rule(await makeTable(t,temporary));});

export async function test_a_stated_hazard_refuses_no_unrelated_operation(table:any){
let client:any,plain:any,moved:any,own:any;

client=(await table(LUCK_FAILS_JUMP_FAILS));
plain=(await ok((await resolve(client,"t1-c1",({"intent":"investigate","skill":"Jump","goal":"jump the gap","method":"jumps"})))));
assert.ok(pyBool(!pyContains(plain,"stated")),"tests/kernel/test_stated_operations.py:339 assert \"stated\" not in plain");
assert.ok(pyBool(!pyContains(pyAt((await receipts(client)),(-1)),"basis")),"tests/kernel/test_stated_operations.py:340 assert \"basis\" not in receipts(client)[-1]");
moved=(await ok((await apply(client,"t1-c2",({["kind"]:"time",["minutes"]:10})))));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt((await receipts(client)),(-1)),"id"),pyAt(pyAt(moved,"receipts"),0));return pyBool(__left)?pyEqual(pyAt(pyAt((await receipts(client)),(-1)),"basis"),"keeper"):__left;})())),"tests/kernel/test_stated_operations.py:342 assert receipts(client)[-1][\"id\"] == moved[\"receipts\"][0] and receipts(client)[-1][\"basis\"] == \"keeper\"");
(await ok((await resolve(client,"t1-c3",({"rule":"chapel-floor"})))));
own=(await ok((await apply(client,"t1-c4",({["kind"]:"damage",["dice"]:"1D2"})))));
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){if(pyBool(pyContains(pyAt(own,"receipts"),pyAt(row,"id")))){__rows.push(pyEqual(pyAt(row,"basis"),"keeper"));}}return __rows;})())))),"tests/kernel/test_stated_operations.py:346 assert all(row[\"basis\"] == \"keeper\" for row in receipts(client) if row[\"id\"] in own[\"receipts\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_a_stated_hazard_refuses_no_unrelated_operation"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_a_stated_hazard_refuses_no_unrelated_operation(await makeTable(t,temporary));});

export async function test_the_offer_ledger_counts_stated_rows_and_kpi_counts_the_kind(table:any){
let client:any,settled:any,rows:any,ledger:any,rows_with_mech:any,offered:any,expected_taken:any,counted:any;
client=(await table(LUCK_FAILS_JUMP_FAILS));
(await ok((await resolve(client,"t1-c1",({"rule":"chapel-floor"})))));
(await ok((await apply(client,"t1-c2",({["kind"]:"time",["stated"]:"long-search"})))));
settled=new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){__rows.push((await pyMethod(row,"get",["stated"],{})));}return __rows;})()));
settled=pyUnion(settled,new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable((await receipts(client)))){if(pyBool((await pyIsInstance((await pyMethod(row,"get",["basis"],{})),pyDict)))){__rows.push((await pyMethod(pyAt(row,"basis"),"get",["rule"],{})));}}return __rows;})())));
assert.ok(pyBool(pyLessEqual(new Set(["chapel-floor","long-search"]),settled)),pyStr("both operations really landed"));
(await pyMethod(client,"table",["narrate"],{"call_id":"t1-c3","text":"The boards creak."}));
rows=(await (async()=>{const __rows:any[]=[];for(const line of pyIterable((await pyMethod((await pyMethod((pyDivide((await campaign_dir(client.workspace)),"telemetry.jsonl")),"read_text",[],{})),"splitlines",[],{})))){if(pyBool((await pyMethod(line,"strip",[],{})))){__rows.push((await pyMethod(json,"loads",[line],{})));}}return __rows;})());
ledger=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(rows)){if(pyBool((await (async()=>{const __left=pyEqual((await pyMethod(row,"get",["lane"],{})),"offers");return pyBool(__left)?pyEqual(pyAt(row,"turn"),1):__left;})()))){__rows.push(row);}}return __rows;})())));
rows_with_mech=(await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(client.opened,"where"),"rules"))){if(pyBool(pyContains(row,"mech"))){__rows.push(pyAt(row,"name"));}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=rows_with_mech;return pyBool(__left)?pyLessEqual((await pySet(rows_with_mech)),(await pySet(RULES))):__left;})())),"tests/kernel/test_stated_operations.py:364 assert rows_with_mech and set(rows_with_mech) <= set(RULES)");
offered=(await (async()=>{const __rows:any[]=[];for(const offer of pyIterable(pyAt(ledger,"offered"))){if(pyBool((await pyMethod(offer,"startswith",["stated:"],{})))){__rows.push(offer);}}return __rows;})());
assert.ok(pyBool(pyEqual(offered,(await (async()=>{const __rows:any[]=[];for(const name of pyIterable(rows_with_mech)){__rows.push(`stated:${name}`);}return __rows;})()))),"tests/kernel/test_stated_operations.py:366 assert offered == [f\"stated:{name}\" for name in rows_with_mech]");
expected_taken=pyIntersection(new Set(["chapel-floor","long-search"]),(await pySet(rows_with_mech)));
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const offer of pyIterable(pyAt(ledger,"taken"))){if(pyBool((await pyMethod(offer,"startswith",["stated:"],{})))){__rows.push(offer);}}return __rows;})())),new Set((await (async()=>{const __rows:any[]=[];for(const name of pyIterable(expected_taken)){__rows.push(`stated:${name}`);}return __rows;})())))),"tests/kernel/test_stated_operations.py:368 assert {offer for offer in ledger[\"taken\"] if offer.startswith(\"stated:\")} == {f\"stated:{name}\" for name in expected_taken}");
counted=pyAt(pyAt((await pyMethod(kpi,"offers",[rows],{})),"by_kind"),"stated");
assert.ok(pyBool(pyEqual(counted,({["offered"]:(await pyLen(rows_with_mech)),["taken"]:(await pyLen(expected_taken)),["never_taken"]:false}))),"tests/kernel/test_stated_operations.py:370 assert counted == {\"offered\": len(rows_with_mech), \"taken\": len(expected_taken), \"never_taken\": False}");
assert.ok(pyBool(!pyContains((await pyMethod(json,"dumps",[pyAt((await pyMethod(client,"table",["player_input"],{"text":"I go on."})),"capsule")],{})),"stated:")),"tests/kernel/test_stated_operations.py:372 assert \"stated:\" not in json.dumps(client.table(\"player_input\", text=\"I go on.\")[\"capsule\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_the_offer_ledger_counts_stated_rows_and_kpi_counts_the_kind"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_the_offer_ledger_counts_stated_rows_and_kpi_counts_the_kind(await makeTable(t,temporary));});
