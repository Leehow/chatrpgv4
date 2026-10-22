/**
 * Contract §257.C: revealing an exhibit at the native turn seam (ticket 03).
 *
 * A real kernel plays The Haunting at Knott's office with exhibits written into its published graph (the library copy,
 * resealed the way a stored generation is); the controlled Keeper selects `reveal:[{exhibit_ref}]`; the real settlement and
 * the real author task are read back. Nothing here asserts model wording.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fauxAssistantMessage,fauxToolCall as rawToolCall} from '@earendil-works/pi-ai';
import {Errors} from 'typebox/value';
import {DecisionContent,ExhibitRefusal} from '../../runtime/decision-content.ts';
import {turnPacketParameterSchema,TURN_PACKET_GUIDANCE} from '../../runtime/turn-packet-prototype.ts';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {openTable} from './harness.mjs';
import {RpcClient,ROOT} from '../integration/support.ts';

const env={PI_COC_LOOP_ENGINE:'hybrid-v1',PI_COC_TURN_PACKET_PROTOTYPE:'1',PI_COC_JEV_PRESELECT:'0',PI_COC_MATERIAL_SCREEN:'0',
  EXT_JEV_APIKEY:undefined,TYPESAFE_API_KEY:undefined,
  PI_COC_READER_CMD:JSON.stringify([process.execPath,join(import.meta.dirname,'fixtures/isolated-expression-writer.mjs')])};
const REFS=[{source_id:'pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting',pdf_index:446}];
const surface=(text,verbatim=false)=>({text,language:'en',verbatim});
const exhibit=(exhibit_id,kind,carrier,channel,extra={})=>({exhibit_id,kind,carrier,channel,label:`LABEL ${exhibit_id}`,keeper_note:`KEEPER_NOTE ${exhibit_id}`,
  surface:surface(`SURFACE ${exhibit_id}`),source_refs:REFS,...extra});
const OFFICE='scene-commission-briefing',KNOTT='npc-steven-knott',LETTER='handout-the-haunting-handout-1-knott-commission';
/** The exhibits of the fixture, in graph order. Refs are issued scene first, then people, then handouts. */
const EXHIBITS=()=>[
  exhibit('exhibit-office-sight','description',OFFICE,'sight'),
  exhibit('exhibit-knott-look','appearance',KNOTT,'sight'),
  exhibit('exhibit-knott-voice','voice',KNOTT,'speech',{owners:[KNOTT]}),
  exhibit('exhibit-knott-says','testimony',KNOTT,'speech',{owners:[KNOTT],stance:'lie',teaches:['clue-knott-commission']}),
  exhibit('exhibit-drawer','perception',OFFICE,'sight',{teaches:['clue-knott-keys'],surface:surface('A key ring lies in the open drawer.')}),
  exhibit('exhibit-desk-tap','perception',OFFICE,'sound',{surface:surface('{{who:npc-steven-knott}} taps the desk twice.')}),
  exhibit('exhibit-commission','document',LETTER,'text',{teaches:['clue-knott-commission'],surface:surface('Twenty dollars a day, signed {{who:npc-steven-knott}}.',true)}),
  exhibit('exhibit-knott-badge','perception',KNOTT,'sight',{surface:surface('A tin badge is pinned to {{who:npc-steven-knott}} lapel.')}),
  exhibit('exhibit-basement-smell','perception','scene-basement-rites','smell'),
  exhibit('exhibit-raid-record','document','handout-the-haunting-handout-8-chapel-police-raid','text',{teaches:['clue-police-raid-chapel']}),
];
/** A content root whose Haunting starter graph carries the exhibits (the bundled bytes stay untouched). */
function contentWith(t,exhibits){
  const root=mkdtempSync(join(tmpdir(),'exhibit-content-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  cpSync(join(ROOT,'content'),root,{recursive:true});
  const file=join(root,'starters/the-haunting/module-graph.json'),graph=JSON.parse(readFileSync(file,'utf8'));
  // The book finds the keys by a check, so the drawer is a checked disclosure; the other clue has none.
  const keys=graph.nodes.find(node=>node.node_id==='clue-knott-keys');
  keys.properties={...keys.properties,delivery_kind:'skill_check',skill:'Spot Hidden',difficulty:'regular'};
  graph.exhibits=exhibits;
  writeFileSync(file,JSON.stringify(graph));
  return root;
}
async function opened(workspace,content,{epithet='the man behind the desk',named=false}={}){
  const client=new RpcClient(workspace,{content});
  try{
    await client.ok('campaign.create',{id:'test-camp',module:'the-haunting',pregen:'thomas-hayes',play_language:'zh-Hans',title:'exhibits'});
    await client.ok('table.open',{campaign:'test-camp'});await client.ok('table.narrate',{campaign:'test-camp',call_id:'t0-c1',text:'Knott waits at his desk.'});
  }finally{await client.close();}
  const campaign=join(workspace,'.coc/campaigns/test-camp'),world=JSON.parse(readFileSync(join(campaign,'world.json'),'utf8'));
  world.person_epithets={...world.person_epithets,'steven-knott':{word:epithet,by:'graph'}};
  writeFileSync(join(campaign,'world.json'),JSON.stringify(world));
  if(named)writeFileSync(join(campaign,'npc-journal.json'),JSON.stringify({entries:{[KNOTT]:{named_at:1}}}));
}
const fauxToolCall=(name,args)=>rawToolCall(name,name==='output'?{...args,commands:[...(args.commands??[]),{kind:'scene',service:'open',crowd:'quiet'}]}:args);
/** The catalog the Keeper was sent, read from its own request. */
function catalogOf(context){
  const text=JSON.stringify(context.messages),at=text.lastIndexOf('\\"decision_materials\\"');
  if(at<0)return undefined;
  for(const message of [...context.messages].reverse()){
    const content=typeof message.content==='string'?message.content:JSON.stringify(message.content);
    if(!content.includes('decision_materials'))continue;
    const start=content.indexOf('{"authority"');
    try{return JSON.parse(typeof message.content==='string'?message.content:message.content.map(part=>part.text??'').join('')).decision_materials;}catch{void start;}
  }
  return undefined;
}
const authorTask=table=>{const written=table.telemetry().find(row=>row.lane==='isolated-expression'&&row.event==='written');assert.ok(written,JSON.stringify(table.telemetry().slice(-8)));return JSON.parse(readFileSync(join(written.attempt,'task.json'),'utf8'));};
const turn=(table,number=1)=>JSON.parse(readFileSync(join(table.workspace,`.coc/campaigns/test-camp/turns/${String(number).padStart(4,'0')}.json`),'utf8'));
/**
 * One or more inputs. `keepers` are the controlled Keeper's answers in order; each gets the catalog it was sent
 * and the table, and returns the tool call(s) it makes. `prompts` are the player's inputs, one per settled turn.
 */
async function play(t,keepers,{options,prompts=['I read the commission on the desk.']}={}){
  const seen=[];let table;
  const engine=createHybridEngine({env,decision:null});
  const content=contentWith(t,options?.exhibits??EXHIBITS());
  table=await openTable({legacyDeliveryFixtures:false,realKernel:true,seedCampaign:false,prepareWorkspace:workspace=>opened(workspace,content,options),env:{...env,PI_COC_CONTENT_ROOT:content},runDriver:engine.runDriver,
    extraExtensions:[{name:'engine',factory:engine.extension}],responses:keepers.map(keeper=>context=>{
      const catalog=catalogOf(context);seen.push(catalog);
      return fauxAssistantMessage(keeper(catalog,table),{stopReason:'toolUse'});
    })});
  t.after(()=>table.dispose());
  for(const prompt of prompts)await table.session.prompt(prompt);
  return {table,seen,get catalog(){return seen[0];}};
}
/** A Keeper answer: an output packet revealing the exhibits whose Keeper labels end with `ids`, plus other packet fields. */
const reveals=(ids,extra={})=>catalog=>[fauxToolCall('output',{version:4,commands:[],...extra,reveal:ids.map(id=>({exhibit_ref:refOf(catalog,id)}))})];
const refOfIssued=(catalog,id)=>catalog.exhibits.find(entry=>entry.label===`LABEL ${id}`).ref;
const refOf=(catalog,label)=>catalog.exhibits.find(entry=>entry.label===`LABEL ${label}`)?.ref;

test('the Keeper catalog lists in-scope document and perception exhibits without surfaces, and no others',async t=>{
  const run=await play(t,[reveals(['exhibit-desk-tap'])]);
  const catalog=run.catalog;
  assert.ok(catalog,'the Keeper was sent a catalog');
  assert.deepEqual(catalog.exhibits.map(entry=>entry.label.replace('LABEL ','')),['exhibit-drawer','exhibit-desk-tap','exhibit-knott-says','exhibit-knott-badge','exhibit-commission'],
    'scene first, then the person present (his testimony, §257.T1, then his badge), then handouts; description, appearance, voice and out-of-scope carriers are not issued');
  const text=JSON.stringify(catalog.exhibits);
  for(const hidden of ['SURFACE','A key ring','taps the desk','Twenty dollars','KEEPER_NOTE','keeper_note','surface'])assert.ok(!text.includes(hidden),hidden);
  const drawer=catalog.exhibits.find(entry=>entry.label==='LABEL exhibit-drawer');
  assert.deepEqual(Object.keys(drawer).sort(),['carrier','channel','clue','kind','label','ref']);
  assert.equal(drawer.clue,'needs Spot Hidden (regular)');
  assert.equal(drawer.carrier,'Knott\'s Office');
  assert.equal(catalog.exhibits.find(entry=>entry.label==='LABEL exhibit-commission').clue,'open');
  assert.equal(catalog.exhibits.find(entry=>entry.label==='LABEL exhibit-desk-tap').clue,undefined);
  assert.equal(catalog.coverage.exhibits.issued,5);
  const says=catalog.exhibits.find(entry=>entry.label==='LABEL exhibit-knott-says');
  assert.deepEqual(Object.keys(says).sort(),['carrier','channel','clue','kind','label','owners','ref','stance'],'a testimony entry names its owners as npc_N and its stance');
  assert.deepEqual([says.owners,says.stance,says.clue,says.kind],[['npc_1'],'lie','open','testimony']);
  assert.equal(catalog.exhibits.find(entry=>entry.label==='LABEL exhibit-knott-badge').carrier,'the man behind the desk','a person carrier shows the public display, the epithet before an introduction');
});

const clueReceipts=(table,number=1)=>turn(table,number).receipts.filter(row=>row.kind==='clue');
const discovered=table=>JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8')).discovered_clues;

test('revealing a document that teaches a clue discovers the clue once; the author gets the surface only',async t=>{
  const run=await play(t,[reveals(['exhibit-commission']),reveals(['exhibit-commission'])],{prompts:['I read the commission on the desk.','I read the commission once more.']});
  const {table}=run;
  assert.deepEqual(table.extensionErrors,[]);
  assert.deepEqual(table.session.messages.filter(message=>message.role==='toolResult'&&message.details?.coc_error).map(message=>message.details.coc_error),[]);
  assert.equal(clueReceipts(table).length,1,'the taught clue is discovered in the same settlement');
  assert.equal(discovered(table).filter(name=>/knott-commission/.test(name)).length,1);
  const task=authorTask(table);
  const material=task.decision_context.selected_materials.find(row=>row.kind==='exhibit');
  assert.deepEqual(Object.keys(material.exhibit).sort(),['carrier','channel','kind','surface']);
  assert.equal(material.exhibit.kind,'document');assert.equal(material.exhibit.channel,'text');
  assert.equal(material.exhibit.surface,'Twenty dollars a day, signed the man behind the desk.','{{who:}} is the epithet before an introduction');
  assert.match(material.authority,/faithfully/);
  const text=JSON.stringify(task);
  for(const hidden of ['KEEPER_NOTE','LABEL exhibit','teaches','exhibit_id','{{who'])assert.ok(!text.includes(hidden),hidden);
  const rows=table.telemetry().filter(row=>row.lane==='decision-content'&&row.event==='exhibits');
  assert.equal(rows.length,2);
  assert.deepEqual([rows[0].issued.length,rows[0].selected,rows[0].refused],[5,[refOfIssued(run.seen[0],'exhibit-commission')],[]]);
  assert.equal(rows[0].author_bytes,Buffer.byteLength(JSON.stringify([material]),'utf8'));
  // The same exhibit again: still readable by the table, and the clue is not discovered a second time.
  assert.equal(run.seen[1].exhibits.find(entry=>entry.label==='LABEL exhibit-commission').clue,'discovered');
  assert.equal(clueReceipts(table,2).length,0,'a clue already discovered is not discovered twice');
  assert.equal(discovered(table).filter(name=>/knott-commission/.test(name)).length,1);
});

const errorsOf=table=>table.session.messages.filter(message=>message.role==='toolResult'&&message.details?.coc_error).map(message=>message.details.coc_error);

test('a missing check refuses the whole packet with a repair naming the exhibit and the check, and settles nothing',async t=>{
  const {table,seen}=await play(t,[reveals(['exhibit-drawer'],{commands:[{kind:'time',minutes:5,reason:'The investigator searches the drawer.'}]}),reveals([])],
    {prompts:['I search the desk drawer for the keys.']});
  assert.deepEqual(table.extensionErrors,[]);
  const refused=errorsOf(table);
  assert.equal(refused.length,1,JSON.stringify(refused));
  const ref=refOfIssued(seen[0],'exhibit-drawer');
  assert.match(refused[0].message,/Spot Hidden/);assert.ok(refused[0].message.includes(ref),'the repair names the exhibit');
  assert.ok(refused[0].fix.includes(`exhibit_ref:"${ref}"`));
  assert.equal(refused[0].details.reason,'check_first');
  const world=JSON.parse(readFileSync(join(table.workspace,'.coc/campaigns/test-camp/world.json'),'utf8'));
  assert.equal(world.clock.minutes,0,'the refused packet\'s time did not land');
  assert.ok(!discovered(table).some(name=>/knott-keys/.test(name)));
  assert.equal(clueReceipts(table).length,0);
  const row=table.telemetry().find(entry=>entry.lane==='decision-content'&&entry.event==='exhibit_refused');
  assert.deepEqual([row.refused[0].ref,row.refused[0].reason,row.selected],[ref,'check_first',[ref]]);
  assert.ok(row.issued.includes(ref));
});

test('an exhibit whose carrier has left refuses the whole packet naming the carrier',async t=>{
  const {table,seen}=await play(t,[(catalog,table)=>[rawToolCall('apply',{effects:[{kind:'npc',name:'npc_1',to:'away',why:'Knott steps out of the office.'}]}),
    ...reveals(['exhibit-knott-badge','exhibit-commission'])(catalog)],reveals([])],{prompts:['I ask about the badge on his lapel.']});
  assert.deepEqual(table.extensionErrors,[]);
  const refused=errorsOf(table);
  assert.equal(refused.length,1,JSON.stringify(refused));
  assert.equal(refused[0].details.reason,'exhibit_carrier_absent');
  assert.match(refused[0].message,/the man behind the desk/);assert.ok(refused[0].message.includes(refOfIssued(seen[0],'exhibit-knott-badge')));
  assert.equal(clueReceipts(table).length,0,'the other exhibit of the refused packet did not discover its clue');
  assert.ok(!discovered(table).some(name=>/knott-commission/.test(name)));
});

test('{{who:}} resolves to the name once the table knows it; a perception with no clue discovers nothing',async t=>{
  const {table}=await play(t,[reveals(['exhibit-desk-tap','exhibit-knott-badge'])],{options:{named:true},prompts:['I watch Knott at his desk.']});
  assert.deepEqual(table.extensionErrors,[]);assert.deepEqual(errorsOf(table),[]);
  const materials=authorTask(table).decision_context.selected_materials.filter(row=>row.kind==='exhibit');
  assert.deepEqual(materials.map(row=>row.exhibit.surface),['Steven Knott taps the desk twice.','A tin badge is pinned to Steven Knott lapel.']);
  assert.deepEqual(materials.map(row=>row.exhibit.channel),['sound','sight']);
  assert.ok(materials.every(row=>row.exhibit.stance===undefined&&!/faithfully/.test(row.authority)));
  assert.equal(clueReceipts(table).length,0);
});

/** Kernel-shaped rows for the catalog, without a kernel. */
const row=(id,extra={})=>({exhibit_id:id,kind:'document',channel:'text',scope:'handout',carrier:{id:'handout-a',node_kind:'handout',display_name:'Handout A'},label:`Label ${id}`,
  surface:{text:`Surface ${id}`,language:'en',verbatim:false},...extra});
const taught=(...clues)=>({teaches:clues,clue:{state:'open'},clue_states:clues.map(clue=>({clue,state:'open'}))});
const capsule={_context:{task_source_revision:'s1'},where:{scene:'Office'},present:[{ref:'npc_1',id:'the-clerk',display_name:'The clerk'},{ref:'npc_2',id:'the-porter',display_name:'The porter'}]};

test('the catalog keeps a stable alias per exhibit, never carries a surface, and omits past its cap with a recorded count',()=>{
  const owner=new DecisionContent();
  const first=owner.prepare('c:1',capsule,[],[],['Investigator'],[],[],[row('a',taught('clue-a')),row('b',{kind:'perception',channel:'sight'})]);
  assert.deepEqual(first.exhibits.map(entry=>entry.ref),['exhibit_1','exhibit_2']);
  assert.ok(!JSON.stringify(first).includes('Surface'));
  const later=owner.prepare('c:2',capsule,[],[],['Investigator'],[],[],[row('b',{kind:'perception',channel:'sight'}),row('a',taught('clue-a'))]);
  assert.deepEqual(later.exhibits.map(entry=>[entry.label,entry.ref]),[['Label b','exhibit_2'],['Label a','exhibit_1']],'an exhibit keeps its alias while the scope is unchanged');
  const many=owner.prepare('c:3',capsule,[],[],['Investigator'],[],[],Array.from({length:60},(_unused,index)=>row(`m${index}`)));
  assert.equal(many.coverage.exhibits.issued,48);assert.equal(many.coverage.exhibits.omitted,12);
  assert.equal(owner.prepare('c:4',capsule,[],[],['Investigator']).coverage.exhibits,undefined,'a table without exhibits reports none');
});

test('reveal accepts exactly the issued document and perception references; a person cannot speak one',()=>{
  const owner=new DecisionContent();
  owner.prepare('c:1',capsule,[],[],['Investigator'],[],[],[row('a'),row('t',{kind:'testimony',channel:'speech',stance:'lie',owners:['the-clerk']})]);
  const bindings=owner.bindings(),schema=turnPacketParameterSchema(false,undefined,undefined,false,bindings);
  assert.deepEqual(bindings.revealExhibits,['exhibit_1']);assert.deepEqual(bindings.speechExhibits,['exhibit_2']);
  assert.equal(Errors(schema,{version:4,reveal:[{exhibit_ref:'exhibit_1'}]}).length,0);
  assert.ok(Errors(schema,{version:4,reveal:[{exhibit_ref:'exhibit_2'}]}).length,'a testimony exhibit is not a reveal');
  assert.ok(Errors(schema,{version:4,reveal:[{exhibit_ref:'exhibit_9'}]}).length,'an unissued reference is refused by the schema');
  assert.ok(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{exhibit_ref:'exhibit_1'}]}]}).length,'a document is not said');
  assert.equal(Errors(schema,{version:4,interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{exhibit_ref:'exhibit_2'}]}]}).length,0,'testimony is selectable in speech');
  assert.throws(()=>owner.resolve({exhibit_ref:'exhibit_1'},'npc_1'),/does not speak/);
  assert.deepEqual(owner.hydrate([],[{exhibit_ref:'exhibit_1'}]).materials,[{kind:'exhibit',ref:'exhibit_1'}],'a selection is a placeholder until settlement gives the author its surface');
});

