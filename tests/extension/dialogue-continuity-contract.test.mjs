import test from 'node:test';
import assert from 'node:assert/strict';
import {DecisionContent,decisionPerson} from '../../runtime/decision-content.ts';
import {turnPacket} from '../../runtime/turn-packet-prototype.ts';
import {decisionDialogueContinuity} from '../../runtime/public-exchanges.ts';
import {importSource} from '../integration/support.ts';

test('a confirmation expresses continuity of an issued report without turning its old wording into a fresh claim',()=>{
 const owner=new DecisionContent();
 const catalog=owner.prepare('c:2',{where:{scene:'Shop'},present:[{ref:'npc_1',display_name:'Clerk',
  commitments:[{statement:'Collect tomorrow at noon. No extra fee.',turn:1,authority:'conversation_report'}]}]},[],[],['Visitor']);
 const ref=catalog.facts[0].ref;
 const packet=turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'confirm',content:[{fact_ref:ref}]}]}));
 const response=owner.hydrate(packet.interactions).responses[0];
 assert.equal(response.claims[0].kind,'confirmation');
 assert.equal(response.claims[0].value.unchanged,true);
 assert.equal(response.claims[0].value.basis.value.statement,'Collect tomorrow at noon. No extra fee.');
 assert.throws(()=>turnPacket(JSON.stringify({version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'confirm',content:[{new:{predicate:'knowledge_status',topic:'Shop',status:'unknown'}}]}]})));
 assert.throws(()=>owner.hydrate([{actor:'npc_2',to:['investigator_1'],act:'confirm',content:[{fact_ref:ref}]}]),/another actor/);
});

test('public appearance survives every author projection while private biography does not',()=>{
 const person=decisionPerson({ref:'npc_1',display_name:'Clerk',public_appearance:'A young man with two pencils pinned to his apron.',
  properties:{biography:'PRIVATE_ORIGIN',appearance:'PRIVATE_UNPROJECTED'},last_public_rendering:{turn:1,scene:'Shop',text:'The clerk nods. He sets down the cup.'}},[]);
 assert.equal(person.public_appearance,'A young man with two pencils pinned to his apron.');
 assert.ok(!JSON.stringify(person).includes('PRIVATE'));
 const history=decisionDialogueContinuity([],[person]);
 assert.equal(history[0]?.portrayal?.text,'The clerk nods. He sets down the cup.');
});

test('the kernel reuses only a committed stationary single-speaker public portrayal in the same scene',async()=>{
 const {npcPublicRendering}=await importSource('kernel-ts/npc/perspective.ts');
 assert.equal(typeof npcPublicRendering,'function');
 const graph={handle:()=> 'Clerk',find:()=>null};const node={};
 const base={turn:3,commit:'c',rendered_text:'The clerk nods. Welcome. He sets down the cup.',marked_text:'The clerk nods. {{say:Clerk}}Welcome.{{/say}} He sets down the cup.',world:{active_scene:'Shop'},receipts:[],speech:[{who:{npc:'Clerk',name:'Clerk',shown:'Clerk'},text:'Welcome.'}]};
 assert.equal(npcPublicRendering(graph,node,[base],{scene:'Shop'}).text,'The clerk nods.  He sets down the cup.');
 for(const changed of [{commit:null},{marked_text:'Unverifiable text'},{closed_how:'stranded'},{interaction_scope:'reference'},{turn:8},{world:{active_scene:'Elsewhere'}},{receipts:[{kind:'move'}]},
  {speech:[...base.speech,{who:{npc:'Other'},text:'Goodbye.'}]},{worldline:'other'}])
  assert.equal(npcPublicRendering(graph,node,[{...base,...changed}],{scene:'Shop',worldline:'current',turn:5}),null);
});

