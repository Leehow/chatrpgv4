/** Contract §277: a carried row the host's question found to be a writing surface is registered beside play with empty pages. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {table} from './object-usages-fixture.mjs';

const NOTEBOOK='Field notebook and pencil';
async function gear(t, equipment = [NOTEBOOK,'Camera']) {
  const game=await table(t);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));sheet.equipment=equipment;
  await writeFile(game.sheetPath,JSON.stringify(sheet));
  return game;
}
const plain=(name,extra={})=>({name,category:'item',description:'Carried equipment.',basis:'The owned equipment row.',
  parameters:{charges:null,effects:[]},traits:[],player_view:{description:'Carried equipment.',fields:[]},...extra});
async function judged(game, surfaces) {
  const {version,rows}=await game.call('mods.equipment.surfaces');
  const verdicts=rows.map(value=>({id:value.id,surface:surfaces[value.name] ?? 'none'}));
  return {rows,answer:await game.call('mods.equipment.surfaces.submit',{version,verdicts})};
}
async function registered(game, draft = job=>plain(job.input.name)) {
  await judged(game,{[NOTEBOOK]:'notebook'});
  const {jobs}=await game.call('mods.equipment.prepare');
  assert.equal(jobs.length,1);
  await writeFile(join(jobs[0].cwd,'result.json'),JSON.stringify(draft(jobs[0])));
  assert.equal((await game.call('mods.equipment.publish',{job:jobs[0].job})).status,'ready');
  return jobs[0];
}
const receipts=async game=>JSON.parse(await readFile(join(game.directory,'turn.json'),'utf8')).receipts;
const instance=async(game,name)=>Object.values((await game.world()).objects.instances).filter(value=>value.name===name);
/** The Keeper's own define, through the ordinary creator job. */
async function keeperDefine(game, name, draft) {
  const job=await game.call('mods.job',{role:'create',input:{name,category:'item',description:'The notebook the investigator carries.'}});
  if(!job.accepted) await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft));
  const accepted=await game.call('mods.accept',{job:job.job});
  return {kind:'define',name,category:'item',_definition:accepted.definition,_provenance:accepted.provenance};
}

test('only rows the question has not answered are listed; unknown rows and answers are not kept',async t=>{
  const game=await gear(t);
  const {rows,answer}=await judged(game,{[NOTEBOOK]:'notebook'});
  assert.deepEqual(rows.map(value=>value.name),[NOTEBOOK,'Camera']);
  assert.equal(answer.written,2);
  assert.deepEqual((await game.call('mods.equipment.surfaces')).rows,[]);
  const stale=await game.call('mods.equipment.surfaces.submit',{version:'1',verdicts:[{id:rows[0].id,surface:'book'},{id:'other',surface:'paper'}]});
  assert.equal(stale.written,0,'a judged row is not asked or rewritten again');
  assert.equal((await game.call('mods.equipment.surfaces.submit',{version:'0',verdicts:[]})).status,'stale');
  const fresh=await gear(t),listed=(await fresh.call('mods.equipment.surfaces')).rows;
  assert.equal((await fresh.call('mods.equipment.surfaces.submit',{version:'1',verdicts:[{id:listed[0].id,surface:'scroll'}]})).written,0);
});

test('an unanswered or none row is never prepared; a writing surface is, and starts with empty pages',async t=>{
  const game=await gear(t);
  assert.deepEqual((await game.call('mods.equipment.prepare')).jobs,[]);
  await judged(game,{});
  assert.deepEqual((await game.call('mods.equipment.prepare')).jobs,[],'none is not registered');
  const other=await gear(t),before=await other.call('table.status');
  await judged(other,{[NOTEBOOK]:'notebook'});
  assert.equal((await other.call('table.view')).investigators[0].equipment_preparation[0].status,'pending');
  const {jobs}=await other.call('mods.equipment.prepare');
  assert.equal(jobs.length,1);assert.match(jobs[0].input.description,/writable carrier \(presentation notebook\)/);
  await writeFile(join(jobs[0].cwd,'result.json'),JSON.stringify(plain(jobs[0].input.name)));
  assert.equal((await other.call('mods.equipment.publish',{job:jobs[0].job})).status,'ready');
  const [item]=await instance(other,NOTEBOOK);
  assert.equal(item.document.text,'');assert.equal(item.document.presentation,'notebook');
  assert.equal(item.document.earlier_pages,'unrecorded','empty is what is on record, not a blank notebook');
  assert.deepEqual(await other.call('table.status'),before,'registration is not a turn');
  const capsule=await other.call('table.capsule');
  assert.ok(capsule.documents_in_reach.rows.some(value=>value.name===NOTEBOOK&&value.reach==='investigator'));
  await other.apply([{kind:'object',name:NOTEBOOK,to:other.sheet.name,document:{action:'append',text:'Sketch: three stones, the tallest north.'},why:'The investigator drew the stones.'}]);
  assert.equal((await instance(other,NOTEBOOK))[0].document.text,'Sketch: three stones, the tallest north.');
  const context=await other.call('mods.context');
  assert.match(JSON.stringify(context),/Pages written before play are not on record/);
});