test('settlement compiles each undiscovered taught clue once and refuses an exhibit that is unissued or whose carrier left',()=>{
  const owner=new DecisionContent();
  owner.prepare('c:1',capsule,[],[],['Investigator'],[],[],[row('a',taught('clue-a')),row('b',taught('clue-a','clue-b')),row('c',{...taught('clue-c'),clue:{state:'discovered'},clue_states:[{clue:'clue-c',state:'discovered'}]})]);
  const current=[row('a',taught('clue-a')),row('b',taught('clue-a','clue-b')),row('c',{clue_states:[{clue:'clue-c',state:'discovered'}]})];
  const settled=owner.settleExhibits([{exhibit_ref:'exhibit_1'},{exhibit_ref:'exhibit_2'},{exhibit_ref:'exhibit_3'}],current);
  assert.deepEqual(settled.effects,[{kind:'clue',clue:'clue-a'},{kind:'clue',clue:'clue-b'}],'one discovery per clue; a discovered clue has none');
  assert.deepEqual(settled.selected,['exhibit_1','exhibit_2','exhibit_3']);
  assert.deepEqual(settled.authors.get('exhibit_1'),{kind:'exhibit',exhibit:{kind:'document',channel:'text',carrier:'Handout A',surface:'Surface a'},
    authority:'Perceivable book material; render it in the play language without adding what it does not show.'});
  assert.throws(()=>owner.settleExhibits([{exhibit_ref:'exhibit_2'}],[current[0]]),error=>error instanceof ExhibitRefusal&&error.reason==='carrier_absent'&&/Handout A/.test(error.message)&&/exhibit_2/.test(error.message));
  assert.throws(()=>owner.settleExhibits([{exhibit_ref:'exhibit_7'}],current),error=>error instanceof ExhibitRefusal&&error.reason==='unissued');
  const lie=new DecisionContent();lie.prepare('c:1',capsule,[],[],['Investigator'],[],[],[row('v',{kind:'perception',surface:{text:'Printed words.',language:'en',verbatim:true}})]);
  assert.equal(lie.settleExhibits([{exhibit_ref:'exhibit_1'}],[row('v',{kind:'perception',surface:{text:'Printed words.',language:'en',verbatim:true}})]).authors.get('exhibit_1').authority,'Render faithfully in the play language; do not summarize.');
});

