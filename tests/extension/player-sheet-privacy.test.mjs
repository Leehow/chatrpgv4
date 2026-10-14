import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {KernelClient} from '../../extensions/kernel/client.ts';

// The production JSONL subprocess is already built by the runtime build stage.
// This test deliberately neither builds a kernel nor substitutes RPC responses.
test('player sheet omits private setup metadata in ready and setup views across a real kernel restart',async t=>{
  const repo=resolve(import.meta.dirname,'../..'),workspace=await mkdtemp(join(tmpdir(),'player-sheet-privacy-'));
  const start=()=>new KernelClient({command:[process.execPath,join(repo,'build/kernel/rpc.mjs'),'--workspace',workspace,'--content',join(repo,'content')],cwd:repo});
  let client=start();t.after(async()=>{await client.close();await rm(workspace,{recursive:true,force:true});});
  await client.call('campaign.create',{id:'privacy-table',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  const folder=join(workspace,'.coc/campaigns/privacy-table'),path=join(folder,'party/thomas-hayes.json');
  const sheet=JSON.parse(await readFile(path,'utf8'));
  sheet.setting_era='private-setting-canary';
  sheet.finance={...sheet.finance,period:'1920s',cash:{amount:60,currency:'USD'},substituted_for:'private-finance-canary',note:'private-note-canary'};
  sheet.creation={...sheet.creation,finance:{...sheet.creation?.finance,period:'1920s',cash:60,substituted_for:'private-creation-canary',note:'private-creation-note-canary'}};
  const raw=JSON.stringify(sheet);await writeFile(path,raw);
  const check=async(state)=>{
    const view=await client.call('table.view',{campaign:'privacy-table'});
    assert.equal(view.state,state);
    const publicSheet=view.investigators[0];
    assert.equal(publicSheet.setting_era,undefined);
    for(const finance of [publicSheet.finance,publicSheet.creation.finance]){
      assert.equal(finance.substituted_for,undefined);assert.equal(finance.note,undefined);
      assert.equal(finance.period,'1920s');
    }
    assert.deepEqual(publicSheet.finance.cash,{amount:60,currency:'USD'});
    assert.equal(publicSheet.creation.finance.cash,60);
    assert.equal(publicSheet.characteristics.STR,sheet.characteristics.STR);
    assert.equal(await readFile(path,'utf8'),raw);
  };
  await check('awaiting_player');
  const privateView=await client.call('table.look',{campaign:'privacy-table',focus:'investigator',name:'thomas-hayes'});
  assert.equal(privateView.setting_era,sheet.setting_era);
  assert.deepEqual(privateView.finance,sheet.finance);assert.deepEqual(privateView.creation,sheet.creation);
  await client.close();client=start();await check('awaiting_player');
  await client.close();
  const metaPath=join(folder,'campaign.json'),meta=JSON.parse(await readFile(metaPath,'utf8'));
  meta.status='setting_up';await writeFile(metaPath,JSON.stringify(meta));client=start();
  await check('setting_up');await client.close();client=start();await check('setting_up');
});
