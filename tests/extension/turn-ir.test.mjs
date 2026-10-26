/** §270: Turn IR translation seams; deterministic, not live gameplay evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Errors} from 'typebox/value';
import {TURN_IR_PARAMETERS,TurnIrError,toPacket,segments,applyConditions,ruleAction} from '../../runtime/turn-ir.ts';
import {compileTurnPacket} from '../../runtime/turn-packet-prototype.ts';

const table={
 '欧文·塔布勒':{ref:'npc_3'},'周衡':{investigator:'investigator_1',name:'周衡'},'警员':{ambiguous:['npc_4','npc_5']},'尼克尔森':{ref:'npc_2'}
};
const directory={person:name=>table[name]};
const ir=actions=>({version:5,actions});
const packet=(actions,aliases=new Map())=>toPacket(actions,directory,aliases);
const refusal=(actions,pattern)=>assert.throws(()=>packet(actions),error=>error instanceof TurnIrError&&pattern.test(error.message));

test('the schema takes the eight families and nothing else',()=>{
 assert.equal(Errors(TURN_IR_PARAMETERS,ir([{op:'move',to:'马丁滩'}])).length,0);
 assert.ok(Errors(TURN_IR_PARAMETERS,ir([{op:'walk_on',slot:'new_1'}])).length,'a v4 command is not an action');
 assert.ok(Errors(TURN_IR_PARAMETERS,{version:4,actions:[{op:'move',to:'x'}]}).length);
});

test('a person enters by name: someone at the table moves here, a book name or newcomer is seated under its own word',()=>{
 const aliases=new Map();
 const out=packet([
  {op:'presence',who:'尼克尔森',action:'enter',reason:'他推门进来'},
  {op:'presence',who:'欧文·塔布勒',action:'enter',reason:'书里的警官在办公室'},
  {op:'presence',who:'@clerk',action:'enter',as:'售票员',reason:'窗口后的职员'},
  {op:'communicate',speaker:'@clerk',to:['周衡'],act:'answer',says:[{claim:'末班车已经开走了'}]}
 ].map((action,i)=>i===1?{...action,who:'塔布勒'}:action),aliases);
 assert.deepEqual(out.commands,[{kind:'npc',actor:'npc_2',to:'here',reason:'他推门进来'},
  {kind:'walk_on',slot:'new_1',label:'塔布勒',reason:'书里的警官在办公室'},{kind:'walk_on',slot:'new_2',label:'售票员',reason:'窗口后的职员'}]);
 assert.deepEqual(out.interactions,[{actor:'new_2',to:['investigator_1'],act:'answer',content:[{new:{predicate:'meaning',meaning:'末班车已经开走了'}}]}]);
 assert.equal(aliases.get('@clerk'),'new_2','the alias keeps its slot for later segments');
});

test('a name is looked up, never guessed: an ambiguous name is refused with its candidates, a mention is no entrance',()=>{
 assert.throws(()=>packet([{op:'communicate',speaker:'警员',to:['周衡'],act:'greet'}]),
  error=>error instanceof TurnIrError&&error.details.candidates.join()==='npc_4,npc_5');
 refusal([{op:'communicate',speaker:'陌生人',to:['周衡'],act:'answer',channel:'phone',says:[{claim:'我在码头'}]}],/presence enter first/);
 refusal([{op:'communicate',speaker:'@nobody',to:['周衡'],act:'greet'}],/no earlier presence enter/);
});

test('what is said routes by its reference; claims and knowledge need no constructor choice',()=>{
 const out=packet([{op:'communicate',speaker:'欧文·塔布勒',to:['周衡'],act:'answer',channel:'phone',delivery:'guarded',
  says:['fact_2','source_4','exhibit_1',{knowledge:'withheld'},{claim:'上周就听说了'}]}]);
 assert.deepEqual(out.interactions[0],{actor:'npc_3',to:['investigator_1'],act:'answer',channel:'phone',delivery:'guarded',content:[
  {fact_ref:'fact_2'},{source_ref:'source_4'},{exhibit_ref:'exhibit_1'},{new:{predicate:'knowledge_status',topic:'player_input',status:'withheld'}},
  {new:{predicate:'meaning',meaning:'上周就听说了'}}]});
 assert.equal(packet([{op:'communicate',speaker:'周衡',to:['欧文·塔布勒'],act:'answer',says:['fact_1']}]).interactions,undefined,'an investigator\'s words are the player\'s');
});

test('a perception routes a reference to reveal, a clue to a clue command, a sentence to an observation',()=>{
 const out=packet([{op:'perceive',what:['source_3',{clue:'墓园脚印',how:'蹲下细看泥地'},{observe:'铁栅栏上有新刮痕'}]}]);
 assert.deepEqual(out.reveal,[{source_ref:'source_3'}]);
 assert.deepEqual(out.commands,[{kind:'clue',clue:'墓园脚印',how:'蹲下细看泥地'},{kind:'place',action:'observe',facts:['铁栅栏上有新刮痕']}]);
});

test('a paper shown read in full, then handed over, settles as object effects in the route order with investigators by name',()=>{
 const out=packet([
  {op:'move',to:'治安官办公室',inside:'马丁滩',actors:['周衡']},
  {op:'material',action:'show',item:'公函',holder:'周衡',to:'欧文·塔布勒',access:'read_full',reason:'当面读'},
  {op:'material',action:'transfer',item:'公函',holder:'周衡',to:'欧文·塔布勒',reason:'收下'}]);
 const effects=compileTurnPacket(out).effects;
 assert.deepEqual(effects[0],{kind:'place',action:'move',to:'治安官办公室',additions:[{name:'治安官办公室',within:'马丁滩'}]});
 assert.deepEqual(effects.slice(1),[
  {kind:'object',name:'公函',from:'周衡',to:'周衡',document:{action:'show',reader:'npc_3',read:true},why:'当面读'},
  {kind:'object',name:'公函',from:'周衡',to:'npc_3',handover:'given',why:'收下'}]);
});

test('rule actions split the list; a conditioned action survives only the result it names',()=>{
 const actions=[{op:'move',to:'书房'},{op:'rule',as:'r1',skill:'Spot Hidden',goal:'找到暗格',stakes:'翻动声惊动管家'},
  {op:'perceive',what:[{clue:'暗格里的信',how:'敲击抽屉底板'}],when:{check:'r1',passed:true}},
  {op:'presence',who:'@butler',action:'enter',as:'管家',reason:'听见声响上楼',when:{check:'r1',passed:false}}];
 const parts=segments(ir(actions));
 assert.deepEqual(parts.map(part=>part.map(action=>action.op)),[['move','rule'],['perceive','presence']]);
 const failed=applyConditions(parts[1],new Map([['r1',false]]),2);
 assert.deepEqual([failed.kept.map(action=>action.op),failed.dropped],[['presence'],[2]]);
 assert.throws(()=>applyConditions(parts[1],new Map(),2),/no earlier rule action/);
 assert.deepEqual(ruleAction(actions[1],name=>name),{intent:'investigate',goal:'找到暗格',method:'找到暗格',skill:'Spot Hidden',stakes:'翻动声惊动管家'});
});

test('fields of another op are dropped and reported; a wrong field is named by action, op and path',async()=>{
 const {normalizeTurnIr,diagnoseTurnIr}=await import('../../runtime/turn-ir.ts');
 const {value,dropped}=normalizeTurnIr({version:5,actions:[{op:'move',to:'here',at:'by the window',additions:[{name:'x'}]},{op:'communicate',speaker:'a',to:['b'],act:'greet',reason:'hello',channel:'in_person'}]});
 assert.deepEqual(value.actions[0],{op:'move',to:'here',spot:'by the window'});
 assert.deepEqual(dropped,[{index:0,fields:['additions']}]);
 assert.equal(value.actions[1].reason,'hello');
 const findings=diagnoseTurnIr({version:5,actions:[{op:'material',action:'show',item:'letter',holder:'a'},{op:'fly'}]});
 assert.match(findings[0],/^actions\[0\] \(material\)/);assert.match(findings.join('\n'),/reason/);
 assert.match(findings.at(-1),/actions\[1\]\.op must be one of move/);
});

test('a reference written as an object is the reference; a plain show writes nothing',async()=>{
 const {normalizeTurnIr}=await import('../../runtime/turn-ir.ts');
 const {value}=normalizeTurnIr({version:5,actions:[{op:'communicate',speaker:'x',to:['y'],act:'answer',says:[{fact_5:'the cart'},{fact_ref:'fact_2'},{claim:'no'}]},{op:'perceive',what:[{source_3:{}}]}]});
 assert.deepEqual(value.actions[0].says,['fact_5','fact_2',{claim:'no'}]);assert.deepEqual(value.actions[1].what,['source_3']);
 const out=packet([{op:'material',action:'show',item:'passport',holder:'周衡',to:'欧文·塔布勒',reason:'he holds it up'}]);
 assert.equal(out.commands,undefined);
});

test('a long answer splits into consecutive interactions; a textual duration is whole minutes',async()=>{
 const {normalizeTurnIr}=await import('../../runtime/turn-ir.ts');
 const says=Array.from({length:10},(_,i)=>`fact_${i+1}`);
 const out=packet([{op:'communicate',speaker:'欧文·塔布勒',to:['周衡'],act:'answer',says,beat:'翻开簿子'}]);
 assert.deepEqual(out.interactions.map(row=>[row.content.length,row.beat??null]),[[8,'翻开簿子'],[2,null]]);
 const {value}=normalizeTurnIr({version:5,actions:[{op:'time',minutes:'5',reason:'wait'},{op:'time',minutes:0.4,band:'brief',reason:'x'}]});
 assert.equal(value.actions[0].minutes,5);assert.equal(value.actions[1].minutes,undefined);
});

test('a knowledge item one level too deep is flattened; a topic in words is what was just asked',async()=>{
 const {normalizeTurnIr}=await import('../../runtime/turn-ir.ts');
 const {value}=normalizeTurnIr({version:5,actions:[{op:'communicate',speaker:'欧文·塔布勒',to:['周衡'],act:'answer',says:[{knowledge:{knowledge:'withheld',topic:'the well'}}]}]});
 assert.deepEqual(value.actions[0].says,[{knowledge:'withheld',topic:'the well'}]);
 const out=packet(value.actions);
 assert.deepEqual(out.interactions[0].content,[{new:{predicate:'knowledge_status',topic:'player_input',status:'withheld'}}]);
});

test('a word carrying one issued person\'s whole name binds them; an investigator\'s relationship records nothing',async()=>{
 const {NpcReferences}=await import('../../runtime/npc-references.ts');
 const refs=new NpcReferences();refs.observe('s',{present:[{ref:'npc_1',display_name:'约翰·格林'},{ref:'npc_2',display_name:'格林夫人'}]});
 assert.deepEqual(refs.lookup('s','约翰·格林中士'),['npc_1']);assert.deepEqual(refs.lookup('s','中士'),[]);
 const out=packet([{op:'relationship',who:'周衡',toward:'欧文·塔布勒',disposition:'friendly'}]);
 assert.equal(out.commands,undefined);
});

test('a move of people only sends them, not the party',()=>{
 const out=packet([{op:'move',to:'镇上',actors:['欧文·塔布勒']}]);
 assert.deepEqual(out.commands,[{kind:'npc',actor:'npc_3',to:'镇上',reason:'goes to 镇上'}]);
 const party=packet([{op:'move',to:'镇上',actors:['周衡','欧文·塔布勒']}]);
 assert.deepEqual(party.commands,[{kind:'place',action:'move',to:'镇上',with:['npc_3']}]);
});

test('lists written inside {item} wrappers are the lists themselves',async()=>{
 const {normalizeTurnIr}=await import('../../runtime/turn-ir.ts');
 const {value}=normalizeTurnIr({version:5,actions:{item:[{op:'communicate',speaker:'a',to:{item:'b'},act:'answer',says:{item:[{item:'fact_2'},{claim:'no'}]}}]}});
 assert.deepEqual(value.actions[0].to,['b']);assert.deepEqual(value.actions[0].says,['fact_2',{claim:'no'}]);
});

test('a move to a new place defines it',()=>{
 const out=packet([{op:'move',to:'阿卡姆教堂公墓',new:true,description:'The churchyard behind the chapel.'}]);
 assert.deepEqual(out.commands[0].additions,[{name:'阿卡姆教堂公墓',description:'The churchyard behind the chapel.'}]);
});

test('player_fights_back on an attack becomes the declared fight_back the host settles (owner 2026-10-26)',()=>{
 const rule={op:'rule',as:'r1',intent:'combat',decision:'combat:attack',actor:'Hill',target:'Zhou',goal:'Drive him off',stakes:'He keeps the axe',player_fights_back:true};
 assert.equal([...Errors(TURN_IR_PARAMETERS,{version:5,actions:[rule]})].length,0);
 assert.equal(ruleAction(rule,name=>name).defense,'fight_back');
 assert.equal(ruleAction({...rule,player_fights_back:undefined},name=>name).defense,undefined);
});