test('packet guidance prefers revealing the exhibit to applying the clue it teaches',()=>{
  assert.match(TURN_PACKET_GUIDANCE,/exhibit_ref/);
  assert.match(TURN_PACKET_GUIDANCE,/do not apply the clue it teaches/);
});

// ---- §257.T1: testimony, lies and deflections ----
const says=(ids,extra={})=>catalog=>[fauxToolCall('output',{version:4,commands:[],...extra,
  interactions:[{actor:'npc_1',to:['investigator_1'],act:'answer',content:ids.map(id=>({exhibit_ref:refOf(catalog,id)}))}]})];

test('an owner says a lie: the clue it teaches is discovered once and the author gets the speaker\'s claim with the authority line',async t=>{
  const {table,seen}=await play(t,[says(['exhibit-knott-says']),says(['exhibit-knott-says'])],{prompts:['I ask Knott about the commission.','I ask Knott again.']});
  assert.deepEqual(table.extensionErrors,[]);assert.deepEqual(errorsOf(table),[]);
  assert.equal(clueReceipts(table).length,1,'testimony that teaches a clue discovers it under the clue\'s own rules');
  assert.equal(discovered(table).filter(name=>/knott-commission/.test(name)).length,1);
  const response=authorTask(table).decision_context.responses.find(entry=>entry.actor==='npc_1');
  assert.ok(response,'the owner\'s response reached the author');
  assert.equal(response.claims.length,1);
  assert.deepEqual(response.claims[0],{kind:'exhibit',exhibit:{kind:'testimony',channel:'speech',surface:'SURFACE exhibit-knott-says',stance:'lie'},
    authority:'What this speaker says, in their terms; not world truth. Render as their speech; do not correct or expose it in narration.'});
  const text=JSON.stringify(authorTask(table));
  for(const hidden of ['KEEPER_NOTE','LABEL exhibit','teaches','exhibit_id','knott-commission'])assert.ok(!text.includes(hidden),hidden);
  assert.equal(seen[1].exhibits.find(entry=>entry.label==='LABEL exhibit-knott-says').clue,'discovered');
  assert.equal(clueReceipts(table,2).length,0,'saying it again discovers nothing twice');
  const row=table.telemetry().find(entry=>entry.lane==='decision-content'&&entry.event==='exhibits');
  assert.deepEqual(row.selected,[refOfIssued(seen[0],'exhibit-knott-says')]);
});

