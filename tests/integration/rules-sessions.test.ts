// Migrated from tests/kernel/test_sessions.py; original case names and assertions retained.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {RpcClient,campaign_dir,narrate,open_turn,read_json,read_jsonl,pyStr,pyLen,pyBool,pyInt,pyList,pySet,pyDict,pySorted,pyRange,pyEnumerate,pyIsInstance,pyAny,pyAll,pySum,pyNext,pyFormat,pyAt,pySlice,pyEqual,pyContains,pyDivide,pyAdd,pyMultiply,pyUnion,pyIntersection,pySubtract,pyLess,pyLessEqual,pyCompare,pyMethod,pyIterable,pyMin,pyMax,pyZip,pyParametrize,pyCartesian,acquireFixture,temporaryPath,pyMonkeypatch,json,re,hashlib,shutil,Path,deepcopy,Counter} from "./npc-support.ts";




import {event_count,events_after,resolve,resolve_err,walk_to_confrontation} from './rules-families.test.ts';
import {importSource} from './support.ts';
const {mechanics,chaseEndOutcome,SessionView,RpcError}=await importSource('tests/integration/rules-sessions-native.ts');
const ask=(client:any,id:any,text:any,options:any,extras:any={})=>client.table('ask',{call_id:id,prompt:text,options,...extras});
function chase_end_word(word:any,reached:any,options:any){const participant={actor_id:'quarry',side:'quarry',escaped:reached==='escaped',captured:reached==='captured'};const saved={participants:[participant]};const campaign={saved:(path:string)=>path==='chase.json'?saved:null,sanity:()=>null};const view=new SessionView(campaign,null,options.quarry_is_investigator?[{id:'quarry'}]:[],{});return chaseEndOutcome(view,word);}
export let INVESTIGATOR:any="thomas-hayes";
export let CORBITT:any="walter-corbitt";
export async function receipts(client:any){
return Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
}
export async function save_path(client:any,...parts:any[]){
return Path([String(await campaign_dir(client.workspace)),"save",...parts].join("/"));
}
export async function sheet(client:any){
return (await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"party"),`${INVESTIGATOR}.json`)));
}
export async function attack_and_npc_defense(client:any,n:any,defense:any="none",weapon:any=".38 Revolver"){
let attack:any,defend:any;

attack=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":weapon})));
defend=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"他迎着子弹","method":"","actor":"Walter Corbitt","defense":defense})));
return [attack,defend,pyAdd(n,2)];
}