test('the creator\'s own document for the surface is kept',async t=>{
  const game=await gear(t);
  await registered(game,job=>plain(job.input.name,{document:{presentation:'paper',text:''}}));
  assert.equal((await instance(game,NOTEBOOK))[0].document.presentation,'paper');
});

test('the Keeper adopting a registered surface claims it; first text given with the adoption is appended',async t=>{
  const game=await gear(t);
  await registered(game);
  const define=await keeperDefine(game,NOTEBOOK,plain(NOTEBOOK));
  await game.apply([define,{kind:'object',name:NOTEBOOK,definition:NOTEBOOK,to:game.sheet.name,adopt:NOTEBOOK}]);
  assert.ok((await receipts(game)).some(value=>value.already_claimed===true&&value.adopted===NOTEBOOK));
  await game.apply([{kind:'object',name:NOTEBOOK,to:game.sheet.name,adopt:NOTEBOOK,from:game.sheet.name,
    document:{presentation:'notebook',text:'Address: 12 Mill Lane.'},why:'The investigator wrote the address down.'}]);
  const items=await instance(game,NOTEBOOK);
  assert.equal(items.length,1);assert.equal(items[0].document.text,'Address: 12 Mill Lane.');
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.equal(sheet.equipment.filter(value=>value===NOTEBOOK||value?.name===NOTEBOOK).length,1);
});

test('an adoption of something another person holds is still refused',async t=>{
  const game=await gear(t);
  await registered(game);
  await game.apply([{kind:'object',name:NOTEBOOK,from:game.sheet.name,to:'here',why:'Left on the desk.'}]);
  await assert.rejects(game.apply([{kind:'object',name:NOTEBOOK,to:game.sheet.name,adopt:NOTEBOOK}]),/Adopt needs/);
});

test('a define of the registered name with other parameters keeps the registered definition',async t=>{
  const game=await gear(t);
  // The Keeper's creator ran before the background registration landed, so its parameters differ.
  const define=await keeperDefine(game,NOTEBOOK,plain(NOTEBOOK,{description:'A battered field notebook.'}));
  await registered(game);
  await game.apply([define]);
  assert.ok((await receipts(game)).some(value=>value.kind==='definition'&&value.kept_registered===true));
  assert.equal((await game.world()).objects.definitions[(await instance(game,NOTEBOOK))[0].definition].description,'Carried equipment.');
});

test('a definition the Keeper gave the name while it was being prepared is adopted rather than regenerated',async t=>{
  const game=await gear(t);
  await judged(game,{[NOTEBOOK]:'notebook'});
  const {jobs:[job]}=await game.call('mods.equipment.prepare');
  await game.apply([await keeperDefine(game,NOTEBOOK,plain(NOTEBOOK,{description:'The Keeper\'s notebook.'}))]);
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(plain(job.input.name)));
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'ready');
  const [item]=await instance(game,NOTEBOOK);
  assert.equal((await game.world()).objects.definitions[item.definition].description,'The Keeper\'s notebook.');
  assert.equal(item.document.text,'');assert.equal(item.equipment_name,NOTEBOOK);
});

test('writing in a carried row nobody judged registers it from then on; a row Jev answered none keeps its answer',async t=>{
  const game=await gear(t);
  const write=()=>game.apply([{kind:'object',name:NOTEBOOK,to:game.sheet.name,document:{action:'append',text:'Three stones.'},why:'The investigator notes the stones.'}]);
  await assert.rejects(write(),error=>error.details?.equipment_row===NOTEBOOK&&/adopt/.test(error.fix));
  assert.deepEqual((await game.call('mods.equipment.surfaces')).rows.map(value=>value.name),['Camera'],'the written row is judged by the attempt');
  const {jobs}=await game.call('mods.equipment.prepare');
  assert.equal(jobs.length,1);assert.match(jobs[0].input.description,/presentation paper/);
  const other=await gear(t);
  await judged(other,{});
  await assert.rejects(other.apply([{kind:'object',name:NOTEBOOK,to:other.sheet.name,document:{action:'append',text:'x'},why:'Notes.'}]),
    error=>error.details?.equipment_row===NOTEBOOK);
  assert.deepEqual((await other.call('mods.equipment.prepare')).jobs,[],'the answer none stands');
});