test('a fact testimony carries the plain speaker line; a deflection the lie line',async t=>{
  const exhibits=EXHIBITS().map(item=>item.exhibit_id==='exhibit-knott-says'?{...item,stance:'fact',teaches:undefined}:item);
  const {table}=await play(t,[says(['exhibit-knott-says'])],{options:{exhibits}});
  assert.deepEqual(errorsOf(table),[]);
  const claim=authorTask(table).decision_context.responses.find(entry=>entry.actor==='npc_1').claims[0];
  assert.deepEqual([claim.exhibit.stance,claim.authority],['fact','What this speaker says, in their terms.']);
  assert.equal(clueReceipts(table).length,0,'a testimony teaching nothing discovers nothing');
});

test('testimony whose owner left refuses the packet naming the owner, and settles nothing',async t=>{
  const {table,seen}=await play(t,[(catalog,table)=>[rawToolCall('apply',{effects:[{kind:'npc',name:'npc_1',to:'away',why:'Knott steps out of the office.'}]}),...says(['exhibit-knott-says'])(catalog)],reveals([])],{prompts:['I ask Knott about the commission.']});
  assert.deepEqual(table.extensionErrors,[]);
  const refused=errorsOf(table);
  assert.equal(refused.length,1,JSON.stringify(refused));
  assert.equal(refused[0].details.reason,'exhibit_carrier_absent');
  assert.match(refused[0].message,/npc_1/);assert.ok(refused[0].message.includes(refOfIssued(seen[0],'exhibit-knott-says')));
  assert.equal(clueReceipts(table).length,0);
});