export async function test_combat_against_corbitt_with_the_revolver(tmp_path:any){
let client:any,n:any,missing:any,unknown:any,attack:any,outcome:any,session:any,corbitt:any,blocked:any,wrong:any,defend:any,hp:any,ammo:any,logged:any,events:any,settled:any,strike:any,pending:any,asked:any,answer:any,again:any,dodge:any,rolled:any,npc_roll:any,rolls:any,first_turn:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await open_turn(client,"我举枪对准棺材里的东西。"));
n=(await walk_to_confrontation(client));
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_sessions.py:41 assert client.table(\"look\")[\"where\"][\"session\"] is None");
missing=(await resolve_err(client,`t1-c${n}`,({"intent":"combat","goal":"开枪","method":"射击","target":"Walter Corbitt"})));
assert.ok(pyBool(pyEqual(pyAt(missing,"code"),"needs")),"tests/kernel/test_sessions.py:44 assert missing[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(missing,"details"),"needs"),({["field"]:"weapon",["options"]:[".38 Revolver","unarmed"]}))),"tests/kernel/test_sessions.py:45 assert missing[\"details\"][\"needs\"] == {\"field\": \"weapon\", \"options\": [\".38 Revolver\", \"unarmed\"]}");
unknown=(await resolve_err(client,`t1-c${n}`,({"intent":"combat","goal":"开枪","method":"射击","target":"Walter Corbitt","weapon":"Tommy gun"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(unknown,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(unknown,"details"),"needs"),"field"),"weapon"):__left;})())),"tests/kernel/test_sessions.py:48 assert unknown[\"code\"] == \"needs\" and unknown[\"details\"][\"needs\"][\"field\"] == \"weapon\"");
attack=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(attack,"decision"),"combat:attack");return pyBool(__left)?pyEqual(pyAt(attack,"family"),"combat"):__left;})())),"tests/kernel/test_sessions.py:52 assert attack[\"decision\"] == \"combat:attack\" and attack[\"family\"] == \"combat\"");
outcome=pyAt(attack,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(outcome,"status"),"pending_defense"):__left;})());return pyBool(__left)?(pyAt(outcome,"started")===true):__left;})())),"tests/kernel/test_sessions.py:54 assert outcome[\"kind\"] == \"combat\" and outcome[\"status\"] == \"pending_defense\" and outcome[\"started\"] is True");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"target"),CORBITT);return pyBool(__left)?pyEqual(pyAt(outcome,"attack_kind"),"firearm_attack"):__left;})())),"tests/kernel/test_sessions.py:55 assert outcome[\"target\"] == CORBITT and outcome[\"attack_kind\"] == \"firearm_attack\"");
assert.ok(pyBool(pyEqual(pyAt(outcome,"defense_options"),["dodge","none"])),"tests/kernel/test_sessions.py:56 assert outcome[\"defense_options\"] == [\"dodge\", \"none\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(outcome,"initiative"))){__rows.push(pyAt(row,"actor_id"));}return __rows;})()),[INVESTIGATOR,CORBITT])),"tests/kernel/test_sessions.py:57 assert [row[\"actor_id\"] for row in outcome[\"initiative\"]] == [INVESTIGATOR, CORBITT]");
session=pyAt(attack,"session");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(session,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(session,"status"),"active"):__left;})());return pyBool(__left)?pyEqual(pyAt(session,"round"),1):__left;})())),"tests/kernel/test_sessions.py:59 assert session[\"kind\"] == \"combat\" and session[\"status\"] == \"active\" and session[\"round\"] == 1");
assert.ok(pyBool(pyEqual(pyAt(session,"turn_of"),INVESTIGATOR)),"tests/kernel/test_sessions.py:60 assert session[\"turn_of\"] == INVESTIGATOR");
assert.ok(pyBool(pyEqual(pyAt(session,"pending_defense"),({["for"]:"npc",["actor"]:CORBITT,["attacker"]:INVESTIGATOR,["options"]:["dodge","none"],["attack_command_id"]:`t1-c${n}`,["revision"]:2,["standing"]:({["defense"]:"dodge",["basis"]:"rule-default"})}))),"tests/kernel/test_sessions.py:62 assert session[\"pending_defense\"] == {\"for\": \"npc\", \"actor\": CORBITT, \"attacker\": INVESTIGATOR, \"options\": [\"dodge\", \"none\"], \"attack_command_id\": f\"t1-c{n}\", \"revision\": 2,\n                                              \"standing\": {\"defense\": \"dodge\", \"basis\": \"rule-default\"}}");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){__rows.push(pyAt(p,"name"));}return __rows;})()),[INVESTIGATOR,CORBITT])),"tests/kernel/test_sessions.py:64 assert [p[\"name\"] for p in session[\"participants\"]] == [INVESTIGATOR, CORBITT]");
corbitt=pyAt(pyAt(session,"participants"),1);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(corbitt,"hp"),16);return pyBool(__left)?pyLessEqual(2,pyAt(corbitt,"armor")):__left;})())),"tests/kernel/test_sessions.py:66 assert corbitt[\"hp\"] == 16 and corbitt[\"armor\"] >= 2");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(session,"actions"),0),"decision"),"combat:defend");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(session,"actions"),0),"for"),"npc"):__left;})())),"tests/kernel/test_sessions.py:67 assert session[\"actions\"][0][\"decision\"] == \"combat:defend\" and session[\"actions\"][0][\"for\"] == \"npc\"");
assert.ok(pyBool(pyEqual(pyAt(attack,"pending_choice"),({...pyAt(attack,"pending_choice"),["name"]:`defense:${INVESTIGATOR}-r1`,["for"]:"keeper",["options"]:["dodge","none"]}))),"tests/kernel/test_sessions.py:68 assert attack[\"pending_choice\"] == {**attack[\"pending_choice\"], \"name\": f\"defense:{INVESTIGATOR}-r1\", \"for\": \"keeper\",\n                                            \"options\": [\"dodge\", \"none\"]}");
assert.ok(pyBool(pyContains(pyAt(attack,"receipts"),`session:combat-start-t1-c${n}`)),"tests/kernel/test_sessions.py:70 assert f\"session:combat-start-t1-c{n}\" in attack[\"receipts\"]");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(attack,"effects"))){__rows.push(pyAt(e,"kind"));}return __rows;})())),new Set(["mp","armor"]))),"tests/kernel/test_sessions.py:71 assert {e[\"kind\"] for e in attack[\"effects\"]} == {\"mp\", \"armor\"}");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(attack,"continuations"))){__rows.push(pyAt(c,"decision"));}return __rows;})()),["combat:defend"])),"tests/kernel/test_sessions.py:72 assert [c[\"decision\"] for c in attack[\"continuations\"]] == [\"combat:defend\"]");
blocked=(await resolve_err(client,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"看看四周","method":"用侦查"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(blocked,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(blocked,"details"),"required"),"combat:defend"):__left;})())),"tests/kernel/test_sessions.py:76 assert blocked[\"code\"] == \"turn_state\" and blocked[\"details\"][\"required\"] == \"combat:defend\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(blocked,"details"),"actor"),CORBITT);return pyBool(__left)?pyContains(pyAt(blocked,"fix"),"defense"):__left;})())),"tests/kernel/test_sessions.py:77 assert blocked[\"details\"][\"actor\"] == CORBITT and \"defense\" in blocked[\"fix\"]");
wrong=(await resolve_err(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"x","method":"","defense":"dodge"})));
assert.ok(pyBool(pyEqual(pyAt(wrong,"code"),"turn_state")),"tests/kernel/test_sessions.py:80 assert wrong[\"code\"] == \"turn_state\"");
defend=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"他迎着子弹","method":"","actor":"Walter Corbitt","defense":"none"})));
assert.ok(pyBool(pyEqual(pyAt(defend,"decision"),"combat:defend")),"tests/kernel/test_sessions.py:84 assert defend[\"decision\"] == \"combat:defend\"");
outcome=pyAt(defend,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(outcome,"status"),"resolved"):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"actor"),CORBITT):__left;})())),"tests/kernel/test_sessions.py:86 assert outcome[\"kind\"] == \"combat\" and outcome[\"status\"] == \"resolved\" and outcome[\"actor\"] == CORBITT");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(outcome,"defense"),"none");return pyBool(__left)?pyEqual(pyAt(outcome,"turn_outcome"),"hit"):__left;})())),"tests/kernel/test_sessions.py:87 assert outcome[\"defense\"] == \"none\" and outcome[\"turn_outcome\"] == \"hit\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(outcome,"rolls"),0),({...pyAt(pyAt(outcome,"rolls"),0),["actor"]:INVESTIGATOR,["skill"]:"Firearms (Handgun)",["target"]:55,["passed"]:true,["receipt"]:`roll:firearms-handgun-t1-c${pyAdd(n,1)}`}))),"tests/kernel/test_sessions.py:88 assert outcome[\"rolls\"][0] == {**outcome[\"rolls\"][0], \"actor\": INVESTIGATOR, \"skill\": \"Firearms (Handgun)\",\n                                       \"target\": 55, \"passed\": True, \"receipt\": f\"roll:firearms-handgun-t1-c{n + 1}\"}");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(outcome,"damage"),0),"expression"),"1D10")),"tests/kernel/test_sessions.py:90 assert outcome[\"damage\"][0][\"expression\"] == \"1D10\"");
assert.ok(pyBool(pyEqual(pySlice(pyAt(defend,"receipts"),undefined,2),[`roll:firearms-handgun-t1-c${pyAdd(n,1)}`,`roll:hp-damage-t1-c${pyAdd(n,1)}`])),"tests/kernel/test_sessions.py:91 assert defend[\"receipts\"][:2] == [f\"roll:firearms-handgun-t1-c{n + 1}\", f\"roll:hp-damage-t1-c{n + 1}\"]");
assert.ok(pyBool(pyContains(pyAt(defend,"receipts"),`delta:hp-t1-c${pyAdd(n,1)}`)),"tests/kernel/test_sessions.py:92 assert f\"delta:hp-t1-c{n + 1}\" in defend[\"receipts\"]");
hp=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(defend,"effects"))){if(pyBool(pyEqual(pyAt(e,"kind"),"hp"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual(hp,[({["kind"]:"hp",["subject"]:CORBITT,["before"]:16,["after"]:15})])),"tests/kernel/test_sessions.py:94 assert hp == [{\"kind\": \"hp\", \"subject\": CORBITT, \"before\": 16, \"after\": 15}]");
ammo=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(defend,"effects"))){if(pyBool(pyEqual(pyAt(e,"kind"),"ammo"))){__rows.push(e);}}return __rows;})());
assert.ok(pyBool(pyEqual(ammo,[({["kind"]:"ammo",["subject"]:INVESTIGATOR,["before"]:6,["after"]:5,["weapon"]:"revolver_38_or_9mm"})])),"tests/kernel/test_sessions.py:96 assert ammo == [{\"kind\": \"ammo\", \"subject\": INVESTIGATOR, \"before\": 6, \"after\": 5, \"weapon\": \"revolver_38_or_9mm\"}]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(defend,"effects"))){__rows.push((await (async()=>{const __left=pyEqual(pyAt(e,"kind"),"armor");return pyBool(__left)?pyEqual(pyAt(e,"subject"),CORBITT):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:97 assert any(e[\"kind\"] == \"armor\" and e[\"subject\"] == CORBITT for e in defend[\"effects\"])");
logged=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){__rows.push([pyAt(r,"id"),r]);}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(logged,`delta:ammo-t1-c${pyAdd(n,1)}`),"resource"),"ammo");return pyBool(__left)?!pyContains(pyAt(logged,`delta:ammo-t1-c${pyAdd(n,1)}`),"label"):__left;})())),"tests/kernel/test_sessions.py:100 assert logged[f\"delta:ammo-t1-c{n + 1}\"][\"resource\"] == \"ammo\" and \"label\" not in logged[f\"delta:ammo-t1-c{n + 1}\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(logged,`delta:armor-t1-c${pyAdd(n,1)}`),"resource"),"armor")),"tests/kernel/test_sessions.py:101 assert logged[f\"delta:armor-t1-c{n + 1}\"][\"resource\"] == \"armor\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(defend,"session"),"turn_of"),CORBITT);return pyBool(__left)?(pyAt(pyAt(defend,"session"),"pending_defense")===null):__left;})())),"tests/kernel/test_sessions.py:102 assert defend[\"session\"][\"turn_of\"] == CORBITT and defend[\"session\"][\"pending_defense\"] is None");
assert.ok(pyBool((pyAt(defend,"pending_choice")===null)),"tests/kernel/test_sessions.py:103 assert defend[\"pending_choice\"] is None");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(pyAt(defend,"session"),"actions"))){__rows.push(pyAt(a,"decision"));}return __rows;})()),["combat:attack","combat:maneuver","combat:flee","combat:end"])),"tests/kernel/test_sessions.py:105 assert [a[\"decision\"] for a in defend[\"session\"][\"actions\"]] == [\"combat:attack\", \"combat:maneuver\", \"combat:flee\", \"combat:end\"]");
events=(await read_jsonl(pyDivide((await campaign_dir(client.workspace)),"events.jsonl")));
settled=pyAt((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){if(pyBool(pyEqual(pyAt(e,"type"),"decision-settled"))){__rows.push(e);}}return __rows;})()),(-1));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(settled,"data"),"session_kind"),"combat");return pyBool(__left)?pyEqual(pyAt(pyAt(settled,"data"),"session_status"),"active"):__left;})())),"tests/kernel/test_sessions.py:108 assert settled[\"data\"][\"session_kind\"] == \"combat\" and settled[\"data\"][\"session_status\"] == \"active\"");
assert.ok(pyBool(pyEqual(pySlice((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(events)){__rows.push(pyAt(e,"type"));}return __rows;})()),(-6),undefined),["roll-resolved","roll-resolved","resource-changed","resource-changed","resource-changed","decision-settled"])),"tests/kernel/test_sessions.py:110 assert [e[\"type\"] for e in events][-6:] == [\"roll-resolved\", \"roll-resolved\", \"resource-changed\",\n                                                    \"resource-changed\", \"resource-changed\", \"decision-settled\"]");
strike=(await resolve(client,`t1-c${pyAdd(n,2)}`,({"intent":"combat","goal":"科比特挥刀扑上来","method":"","actor":"Walter Corbitt","target":"托马斯·海斯"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(strike,"outcome"),"status"),"pending_defense");return pyBool(__left)?pyEqual(pyAt(pyAt(strike,"outcome"),"actor"),CORBITT):__left;})())),"tests/kernel/test_sessions.py:116 assert strike[\"outcome\"][\"status\"] == \"pending_defense\" and strike[\"outcome\"][\"actor\"] == CORBITT");
assert.ok(pyBool(pyEqual(pyAt(pyAt(strike,"outcome"),"defense_options"),["dodge","fight_back","none"])),"tests/kernel/test_sessions.py:117 assert strike[\"outcome\"][\"defense_options\"] == [\"dodge\", \"fight_back\", \"none\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(strike,"session"),"pending_defense"),({["for"]:"player",["actor"]:INVESTIGATOR,["attacker"]:CORBITT,["options"]:["dodge","fight_back","none"],["attack_command_id"]:`t1-c${pyAdd(n,2)}`,["revision"]:4}))),"tests/kernel/test_sessions.py:118 assert strike[\"session\"][\"pending_defense\"] == {\"for\": \"player\", \"actor\": INVESTIGATOR, \"attacker\": CORBITT,\n                                                        \"options\": [\"dodge\", \"fight_back\", \"none\"], \"attack_command_id\": f\"t1-c{n+2}\", \"revision\": 4}");
pending=pyAt(strike,"pending_choice");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"player");return pyBool(__left)?pyEqual(pyAt(pending,"name"),`defense:${CORBITT}-r1`):__left;})())),"tests/kernel/test_sessions.py:121 assert pending[\"for\"] == \"player\" and pending[\"name\"] == f\"defense:{CORBITT}-r1\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"options"),["dodge","fight_back","none"]);return pyBool(__left)?pyContains(pyAt(pending,"prompt"),"Walter Corbitt"):__left;})())),"tests/kernel/test_sessions.py:122 assert pending[\"options\"] == [\"dodge\", \"fight_back\", \"none\"] and \"Walter Corbitt\" in pending[\"prompt\"]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(strike,"effects"))){__rows.push(pyAt(e,"kind"));}return __rows;})()),["mp"])),"tests/kernel/test_sessions.py:123 assert [e[\"kind\"] for e in strike[\"effects\"]] == [\"mp\"]");
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session"),"pending_defense"),"for"),"player")),"tests/kernel/test_sessions.py:125 assert client.table(\"look\")[\"where\"][\"session\"][\"pending_defense\"][\"for\"] == \"player\"");
asked=(await ask(client,`t1-c${pyAdd(n,3)}`,"科比特挥刀扑来，你怎么应对？",["躲开","还手","硬挨"],({"binds":pyAt(pending,"name")})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(asked,"pending_choice"),"binds"),pyAt(pending,"name"))),"tests/kernel/test_sessions.py:130 assert asked[\"pending_choice\"][\"binds\"] == pending[\"name\"]");
answer=(await pyMethod(client,"table",["player_input"],{"text":"我闪开！"}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(answer,"turn"),2);return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(pyAt(pyAt(answer,"capsule"),"where"),"session"),"pending_defense"),"for"),"player"):__left;})())),"tests/kernel/test_sessions.py:132 assert answer[\"turn\"] == 2 and answer[\"capsule\"][\"where\"][\"session\"][\"pending_defense\"][\"for\"] == \"player\"");
again=(await resolve_err(client,"t2-c1",({"intent":"investigate","goal":"x","method":"用侦查"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(again,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(again,"details"),"actor"),INVESTIGATOR):__left;})())),"tests/kernel/test_sessions.py:134 assert again[\"code\"] == \"turn_state\" and again[\"details\"][\"actor\"] == INVESTIGATOR");
dodge=(await resolve(client,"t2-c1",({"intent":"combat","goal":"我闪开","method":"","defense":"dodge","choice":({["pending"]:pyAt(pending,"name"),["option"]:"dodge"})})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(dodge,"decision"),"combat:defend");return pyBool(__left)?pyEqual(pyAt(pyAt(dodge,"outcome"),"actor"),INVESTIGATOR):__left;})())),"tests/kernel/test_sessions.py:137 assert dodge[\"decision\"] == \"combat:defend\" and dodge[\"outcome\"][\"actor\"] == INVESTIGATOR");
assert.ok(pyBool(pyEqual(pyAt(pyAt(dodge,"outcome"),"defense"),"dodge")),"tests/kernel/test_sessions.py:138 assert dodge[\"outcome\"][\"defense\"] == \"dodge\"");
rolled=(await receipts(client));
assert.ok(pyBool(pyEqual(pyAt(pyAt(rolled,pyAdd(pyAdd("choice:",pyAt(pyAt(asked,"pending_choice"),"name")),"-t2")),"option"),"dodge")),"tests/kernel/test_sessions.py:140 assert rolled[\"choice:\" + asked[\"pending_choice\"][\"name\"] + \"-t2\"][\"option\"] == \"dodge\"");
npc_roll=pyAt(rolled,"roll:pow-walter-corbitt-t2-c1");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(npc_roll,"actor"),CORBITT);return pyBool(__left)?pyEqual(pyAt(npc_roll,"actor_label"),"Walter Corbitt"):__left;})());return pyBool(__left)?pyEqual(pyAt(npc_roll,"visibility"),"public"):__left;})())),"tests/kernel/test_sessions.py:142 assert npc_roll[\"actor\"] == CORBITT and npc_roll[\"actor_label\"] == \"Walter Corbitt\" and npc_roll[\"visibility\"] == \"public\"");
assert.ok(pyBool((pyAt(npc_roll,"actor_is_investigator")===false)),"tests/kernel/test_sessions.py:143 assert npc_roll[\"actor_is_investigator\"] is False");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(npc_roll,"round"),1);return pyBool(__left)?pyEqual(pyAt(npc_roll,"session_kind"),"combat"):__left;})())),"tests/kernel/test_sessions.py:144 assert npc_roll[\"round\"] == 1 and npc_roll[\"session_kind\"] == \"combat\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rolled,"roll:dodge-t2-c1"),"actor"),INVESTIGATOR);return pyBool(__left)?pyEqual(pyAt(pyAt(rolled,"roll:dodge-t2-c1"),"target"),30):__left;})())),"tests/kernel/test_sessions.py:145 assert rolled[\"roll:dodge-t2-c1\"][\"actor\"] == INVESTIGATOR and rolled[\"roll:dodge-t2-c1\"][\"target\"] == 30");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(dodge,"session"),"status"),"active");return pyBool(__left)?pyEqual(pyAt(pyAt(dodge,"session"),"round"),2):__left;})())),"tests/kernel/test_sessions.py:146 assert dodge[\"session\"][\"status\"] == \"active\" and dodge[\"session\"][\"round\"] == 2");
assert.ok(pyBool(pyEqual(pyAt(pyAt(dodge,"session"),"turn_of"),INVESTIGATOR)),"tests/kernel/test_sessions.py:147 assert dodge[\"session\"][\"turn_of\"] == INVESTIGATOR");
assert.ok(pyBool(pyEqual((await resolve(client,"t2-c1",({"intent":"combat","goal":"我闪开","method":"","defense":"dodge","choice":({["pending"]:pyAt(pending,"name"),["option"]:"dodge"})}))),({...dodge,["replayed"]:true}))),"tests/kernel/test_sessions.py:150 assert resolve(client, \"t2-c1\", intent=\"combat\", goal=\"我闪开\", method=\"\", defense=\"dodge\",\n                       choice={\"pending\": pending[\"name\"], \"option\": \"dodge\"}) == {**dodge, \"replayed\": True}");
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt((await pyMethod(client,"table",["status"],{})),"receipts"))){if(pyBool(pyEqual(pyAt(r,"kind"),"roll"))){__rows.push(r);}}return __rows;})()))),2)),"tests/kernel/test_sessions.py:152 assert len([r for r in client.table(\"status\")[\"receipts\"] if r[\"kind\"] == \"roll\"]) == 2");
rolls=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(client,"t2-c2","刀锋擦着你的脸过去。")),"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"roll"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(rolls)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=(pyAt(m,"actor_is_investigator")===false);return pyBool(__left)?!pyContains(m,"actor_label"):__left;})());return pyBool(__left)?!pyContains(m,"actor"):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:155 assert any(m[\"actor_is_investigator\"] is False and \"actor_label\" not in m and \"actor\" not in m for m in rolls)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(rolls)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(m,"skill"),"Dodge");return pyBool(__left)?pyEqual(pyAt(m,"actor"),INVESTIGATOR):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:156 assert any(m[\"skill\"] == \"Dodge\" and m[\"actor\"] == INVESTIGATOR for m in rolls)");
first_turn=(await read_json(pyDivide(pyDivide((await campaign_dir(client.workspace)),"turns"),"0001.json")));
assert.ok(pyBool(pyEqual(pyAt(first_turn,"closed_by"),"ask")),"tests/kernel/test_sessions.py:158 assert first_turn[\"closed_by\"] == \"ask\"");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(first_turn,"receipts"))){__rows.push((await (async()=>{const __left=pyEqual(pyAt(r,"kind"),"session");return pyBool(__left)?pyEqual(pyAt(r,"transition"),"start"):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:159 assert any(r[\"kind\"] == \"session\" and r[\"transition\"] == \"start\" for r in first_turn[\"receipts\"])");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_combat_against_corbitt_with_the_revolver"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_combat_against_corbitt_with_the_revolver(temporary);});
export async function test_floating_knife_cost_is_not_charged_to_corbitts_claws(kernel:any){
let n:any,_attack:any,defend:any,before:any,strike:any,after:any;
(await open_turn(kernel,"我举起撬棍迎战。"));
n=(await walk_to_confrontation(kernel));
const __unpack11510=(await attack_and_npc_defense(kernel,n));assert.equal(__unpack11510.length,3,"Original tuple unpacking requires exact arity");_attack=__unpack11510[0];defend=__unpack11510[1];n=__unpack11510[2];
assert.ok(pyBool(pyEqual(pyAt(pyAt(defend,"session"),"turn_of"),CORBITT)),"tests/kernel/test_sessions.py:168 assert defend[\"session\"][\"turn_of\"] == CORBITT");
before=pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await read_json((await save_path(kernel,"combat.json")))),"participants"))){if(pyBool(pyEqual(pyAt(row,"actor_id"),CORBITT))){__rows.push(row);}}return __rows;})()))),"magic_points");
strike=(await resolve(kernel,`t1-c${n}`,({"intent":"combat","goal":"科比特伸爪扑来","method":"用干爪抓","actor":"Walter Corbitt","target":"托马斯·海斯","weapon":"claws"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(strike,"outcome"),"status"),"pending_defense")),"tests/kernel/test_sessions.py:175 assert strike[\"outcome\"][\"status\"] == \"pending_defense\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const effect of pyIterable(pyAt(strike,"effects"))){if(pyBool(pyEqual(pyAt(effect,"kind"),"mp"))){__rows.push(effect);}}return __rows;})()),[])),"tests/kernel/test_sessions.py:176 assert [effect for effect in strike[\"effects\"] if effect[\"kind\"] == \"mp\"] == []");
after=pyAt((await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt((await read_json((await save_path(kernel,"combat.json")))),"participants"))){if(pyBool(pyEqual(pyAt(row,"actor_id"),CORBITT))){__rows.push(row);}}return __rows;})()))),"magic_points");
assert.ok(pyBool(pyEqual(after,before)),"tests/kernel/test_sessions.py:179 assert after == before");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_floating_knife_cost_is_not_charged_to_corbitts_claws"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_floating_knife_cost_is_not_charged_to_corbitts_claws(await kernel(t,{}));});
export async function test_an_unlocked_authored_encounter_must_be_entered_before_combat_starts(kernel:any){
let refused:any,attack:any,corbitt:any;

(await open_turn(kernel,"我发现科比特的尸体，立刻举枪。"));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"corbitt-house-ground"})]}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"move",["to"]:"basement-rites"})]}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c3","effects":[({["kind"]:"clue",["clue"]:"corbitt-body-found"})]}));
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c4","effects":[({["kind"]:"npc",["name"]:"Walter Corbitt",["to"]:"here",["why"]:"His body is behind the opened boards"})]}));
refused=(await resolve_err(kernel,"t1-c5",({"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"})));
assert.ok(pyBool(pyEqual(pyAt(refused,"code"),"needs")),"tests/kernel/test_sessions.py:193 assert refused[\"code\"] == \"needs\"");
assert.ok(pyBool(pyEqual(pyAt(refused,"details"),({["reason"]:"combat_scene_required",["target"]:"walter-corbitt",["current"]:"basement-rites",["destinations"]:[({["scene"]:"corbitt-confrontation",["name"]:"corbitt-confrontation",["affordance"]:"conventional-assault",["module_rules_id"]:"the-haunting"})]}))),"tests/kernel/test_sessions.py:194 assert refused[\"details\"] == {\n        \"reason\": \"combat_scene_required\",\n        \"target\": \"walter-corbitt\",\n        \"current\": \"basement-rites\",\n        \"destinations\": [{\"scene\": \"corbitt-confrontation\", \"name\": \"corbitt-confrontation\",\n                          \"affordance\": \"conventional-assault\", \"module_rules_id\": \"the-haunting\"}],\n    }");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(refused,"fix"),"apply move");return pyBool(__left)?pyContains(pyAt(refused,"fix"),"corbitt-confrontation"):__left;})())),"tests/kernel/test_sessions.py:201 assert \"apply move\" in refused[\"fix\"] and \"corbitt-confrontation\" in refused[\"fix\"]");
assert.ok(pyBool((pyAt((await pyMethod(kernel,"table",["look"],{"focus":"session"})),"session")===null)),"tests/kernel/test_sessions.py:202 assert kernel.table(\"look\", focus=\"session\")[\"session\"] is None");
(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c5","effects":[({["kind"]:"move",["to"]:"corbitt-confrontation"}),({["kind"]:"npc",["name"]:"Walter Corbitt",["to"]:"here",["why"]:"The opened hiding place is the confrontation"})]}));
attack=(await resolve(kernel,"t1-c6",({"intent":"combat","goal":"朝科比特开枪","method":"用左轮射击","target":"Walter Corbitt","weapon":".38 Revolver"})));
corbitt=(await pyNext((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(pyAt(attack,"session"),"participants"))){if(pyBool(pyEqual(pyAt(row,"name"),CORBITT))){__rows.push(row);}}return __rows;})())));
assert.ok(pyBool(pyLessEqual(2,pyAt(corbitt,"armor"))),"tests/kernel/test_sessions.py:210 assert corbitt[\"armor\"] >= 2");
assert.ok(pyBool(pyEqual(new Set((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(attack,"effects"))){__rows.push(pyAt(row,"kind"));}return __rows;})())),new Set(["mp","armor"]))),"tests/kernel/test_sessions.py:211 assert {row[\"kind\"] for row in attack[\"effects\"]} == {\"mp\", \"armor\"}");
assert.ok(pyBool(pyEqual((await pyLen((await (async()=>{const __rows:any[]=[];for(const row of pyIterable(pyAt(attack,"effects"))){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(row,"kind"),"mp");return pyBool(__left)?pyEqual(pyAt(row,"subject"),CORBITT):__left;})()))){__rows.push(row);}}return __rows;})()))),2)),"tests/kernel/test_sessions.py:212 assert len([row for row in attack[\"effects\"] if row[\"kind\"] == \"mp\" and row[\"subject\"] == CORBITT]) == 2");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_an_unlocked_authored_encounter_must_be_entered_before_combat_starts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_an_unlocked_authored_encounter_must_be_entered_before_combat_starts(await kernel(t,{}));});
export async function test_defense_none_and_the_snapshot_survives_a_restart(tmp_path:any){
let client:any,n:any,attack:any,defend:any,strike:any,stand:any,rolled:any,hp:any,healing:any,snapshot_before:any,second:any,look:any,actor:any,follow:any,ended:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"6"})})));
try{(await open_turn(client,"我开枪。"));
n=(await walk_to_confrontation(client));
const __unpack14752=(await attack_and_npc_defense(client,n));assert.equal(__unpack14752.length,3,"Original tuple unpacking requires exact arity");attack=__unpack14752[0];defend=__unpack14752[1];n=__unpack14752[2];
assert.ok(pyBool(pyEqual(pyAt(pyAt(defend,"session"),"turn_of"),CORBITT)),"tests/kernel/test_sessions.py:221 assert defend[\"session\"][\"turn_of\"] == CORBITT");
strike=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"科比特扑来","method":"","actor":"Walter Corbitt","target":"托马斯·海斯"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(strike,"pending_choice"),"for"),"player")),"tests/kernel/test_sessions.py:224 assert strike[\"pending_choice\"][\"for\"] == \"player\"");
stand=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"我硬吃这一下","method":"","defense":"none"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(stand,"outcome"),"defense"),"none");return pyBool(__left)?pyEqual(pyAt(pyAt(stand,"outcome"),"opposed_outcome"),"unopposed"):__left;})())),"tests/kernel/test_sessions.py:227 assert stand[\"outcome\"][\"defense\"] == \"none\" and stand[\"outcome\"][\"opposed_outcome\"] == \"unopposed\"");
rolled=(await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(pyAt(stand,"outcome"),"rolls"))){__rows.push(r);}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(rolled,0),"actor"),CORBITT);return pyBool(__left)?pyEqual(pyAt(pyAt(rolled,0),"skill"),"POW"):__left;})())),"tests/kernel/test_sessions.py:229 assert rolled[0][\"actor\"] == CORBITT and rolled[0][\"skill\"] == \"POW\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(rolled,0),"target"),90)),"tests/kernel/test_sessions.py:230 assert rolled[0][\"target\"] == 90");
assert.ok(pyBool((await pyAll((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pySlice(rolled,1,undefined))){if(pyBool(pyEqual(pyAt(r,"actor"),INVESTIGATOR))){__rows.push(pyEqual(pyAt(r,"skill"),"CON"));}}return __rows;})())))),"tests/kernel/test_sessions.py:232 assert all(r[\"skill\"] == \"CON\" for r in rolled[1:] if r[\"actor\"] == INVESTIGATOR)");
hp=(await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(stand,"effects"))){if(pyBool(pyEqual(pyAt(e,"kind"),"hp"))){__rows.push(e);}}return __rows;})());
if(pyBool(pyEqual(pyAt(pyAt(stand,"outcome"),"turn_outcome"),"hit"))){assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(pyAt(stand,"outcome"),"damage"),0),"expression"),"1D4+2")),"tests/kernel/test_sessions.py:235 assert stand[\"outcome\"][\"damage\"][0][\"expression\"] == \"1D4+2\"");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=hp;return pyBool(__left)?pyEqual(pyAt(pyAt(hp,0),"subject"),INVESTIGATOR):__left;})());return pyBool(__left)?pyLess(pyAt(pyAt(hp,0),"after"),12):__left;})())),"tests/kernel/test_sessions.py:236 assert hp and hp[0][\"subject\"] == INVESTIGATOR and hp[0][\"after\"] < 12");
assert.ok(pyBool(pyEqual(pyAt((await sheet(client)),"current_hp"),pyAt(pyAt(hp,0),"after"))),"tests/kernel/test_sessions.py:237 assert sheet(client)[\"current_hp\"] == hp[0][\"after\"]");
healing=(await read_json((await save_path(client,"healing-state",`${INVESTIGATOR}.json`))));
assert.ok(pyBool(pyEqual(pyAt(pyAt(pyAt(healing,"wound_ledger"),0),"status"),"active")),"tests/kernel/test_sessions.py:239 assert healing[\"wound_ledger\"][0][\"status\"] == \"active\"");}else{assert.ok(pyBool(pyEqual(hp,[])),"tests/kernel/test_sessions.py:241 assert hp == []");}
snapshot_before=(await read_json((await save_path(client,"combat.json"))));
assert.ok(pyBool(pyContains(["active","concluded"],pyAt(snapshot_before,"status"))),"tests/kernel/test_sessions.py:243 assert snapshot_before[\"status\"] in (\"active\", \"concluded\")");}finally{(await pyMethod(client,"close",[],{}));}
second=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"6"})})));
try{look=pyAt(pyAt((await pyMethod(second,"table",["look"],{})),"where"),"session");
if(pyBool(!pyEqual(pyAt(snapshot_before,"status"),"active"))){assert.ok(pyBool((look===null)),"tests/kernel/test_sessions.py:252 assert look is None");
return ;}
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(look,"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(look,"round"),pyAt(snapshot_before,"current_round")):__left;})())),"tests/kernel/test_sessions.py:254 assert look[\"kind\"] == \"combat\" and look[\"round\"] == snapshot_before[\"current_round\"]");
assert.ok(pyBool(pyEqual(pyAt(look,"turn_of"),pyAt(pyAt(pyAt(snapshot_before,"current_initiative"),pyAt(snapshot_before,"initiative_cursor")),"actor_id"))),"tests/kernel/test_sessions.py:255 assert look[\"turn_of\"] == snapshot_before[\"current_initiative\"][snapshot_before[\"initiative_cursor\"]][\"actor_id\"]");
actor=pyAt(look,"turn_of");
if(pyBool(pyEqual(actor,INVESTIGATOR))){follow=(await resolve(second,`t1-c${pyAdd(n,2)}`,({"intent":"combat","goal":"再开一枪","method":"","target":"Walter Corbitt","weapon":".38 Revolver"})));}else{follow=(await resolve(second,`t1-c${pyAdd(n,2)}`,({"intent":"combat","goal":"他再扑","method":"","actor":"Walter Corbitt","target":"托马斯·海斯"})));}
assert.ok(pyBool(pyEqual(pyAt(pyAt(follow,"outcome"),"status"),"pending_defense")),"tests/kernel/test_sessions.py:263 assert follow[\"outcome\"][\"status\"] == \"pending_defense\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json((await save_path(second,"combat.json")))),"revision"),pyAdd(pyAt(snapshot_before,"revision"),1))),"tests/kernel/test_sessions.py:264 assert read_json(save_path(second, \"combat.json\"))[\"revision\"] == snapshot_before[\"revision\"] + 1");
ended=(await resolve_err(second,`t1-c${pyAdd(n,3)}`,({"intent":"combat","goal":"x","method":"","decision":"combat:end","outcome":"stalemate"})));
assert.ok(pyBool(pyEqual(pyAt(ended,"code"),"turn_state")),"tests/kernel/test_sessions.py:266 assert ended[\"code\"] == \"turn_state\"");}finally{(await pyMethod(second,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_defense_none_and_the_snapshot_survives_a_restart"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_defense_none_and_the_snapshot_survives_a_restart(temporary);});
export async function test_combat_end_by_the_keeper(seeded_kernel:any){
let n:any,attack:any,defend:any,missing:any,ended:any,after:any,sessions:any;
(await open_turn(seeded_kernel,"我上前。"));
n=(await walk_to_confrontation(seeded_kernel));
const __unpack17969=(await attack_and_npc_defense(seeded_kernel,n,undefined,"unarmed"));assert.equal(__unpack17969.length,3,"Original tuple unpacking requires exact arity");attack=__unpack17969[0];defend=__unpack17969[1];n=__unpack17969[2];
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(attack,"outcome"),"attack_kind"),"opposed_melee");return pyBool(__left)?pyEqual(pyAt(pyAt(attack,"outcome"),"defense_options"),["dodge","fight_back","none"]):__left;})())),"tests/kernel/test_sessions.py:275 assert attack[\"outcome\"][\"attack_kind\"] == \"opposed_melee\" and attack[\"outcome\"][\"defense_options\"] == [\"dodge\", \"fight_back\", \"none\"]");
missing=(await resolve_err(seeded_kernel,`t1-c${n}`,({"intent":"combat","goal":"收手","method":"","decision":"combat:end"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(missing,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(missing,"details"),"needs"),"field"),"outcome"):__left;})())),"tests/kernel/test_sessions.py:277 assert missing[\"code\"] == \"needs\" and missing[\"details\"][\"needs\"][\"field\"] == \"outcome\"");
ended=(await resolve(seeded_kernel,`t1-c${n}`,({"intent":"combat","goal":"双方僵持","method":"","decision":"combat:end","outcome":"stalemate"})));
assert.ok(pyBool(pyEqual(pyAt(ended,"decision"),"combat:end")),"tests/kernel/test_sessions.py:279 assert ended[\"decision\"] == \"combat:end\"");
assert.ok(pyBool(pyEqual(pyAt(ended,"outcome"),({...pyAt(ended,"outcome"),["kind"]:"combat",["status"]:"ended",["combat_outcome"]:"stalemate"}))),"tests/kernel/test_sessions.py:280 assert ended[\"outcome\"] == {**ended[\"outcome\"], \"kind\": \"combat\", \"status\": \"ended\", \"combat_outcome\": \"stalemate\"}");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(ended,"session"),"status"),"ended");return pyBool(__left)?pyEqual(pyAt(pyAt(ended,"session"),"outcome"),"stalemate"):__left;})())),"tests/kernel/test_sessions.py:281 assert ended[\"session\"][\"status\"] == \"ended\" and ended[\"session\"][\"outcome\"] == \"stalemate\"");
assert.ok(pyBool(pyEqual(pyAt(ended,"receipts"),[`session:combat-end-t1-c${n}`])),"tests/kernel/test_sessions.py:282 assert ended[\"receipts\"] == [f\"session:combat-end-t1-c{n}\"]");
assert.ok(pyBool((pyAt(pyAt((await pyMethod(seeded_kernel,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_sessions.py:283 assert seeded_kernel.table(\"look\")[\"where\"][\"session\"] is None");
after=(await resolve(seeded_kernel,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"看清他的脸","method":"用侦查"})));
assert.ok(pyBool((pyAt(after,"session")===null)),"tests/kernel/test_sessions.py:285 assert after[\"session\"] is None");
sessions=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(seeded_kernel,`t1-c${pyAdd(n,2)}`,"你们隔着棺材对峙。")),"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"session"))){__rows.push(m);}}return __rows;})());
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(sessions)){__rows.push([pyAt(m,"family"),pyAt(m,"transition"),(await pyMethod(m,"get",["outcome"],{}))]);}return __rows;})()),[["combat","start",null],["combat","end","stalemate"]])),"tests/kernel/test_sessions.py:287 assert [(m[\"family\"], m[\"transition\"], m.get(\"outcome\")) for m in sessions] == [(\"combat\", \"start\", None),\n                                                                                   (\"combat\", \"end\", \"stalemate\")]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_combat_end_by_the_keeper"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_combat_end_by_the_keeper(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_flee_ends_the_fight_and_the_pursuers_chase_runs_to_its_end(tmp_path:any){
let client:any,n:any,attack:any,defend:any,strike:any,dodge:any,before:any,fled:any,chased:any,session:any,positions:any,blocked:any,chase_file:any,snapshot:any,look:any,hazard:any,taken:any,roll:any,_:any,action:any,params:any,step:any,final:any,sessions:any;

client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"9"})})));
try{(await open_turn(client,"我转身就跑。"));
n=(await walk_to_confrontation(client));
const __unpack20099=(await attack_and_npc_defense(client,n));assert.equal(__unpack20099.length,3,"Original tuple unpacking requires exact arity");attack=__unpack20099[0];defend=__unpack20099[1];n=__unpack20099[2];
strike=(await resolve(client,`t1-c${n}`,({"intent":"combat","goal":"科比特扑来","method":"","actor":"Walter Corbitt","target":"托马斯·海斯"})));
dodge=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"combat","goal":"我闪开","method":"","defense":"dodge"})));
n=pyAdd(n,2);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(dodge,"session"),"round"),2);return pyBool(__left)?pyEqual(pyAt(pyAt(dodge,"session"),"turn_of"),INVESTIGATOR):__left;})())),"tests/kernel/test_sessions.py:305 assert dodge[\"session\"][\"round\"] == 2 and dodge[\"session\"][\"turn_of\"] == INVESTIGATOR");
before=(await event_count(client.workspace));
fled=(await resolve(client,`t1-c${n}`,({"intent":"flee","goal":"我冲上楼梯","method":"拔腿就跑"})));
assert.ok(pyBool(pyEqual(pyAt(fled,"decision"),"combat:flee")),"tests/kernel/test_sessions.py:309 assert fled[\"decision\"] == \"combat:flee\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(fled,"outcome"),"kind"),"combat");return pyBool(__left)?pyEqual(pyAt(pyAt(fled,"outcome"),"status"),"ended"):__left;})())),"tests/kernel/test_sessions.py:310 assert fled[\"outcome\"][\"kind\"] == \"combat\" and fled[\"outcome\"][\"status\"] == \"ended\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(fled,"outcome"),"combat_outcome"),"fled");return pyBool(__left)?!pyContains(pyAt(fled,"outcome"),"continued"):__left;})())),"tests/kernel/test_sessions.py:311 assert fled[\"outcome\"][\"combat_outcome\"] == \"fled\" and \"continued\" not in fled[\"outcome\"]");
assert.ok(pyBool(!pyBool((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(fled,"continuations"))){if(pyBool((await pyMethod(c,"get",["executed"],{})))){__rows.push(c);}}return __rows;})()))),pyStr("nothing ran as the flight's continuation"));
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(fled,"receipts"),`session:combat-end-t1-c${n}`);return pyBool(__left)?!pyContains(pyAt(fled,"receipts"),`session:chase-start-t1-c${n}`):__left;})())),"tests/kernel/test_sessions.py:313 assert f\"session:combat-end-t1-c{n}\" in fled[\"receipts\"] and f\"session:chase-start-t1-c{n}\" not in fled[\"receipts\"]");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const hint of pyIterable(pyAt(fled,"hints"))){__rows.push((await (async()=>{const __left=pyContains(hint,"chase:start");return pyBool(__left)?pyContains(hint,CORBITT):__left;})()));}return __rows;})())))),pyStr(pyAt(fled,"hints")));
assert.ok(pyBool(pyEqual(pyAt((await events_after(client.workspace,before)),(-1)),"decision-settled")),"tests/kernel/test_sessions.py:315 assert events_after(client.workspace, before)[-1] == \"decision-settled\"");
assert.ok(pyBool(pyEqual(pyAt((await read_json((await save_path(client,"combat.json")))),"status"),"concluded")),"tests/kernel/test_sessions.py:316 assert read_json(save_path(client, \"combat.json\"))[\"status\"] == \"concluded\"");
n=pyAdd(n,1);
chased=(await resolve(client,`t1-c${n}`,({"intent":"flee","decision":"chase:start","actor":"Walter Corbitt","target":INVESTIGATOR,"goal":"科比特追上楼梯","method":""})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(chased,"decision"),"chase:start");return pyBool(__left)?pyEqual(pyAt(pyAt(chased,"outcome"),"kind"),"chase"):__left;})())),"tests/kernel/test_sessions.py:322 assert chased[\"decision\"] == \"chase:start\" and chased[\"outcome\"][\"kind\"] == \"chase\"");
assert.ok(pyBool(pyContains(["started","ended"],pyAt(pyAt(chased,"outcome"),"status"))),"tests/kernel/test_sessions.py:323 assert chased[\"outcome\"][\"status\"] in (\"started\", \"ended\")");
session=pyAt(chased,"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"kind"),"chase");return pyBool(__left)?pyContains(["active","ended"],pyAt(session,"status")):__left;})())),"tests/kernel/test_sessions.py:325 assert session[\"kind\"] == \"chase\" and session[\"status\"] in (\"active\", \"ended\")");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){__rows.push(pyAt(p,"name"));}return __rows;})()),[INVESTIGATOR,CORBITT])),"tests/kernel/test_sessions.py:326 assert [p[\"name\"] for p in session[\"participants\"]] == [INVESTIGATOR, CORBITT]");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){__rows.push(pyAt(p,"side"));}return __rows;})()),["quarry","pursuer"])),"tests/kernel/test_sessions.py:327 assert [p[\"side\"] for p in session[\"participants\"]] == [\"quarry\", \"pursuer\"]");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(session,"locations"),0),"label"),"corbitt-confrontation");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(session,"locations"),(-1)),"label"),"escape"):__left;})())),"tests/kernel/test_sessions.py:328 assert session[\"locations\"][0][\"label\"] == \"corbitt-confrontation\" and session[\"locations\"][-1][\"label\"] == \"escape\"");
assert.ok(pyBool(pyContains(pyAt(chased,"receipts"),`session:chase-start-t1-c${n}`)),"tests/kernel/test_sessions.py:329 assert f\"session:chase-start-t1-c{n}\" in chased[\"receipts\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(chased,"receipts"),`roll:con-t1-c${n}`);return pyBool(__left)?pyContains(pyAt(chased,"receipts"),`roll:con-${CORBITT}-t1-c${n}`):__left;})())),"tests/kernel/test_sessions.py:330 assert f\"roll:con-t1-c{n}\" in chased[\"receipts\"] and f\"roll:con-{CORBITT}-t1-c{n}\" in chased[\"receipts\"]");
n=pyAdd(n,1);
if(pyBool(pyEqual(pyAt(session,"status"),"ended"))){assert.ok(pyBool(pyEqual(pyAt(session,"outcome"),"escaped")),"tests/kernel/test_sessions.py:333 assert session[\"outcome\"] == \"escaped\"");
return ;}
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(session,"turn_of"),INVESTIGATOR);return pyBool(__left)?pyEqual(pyAt(pyAt(session,"actions"),0),({...pyAt(pyAt(session,"actions"),0),["decision"]:"chase:move",["action"]:"move:advance",["cost"]:1})):__left;})())),"tests/kernel/test_sessions.py:335 assert session[\"turn_of\"] == INVESTIGATOR and session[\"actions\"][0] == {**session[\"actions\"][0], \"decision\": \"chase:move\",\n                                                                                 \"action\": \"move:advance\", \"cost\": 1}");
positions=Object.fromEntries((await (async()=>{const __rows:any[]=[];for(const p of pyIterable(pyAt(session,"participants"))){__rows.push([pyAt(p,"name"),pyAt(p,"position")]);}return __rows;})()));
assert.ok(pyBool(pyEqual(positions,({[INVESTIGATOR]:2,[CORBITT]:0}))),"tests/kernel/test_sessions.py:338 assert positions == {INVESTIGATOR: 2, CORBITT: 0}");
blocked=(await resolve_err(client,`t1-c${n}`,({"intent":"investigate","goal":"x","method":"用侦查"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(blocked,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(blocked,"details"),"session"),"chase"):__left;})())),"tests/kernel/test_sessions.py:342 assert blocked[\"code\"] == \"turn_state\" and blocked[\"details\"][\"session\"] == \"chase\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(blocked,"details"),"required"),"chase:move")),"tests/kernel/test_sessions.py:343 assert blocked[\"details\"][\"required\"] == \"chase:move\"");
chase_file=(await save_path(client,"chase.json"));
snapshot=(await read_json(chase_file));
pyAt(pyAt(snapshot,"location_chain"),3)["hazard"]=({["hazard_id"]:"rotten-stairs",["skill"]:"DEX",["difficulty"]:"regular",["damage_dice"]:"1D3"});
(await pyMethod(chase_file,"write_text",[(await pyMethod(json,"dumps",[snapshot],{"ensure_ascii":false,"indent":2}))],{"encoding":"utf-8"}));
look=pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(look,"pending_kind"),"hazard");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(look,"actions"),0),"decision"),"chase:hazard"):__left;})())),"tests/kernel/test_sessions.py:352 assert look[\"pending_kind\"] == \"hazard\" and look[\"actions\"][0][\"decision\"] == \"chase:hazard\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(pyAt(look,"actions"),0),"action"),"hazard:rotten-stairs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(look,"actions"),0),"skill"),"DEX"):__left;})())),"tests/kernel/test_sessions.py:353 assert look[\"actions\"][0][\"action\"] == \"hazard:rotten-stairs\" and look[\"actions\"][0][\"skill\"] == \"DEX\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})()),["chase:hazard"])),"tests/kernel/test_sessions.py:354 assert [s[\"decision\"] for s in client.table(\"look\")[\"where\"][\"situations\"]] == [\"chase:hazard\"]");
hazard=(await resolve(client,`t1-c${n}`,({"intent":"flee","goal":"冲下楼梯","method":"","decision":"chase:hazard"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(hazard,"decision"),"chase:hazard");return pyBool(__left)?pyEqual(pyAt(pyAt(hazard,"outcome"),"kind"),"chase"):__left;})())),"tests/kernel/test_sessions.py:357 assert hazard[\"decision\"] == \"chase:hazard\" and hazard[\"outcome\"][\"kind\"] == \"chase\"");
taken=pyAt(pyAt(pyAt(hazard,"outcome"),"actions_taken"),0);
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(taken,"type"),"hazard");return pyBool(__left)?pyEqual(pyAt(taken,"hazard_id"),"rotten-stairs"):__left;})());return pyBool(__left)?pyEqual(pyAt(taken,"new_position"),3):__left;})())),"tests/kernel/test_sessions.py:359 assert taken[\"type\"] == \"hazard\" and taken[\"hazard_id\"] == \"rotten-stairs\" and taken[\"new_position\"] == 3");
roll=pyAt((await receipts(client)),`roll:dex-t1-c${n}`);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(roll,"target"),60);return pyBool(__left)?pyEqual(pyAt(roll,"roll_kind"),"chase_check"):__left;})())),"tests/kernel/test_sessions.py:361 assert roll[\"target\"] == 60 and roll[\"roll_kind\"] == \"chase_check\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(hazard,"effects"))){if(pyBool(pyEqual(pyAt(e,"kind"),"position"))){__rows.push(e);}}return __rows;})()),[({["kind"]:"position",["subject"]:INVESTIGATOR,["before"]:2,["after"]:3})])),"tests/kernel/test_sessions.py:362 assert [e for e in hazard[\"effects\"] if e[\"kind\"] == \"position\"] == [{\"kind\": \"position\", \"subject\": INVESTIGATOR, \"before\": 2, \"after\": 3}]");
if(pyBool(!pyBool(pyAt(taken,"passed")))){assert.ok(pyBool((await (async()=>{const __left=pyLessEqual(0,pyAt(taken,"damage"));return pyBool(__left)?pyEqual((await pyAny((await (async()=>{const __rows:any[]=[];for(const e of pyIterable(pyAt(hazard,"effects"))){__rows.push(pyEqual(pyAt(e,"kind"),"hp"));}return __rows;})()))),(pyLess(0,pyAt(taken,"damage")))):__left;})())),"tests/kernel/test_sessions.py:364 assert taken[\"damage\"] >= 0 and any(e[\"kind\"] == \"hp\" for e in hazard[\"effects\"]) == (taken[\"damage\"] > 0)");}
n=pyAdd(n,1);
let chaseEnded=false;for(_ of pyIterable((await pyRange(16)))){
session=pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session");
if(pyBool(!pyEqual(pyAt(session,"status"),"active"))){chaseEnded=true;break;}
action=pyAt(pyAt(session,"actions"),0);
params=({["intent"]:"flee",["goal"]:"跑",["method"]:"",["decision"]:pyAt(action,"decision")});
if(pyBool(!pyEqual(pyAt(session,"turn_of"),INVESTIGATOR))){params["actor"]=pyAt(session,"turn_of");}
if(pyBool(pyEqual(pyAt(action,"decision"),"chase:conflict"))){params["target"]=pyAt(pyAt(action,"targets"),0);}
step=(await pyMethod(client,"table",["resolve"],{"call_id":`t1-c${n}`,"action":params}));
assert.ok(pyBool(pyEqual(pyAt(step,"decision"),pyAt(action,"decision"))),"tests/kernel/test_sessions.py:379 assert step[\"decision\"] == action[\"decision\"]");
n=pyAdd(n,1);
if(pyBool(pyEqual(pyAt(pyAt(step,"outcome"),"status"),"ended"))){assert.ok(pyBool(pyContains(["escaped","captured"],pyAt(pyAt(step,"outcome"),"chase_outcome"))),"tests/kernel/test_sessions.py:382 assert step[\"outcome\"][\"chase_outcome\"] in (\"escaped\", \"captured\")");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(step,"session"),"status"),"ended");return pyBool(__left)?pyEqual(pyAt(pyAt(step,"session"),"outcome"),pyAt(pyAt(step,"outcome"),"chase_outcome")):__left;})())),"tests/kernel/test_sessions.py:383 assert step[\"session\"][\"status\"] == \"ended\" and step[\"session\"][\"outcome\"] == step[\"outcome\"][\"chase_outcome\"]");
assert.ok(pyBool(pyContains(pyAt(step,"receipts"),`session:chase-end-t1-c${pySubtract(n,1)}`)),"tests/kernel/test_sessions.py:384 assert f\"session:chase-end-t1-c{n - 1}\" in step[\"receipts\"]");
chaseEnded=true;break;}
}
assert.ok(chaseEnded,"the chase did not end in 16 steps");
final=(await read_json(chase_file));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(final,"status"),"concluded");return pyBool(__left)?pyContains(["escaped","captured"],pyAt(final,"outcome")):__left;})())),"tests/kernel/test_sessions.py:389 assert final[\"status\"] == \"concluded\" and final[\"outcome\"] in (\"escaped\", \"captured\")");
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_sessions.py:390 assert client.table(\"look\")[\"where\"][\"session\"] is None");
sessions=(await (async()=>{const __rows:any[]=[];for(const m of pyIterable(pyAt((await narrate(client,`t1-c${n}`,"脚步声在楼梯上炸响。")),"mechanics"))){if(pyBool(pyEqual(pyAt(m,"kind"),"session"))){__rows.push([pyAt(m,"family"),pyAt(m,"transition"),(await pyMethod(m,"get",["outcome"],{}))]);}}return __rows;})());
assert.ok(pyBool((await (async()=>{const __left=pyContains(sessions,["combat","end","fled"]);return pyBool(__left)?pyContains(sessions,["chase","start",null]):__left;})())),"tests/kernel/test_sessions.py:393 assert (\"combat\", \"end\", \"fled\") in sessions and (\"chase\", \"start\", None) in sessions");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const [family,transition,outcome] of pyIterable(sessions)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(family,"chase");return pyBool(__left)?pyEqual(transition,"end"):__left;})());return pyBool(__left)?pyContains(["escaped","captured"],outcome):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:394 assert any(family == \"chase\" and transition == \"end\" and outcome in (\"escaped\", \"captured\")\n                   for family, transition, outcome in sessions)");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_flee_ends_the_fight_and_the_pursuers_chase_runs_to_its_end"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_flee_ends_the_fight_and_the_pursuers_chase_runs_to_its_end(temporary);});
export async function test_flee_without_a_pursuer_needs_one(kernel:any){
let error:any;
(await open_turn(kernel,"我跑。"));
error=(await resolve_err(kernel,"t1-c1",({"intent":"flee","goal":"逃出办公室","method":"夺门而出"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(error,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(error,"details"),"needs"),"field"),"target"):__left;})())),"tests/kernel/test_sessions.py:403 assert error[\"code\"] == \"needs\" and error[\"details\"][\"needs\"][\"field\"] == \"target\"");
assert.ok(pyBool(pyEqual(pyAt((await pyMethod(kernel,"table",["status"],{})),"receipts"),[])),"tests/kernel/test_sessions.py:404 assert kernel.table(\"status\")[\"receipts\"] == []");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_flee_without_a_pursuer_needs_one"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_flee_without_a_pursuer_needs_one(await kernel(t,{}));});

