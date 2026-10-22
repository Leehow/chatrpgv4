/** Migrated from tests/kernel/test_mod_documents.py; all eleven original cases retained. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,RpcClient,CAMPAIGN,campaignDir,readJson,writeJson,openTurn,prepared,type Row} from './support.ts';

const paper=(name='Notebook',text='',presentation='notebook'):Row=>({name,category:'item',description:'An ordinary writable carrier.',
  basis:'Fixture text, not an authored scenario claim.',parameters:{charges:null,effects:[]},document:{text,presentation},player_view:{description:'A carried paper.',fields:[]}});
async function ownedPaper(k:RpcClient,text='Meet at the station.'){
  await openTurn(k);await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,paper('Notebook',text)),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
}
const view=(k:RpcClient)=>k.ok('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook'});
const edit=(k:RpcClient,snapshot:Row,action='save',text='My own notes')=>k.ok('mods.document.apply',{
  campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook',version:snapshot.version,action,...(action==='save'?{text}:{})});

test('test_edit_reopen_reset_keeps_acquisition_source_and_turn_state',async t=>{
  const k=await kernel(t);await ownedPaper(k);const folder=campaignDir(k.workspace);
  const before=Object.fromEntries(['turn.json','campaign.json','party/thomas-hayes.json'].map(name=>[name,readFileSync(join(folder,name))]));
  const original=readJson(join(folder,'world.json')),first=await view(k);
  assert.equal(first.original,'Meet at the station.');assert.equal(first.text,first.original);assert.equal(first.player_edited,false);
  assert.deepEqual(first.editor,{provider:'enhanced-items',renderer:'paper'});
  const changed=await edit(k,first,'save','<script>not executable</script>\nMy notes');
  assert.equal(changed.original,first.original);assert.notEqual(changed.text,first.text);assert.equal(changed.player_edited,true);
  assert.equal((await view(k)).text,changed.text);
  const reset=await edit(k,changed,'reset');assert.equal(reset.text,reset.original);assert.equal(reset.text,first.text);assert.equal(reset.player_edited,false);
  assert.deepEqual(Object.fromEntries(Object.keys(before).map(name=>[name,readFileSync(join(folder,name))])),before);
  const world=readJson(join(folder,'world.json'));assert.deepEqual(world.objects.definitions,original.objects.definitions);
  const withoutObjects=({objects,...rest}:Row)=>rest;assert.deepEqual(withoutObjects(world),withoutObjects(original));
  assert.equal(readFileSync(join(folder,'document-edits.jsonl'),'utf8').trim().split('\n').length,2);
});

test('test_blank_original_and_stale_edits_are_preserved_across_processes',async t=>{
  const k=await kernel(t);await ownedPaper(k,'');const first=await view(k),other=new RpcClient(k.workspace);t.after(()=>other.close());
  await edit(other,first,'save','Written elsewhere');
  const stale={campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook',version:first.version,action:'save',text:'Stale draft'};
  assert.equal((await k.err('mods.document.apply',stale)).code,'revision_conflict');assert.equal((await view(k)).text,'Written elsewhere');
  assert.equal((await edit(k,await view(k),'reset')).text,'');
  assert.equal((await k.err('mods.document.apply',{...stale,version:(await view(k)).version,action:'reset',original:'Forged'})).code,'invalid_params');
});

test('test_explicit_player_wording_is_preserved_even_when_equal_to_raw_source',async t=>{
  const k=await kernel(t);await ownedPaper(k,'Keep this exact English wording.');const first=await view(k),saved=await edit(k,first,'save',first.text);
  assert.equal(saved.player_edited,true);assert.notEqual(saved.version,first.version);
  const reset=await edit(k,saved,'reset');assert.equal(reset.player_edited,false);assert.equal(reset.text,reset.original);assert.equal(reset.text,first.original);
});

test('test_transfer_captures_actual_received_text_and_blocks_prior_owner',async t=>{
  const k=await kernel(t);await ownedPaper(k);const old=await edit(k,await view(k),'save','Player addition');
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Steven Knott',handover:'given'}]});
  const identity={campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook'};
  assert.equal((await k.err('mods.document.view',identity)).code,'not_owned');
  assert.equal((await k.err('mods.document.apply',{...identity,action:'reset',version:old.version})).code,'not_owned');
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'Notebook',from:'Steven Knott',to:'Steven Knott',document:{action:'write',text:"Knott's addition"},why:'Knott writes in the paper he is holding'}]});
  await k.table('apply',{call_id:'t1-c4',effects:[{kind:'object',name:'Notebook',from:'Steven Knott',to:'Thomas Hayes',handover:'given'}]});
  const received=await view(k);assert.equal(received.original,"Knott's addition");assert.equal(received.text,received.original);assert.equal(received.player_edited,false);
  const changed=await edit(k,received,'save','Another player edit');assert.equal((await edit(k,changed,'reset')).text,"Knott's addition");
});

test('test_existing_carrier_initializes_once_and_disabled_mod_keeps_editor',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=paper();delete draft.document;
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  const initialize={kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',document:{text:'Original',presentation:'book'}};
  await k.table('apply',{call_id:'t1-c2',effects:[initialize]});const changed=await edit(k,await view(k),'save',"A player's annotation");
  assert.equal((await k.tableErr('apply',{call_id:'t1-c3',effects:[initialize]})).code,'invalid_params');assert.equal((await view(k)).text,changed.text);
  await k.ok('mods.configure',{campaign:CAMPAIGN,id:'enhanced-items',enabled:false});
  await k.table('narrate',{call_id:'t1-c3',text:'We put the papers away.'});await k.table('player_input',{text:'I inspect my notes.'});
  assert.deepEqual((await view(k)).editor,{provider:'core',renderer:'plain'});assert.equal((await edit(k,await view(k),'reset')).text,'Original');
});

test('test_document_limits_and_container_custody',async t=>{
  const k=await kernel(t);await ownedPaper(k);const draft=paper('Bag');delete draft.document;
  await k.table('apply',{call_id:'t1-c2',effects:[await prepared(k,draft),{kind:'object',name:'Bag',to:'Thomas Hayes'},{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Bag'}]});
  const snapshot=await view(k);assert.equal(snapshot.original,'Meet at the station.');const sheet=(await k.table('view')).investigators[0];
  assert.equal(sheet.objects.find((row:Row)=>row.name==='Notebook').container,'Bag');assert.ok(sheet.equipment.some((row:Row)=>row.name==='Notebook'));
  assert.ok(!readJson(join(campaignDir(k.workspace),'party/thomas-hayes.json')).equipment.some((row:Row)=>row?.name==='Notebook'));
  assert.equal((await k.err('mods.document.apply',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook',version:snapshot.version,action:'save',text:'x'.repeat(64001)})).code,'invalid_params');
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'Bag',from:'Thomas Hayes',to:'Steven Knott',handover:'given'}]});
  assert.equal((await k.err('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook'})).code,'not_owned');
});

test('test_document_worldline_snapshots_and_stale_editor_identity',async t=>{
  const k=await kernel(t);await ownedPaper(k);await k.table('narrate',{call_id:'t1-c2',text:'We put the notebook away.'});
  await k.table('player_input',{text:'I take another route.'});
  await k.table('apply',{call_id:'t2-c1',effects:[{kind:'fork',name:'side',mode:'if'}]});
  await k.table('narrate',{call_id:'t2-c2',text:'The world follows another line.'});
  const side=await edit(k,await view(k),'save','Writing on the other line');
  const turn=()=>readJson(join(campaignDir(k.workspace),'turn.json')).turn;
  const switchLine=async(line:string)=>{const index=turn();await k.table('player_input',{text:'I return to that route.'});
    await k.table('apply',{call_id:`t${index}-c1`,effects:[{kind:'switch',line}]});
    await k.table('narrate',{call_id:`t${index}-c2`,text:'The previous line is restored.'});};
  await switchLine('main');assert.equal((await view(k)).text,'Meet at the station.');
  assert.equal((await k.err('mods.document.apply',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook',version:side.version,action:'save',text:'Old tab'})).code,'revision_conflict');
  await switchLine('side');assert.equal((await view(k)).text,'Writing on the other line');
  assert.equal((await edit(k,await view(k),'reset')).text,'Meet at the station.');
});

test('test_two_processes_cannot_both_save_the_same_revision',async t=>{
  const k=await kernel(t);await ownedPaper(k);const snapshot=await view(k),other=new RpcClient(k.workspace);t.after(()=>other.close());
  const save=(client:RpcClient,text:string)=>client.call('mods.document.apply',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook',version:snapshot.version,action:'save',text});
  const results=await Promise.all([save(k,'First window'),save(other,'Second window')]);
  assert.equal(results.filter(row=>row.ok).length,1);assert.equal(results.find(row=>!row.ok)!.error.code,'revision_conflict');
  assert.equal((await view(k)).text,results.find(row=>row.ok)!.result.text);
});

test('test_revealed_handout_is_copied_exactly_and_hidden_source_is_refused',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=paper();draft.document={handout:'Not yet revealed',presentation:'paper'};
  const request={name:draft.name,category:draft.category,description:draft.description};const job=await k.ok('mods.job',{campaign:CAMPAIGN,role:'create',input:request});
  writeJson(join(job.cwd,'result.json'),draft);assert.equal((await k.err('mods.accept',{campaign:CAMPAIGN,job:job.job})).code,'invalid_params');
  const shown=await k.table('apply',{call_id:'t1-c1',effects:[{kind:'handout',name:'globe-unpublished-1918'}]});
  const source=shown.attachment.path,bytes=readFileSync(source);draft.document.handout=(await k.table('status')).receipts.at(-1).name;
  writeJson(join(job.cwd,'result.json'),draft);const accepted=await k.ok('mods.accept',{campaign:CAMPAIGN,job:job.job});
  await k.table('apply',{call_id:'t1-c2',effects:[{kind:'define',...request,_definition:accepted.definition,_provenance:accepted.provenance},{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  const snapshot=await view(k);assert.equal(snapshot.text.trim(),bytes.toString().slice(bytes.toString().indexOf('\n')+1).trim());
  const changed=await edit(k,snapshot,'save','A player rewrite');assert.equal((await edit(k,changed,'reset')).text,snapshot.text);assert.deepEqual(readFileSync(source),bytes);
});

test('test_declared_document_limit_allows_multibyte_text_in_creator_output',async t=>{
  const k=await kernel(t);await openTurn(k);const body='文字'.repeat(30000);
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,paper('Notebook',body)),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  assert.equal((await view(k)).original,body);
});

test('test_instance_writing_is_captured_once_ahead_of_a_blank_template',async t=>{
  const k=await kernel(t);await openTurn(k);const draft=paper();
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes',document:{text:'The received task details',presentation:'paper'}}]});
  const received=await view(k);assert.equal(received.original,'The received task details');assert.equal(received.text,received.original);
  const changed=await edit(k,received,'save','A temporary edit');assert.equal((await edit(k,changed,'reset')).text,'The received task details');
  const definition=Object.values(readJson(join(campaignDir(k.workspace),'world.json')).objects.definitions)[0] as Row;assert.equal(definition.document.text,'');
});

test('test_writing_a_carrier_without_text_is_refused_with_its_initialization',async t=>{
  // 2026-10-22 sandbox (mc1 turn 3): writing into an adopted notebook that had no document yet threw
  // "TypeError: unsupported JSON value" from the version digest instead of the carrier's own refusal.
  const k=await kernel(t);await openTurn(k);const draft=paper();delete draft.document;
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
  const refused=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',
    document:{action:'write',text:'Line one\nLine two'},why:'Hayes writes down what he learned'}]});
  assert.equal(refused.code,'invalid_params');assert.equal(refused.details?.reason,'document_not_initialized');
  await k.table('apply',{call_id:'t1-c3',effects:[{kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',
    document:{text:'Line one\nLine two',presentation:'notebook'},why:'Hayes writes down what he learned'}]});
  assert.equal((await view(k)).text,'Line one\nLine two');
});