test('a non-owner is refused with the owners named; testimony in reveal is refused; speaking a document is refused',()=>{
  const owner=new DecisionContent();
  const clerk=row('t',{kind:'testimony',channel:'speech',scope:'person',stance:'deflection',owners:['the-clerk'],...taught('clue-t')});
  owner.prepare('c:1',capsule,[],[],['Investigator'],[],[],[clerk,row('d')]);
  assert.deepEqual(owner.bindings().speechExhibits,['exhibit_1']);
  const catalog=owner.prepare('c:1',capsule,[],[],['Investigator'],[],[],[clerk,row('d')]).exhibits;
  assert.deepEqual(catalog[0].owners,['npc_1']);
  const speak=actor=>[{actor,content:[{exhibit_ref:'exhibit_1'}]}];
  assert.throws(()=>owner.settleExhibits([],[clerk],speak('npc_2')),error=>error instanceof ExhibitRefusal&&error.reason==='not_owner'&&/npc_1 \(The clerk\)/.test(error.message)&&/npc_2/.test(error.message)&&/exhibit_1/.test(error.message));
  assert.throws(()=>owner.settleExhibits([{exhibit_ref:'exhibit_1'}],[clerk]),error=>error instanceof ExhibitRefusal&&error.reason==='testimony_revealed'&&/npc_1/.test(error.message));
  assert.throws(()=>owner.settleExhibits([],[row('d')],[{actor:'npc_1',content:[{exhibit_ref:'exhibit_2'}]}]),error=>error instanceof ExhibitRefusal&&/does not speak|a person does not speak/.test(error.message));
  assert.throws(()=>owner.resolve({exhibit_ref:'exhibit_1'},'npc_2'),/npc_1 \(The clerk\)/);
  const settled=owner.settleExhibits([],[clerk],speak('npc_1'));
  assert.deepEqual(settled.effects,[{kind:'clue',clue:'clue-t'}]);
  const claims=owner.authorClaims(owner.hydrate([{actor:'npc_1',to:['investigator_1'],act:'answer',content:[{exhibit_ref:'exhibit_1'}]}]).responses,settled.authors)[0].claims;
  assert.deepEqual(claims,[{kind:'exhibit',exhibit:{kind:'testimony',channel:'speech',surface:'Surface t',stance:'deflection'},
    authority:'What this speaker says, in their terms; not world truth. Render as their speech; do not correct or expose it in narration.'}]);
});