test('the actual NPC read and direct author task preserve portrayal without promoting it into selected speech',async t=>{
 const {readFile,mkdtemp,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {ModuleGraph}=await importSource('kernel-ts/read/module-graph.ts');
 const {npcView}=await importSource('kernel-ts/read/capsule.ts');
 const {writeIsolatedExpression}=await import('../../runtime/isolated-expression.ts');
 const raw=JSON.parse(await readFile('content/starters/the-haunting/module-graph.json','utf8'));
 const contract=JSON.parse(await readFile('content/modules/module-graph-contract-v3.json','utf8'));
 const graph=new ModuleGraph('the-haunting',raw,'',contract.actor_dossier);
 const node=graph.kind('npc')[0];node.properties.appearance='A young man with two pencils pinned to his apron.';
 const handle=graph.handle(node),scene='Shop';
 const record={turn:1,commit:'c',world:{scene:{name:scene}},rendered_text:'The clerk nods. He sets down the cup. Collect tomorrow.',marked_text:'The clerk nods. He sets down the cup. {{say:Clerk}}Collect tomorrow.{{/say}}',receipts:[],speech:[{who:{npc:handle,name:'Clerk'},text:'Collect tomorrow.'}]};
 const view=npcView(graph,{npc_presence:{[handle]:scene}},node,{}, {},[record],[],{turn:2});
 assert.equal(view.public_appearance,node.properties.appearance);
 assert.equal(view.last_public_rendering.text,'The clerk nods. He sets down the cup.');
 const person=decisionPerson({...view,ref:'npc_1',display_name:'Clerk'},[]);
 const home=await mkdtemp(join(tmpdir(),'dialogue-contract-'));t.after(()=>rm(home,{recursive:true,force:true}));let packet;
 const runtime={home,async runTask(value){packet=JSON.parse(value.request.brief);value.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'The clerk nods. Nothing has changed.'}]}});return{ok:true,ms:1};}};
 await writeIsolatedExpression({runtime,campaign:'c',turn:2,run:'r',language:'en',investigatorNames:['Visitor'],
  decision:{scene:{name:scene},clock:{},people:[person],responses:[{actor:'npc_1',to:['investigator_1'],act:'greet'}],recent_public:[]},stream:{push(){}},record:async()=>{}});
 assert.equal(packet.decision_context.people[0].last_public_rendering,undefined);
 assert.equal(packet.decision_context.people[0].public_appearance,node.properties.appearance);
 assert.equal(packet.decision_context.recent_public[0].portrayal.text,'The clerk nods. He sets down the cup.');
 assert.equal(packet.decision_context.responses[0].claims,undefined);
});

test('selected prior public words reach the actual author as optional history rather than mandatory fresh claims',async t=>{
 const {writeIsolatedExpression}=await import('../../runtime/isolated-expression.ts');const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');const home=await mkdtemp(join(tmpdir(),'selected-history-'));t.after(()=>rm(home,{recursive:true,force:true}));let task;
 const old={ref:'fact_1',actor:'npc_1',kind:'recent_speech',value:{statement:'The doctor lives north. I cannot promise he is home.',turn:1,authority:'conversation_report',attribution:{kind:'speech',speaker:{kind:'npc',name:'OLD_PRIVATE_LABEL'}}}};
 const fresh={kind:'proposed_claim',value:{predicate:'knowledge_status',topic:'npc_2',status:'uncertain'}};
 const runtime={home,async runTask(value){task=JSON.parse(value.request.brief);value.request.onEvent({type:'message_end',message:{role:'assistant',provider:'opencode-go',model:'deepseek-v4.1-flash',stopReason:'stop',content:[{type:'text',text:'The address is still the one I know.'}]}});return{ok:true,ms:1};}};
 await writeIsolatedExpression({runtime,campaign:'c',turn:3,run:'r',language:'en',playerText:'Is that address still a useful lead?',
  decision:{scene:{name:'Cafe'},clock:{},people:[{ref:'npc_1',display_name:'Waitress'}],responses:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{fact_ref:'fact_1'},{new:fresh.value}],claims:[old,fresh]}],
   recent_public:[{turn:1,player:'Where does he live?',keeper:'',speech:[{speaker:'Waitress',text:old.value.statement}]}]},stream:{push(){}},record:async()=>{}});
 assert.deepEqual(task.decision_context.responses[0].claims,[fresh]);
 assert.equal(task.decision_context.responses[0].act,'answer');
 assert.equal(task.decision_context.recent_public[0].keeper,'Waitress: '+old.value.statement);
 assert.equal(task.decision_context.recent_public.length,1);
 assert.ok(!JSON.stringify(task).includes('OLD_PRIVATE_LABEL'));
});
