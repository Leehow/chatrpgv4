import {expect,it,vi} from 'vitest';
import {appendFile,cp,mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {KernelClient} from '../../../../extensions/kernel/client.js';
import {prepareCluePresentation} from '../../../../extensions/module/character-presentation.ts';
import {readColdSheet} from '../src/coc-view.js';
import {createPiHostBackend} from '../src/index.js';

it('opening an old history card backfills its public account and redraws it without a Keeper turn',async()=>{
  const repo=resolve(import.meta.dirname,'../../../..'),home=await mkdtemp(join(tmpdir(),'clue-history-'));
  const campaign='clue-history',play_language='zh-Hans';
  const how='Knott explained the commission in person.',latest='Knott later clarified the commission.';
  const translated='诺特当面说明了委托。',label='诺特的委托';
  const client=new KernelClient({command:[process.execPath,join(repo,'build/kernel/rpc.mjs'),'--workspace',home,'--content',join(repo,'content')],cwd:repo,env:{}});
  try {
    await client.call('campaign.create',{id:campaign,module:'the-haunting',pregen:'thomas-hayes',play_language});
    await client.call('table.open',{campaign});
    await client.call('table.apply',{campaign,call_id:'t0-c1',effects:[{kind:'clue',clue:'knott-commission',label,how:latest}]});
    await client.call('table.narrate',{campaign,call_id:'t0-c2',text:'Knott explains the commission.'});
  } finally {await client.close();}
  const folder=join(home,'.coc/campaigns',campaign,'setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'clues-zh-Hans.json'),JSON.stringify({play_language,texts:{[label]:label}}));
  const worldFile=join(home,'.coc/campaigns',campaign,'world.json'),worldBefore=await readFile(worldFile,'utf8');
  const asked:string[][]=[];
  const registry={get:()=>({presentation:async(request:any)=>{
    expect(request.clues).toBe(true);
    const view=await readColdSheet(repo,{home,campaign,play_language}) as any;
    return prepareCluePresentation({...request,home,view:{...view,mechanics:request.mechanics},runner:async task=>{
      const packet=JSON.parse(await readFile(join(task.cwd,'texts.json'),'utf8'));
      asked.push(packet.sources.map((row:any)=>row.text));
      await writeFile(join(task.cwd,'presentation.json'),JSON.stringify({protocol:packet.protocol,
        texts:packet.sources.map((row:any)=>({source:row.alias,action:'translate',text:row.text===how?translated:'后续澄清。'})),finance_equipment_sources:[]}));
      return {ok:true};
    }});
  }}),dispose(){},async close(){}} as any;
  const profile=join(home,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(home,'sessions'),runtimeRoot:join(home,'runtime'),
    defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),cocOnboardingRegistry:registry,
    env:{...process.env,PI_COC_HOME:home},spawn:()=>{throw new Error('Keeper must remain asleep');}});
  vi.spyOn(backend as any,'getModelState').mockResolvedValue({model:{provider:'unknown',id:'fixture'},thinkingLevel:'low'});
  const events:any[]=[];backend.subscribe((frame:any)=>{if(frame.channel==='stream'&&frame.event?.type==='presentation')events.push(frame.event);});
  try {
    await backend.handle('addProject',[home]);const projects=await backend.handle('listProjects',[]) as any[];
    const session=await backend.handle('newSession',[projects[0].id]) as any,located=await (backend as any).locate(session.id);
    await writeFile(located.path+'.coc.json',JSON.stringify({home,campaign,play_language}));
    const raw={type:'custom',id:'old-clue-card',customType:'coc-mechanics',timestamp:new Date().toISOString(),data:{turn:0,play_language,
      mechanics:[{kind:'clue',clue:'knott-commission',label,how,summary:'Private Keeper staging'}]}};
    await appendFile(located.path,JSON.stringify(raw)+'\n');const transcriptBefore=await readFile(located.path,'utf8');
    const first=await backend.handle('getSessionHistory',[session.id]) as any[];
    expect(first.find(row=>row.id===raw.id).presentation.details.labels[how]).toBeUndefined();
    await vi.waitFor(()=>expect(events).toHaveLength(1),{timeout:5000});
    expect(events[0].entry.id).toBe(raw.id);
    expect(events[0].entry.presentation.details.labels[how]).toBe(translated);
    expect(asked).toEqual([[how,latest].sort()]);
    const next=await backend.handle('getSessionHistory',[session.id]) as any[];
    expect(next.find(row=>row.id===raw.id).presentation.details.labels[how]).toBe(translated);
    expect(await readFile(worldFile,'utf8')).toBe(worldBefore);
    expect(await readFile(located.path,'utf8')).toBe(transcriptBefore);
    expect(asked).toHaveLength(1);
  } finally {await backend.close();}
},20000);