export async function test_sanity_check_bout_recovery_and_reality_check(tmp_path:any){
let client:any,n:any,offered:any,missing:any,no_loss:any,before:any,checked:any,outcome:any,session:any,pending:any,snapshot:any,san_roll:any,blocked:any,another:any,rounds:any,tick:any,end:any,situations:any,early:any,due:any,recovered:any,state:any,reality:any,mechanics:any,san_change:any,bout:any;
client=(new RpcClient(pyDivide(tmp_path,"ws"),({"env":({["COC_KERNEL_SEED"]:"1"})})));
try{(await open_turn(client,"我掀开裹尸布。"));
n=(await walk_to_confrontation(client));
offered=(await resolve_err(client,`t1-c${n}`,({"intent":"investigate","goal":"看清棺材里的东西","method":"用侦查","stakes":"理智受创","target":"Walter Corbitt"})));
assert.ok(pyBool(pyEqual(pyAt(offered,"code"),"needs_choice")),"tests/kernel/test_sessions.py:417 assert offered[\"code\"] == \"needs_choice\"");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const c of pyIterable(pyAt(pyAt(offered,"details"),"candidates"))){__rows.push(pyAt(c,"name"));}return __rows;})()),["core-check:ordinary-check","sanity:check"])),"tests/kernel/test_sessions.py:418 assert [c[\"name\"] for c in offered[\"details\"][\"candidates\"]] == [\"core-check:ordinary-check\", \"sanity:check\"]");
missing=(await resolve_err(client,`t1-c${n}`,({"intent":"investigate","goal":"看清棺材里的东西","method":"","target":"Walter Corbitt","decision":"sanity:check"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(missing,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(missing,"details"),"needs"),"field"),"involuntary"):__left;})())),"tests/kernel/test_sessions.py:421 assert missing[\"code\"] == \"needs\" and missing[\"details\"][\"needs\"][\"field\"] == \"involuntary\"");
assert.ok(pyBool(pyContains(pyAt(pyAt(pyAt(missing,"details"),"needs"),"options"),"freeze")),"tests/kernel/test_sessions.py:422 assert \"freeze\" in missing[\"details\"][\"needs\"][\"options\"]");
no_loss=(await resolve_err(client,`t1-c${n}`,({"intent":"investigate","goal":"血从天花板滴下来","method":"","decision":"sanity:check","involuntary":"freeze"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(no_loss,"code"),"needs");return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(no_loss,"details"),"needs"),"field"),"san_loss"):__left;})())),"tests/kernel/test_sessions.py:425 assert no_loss[\"code\"] == \"needs\" and no_loss[\"details\"][\"needs\"][\"field\"] == \"san_loss\"");
before=(await event_count(client.workspace));
checked=(await resolve(client,`t1-c${n}`,({"intent":"investigate","goal":"看见科比特的尸体动了","method":"","target":"Walter Corbitt","decision":"sanity:check","involuntary":({["kind"]:"freeze",["summary"]:"手电筒的光柱僵在原地"})})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(checked,"decision"),"sanity:check");return pyBool(__left)?pyEqual(pyAt(checked,"family"),"sanity"):__left;})())),"tests/kernel/test_sessions.py:431 assert checked[\"decision\"] == \"sanity:check\" and checked[\"family\"] == \"sanity\"");
outcome=pyAt(checked,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"sanity");return pyBool(__left)?pyEqual(pyAt(outcome,"skill"),"SAN"):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"target"),55):__left;})())),"tests/kernel/test_sessions.py:433 assert outcome[\"kind\"] == \"sanity\" and outcome[\"skill\"] == \"SAN\" and outcome[\"target\"] == 55");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"level"),"failure");return pyBool(__left)?(pyAt(outcome,"passed")===false):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"san_loss"),8):__left;})())),"tests/kernel/test_sessions.py:435 assert outcome[\"level\"] == \"failure\" and outcome[\"passed\"] is False and outcome[\"san_loss\"] == 8");
assert.ok(pyBool(pyEqual([pyAt(outcome,"san_before"),pyAt(outcome,"san_after")],[55,47])),"tests/kernel/test_sessions.py:436 assert (outcome[\"san_before\"], outcome[\"san_after\"]) == (55, 47)");
assert.ok(pyBool(pyEqual(pyAt(outcome,"involuntary_action"),({...pyAt(outcome,"involuntary_action"),["kind"]:"freeze",["summary"]:"手电筒的光柱僵在原地"}))),"tests/kernel/test_sessions.py:437 assert outcome[\"involuntary_action\"] == {**outcome[\"involuntary_action\"], \"kind\": \"freeze\", \"summary\": \"手电筒的光柱僵在原地\"}");
assert.ok(pyBool((await (async()=>{const __left=(pyAt(outcome,"temporary_insane")===true);return pyBool(__left)?(pyAt(outcome,"bout_active")===true):__left;})())),"tests/kernel/test_sessions.py:438 assert outcome[\"temporary_insane\"] is True and outcome[\"bout_active\"] is True");
assert.ok(pyBool(pyEqual(pyAt(checked,"effects"),[({["kind"]:"san",["subject"]:INVESTIGATOR,["before"]:55,["after"]:47})])),"tests/kernel/test_sessions.py:439 assert checked[\"effects\"] == [{\"kind\": \"san\", \"subject\": INVESTIGATOR, \"before\": 55, \"after\": 47}]");
assert.ok(pyBool(pyEqual(pySlice(pyAt(checked,"receipts"),undefined,3),[`roll:san-t1-c${n}`,`roll:san-loss-t1-c${n}`,`roll:int-t1-c${n}`])),"tests/kernel/test_sessions.py:440 assert checked[\"receipts\"][:3] == [f\"roll:san-t1-c{n}\", f\"roll:san-loss-t1-c{n}\", f\"roll:int-t1-c{n}\"]");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(checked,"receipts"),`delta:san-t1-c${n}`);return pyBool(__left)?pyContains(pyAt(checked,"receipts"),`session:sanity_bout-start-t1-c${n}`):__left;})())),"tests/kernel/test_sessions.py:441 assert f\"delta:san-t1-c{n}\" in checked[\"receipts\"] and f\"session:sanity_bout-start-t1-c{n}\" in checked[\"receipts\"]");
session=pyAt(checked,"session");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(session,"kind"),"sanity_bout");return pyBool(__left)?pyEqual(pyAt(session,"status"),"active"):__left;})());return pyBool(__left)?pyEqual(pyAt(session,"turn_of"),INVESTIGATOR):__left;})())),"tests/kernel/test_sessions.py:443 assert session[\"kind\"] == \"sanity_bout\" and session[\"status\"] == \"active\" and session[\"turn_of\"] == INVESTIGATOR");
assert.ok(pyBool((await (async()=>{const __term0=pyAt(pyAt(session,"bout"),"rounds_remaining");const __term1=pyAt(pyAt(session,"bout"),"duration_rounds");const __term2=1;return pyCompare(__term0,__term1,"==")&&pyCompare(__term1,__term2,">=");})())),"tests/kernel/test_sessions.py:444 assert session[\"bout\"][\"rounds_remaining\"] == session[\"bout\"][\"duration_rounds\"] >= 1");
assert.ok(pyBool(pyEqual((await (async()=>{const __rows:any[]=[];for(const a of pyIterable(pyAt(session,"actions"))){__rows.push(pyAt(a,"decision"));}return __rows;})()),["sanity:bout-tick","sanity:bout-end"])),"tests/kernel/test_sessions.py:445 assert [a[\"decision\"] for a in session[\"actions\"]] == [\"sanity:bout-tick\", \"sanity:bout-end\"]");
pending=pyAt(checked,"pending_choice");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pending,"for"),"keeper");return pyBool(__left)?pyEqual(pyAt(pending,"name"),`bout:${INVESTIGATOR}-r1`):__left;})())),"tests/kernel/test_sessions.py:447 assert pending[\"for\"] == \"keeper\" and pending[\"name\"] == f\"bout:{INVESTIGATOR}-r1\"");
assert.ok(pyBool(pyEqual(pyAt(pending,"options"),["sanity:bout-tick","sanity:bout-end"])),"tests/kernel/test_sessions.py:448 assert pending[\"options\"] == [\"sanity:bout-tick\", \"sanity:bout-end\"]");
assert.ok(pyBool(pyEqual(pyAt((await sheet(client)),"current_san"),47)),"tests/kernel/test_sessions.py:449 assert sheet(client)[\"current_san\"] == 47");
snapshot=(await read_json((await save_path(client,"sanity-state",`${INVESTIGATOR}.json`))));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(snapshot,"bout_active")===true);return pyBool(__left)?pyEqual(pyAt(pyAt(snapshot,"recovery_trigger"),"handler"),"recover_temporary_insanity"):__left;})())),"tests/kernel/test_sessions.py:451 assert snapshot[\"bout_active\"] is True and snapshot[\"recovery_trigger\"][\"handler\"] == \"recover_temporary_insanity\"");
assert.ok(pyBool(pyEqual(pySlice((await events_after(client.workspace,before)),(-3),undefined),["resource-changed","session-changed","decision-settled"])),"tests/kernel/test_sessions.py:453 assert events_after(client.workspace, before)[-3:] == [\"resource-changed\", \"session-changed\", \"decision-settled\"]");
san_roll=pyAt((await receipts(client)),`roll:san-t1-c${n}`);
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(san_roll,"skill_label"),"SAN");return pyBool(__left)?pyEqual(pyAt(san_roll,"roll_kind"),"sanity_check"):__left;})())),"tests/kernel/test_sessions.py:455 assert san_roll[\"skill_label\"] == \"SAN\" and san_roll[\"roll_kind\"] == \"sanity_check\"");
blocked=(await resolve_err(client,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"x","method":"用侦查"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(blocked,"code"),"turn_state");return pyBool(__left)?pyEqual(pyAt(pyAt(blocked,"details"),"session"),"sanity_bout"):__left;})())),"tests/kernel/test_sessions.py:459 assert blocked[\"code\"] == \"turn_state\" and blocked[\"details\"][\"session\"] == \"sanity_bout\"");
another=(await resolve_err(client,`t1-c${pyAdd(n,1)}`,({"intent":"investigate","goal":"又一具尸体","method":"","decision":"sanity:check","san_loss":"0/1D6","involuntary":"cry_out"})));
assert.ok(pyBool(pyEqual(pyAt(another,"code"),"turn_state")),"tests/kernel/test_sessions.py:462 assert another[\"code\"] == \"turn_state\"");
rounds=pyAt(pyAt(session,"bout"),"rounds_remaining");
tick=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"montage","goal":"x","method":"","decision":"sanity:bout-tick"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(tick,"decision"),"sanity:bout-tick");return pyBool(__left)?pyEqual(pyAt(pyAt(tick,"outcome"),"status"),"bout_tick"):__left;})())),"tests/kernel/test_sessions.py:465 assert tick[\"decision\"] == \"sanity:bout-tick\" and tick[\"outcome\"][\"status\"] == \"bout_tick\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(tick,"outcome"),"bout_rounds_remaining"),pySubtract(rounds,1))),"tests/kernel/test_sessions.py:466 assert tick[\"outcome\"][\"bout_rounds_remaining\"] == rounds - 1");
if(pyBool(pyLess(0,pySubtract(rounds,1)))){assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(tick,"session"),"status"),"active");return pyBool(__left)?pyEqual(pyAt(pyAt(tick,"pending_choice"),"name"),`bout:${INVESTIGATOR}-r2`):__left;})())),"tests/kernel/test_sessions.py:468 assert tick[\"session\"][\"status\"] == \"active\" and tick[\"pending_choice\"][\"name\"] == f\"bout:{INVESTIGATOR}-r2\"");
end=(await resolve(client,`t1-c${pyAdd(n,2)}`,({"intent":"montage","goal":"x","method":"","decision":"sanity:bout-end"})));}else{end=tick;}
assert.ok(pyBool((await (async()=>{const __left=(pyAt(pyAt(end,"outcome"),"bout_active")===false);return pyBool(__left)?pyEqual(pyAt(pyAt(end,"session"),"status"),"ended"):__left;})())),"tests/kernel/test_sessions.py:472 assert end[\"outcome\"][\"bout_active\"] is False and end[\"session\"][\"status\"] == \"ended\"");
assert.ok(pyBool((pyAt(end,"pending_choice")===null)),"tests/kernel/test_sessions.py:473 assert end[\"pending_choice\"] is None");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(end,"receipts"))){__rows.push((await pyMethod(r,"startswith",["session:sanity_bout-end"],{})));}return __rows;})())))),"tests/kernel/test_sessions.py:474 assert any(r.startswith(\"session:sanity_bout-end\") for r in end[\"receipts\"])");
n=pyAdd(n,3);
assert.ok(pyBool((pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"session")===null)),"tests/kernel/test_sessions.py:476 assert client.table(\"look\")[\"where\"][\"session\"] is None");
situations=new Set((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})()));
assert.ok(pyBool((await (async()=>{const __left=pyContains(situations,"sanity:insane-insight");return pyBool(__left)?!pyContains(situations,"sanity:recover-temporary"):__left;})())),"tests/kernel/test_sessions.py:478 assert \"sanity:insane-insight\" in situations and \"sanity:recover-temporary\" not in situations");
early=(await resolve_err(client,`t1-c${n}`,({"intent":"montage","goal":"x","method":"","decision":"sanity:recover-temporary"})));
assert.ok(pyBool(pyContains(["needs","turn_state"],pyAt(early,"code"))),"tests/kernel/test_sessions.py:482 assert early[\"code\"] in (\"needs\", \"turn_state\")");
due=pyAt(pyAt(snapshot,"recovery_trigger"),"due_elapsed_minutes");
(await pyMethod(client,"table",["apply"],{"call_id":`t1-c${n}`,"effects":[({["kind"]:"time",["minutes"]:due})]}));
assert.ok(pyBool(pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})())),"sanity:recover-temporary")),"tests/kernel/test_sessions.py:485 assert \"sanity:recover-temporary\" in {s[\"decision\"] for s in client.table(\"look\")[\"where\"][\"situations\"]}");
recovered=(await resolve(client,`t1-c${pyAdd(n,1)}`,({"intent":"montage","goal":"x","method":"","decision":"sanity:recover-temporary"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(recovered,"decision"),"sanity:recover-temporary");return pyBool(__left)?(pyAt(pyAt(recovered,"outcome"),"recovered")===true):__left;})())),"tests/kernel/test_sessions.py:487 assert recovered[\"decision\"] == \"sanity:recover-temporary\" and recovered[\"outcome\"][\"recovered\"] is True");
assert.ok(pyBool((pyAt(pyAt(recovered,"outcome"),"temporary_insane")===false)),"tests/kernel/test_sessions.py:488 assert recovered[\"outcome\"][\"temporary_insane\"] is False");
n=pyAdd(n,2);
state=(await read_json((await save_path(client,"sanity-state",`${INVESTIGATOR}.json`))));
assert.ok(pyBool((await (async()=>{const __left=(pyAt(state,"temporary_insane")===false);return pyBool(__left)?(pyAt(state,"recovery_trigger")===null):__left;})())),"tests/kernel/test_sessions.py:491 assert state[\"temporary_insane\"] is False and state[\"recovery_trigger\"] is None");
state["active_delusion"]=({["description"]:"科比特还在你身后",["backstory_field"]:null,["resistant"]:false});
state["indefinite_insane"]=true;
(await pyMethod((await save_path(client,"sanity-state",`${INVESTIGATOR}.json`)),"write_text",[(await pyMethod(json,"dumps",[state],{"ensure_ascii":false}))],{"encoding":"utf-8"}));
assert.ok(pyBool(pyContains(new Set((await (async()=>{const __rows:any[]=[];for(const s of pyIterable(pyAt(pyAt((await pyMethod(client,"table",["look"],{})),"where"),"situations"))){__rows.push(pyAt(s,"decision"));}return __rows;})())),"sanity:reality-check")),"tests/kernel/test_sessions.py:497 assert \"sanity:reality-check\" in {s[\"decision\"] for s in client.table(\"look\")[\"where\"][\"situations\"]}");
reality=(await resolve(client,`t1-c${n}`,({"intent":"investigate","goal":"我怀疑身后根本没人","method":"","decision":"sanity:reality-check"})));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(reality,"decision"),"sanity:reality-check");return pyBool(__left)?pyEqual(pyAt(pyAt(reality,"outcome"),"kind"),"sanity"):__left;})())),"tests/kernel/test_sessions.py:500 assert reality[\"decision\"] == \"sanity:reality-check\" and reality[\"outcome\"][\"kind\"] == \"sanity\"");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(reality,"outcome"),"skill"),"SAN");return pyBool(__left)?pyEqual(pyAt(pyAt(reality,"outcome"),"target"),47):__left;})())),"tests/kernel/test_sessions.py:501 assert reality[\"outcome\"][\"skill\"] == \"SAN\" and reality[\"outcome\"][\"target\"] == 47");
assert.ok(pyBool(pyEqual(pyAt(pyAt(reality,"receipts"),0),`roll:san-t1-c${n}`)),"tests/kernel/test_sessions.py:502 assert reality[\"receipts\"][0] == f\"roll:san-t1-c{n}\"");
state=(await read_json((await save_path(client,"sanity-state",`${INVESTIGATOR}.json`))));
if(pyBool(pyAt(pyAt(reality,"outcome"),"delusion_cleared"))){assert.ok(pyBool((await (async()=>{const __left=(pyAt(state,"active_delusion")===null);return pyBool(__left)?pyEqual(pyAt(reality,"effects"),[]):__left;})())),"tests/kernel/test_sessions.py:505 assert state[\"active_delusion\"] is None and reality[\"effects\"] == []");}else{assert.ok(pyBool(pyEqual(pyAt(pyAt(reality,"effects"),0),({["kind"]:"san",["subject"]:INVESTIGATOR,["before"]:47,["after"]:46}))),"tests/kernel/test_sessions.py:507 assert reality[\"effects\"][0] == {\"kind\": \"san\", \"subject\": INVESTIGATOR, \"before\": 47, \"after\": 46}");
assert.ok(pyBool((pyAt(pyAt(reality,"outcome"),"bout_active")===true)),"tests/kernel/test_sessions.py:508 assert reality[\"outcome\"][\"bout_active\"] is True");}
n=pyAdd(n,1);
mechanics=pyAt((await narrate(client,`t1-c${n}`,"你僵在原地。\n\n它坐了起来。")),"mechanics");
san_change=(await pyNext((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(mechanics)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(m,"kind"),"change");return pyBool(__left)?pyEqual(pyAt(m,"resource"),"san"):__left;})()))){__rows.push(m);}}return __rows;})())));
assert.ok(pyBool(pyEqual(san_change,({...san_change,["subject"]:INVESTIGATOR,["subject_label"]:"托马斯·海斯",["before"]:55,["after"]:47}))),"tests/kernel/test_sessions.py:512 assert san_change == {**san_change, \"subject\": INVESTIGATOR, \"subject_label\": \"托马斯·海斯\", \"before\": 55, \"after\": 47}");
assert.ok(pyBool((await pyMethod(pyAt(san_change,"receipt"),"startswith",["delta:san-t1-c"],{}))),"tests/kernel/test_sessions.py:513 assert san_change[\"receipt\"].startswith(\"delta:san-t1-c\")");
bout=(await pyNext((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(mechanics)){if(pyBool((await (async()=>{const __left=pyEqual(pyAt(m,"kind"),"session");return pyBool(__left)?pyEqual(pyAt(m,"family"),"sanity_bout"):__left;})()))){__rows.push(m);}}return __rows;})())));
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(bout,"transition"),"start");return pyBool(__left)?pyAt(bout,"outcome"):__left;})());return pyBool(__left)?(await pyIsInstance(pyAt(bout,"rounds"),pyInt)):__left;})())),"tests/kernel/test_sessions.py:515 assert bout[\"transition\"] == \"start\" and bout[\"outcome\"] and isinstance(bout[\"rounds\"], int)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(mechanics)){__rows.push((await (async()=>{const __left=pyEqual(pyAt(m,"kind"),"roll");return pyBool(__left)?pyEqual(pyAt(m,"skill"),"SAN"):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:516 assert any(m[\"kind\"] == \"roll\" and m[\"skill\"] == \"SAN\" for m in mechanics)");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const m of pyIterable(mechanics)){__rows.push((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(m,"kind"),"dice");return pyBool(__left)?pyEqual(pyAt(m,"label"),"SAN Loss"):__left;})());return pyBool(__left)?pyEqual(pyAt(m,"expression"),"1D8"):__left;})()));}return __rows;})())))),"tests/kernel/test_sessions.py:517 assert any(m[\"kind\"] == \"dice\" and m[\"label\"] == \"SAN Loss\" and m[\"expression\"] == \"1D8\" for m in mechanics)");}finally{(await pyMethod(client,"close",[],{}));}
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sanity_check_bout_recovery_and_reality_check"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sanity_check_bout_recovery_and_reality_check(temporary);});
export async function test_sanity_check_with_an_explicit_loss_and_no_target(seeded_kernel:any){
let checked:any,outcome:any,bad:any;
(await open_turn(seeded_kernel,"我看见地上的血。"));
checked=(await resolve(seeded_kernel,"t1-c1",({"intent":"investigate","goal":"血从地板缝里渗出来","method":"","decision":"sanity:check","san_loss":"0/1D3","involuntary":"jump_in_fright"})));
outcome=pyAt(checked,"outcome");
assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"kind"),"sanity");return pyBool(__left)?pyEqual(pyAt(outcome,"target"),55):__left;})());return pyBool(__left)?pyEqual(pyAt(outcome,"san_after"),pySubtract(55,pyAt(outcome,"san_loss"))):__left;})())),"tests/kernel/test_sessions.py:527 assert outcome[\"kind\"] == \"sanity\" and outcome[\"target\"] == 55 and outcome[\"san_after\"] == 55 - outcome[\"san_loss\"]");
if(pyBool(pyAt(outcome,"passed"))){assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __left=pyEqual(pyAt(outcome,"san_loss"),0);return pyBool(__left)?pyEqual(pyAt(checked,"effects"),[]):__left;})());return pyBool(__left)?pyEqual(pyAt(checked,"receipts"),["roll:san-t1-c1"]):__left;})())),"tests/kernel/test_sessions.py:529 assert outcome[\"san_loss\"] == 0 and checked[\"effects\"] == [] and checked[\"receipts\"] == [\"roll:san-t1-c1\"]");}else{assert.ok(pyBool((await (async()=>{const __left=(await (async()=>{const __term0=1;const __term1=pyAt(outcome,"san_loss");const __term2=3;return pyCompare(__term0,__term1,"<=")&&pyCompare(__term1,__term2,"<=");})());return pyBool(__left)?pyEqual(pyAt(pyAt(pyAt(checked,"effects"),0),"kind"),"san"):__left;})())),"tests/kernel/test_sessions.py:531 assert 1 <= outcome[\"san_loss\"] <= 3 and checked[\"effects\"][0][\"kind\"] == \"san\"");
assert.ok(pyBool(pyEqual(pyAt(pyAt(outcome,"involuntary_action"),"kind"),"jump_in_fright")),"tests/kernel/test_sessions.py:532 assert outcome[\"involuntary_action\"][\"kind\"] == \"jump_in_fright\"");}
assert.ok(pyBool((pyAt(checked,"session")===null)),"tests/kernel/test_sessions.py:533 assert checked[\"session\"] is None");
bad=(await resolve_err(seeded_kernel,"t1-c2",({"intent":"investigate","goal":"x","method":"","decision":"sanity:check","san_loss":"one/two","involuntary":"freeze"})));
assert.ok(pyBool(pyEqual(pyAt(bad,"code"),"invalid_params")),"tests/kernel/test_sessions.py:536 assert bad[\"code\"] == \"invalid_params\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_sanity_check_with_an_explicit_loss_and_no_target"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_sanity_check_with_an_explicit_loss_and_no_target(await kernel(t,{env:{COC_KERNEL_SEED:'7'}}));});

