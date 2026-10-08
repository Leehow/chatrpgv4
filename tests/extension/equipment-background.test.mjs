/** Real registration/document boundaries; model authoring is controlled independently. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {table} from './object-usages-fixture.mjs';
import {waitFor} from './wait.mjs';
import modsExtension from '../../extensions/mods/index.ts';

async function gear(t, equipment = [{name:'Pocket record',quantity:2,condition:'damaged'},'Camera']) {
  const game=await table(t);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));sheet.equipment=equipment;
  await writeFile(game.sheetPath,JSON.stringify(sheet));
  return game;
}
const draft=(job, document)=>({name:job.input.name,category:'item',description:'Existing carried equipment.',basis:'The issued owned equipment row.',
  parameters:{charges:null,effects:[]},traits:[],player_view:{description:'Existing carried equipment.',fields:[]},
  ...(document?{document:{presentation:'notebook',text:'The acquired original.\nSecond line.'}}:{})});

test('background publication keeps the turn and inventory position, then the paper can save and reset immediately',async t=>{
  const game=await gear(t),before=await game.call('table.status'),prepared=await game.call('mods.equipment.prepare');
  assert.equal(prepared.jobs.length,2);
  const again=await game.call('mods.equipment.prepare');assert.deepEqual(again.jobs.map(job=>job.job),prepared.jobs.map(job=>job.job));
  assert.equal((await game.call('table.view')).investigators[0].equipment_preparation[0].status,'pending');
  const job=prepared.jobs[0];await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft(job,true)));
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'ready');
  const after=await game.call('table.status');assert.deepEqual(after,before,'background registration is not a player action or a turn');
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.equal(sheet.equipment[0].name,'Pocket record');assert.equal(sheet.equipment[0].quantity,2);
  assert.equal(sheet.equipment[1],'Camera');
  let view=await game.call('mods.document.view',{actor:game.sheet.id,name:'Pocket record'});
  assert.equal(view.text,'The acquired original.\nSecond line.');assert.equal(view.original,view.text);
  view=await game.call('mods.document.apply',{actor:game.sheet.id,name:'Pocket record',version:view.version,action:'save',text:'Player wording.'});
  assert.equal(view.text,'Player wording.');assert.equal(view.original,'The acquired original.\nSecond line.');
  view=await game.call('mods.document.apply',{actor:game.sheet.id,name:'Pocket record',version:view.version,action:'reset'});
  assert.equal(view.text,view.original);
  assert.equal((await game.call('table.look',{focus:'object',name:'Pocket record'})).instance.state.condition,'damaged');
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'ready');
  assert.equal(Object.values((await game.world()).objects.instances).filter(value=>value.name==='Pocket record').length,1);
});

test('failed work is retained for explicit retry, while a removed row cannot be resurrected',async t=>{
  const game=await gear(t),{jobs}=await game.call('mods.equipment.prepare'),job=jobs[0];
  await game.call('mods.equipment.fail',{job:job.job,code:'preparation_failed'});
  assert.equal((await game.call('mods.equipment.prepare')).jobs.some(value=>value.job===job.job),false);
  assert.equal((await game.call('table.view')).investigators[0].equipment_preparation[0].status,'failed');
  await game.call('mods.equipment.retry',{actor:game.sheet.id,name:'Pocket record'});
  assert.equal((await game.call('mods.equipment.prepare')).jobs[0].job,job.job);
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));sheet.equipment=sheet.equipment.filter(value=>value?.name!=='Pocket record');
  await writeFile(game.sheetPath,JSON.stringify(sheet));
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft(job,true)));
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'stale');
  assert.equal(Object.values((await game.world()).objects.instances).some(value=>value.name==='Pocket record'),false);
});

test('a model-selected financial placeholder is skipped without acquiring an object',async t=>{
  const game=await gear(t,['Allowance']),{jobs:[job]}=await game.call('mods.equipment.prepare');
  await writeFile(join(job.cwd,'result.json'),'null');
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'skipped');
  assert.equal((await game.call('mods.equipment.prepare')).jobs.length,0);
  assert.equal((await game.call('table.view')).investigators[0].equipment_preparation,undefined);
  assert.deepEqual(JSON.parse(await readFile(game.sheetPath,'utf8')).equipment,['Allowance']);
});

test('a retained preparation crosses player turns and recovers a world-only publication in place',async t=>{
  const game=await gear(t,['Pocket record','Camera']),{jobs}=await game.call('mods.equipment.prepare'),job=jobs[0];
  await game.call('table.narrate',{call_id:game.next(),text:'The investigation continues.'});
  await game.call('table.player_input',{text:'I look at the desk.'});
  assert.equal((await game.call('mods.equipment.prepare')).jobs[0].job,job.job);
  await writeFile(join(job.cwd,'result.json'),JSON.stringify(draft(job,true)));
  assert.equal((await game.call('mods.equipment.publish',{job:job.job})).status,'ready');
  // Interrupt recovery: the canonical world landed, but the old sheet and pending marker survived.
  const sheet=JSON.parse(await readFile(game.sheetPath,'utf8'));sheet.equipment=['Pocket record','Camera'];
  await writeFile(game.sheetPath,JSON.stringify(sheet));
  const file=join(game.directory,'save/equipment-preparation.json'),ledger=JSON.parse(await readFile(file,'utf8'));
  Object.values(ledger.entries).find(value=>value.job===job.job).status='pending';await writeFile(file,JSON.stringify(ledger));
  await game.call('table.open');
  assert.equal((await game.call('mods.equipment.prepare')).jobs.some(value=>value.job===job.job),false);
  const recovered=JSON.parse(await readFile(game.sheetPath,'utf8'));
  assert.equal(recovered.equipment[0].name,'Pocket record');assert.equal(recovered.equipment[1],'Camera');
  assert.equal(recovered.equipment.filter(value=>value.name==='Pocket record'||value==='Pocket record').length,1);
  assert.equal((await game.call('mods.document.view',{actor:game.sheet.id,name:'Pocket record'})).text,'The acquired original.\nSecond line.');
});

test('session startup returns before a held creator, then publishes without another player input',async t=>{
  const game=await gear(t,['Pocket record']),events=new EventEmitter(),hooks=new Map(),records=[];
  let release,started=false;
  const held=new Promise(resolve=>{release=resolve;});
  const pi={events,on:(name,fn)=>hooks.set(name,fn),appendEntry:()=>{}};
  modsExtension(pi);
  const controller=new AbortController();
  t.after(async()=>{controller.abort();await hooks.get('session_shutdown')?.();});
  events.emit('coc:kernel-bridge',{call:(method,params)=>game.call(method,params),record:value=>records.push(value),runtime:{signal:controller.signal,
    async check(){return {ok:true};},
    async runTask(task){started=true;await held;const request=JSON.parse(await readFile(join(task.request.cwd,'request.json'),'utf8'));
      await writeFile(join(task.request.cwd,'result.json'),JSON.stringify(draft({input:request.input},true)));
      return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};}}});
  events.emit('coc:table-open',{campaign:'c1'});
  await hooks.get('session_start')({}, {hasUI:false});
  await waitFor(()=>started,{label:'the background creator began'});
  assert.equal((await game.call('table.view')).investigators[0].equipment_preparation[0].status,'pending');
  release();
  await waitFor(async()=>Object.values((await game.world()).objects.instances).some(value=>value.name==='Pocket record'),{label:'the same owned row was registered'});
  await waitFor(()=>records.some(value=>value.lane==='equipment-preparation'&&value.status==='ready'),{label:'publication including its receipts finished'});
  assert.equal((await game.call('mods.document.view',{actor:game.sheet.id,name:'Pocket record'})).text,'The acquired original.\nSecond line.');
});
