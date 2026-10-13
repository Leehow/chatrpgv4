/** Whole-batch atomicity through the production TypeScript RPC and persisted campaign state. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {kernel,openTurn,campaignDir,RpcClient,prepared,CAMPAIGN,type Row} from './support.ts';

function savedState(folder:string):Record<string,Buffer>{
  const paths=['campaign.json','world.json','turn.json','events.jsonl','transcript.jsonl'];
  const walk=(name:string)=>{
    if(!existsSync(join(folder,name)))return;
    for(const entry of readdirSync(join(folder,name),{withFileTypes:true})){
      const path=join(name,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())paths.push(path);
    }
  };
  for(const name of ['party','save','handouts'])walk(name);
  return Object.fromEntries(paths.filter(name=>existsSync(join(folder,name))).sort().map(name=>[name,readFileSync(join(folder,name))]));
}

async function notebook(k:RpcClient){
  await openTurn(k,'I take notes while examining the room.');
  const draft={name:'Notebook',category:'item',description:'An ordinary writable carrier.',
    basis:'Fixture text, not an authored scenario claim.',parameters:{charges:null,effects:[]},
    document:{text:'A',presentation:'notebook'},player_view:{description:'A carried paper.',fields:[]}};
  await k.table('apply',{call_id:'t1-c1',effects:[await prepared(k,draft),{kind:'object',name:'Notebook',to:'Thomas Hayes'}]});
}
const append=(text:string)=>({kind:'object',name:'Notebook',from:'Thomas Hayes',to:'Thomas Hayes',
  document:{action:'append',text},why:'The investigator writes the next note.'});
const document=(k:RpcClient)=>k.ok('mods.document.view',{campaign:CAMPAIGN,actor:'Thomas Hayes',name:'Notebook'});

test('a refused ordinary batch leaves resources and the whole campaign unchanged across restart',async t=>{
  const k=await kernel(t);await openTurn(k,'I watch Knott prepare a mechanical action.');
  await k.table('apply',{call_id:'t1-c1',effects:[{kind:'npc',name:'Steven Knott',intends:'Try to force the locked mechanism.',outcome:'attempted',_generated:true}]});
  const before=await k.table('look',{focus:'investigator'}),receipts=(await k.table('status')).receipts;
  const ref=receipts.find((receipt:Row)=>receipt.intent?.generated===true).intent.ref;
  const folder=campaignDir(k.workspace),bytes=()=>savedState(folder);
  const saved=bytes();
  const error=await k.tableErr('apply',{call_id:'t1-c2',effects:[{kind:'damage',dice:'1D1',why:'A dependent fixture wound.'},
    {kind:'npc',name:'Steven Knott',intent_ref:ref,outcome:'done'}]});
  assert.equal(error.details.reason,'table_act_unsettled');
  const after=await k.table('look',{focus:'investigator'}),disk=JSON.parse(readFileSync(join(folder,'party/thomas-hayes.json'),'utf8'));
  t.diagnostic(JSON.stringify({refused:error.details.reason,beforeHp:before.hp,afterHp:after.hp,diskCurrentHp:disk.current_hp}));
  assert.deepEqual(bytes(),saved,'a refused batch must preserve actual persisted bytes');
  assert.deepEqual((await k.table('status')).receipts,receipts);assert.equal(after.hp,before.hp);
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  assert.equal((await restarted.table('look',{focus:'investigator'})).hp,before.hp);
  assert.deepEqual((await restarted.table('status')).receipts,receipts);
});

test('a refused mixed batch preserves document text, inventory, handout files and healing saves',async t=>{
  const k=await kernel(t);await notebook(k);const folder=campaignDir(k.workspace);
  const before=savedState(folder),paper=await document(k);
  const error=await k.tableErr('apply',{call_id:'t1-c2',effects:[
    {kind:'damage',dice:'1D1',why:'A dependent fixture wound.'},
    {kind:'item',name:'Loose test slips',quantity:3},append('B'),
    {kind:'handout',name:'globe-unpublished-1918'},{kind:'time',minutes:-1}]});
  assert.equal(error.code,'invalid_params');assert.equal(error.details.index,4);
  assert.deepEqual(savedState(folder),before);assert.deepEqual(await document(k),paper);
  assert.equal((await k.table('look',{focus:'investigator'})).hp,12);
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  assert.deepEqual(await document(restarted),paper);assert.deepEqual(savedState(folder),before);
});

test('a successful mixed batch reads its earlier effects and commits once across replay and restart',async t=>{
  const k=await kernel(t);await notebook(k);const folder=campaignDir(k.workspace);
  const input={call_id:'t1-c2',effects:[
    {kind:'damage',dice:'1D1',why:'The first fixture wound.'},
    {kind:'item',name:'Loose test slips',quantity:3},append('B'),
    {kind:'damage',dice:'1D1',why:'The second fixture wound.'},
    {kind:'item',name:'Loose test slips',quantity:-1},append('C')]};
  await k.table('apply',input);
  const receipts=(await k.table('status')).receipts.filter((receipt:Row)=>receipt.call_id===input.call_id);
  assert.deepEqual(receipts.filter((receipt:Row)=>receipt.resource==='hp').map((receipt:Row)=>[receipt.before,receipt.after]),[[12,11],[11,10]]);
  const writes=receipts.filter((receipt:Row)=>receipt.writing_result).map((receipt:Row)=>receipt.writing_result);
  assert.equal(writes.length,2);assert.equal(writes[1].before_version,writes[0].after_version);
  assert.equal((await document(k)).text,'ABC');assert.equal((await k.table('look',{focus:'investigator'})).hp,10);
  const sheet=JSON.parse(readFileSync(join(folder,'party/thomas-hayes.json'),'utf8'));
  assert.equal(sheet.current_hp,10);assert.equal(sheet.equipment.find((item:Row)=>item.name==='Loose test slips').quantity,2);
  const saved=savedState(folder);assert.equal((await k.table('apply',input)).replayed,true);assert.deepEqual(savedState(folder),saved);
  await k.close();const restarted=new RpcClient(k.workspace);t.after(()=>restarted.close());
  assert.equal((await restarted.table('look',{focus:'investigator'})).hp,10);assert.equal((await document(restarted)).text,'ABC');
  assert.deepEqual(savedState(folder),saved);
});