export async function test_apply_move_returns_the_destination_view(kernel:any){
let moved:any,timed:any;
(await open_turn(kernel));
moved=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c1","effects":[({["kind"]:"move",["to"]:"hall-of-records"})]}));
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(moved,"where"),"scene"),"hall-of-records");return pyBool(__left)?(pyAt(pyAt(moved,"where"),"session")===null):__left;})())),"tests/kernel/test_sessions.py:544 assert moved[\"where\"][\"scene\"] == \"hall-of-records\" and moved[\"where\"][\"session\"] is None");
assert.ok(pyBool((await (async()=>{const __left=pyEqual(pyAt(pyAt(moved,"where"),"situations"),[]);return pyBool(__left)?pyContains(pyAt(moved,"where"),"exits"):__left;})())),"tests/kernel/test_sessions.py:545 assert moved[\"where\"][\"situations\"] == [] and \"exits\" in moved[\"where\"]");
assert.ok(pyBool(pyEqual(pyAt(moved,"present"),pyAt((await pyMethod(kernel,"table",["look"],{})),"present"))),"tests/kernel/test_sessions.py:546 assert moved[\"present\"] == kernel.table(\"look\")[\"present\"]");
assert.ok(pyBool(pyEqual(pyAt(moved,"where"),pyAt((await pyMethod(kernel,"table",["look"],{})),"where"))),"tests/kernel/test_sessions.py:547 assert moved[\"where\"] == kernel.table(\"look\")[\"where\"]");
timed=(await pyMethod(kernel,"table",["apply"],{"call_id":"t1-c2","effects":[({["kind"]:"time",["minutes"]:5})]}));
assert.ok(pyBool(!pyContains(timed,"where")),"tests/kernel/test_sessions.py:549 assert \"where\" not in timed");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_apply_move_returns_the_destination_view"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_apply_move_returns_the_destination_view(await kernel(t,{}));});