// ---- §257.T1: {{who:}} in first sight and in speech_style ----
const TOKENED=()=>[
  exhibit('exhibit-office-sight','description',OFFICE,'sight',{surface:surface('{{who:npc-steven-knott}} sits behind a cluttered desk.')}),
  exhibit('exhibit-knott-look','appearance',KNOTT,'sight',{surface:surface('{{who:npc-steven-knott}} is gaunt, in a rumpled suit.')}),
  exhibit('exhibit-knott-voice','voice',KNOTT,'speech',{owners:[KNOTT],surface:surface('Clipped; {{who:npc-steven-knott}} never finishes a sentence he can trail off.')}),
];
const greet=catalog=>[fauxToolCall('output',{version:4,commands:[],interactions:[{actor:'npc_1',to:['investigator_1'],act:'greet'}]})];

test('first-sight words and speech_style reach the author with {{who:}} resolved: the epithet before the name is told',async t=>{
  const {table}=await play(t,[greet],{options:{exhibits:TOKENED()},prompts:['I step into the office.']});
  assert.deepEqual(table.extensionErrors,[]);assert.deepEqual(errorsOf(table),[]);
  const task=authorTask(table),text=JSON.stringify(task);
  assert.ok(!text.includes('{{who'),'no token reaches the author');
  const context=task.decision_context;
  assert.equal(context.scene.first_sight.place.described,'the man behind the desk sits behind a cluttered desk.');
  assert.equal(context.scene.first_sight.people[0].described,'the man behind the desk is gaunt, in a rumpled suit.');
  assert.equal(context.people.find(person=>person.ref==='npc_1').speech_style,'Clipped; the man behind the desk never finishes a sentence he can trail off.');
});

