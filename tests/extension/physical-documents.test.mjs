/** Physical writing, observation and editor intent cross the actual kernel interfaces. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {table} from './object-usages-fixture.mjs';

async function paper(t){
  const game=await table(t),sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  sheet.equipment=['Pocket notebook','Pencil','Eraser'];await writeFile(game.sheetPath,JSON.stringify(sheet));
  const job=await game.call('mods.job',{role:'create',input:{name:'Pocket notebook',category:'item',description:'An owned paper notebook.'}});
  const definition={name:'Pocket notebook',category:'item',description:'An owned paper notebook.',basis:'The issued fixture equipment.',
    parameters:{charges:null,effects:[]},traits:[],player_view:{description:'An owned paper notebook.',fields:[]},document:{text:'Initial harmless note.\n',presentation:'notebook'}};
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(definition));const accepted=await game.call('mods.accept',{job:job.job});
  await game.apply([{kind:'define',name:definition.name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance},
    {kind:'object',name:'Pocket notebook',definition:definition.name,to:game.sheet.name,adopt:'Pocket notebook'}]);
  let ordinal=30;
  const apply=async effects=>game.call('table.apply',{call_id:`t${(await game.call('table.status')).turn}-c${ordinal++}`,effects});
  const doc=(document,why='The actual physical paper operation.')=>({kind:'object',name:'Pocket notebook',from:game.sheet.name,to:game.sheet.name,document,why});
  const view=()=>game.call('mods.document.view',{actor:game.sheet.id,name:'Pocket notebook'});
  const next=async text=>{
    const turn=(await game.call('table.status')).turn;
    await game.call('table.narrate',{call_id:`t${turn}-c${ordinal++}`,text:'The current action is finished.'});
    await game.call('table.player_input',{text});
  };
  const request=async text=>{const value=await view();return game.call('mods.document.request',{actor:game.sheet.id,name:value.name,version:value.version,action:'save',text});};
  return {...game,apply,doc,view,next,request};
}

test('story append reaches the same current paper and an unshown NPC cannot acquire its writing',async t=>{
  const game=await paper(t);
  await game.apply([game.doc({action:'append',text:'Plate LICENSE-A7.\nPrivate route SECRET-R9.'},'The investigator writes the selected notes with their pencil.')]);
  assert.match((await game.view()).text,/LICENSE-A7/);
  assert.match((await game.call('table.capsule')).own.documents[0].text,/LICENSE-A7/);
  assert.equal(JSON.stringify(await game.call('npc.perspective',{name:'Steven Knott'})).includes('LICENSE-A7'),false);
  await game.apply([game.doc({action:'close'})]);
  await assert.rejects(game.apply([game.doc({action:'observe',reader:'Steven Knott',access:'glimpse',quote:'Plate LICENSE-A7.'})]),/not open/);
  await game.apply([game.doc({action:'open'})]);
  await game.apply([game.doc({action:'observe',reader:'Steven Knott',access:'glimpse',quote:'Plate LICENSE-A7.'},'Knott actually sees this one readable line over the investigator shoulder.')]);
  const perspective=await game.call('npc.perspective',{name:'Steven Knott'});
  assert.equal(perspective.observed_documents[0].writing,'Plate LICENSE-A7.');
  assert.equal(JSON.stringify(perspective).includes('SECRET-R9'),false,'a glimpse does not grant the rest of the book');
});

test('a sidebar draft does not erase anything until its bound physical method, implement and time settle',async t=>{
  const game=await paper(t);
  await game.apply([game.doc({action:'append',text:'Plate LICENSE-A7.'})]);
  await game.apply([game.doc({action:'show',reader:'Steven Knott'})]);
  await game.apply([game.doc({action:'observe',reader:'Steven Knott',access:'shown'})]);
  const before=(await game.view()).text;
  await game.request('Initial harmless note.\n');
  assert.equal((await game.view()).text,before,'an editor request is not a writing mutation');
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  const request=(await game.call('table.capsule')).turn.document_edit;
  assert.equal(request.document,'Pocket notebook');assert.equal(request.remove,'Plate LICENSE-A7.');
  assert.equal((await game.call('npc.situation',{name:'Steven Knott'})).canonical_context.player_declaration,'');
  assert.equal((await game.call('npc.perspective',{name:'Steven Knott'})).input.player_input,null);
  const edit=game.doc({action:'requested_edit',method:'erase',implements:['Eraser'],marks:'A faint abrasion remains; the old pencil words are not readable.',legibility:'illegible'});
  await assert.rejects(game.apply([game.doc({action:'write',text:'Initial harmless note.\n'})]),/ordinary writing cannot bypass/);
  await assert.rejects(game.apply([edit]),/editing time/);
  await assert.rejects(game.apply([{kind:'time',minutes:1,why:'The attempted editing.'},game.doc({...edit.document,implements:['Unowned solvent']})]),/available carried implement/);
  assert.equal((await game.view()).text,before,'a bad physical batch changes none of the writing');
  await game.apply([{kind:'time',minutes:1,why:'The investigator erases the selected pencil line with their eraser.'},edit]);
  assert.equal((await game.view()).text,'Initial harmless note.\n');
  assert.equal((await game.view()).edit_request.status,'applied');
  assert.match((await game.view()).original,/Initial harmless/,'acquisition originals do not become history rollbacks');
  const observed=(await game.call('npc.perspective',{name:'Steven Knott'})).observed_documents;
  assert.match(observed[0].writing,/LICENSE-A7/,'a person who already saw it keeps that observation');
  const look=await game.call('table.look',{focus:'object',name:'Pocket notebook'});
  assert.equal(look.instance.document.text.includes('LICENSE-A7'),false);
  assert.equal(JSON.stringify(look.instance.document.marks).includes('LICENSE-A7'),false,'illegible marks do not reveal overwritten words');
  await game.next('I open the notebook again and read what is on it now.');
  const capsule=await game.call('table.capsule');
  assert.equal(capsule.own.documents[0].text.includes('LICENSE-A7'),false,'history does not refill erased writing');
  assert.equal(capsule.turn.document_edit,undefined);
});

test('legible crossing-out remains observable, and closing revokes showing without retracting knowledge',async t=>{
  const game=await paper(t);await game.apply([game.doc({action:'append',text:'Plate LICENSE-A7.'})]);
  await game.request('Initial harmless note.\n');
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  await game.apply([{kind:'time',minutes:1,why:'The investigator crosses out the line.'},game.doc({action:'requested_edit',method:'cross_out',implements:['Pencil'],marks:'One pencil stroke crosses the still readable line.',legibility:'legible'})]);
  await game.apply([game.doc({action:'show',reader:'Steven Knott'}),game.doc({action:'observe',reader:'Steven Knott',access:'shown'})]);
  assert.match((await game.call('npc.perspective',{name:'Steven Knott'})).observed_documents[0].writing,/LICENSE-A7/);
  await game.apply([game.doc({action:'close'})]);
  await assert.rejects(game.apply([game.doc({action:'observe',reader:'Steven Knott',access:'shown'})]),/not open/);
  assert.match((await game.call('npc.perspective',{name:'Steven Knott'})).observed_documents[0].writing,/LICENSE-A7/);
});

test('a stale body cannot execute a queued editor goal',async t=>{
  const game=await paper(t),before=await game.view();await game.request('Changed target.');
  await game.apply([game.doc({action:'append',text:'A later actual note.'})]);
  assert.equal((await game.view()).edit_request.status,'stale');
  await assert.rejects(game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'})),/unavailable/);
  assert.equal((await game.view()).original,before.original);
});

test('failed dispatch and a stranded turn retain a retryable physical draft',async t=>{
  const game=await paper(t),before=(await game.view()).text;
  const first=await game.request('A retained target body.');
  assert.equal((await game.request('A retained target body.')).send,true,'unacknowledged submission can retry');
  await assert.rejects(game.call('mods.document.dispatch',{actor:game.sheet.id,name:'Pocket notebook',request:'wrong-request',accepted:true}),/current document request/);
  await game.call('mods.document.dispatch',{actor:game.sheet.id,name:'Pocket notebook',request:first.request,accepted:false});
  assert.equal((await game.view()).edit_request.status,'needs_follow_up');
  const retried=await game.request('A retained target body.');
  assert.equal(retried.request,first.request);assert.equal(retried.send,true);
  await game.call('mods.document.dispatch',{actor:game.sheet.id,name:'Pocket notebook',request:first.request,accepted:true});
  assert.equal((await game.request('A retained target body.')).send,false,'accepted queue does not resend on another click');
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  await game.call('table.release',{release:'stranded'});
  assert.equal((await game.view()).edit_request.status,'needs_follow_up');
  assert.equal((await game.view()).edit_request.text,'A retained target body.');
  assert.equal((await game.view()).text,before);
  assert.equal((await game.request('A retained target body.')).send,true);
});

test('a readable Unicode trace captures the original character rather than half a surrogate pair',async t=>{
  const game=await paper(t);await game.apply([game.doc({action:'append',text:'Keep 😀 end.'})]);
  await game.request((await game.view()).text.replace('😀','😃'));
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  await game.apply([{kind:'time',minutes:1,why:'The investigator rewrites one marked character.'},game.doc({action:'requested_edit',method:'rewrite',implements:['Pencil'],marks:'The old character is still visible under its replacement.',legibility:'legible'})]);
  await game.apply([game.doc({action:'show',reader:'Steven Knott'}),game.doc({action:'observe',reader:'Steven Knott',access:'shown',quote:'😀'})]);
  assert.equal((await game.call('npc.perspective',{name:'Steven Knott'})).observed_documents[0].writing,'😀');
});

test('a question retains the edit goal and a display-name change does not change physical custody',async t=>{
  const game=await paper(t),before=await game.view();
  const world=await game.world(),item=Object.values(world.objects.instances).find(value=>value.document);
  item.owner.name='A different display caption for the same investigator';
  await writeFile(join(game.directory,'world.json'),JSON.stringify(world));
  assert.equal((await game.view()).version,before.version,'host versions bind physical identity, not display words');
  await game.request('A target needing a method choice.');
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  const turn=(await game.call('table.status')).turn;
  await game.call('table.narrate',{call_id:`t${turn}-c90`,text:'Choose an actual method for the proposed change.'});
  assert.equal((await game.view()).edit_request.status,'needs_follow_up');
  assert.equal((await game.view()).text,before.text);
  await game.call('table.player_input',{text:'I choose to erase with my eraser.'});
  await game.apply([{kind:'time',minutes:1,why:'Erasing with the selected implement.'},game.doc({action:'requested_edit',method:'erase',implements:['Eraser'],marks:'The earlier writing is abraded beyond legibility.',legibility:'illegible'})]);
  assert.equal((await game.view()).edit_request.status,'applied');
});

test('focused reading locates middle and end entries beyond the capsule preview, with exact Unicode context',async t=>{
  const game=await paper(t),text='Opening plan.\n'+'Ordinary observation.\n'.repeat(150)+'Middle: Plate MIDDLE-X7, green van.\n'
    +'Unrelated private plan.\n'.repeat(170)+'End: contact END-Y9, telephone 62841. 😀';
  await game.apply([game.doc({action:'write',text})]);
  const preview=(await game.call('table.capsule')).own.documents[0];
  assert.equal(preview.cut,true);assert.equal(preview.text.includes('MIDDLE-X7'),false);
  for(const query of ['MIDDLE-X7','END-Y9','😀']){
    const read=(await game.call('table.look',{focus:'object',name:'Pocket notebook',document_query:query})).document_read;
    assert.equal(read.status,'matches');assert.equal(read.total_hits,1);assert.equal(read.coverage.literal_scan_complete,true);
    const fragment=read.fragments[0];assert.equal(fragment.text,Array.from(text).slice(fragment.start,fragment.end).join(''));
    assert.match(fragment.sources[0].kind,/current_writing/);assert.ok(fragment.text.includes(query));
    assert.ok(JSON.stringify(read).length<5000,'focused evidence does not return the entire long body');
  }
  const miss=(await game.call('table.look',{focus:'object',name:'Pocket notebook',document_query:'a description with different wording'})).document_read;
  assert.equal(miss.status,'no_literal_match');assert.equal(miss.coverage.semantic_assessment,'not_performed');assert.equal(miss.read_pages.document_page,1);
});

test('paged reading covers every current character, paginates literal hits and rejects changed continuations',async t=>{
  const game=await paper(t),text=('Repeated token QUERY-T. A Unicode character 😀.\n').repeat(180);
  await game.apply([game.doc({action:'write',text})]);
  let read=(await game.call('table.look',{focus:'object',name:'Pocket notebook',document_page:1})).document_read;
  const revision=read.revision,parts=[read.fragments[0]];
  await assert.rejects(game.call('table.look',{focus:'object',name:'Pocket notebook',document_page:2}),/issued revision/);
  while(read.next){read=(await game.call('table.look',read.next)).document_read;parts.push(read.fragments[0]);}
  const points=Array.from(text);for(let at=0;at<points.length;at++)assert.ok(parts.some(part=>part.start<=at&&part.end>at));
  assert.equal(read.coverage.all_pages_supplied,false,'a last page alone is not full read coverage');
  assert.equal(parts.every(part=>part.text===points.slice(part.start,part.end).join('')),true);
  let hit=(await game.call('table.look',{focus:'object',name:'Pocket notebook',document_query:'QUERY-T'})).document_read;
  assert.equal(hit.total_hits,180);assert.equal(hit.fragments.length,6);assert.ok(hit.next);
  const second=(await game.call('table.look',hit.next)).document_read;assert.ok(second.fragments[0].match.start>hit.fragments[5].match.start);
  await game.apply([game.doc({action:'append',text:'A new entry.'})]);
  await assert.rejects(game.call('table.look',{focus:'object',name:'Pocket notebook',document_page:2,document_revision:revision}),/writing changed/);
});

test('search uses current legibility rather than acquisition originals, erased text or NPC memory',async t=>{
  const game=await paper(t);await game.apply([game.doc({action:'append',text:'Keep EXACT-OLD-19.'}),game.doc({action:'show',reader:'Steven Knott'}),game.doc({action:'observe',reader:'Steven Knott',access:'shown'})]);
  await game.request('Initial harmless note.\n');await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  await game.apply([{kind:'time',minutes:1,why:'Erasing the chosen line.'},game.doc({action:'requested_edit',method:'erase',implements:['Eraser'],marks:'Only an unreadable abrasion remains.',legibility:'illegible'})]);
  assert.equal((await game.call('table.look',{focus:'object',name:'Pocket notebook',document_query:'EXACT-OLD-19'})).document_read.status,'no_literal_match');
  assert.match((await game.call('npc.perspective',{name:'Steven Knott'})).observed_documents[0].writing,/EXACT-OLD-19/);
  await game.apply([game.doc({action:'append',text:'Visible STRIKE-77.'})]);await game.request('Initial harmless note.\n');
  await game.next(JSON.stringify({kind:'document_edit_request',actor:game.sheet.name,document:'Pocket notebook'}));
  await game.apply([{kind:'time',minutes:1,why:'Crossing out the chosen line.'},game.doc({action:'requested_edit',method:'cross_out',implements:['Pencil'],marks:'The strike-through leaves the original words readable.',legibility:'legible'})]);
  const visible=(await game.call('table.look',{focus:'object',name:'Pocket notebook',document_query:'STRIKE-77'})).document_read;
  assert.equal(visible.status,'matches');assert.equal(visible.fragments[0].sources[0].kind,'current_writing');
  assert.ok(visible.fragments[0].sources.some(source=>source.kind==='legible_mark'));
  await assert.rejects(game.call('table.look',{focus:'npc',name:'Steven Knott',document_page:1}),/require focus object/);
});