export async function test_mechanics_projection_is_language_neutral_and_the_check_skips_keeper_rolls(){
let receipts:any;





async function roll(skill:any,round_no:any,roll_value:any=40,target:any=50,actor_label:any=null,visibility:any="public",investigator:any=true){
let receipt:any;
receipt=({["id"]:`roll:${(await pyMethod(skill,"lower",[],{}))}-t1-c${round_no}`,["kind"]:"roll",["actor"]:"x",["skill"]:skill,["skill_label"]:skill,["target"]:target,["difficulty"]:"regular",["threshold"]:target,["roll"]:roll_value,["passed"]:pyLessEqual(roll_value,target),["round"]:round_no,["session_kind"]:"combat",["visibility"]:visibility,["actor_is_investigator"]:investigator});
if(pyBool(actor_label)){receipt["actor_label"]=actor_label;}
return receipt;
}
receipts=[({["id"]:"session:combat-start-t1-c1",["kind"]:"session",["family"]:"combat",["transition"]:"start"}),(await roll("Handgun",1)),(await roll("Dodge",1,undefined,undefined,"Walter Corbitt",undefined,false)),({["id"]:"delta:hp-t1-c1",["kind"]:"delta",["resource"]:"hp",["subject"]:"walter-corbitt",["subject_label"]:"Walter Corbitt",["subject_is_investigator"]:false,["before"]:16,["after"]:15}),(await roll("Psychology",2,undefined,undefined,undefined,"keeper",undefined)),({["id"]:"session:sanity_bout-start-t1-c3",["kind"]:"session",["family"]:"sanity_bout",["transition"]:"start",["outcome"]:"Faint",["rounds"]:3,["summary"]:"Faint (3 rounds)"}),({["id"]:"session:chase-end-t1-c4",["kind"]:"session",["family"]:"chase",["transition"]:"end",["outcome"]:"escaped"})];
assert.deepEqual((await mechanics(receipts)),[({["kind"]:"session",["receipt"]:"session:combat-start-t1-c1",["family"]:"combat",["transition"]:"start"}),({["kind"]:"roll",["receipt"]:"roll:handgun-t1-c1",["actor"]:"x",["actor_is_investigator"]:true,["skill"]:"Handgun",["roll"]:40,["target"]:50,["threshold"]:50,["difficulty"]:"regular",["level"]:null,["passed"]:true,["pushed"]:false,["bonus"]:0,["penalty"]:0,["visibility"]:"public"}),({["kind"]:"roll",["receipt"]:"roll:dodge-t1-c1",["actor_is_investigator"]:false,["skill"]:"Dodge",["roll"]:40,["target"]:50,["threshold"]:50,["difficulty"]:"regular",["level"]:null,["passed"]:true,["pushed"]:false,["bonus"]:0,["penalty"]:0,["visibility"]:"public"}),({["kind"]:"change",["receipt"]:"delta:hp-t1-c1",["resource"]:"hp",["subject_is_investigator"]:false,["before"]:16,["after"]:15}),({["kind"]:"roll",["receipt"]:"roll:psychology-t1-c2",["actor"]:"x",["actor_is_investigator"]:true,["skill"]:"Psychology",["roll"]:40,["target"]:50,["threshold"]:50,["difficulty"]:"regular",["level"]:null,["passed"]:true,["pushed"]:false,["bonus"]:0,["penalty"]:0,["visibility"]:"keeper"}),({["kind"]:"session",["receipt"]:"session:sanity_bout-start-t1-c3",["family"]:"sanity_bout",["transition"]:"start",["rounds"]:3,["outcome"]:"Faint"}),({["kind"]:"session",["receipt"]:"session:chase-end-t1-c4",["family"]:"chase",["transition"]:"end",["outcome"]:"escaped"})],"tests/kernel/test_sessions.py:578 assert mechanics(receipts) == [\n        {\"kind\": \"session\", \"receipt\": \"session:combat-start-t1-c1\", \"family\": \"combat\", \"transition\": \"start\"},\n        {\"kind\": \"roll\", \"receipt\": \"roll:handgun-t1-c1\", \"actor\": \"x\", \"actor_is_investigator\": True, \"skill\": \"Handgun\", \"roll\": 40, \"target\": 50,\n         \"threshold\": 50, \"difficulty\": \"regular\", \"level\": None, \"passed\": True, \"pushed\": False, \"visibility\": \"public\"},\n        {\"kind\": \"roll\", \"receipt\": \"roll:dodge-t1-c1\", \"actor_is_investigator\": False, \"skill\": \"Dodge\", \"roll\": 40, \"target\": 50,\n         \"threshold\": 50, \"difficulty\": \"regular\", \"level\": None, \"passed\": True, \"pushed\": False, \"visibility\": \"public\"},\n        {\"kind\": \"change\", \"receipt\": \"delta:hp-t1-c1\", \"resource\": \"hp\", \"subject_is_investigator\": False, \"before\": 16,\n         \"after\": 15},\n        {\"kind\": \"roll\", \"receipt\": \"roll:psychology-t1-c2\", \"actor\": \"x\", \"actor_is_investigator\": True, \"skill\": \"Psychology\", \"roll\": 40, \"target\": 50,\n         \"threshold\": 50, \"difficulty\": \"regular\", \"level\": None, \"passed\": True, \"pushed\": False, \"visibility\": \"keeper\"},\n        {\"kind\": \"session\", \"receipt\": \"session:sanity_bout-start-t1-c3\", \"family\": \"sanity_bout\", \"transition\": \"start\",\n         \"rounds\": 3, \"outcome\": \"Faint\"},\n        {\"kind\": \"session\", \"receipt\": \"session:chase-end-t1-c4\", \"family\": \"chase\", \"transition\": \"end\", \"outcome\": \"escaped\"},\n    ]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_mechanics_projection_is_language_neutral_and_the_check_skips_keeper_rolls"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_mechanics_projection_is_language_neutral_and_the_check_skips_keeper_rolls();});
export async function test_chase_end_reads_the_schema_vocabulary_from_the_quarry_side(){
let raised:any;



assert.ok(pyBool(pyEqual((await chase_end_word(null,null,({"quarry_is_investigator":true}))),"concluded")),"tests/kernel/test_sessions.py:599 assert chase_end_word(None, None, quarry_is_investigator=True) == \"concluded\"");
assert.ok(pyBool(pyEqual((await chase_end_word("fled","captured",({"quarry_is_investigator":true}))),"captured")),"tests/kernel/test_sessions.py:600 assert chase_end_word(\"fled\", \"captured\", quarry_is_investigator=True) == \"captured\"");
assert.ok(pyBool(pyEqual((await chase_end_word("fled",null,({"quarry_is_investigator":true}))),"escaped")),"tests/kernel/test_sessions.py:601 assert chase_end_word(\"fled\", None, quarry_is_investigator=True) == \"escaped\"");
assert.ok(pyBool(pyEqual((await chase_end_word("investigators_win",null,({"quarry_is_investigator":true}))),"escaped")),"tests/kernel/test_sessions.py:602 assert chase_end_word(\"investigators_win\", None, quarry_is_investigator=True) == \"escaped\"");
assert.ok(pyBool(pyEqual((await chase_end_word("monsters_win",null,({"quarry_is_investigator":true}))),"captured")),"tests/kernel/test_sessions.py:603 assert chase_end_word(\"monsters_win\", None, quarry_is_investigator=True) == \"captured\"");
assert.ok(pyBool(pyEqual((await chase_end_word("investigators_win",null,({"quarry_is_investigator":false}))),"captured")),"tests/kernel/test_sessions.py:604 assert chase_end_word(\"investigators_win\", None, quarry_is_investigator=False) == \"captured\"");
assert.ok(pyBool(pyEqual((await chase_end_word("monsters_win",null,({"quarry_is_investigator":false}))),"escaped")),"tests/kernel/test_sessions.py:605 assert chase_end_word(\"monsters_win\", None, quarry_is_investigator=False) == \"escaped\"");
assert.ok(pyBool(pyEqual((await chase_end_word("stalemate",null,({"quarry_is_investigator":false}))),"concluded")),"tests/kernel/test_sessions.py:606 assert chase_end_word(\"stalemate\", None, quarry_is_investigator=False) == \"concluded\"");
assert.ok(pyBool(pyEqual((await chase_end_word("captured",null,({"quarry_is_investigator":true}))),"captured")),"tests/kernel/test_sessions.py:607 assert chase_end_word(\"captured\", None, quarry_is_investigator=True) == \"captured\"");
assert.throws(()=>chase_end_word("victory",null,{quarry_is_investigator:true}),(error:any)=>{assert.ok(error instanceof RpcError);raised={value:error};return true;});
assert.ok(pyBool(pyEqual(raised.value.code,"invalid_params")),"tests/kernel/test_sessions.py:610 assert raised.value.code == \"invalid_params\"");
assert.ok(pyBool((await (async()=>{const __left=pyContains(pyAt(raised.value.details,"options"),"fled");return pyBool(__left)?pyContains(pyAt(raised.value.details,"options"),"escaped"):__left;})())),"tests/kernel/test_sessions.py:611 assert \"fled\" in raised.value.details[\"options\"] and \"escaped\" in raised.value.details[\"options\"]");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_chase_end_reads_the_schema_vocabulary_from_the_quarry_side"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_chase_end_reads_the_schema_vocabulary_from_the_quarry_side();});
export async function test_maneuver_and_nonresisting_attack_have_receipts(kernel:any){
let n:any,result:any,follow:any;
(await open_turn(kernel));
n=(await walk_to_confrontation(kernel));
result=(await resolve(kernel,`t1-c${n}`,({"intent":"combat","decision":"combat:maneuver","goal":"disarm","method":"grip the wrist","target":"Walter Corbitt","weapon":"unarmed"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"combat:maneuver")),"tests/kernel/test_sessions.py:619 assert result[\"decision\"] == \"combat:maneuver\"");
assert.ok(pyBool(pyAt(result,"receipts")),"tests/kernel/test_sessions.py:620 assert result[\"receipts\"]");
follow=(await resolve(kernel,`t1-c${pyAdd(n,1)}`,({"intent":"combat","actor":"Walter Corbitt","goal":"claw the investigator","method":"claws","target":"Thomas Hayes","weapon":"claws"})));
assert.ok(pyBool(pyEqual(pyAt(pyAt(follow,"outcome"),"status"),"pending_defense")),"tests/kernel/test_sessions.py:623 assert follow[\"outcome\"][\"status\"] == \"pending_defense\"");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_maneuver_and_nonresisting_attack_have_receipts"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_maneuver_and_nonresisting_attack_have_receipts(await kernel(t,{}));});
export async function test_nonresisting_target_settles_in_one_attack(kernel:any){
let n:any,result:any;
(await open_turn(kernel));
n=(await walk_to_confrontation(kernel));
result=(await resolve(kernel,`t1-c${n}`,({"intent":"combat","goal":"strike the inert body","method":"shoot","target":"Walter Corbitt","weapon":".38 Revolver","defense":"none"})));
assert.ok(pyBool(pyEqual(pyAt(result,"decision"),"combat:attack")),"tests/kernel/test_sessions.py:631 assert result[\"decision\"] == \"combat:attack\"");
assert.ok(pyBool(((await pyMethod(result,"get",["pending_choice"],{}))===null)),"tests/kernel/test_sessions.py:632 assert result.get(\"pending_choice\") is None");
assert.ok(pyBool((await pyAny((await (async()=>{const __rows:any[]=[];for(const r of pyIterable(pyAt(result,"receipts"))){__rows.push((await pyMethod(r,"startswith",["roll:"],{})));}return __rows;})())))),"tests/kernel/test_sessions.py:633 assert any(r.startswith(\"roll:\") for r in result[\"receipts\"])");
}
if(process.argv[1]===import.meta.filename)for(const [index,row] of ([{}]).entries())test("test_nonresisting_target_settles_in_one_attack"+(([{}]).length>1?' ['+index+']':''),async(t)=>{const temporary=temporaryPath(t);await test_nonresisting_target_settles_in_one_attack(await kernel(t,{}));});