test('once the table has been told the name, first sight and speech_style carry it',async t=>{
  const {table}=await play(t,[greet],{options:{exhibits:TOKENED(),named:true},prompts:['I step into the office.']});
  assert.deepEqual(errorsOf(table),[]);
  const context=authorTask(table).decision_context;
  assert.equal(context.scene.first_sight.place.described,'Steven Knott sits behind a cluttered desk.');
  assert.equal(context.people.find(person=>person.ref==='npc_1').speech_style,'Clipped; Steven Knott never finishes a sentence he can trail off.');
});

test('the first-sight check still locates an excerpt of the resolved words, whichever wording the capsule carried',async t=>{
  const root=contentWith(t,TOKENED()),workspace=mkdtempSync(join(tmpdir(),'exhibit-who-'));
  t.after(()=>rmSync(workspace,{recursive:true,force:true}));
  await opened(workspace,root,{});
  const client=new RpcClient(workspace,{content:root});
  try{
    const check=missing=>client.ok('table.first_sight',{campaign:'test-camp',turn:0,items:[{id:'commission-briefing',kind:'place',missing:[missing]}]});
    const epithet=await check('the man behind the desk sits behind');
    assert.deepEqual(epithet.dropped,[],JSON.stringify(epithet));
    assert.deepEqual(epithet.open[0].missing,['the man behind the desk sits behind']);
    const named=await check('Steven Knott sits behind');
    assert.deepEqual(named.open?.[0]?.missing??named.dropped,['Steven Knott sits behind'],'the book\'s own name locates too: a name told since the capsule must not hide the excerpt');
    const none=await check('{{who:npc-steven-knott}} sits');
    assert.equal(none.dropped[0]?.reason,'missing_not_in_book','the token itself is never the book\'s wording');
  }finally{await client.close();}
});
