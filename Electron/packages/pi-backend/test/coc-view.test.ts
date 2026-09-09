import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {draftPresentations,laneProjection,laneWords,mechanicsEntry,readCocBinding,readColdSheet} from '../src/coc-view.js';
import {KernelClient} from '../../../../extensions/kernel/client.js';

it('projects only public rows with stable identity and language',()=>{
  const entry=mechanicsEntry({type:'custom',id:'projection',customType:'coc-mechanics',timestamp:'2026-09-07',data:{turn:2,mechanics:[{kind:'roll',visibility:'keeper',roll:99},{kind:'roll',visibility:'public',roll:25,target:50},{kind:'time',minutes:5}]}},'zh-Hans')!;
  expect(entry.id).toBe('projection');
  expect(JSON.stringify(entry)).not.toContain('99');
  expect(entry.presentation?.details).toMatchObject({play_language:'zh-Hans',mechanics:[{roll:25,target:50},{minutes:5}]});
});
it('missing binding stays missing and a recorded binding wins over a legacy sidecar',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-binding-'));const file=join(root,'session.jsonl');await writeFile(file,'');
  expect(await readCocBinding(file)).toBeUndefined();
  await writeFile(file+'.coc.json',JSON.stringify({campaign:'older',home:root,play_language:'en'}));
  expect((await readCocBinding(file))?.campaign).toBe('older');
  await writeFile(file,JSON.stringify({type:'custom',customType:'coc-session',data:{campaign:'current',home:root,play_language:'zh-Hans'}})+'\n');
  expect((await readCocBinding(file))?.campaign).toBe('current');
});
it('a cold sheet read starts no Keeper and leaves campaign bytes unchanged',async()=>{
  const repo=resolve(import.meta.dirname,'../../../..');const root=await mkdtemp(join(tmpdir(),'coc-cold-view-'));
  const client=new KernelClient({command:['uv','run','--frozen','python','-m','coc.rpc','--workspace',root,'--content',join(repo,'content')],cwd:repo,env:{PYTHONPATH:join(repo,'kernel'),UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'}});
  try {await client.call('campaign.create',{id:'cold-view',module:'the-haunting',pregen:'thomas-hayes',play_language:'zh-Hans'});}finally{await client.close();}
  const dir=join(root,'.coc/campaigns/cold-view');
  const files=['campaign.json','world.json','turn.json'];
  const before=await Promise.all(files.map(f=>readFile(join(dir,f),'utf8')));
  const view=await readColdSheet(repo,{campaign:'cold-view',home:root,play_language:'zh-Hans'}) as any;
  expect(view.investigators.length).toBeGreaterThan(0);
  expect(await Promise.all(files.map(f=>readFile(join(dir,f),'utf8')))).toEqual(before);
},20000);

it('cold host sheet reads are tied to the requested session and never start Pi',async()=>{
  const {cp}=await import('node:fs/promises');
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),'coc-cold-host-'));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  let spawns=0;
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root,PATH:'/usr/bin:/bin'},piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},spawn:()=>{spawns++;throw new Error('Pi must remain asleep');}});
  try {
    await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
    const first=await backend.handle('newSession',[projects[0].id]) as any;
    const result=await backend.handle('invokeExtension',['coc-keeper','sheet',{}, {sessionId:first.id}]) as any;
    expect(result).toMatchObject({ok:true,data:{status:'unbound',view:null}});
    expect(spawns).toBe(0);
    const anonymous=await backend.handle('invokeExtension',['coc-keeper','sheet',{}]) as any;
    expect(anonymous).toMatchObject({ok:true,data:{status:'unbound'}});
    const catalog=await backend.handle('invokeExtension',['coc-keeper','onboarding',{action:'catalog'}, {sessionId:first.id}]) as any;
    expect(catalog.ok).toBe(true);
    const mods=await backend.handle('invokeExtension',['coc-keeper','mods.list',{campaign:'must-not-be-guessed'}, {sessionId:first.id}]) as any;
    expect(mods.ok).toBe(true);
    expect(mods.data.mods.map((row:any)=>row.id)).toEqual(['enhanced-items','natural-npc']);
    expect(mods.data.campaign).toBeUndefined();
    const defaults=await backend.handle('invokeExtension',['coc-keeper','mods.defaults',{id:'natural-npc',enabled:false}, {sessionId:first.id}]) as any;
    expect(defaults).toMatchObject({ok:true,data:{'natural-npc':false}});
    const refused=await backend.handle('invokeExtension',['coc-keeper','mods.configure',{id:'natural-npc',enabled:false,campaign:'another'}, {sessionId:first.id}]) as any;
    expect(refused.ok).toBe(false);
    expect(spawns).toBe(0);
  }finally{await backend.close();}
});

it('preserves the kernel glossary on mechanics renderer details', () => {
  const labels = {'Spot Hidden':'侦查'};
  const entry = mechanicsEntry({type:'custom', id:'localized', customType:'coc-mechanics', data:{
    turn:1, play_language:'zh-Hans', labels, mechanics:[{kind:'roll',skill:'Spot Hidden',roll:25,target:50}]
  }})!;
  expect(entry.presentation?.details).toMatchObject({labels});
});

it('converse waits for startup and immediately projects the persisted first question',async()=>{
  // A transport seam fixture, not a simulated Keeper or gameplay acceptance.
  const {cp,appendFile}=await import('node:fs/promises');
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),'coc-opening-delivery-'));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const preparation={invoke:async()=>({campaign:'delivery-fixture',name:'Source meeting',play_language:'en'}),close:async()=>{}};
  const registry={get:()=>preparation,close:async()=>{}};
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),cocOnboardingRegistry:registry as any,spawn:()=>{throw new Error('No model is needed to deliver a prepared question');}});
  const frames:any[]=[];const unsubscribe=backend.subscribe(frame=>frames.push(frame));
  try {
    await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
    const session=await backend.handle('newSession',[projects[0].id]) as any;
    vi.spyOn(backend as any,'getModelState').mockResolvedValue({model:{provider:'unknown',id:'fixture'},thinkingLevel:'low'});
    vi.spyOn(backend as any,'ensure').mockResolvedValue({});
    const command=vi.spyOn(backend as any,'command').mockImplementation(async()=>{
      const file=(await (backend as any).locate(session.id)).path;
      const rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
      await appendFile(file,JSON.stringify({type:'custom_message',id:'prepared-question',parentId:rows.at(-1)?.id||null,
        customType:'coc-setup-opening',display:true,content:'Who joins this expedition?',timestamp:new Date().toISOString()})+'\n');
      return {isStreaming:false};
    });
    const result=await backend.handle('invokeExtension',['coc-keeper','onboarding',{action:'converse',id:'import-fixture'},{sessionId:session.id}]) as any;
    expect(result.ok).toBe(true);expect(command).toHaveBeenCalledWith(session.id,{type:'get_state'});
    expect(frames.some(frame=>frame.channel==='stream'&&frame.event.type==='presentation'&&frame.event.entry.role==='assistant'&&frame.event.entry.content==='Who joins this expedition?')).toBe(true);
  }finally{unsubscribe();await backend.close();}
});

it('setup exit lets the play child establish a new turn when its agent_start was unobservable',async()=>{
  const {createPiHostBackend}=await import('../src/index.js');
  const root=await mkdtemp(join(tmpdir(),'coc-handoff-epoch-'));
  const backend=createPiHostBackend({agentDir:root,sessionsRoot:join(root,'sessions')});
  const internal=backend as any,frames:any[]=[];
  const unsubscribe=backend.subscribe(frame=>frames.push(frame));
  const token={};
  vi.spyOn(internal,'sessionRuntimeTokenIsCurrent').mockReturnValue(true);
  const mark=vi.spyOn(internal.queue,'markBusy').mockReturnValue(8);
  internal.queueLoads.set('handoff',Promise.resolve());
  const live={session:{id:'handoff'},runtimeToken:token,turnEpoch:7,terminalEpoch:7,messageEpoch:4,
    compaction:{cancel:()=>{}},followUps:[],toolNames:new Map(),toolArgs:new Map()};
  try {
    internal.rpcEvent(live,{type:'entry_appended',entry:{type:'custom',customType:'coc-setup-exit'}});
    internal.rpcEvent(live,{type:'message_start',message:{role:'assistant',content:[]}});
    expect(mark).toHaveBeenCalledTimes(1);expect(live.turnEpoch).toBe(8);
    expect(frames.some(frame=>frame.channel==='stream'&&frame.event.type==='status'&&frame.event.status==='started'&&frame.event.turnEpoch===8)).toBe(true);
  }finally{unsubscribe();await backend.close();}
});

it('a drawn card travels with the row, and only an unprojected draft is left to fetch',async()=>{
  const home=await mkdtemp(join(tmpdir(),'coc-draft-projection-'));
  const binding={campaign:'c1',home,play_language:'zh-Hans'};
  const folder=join(home,'.coc/campaigns/c1/setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'1-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:{Parameter:'参数'},finance_equipment:[]}));
  await writeFile(join(folder,'2-en.json'),JSON.stringify({play_language:'en',texts:{Parameter:'Parameter'}}));
  await writeFile(join(folder,'standing-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:{Office:'办公室'}}));
  await writeFile(join(folder,'3-zh-Hans.json'),'{ half written');
  const saved=await draftPresentations(binding);
  expect([...saved.keys()]).toEqual([1]);
  const row=(revision:number)=>({type:'custom',id:`draft-${revision}`,customType:'coc-character-draft',timestamp:'2026-09-09',data:{revision,sheet:{name:'艾琳'},labels:{}}});
  const drawn=mechanicsEntry(row(1),'zh-Hans',saved)!;
  expect((drawn.presentation?.details as any).presentation.texts).toEqual({Parameter:'参数'});
  // A revision with no projection yet must stay fetchable; attaching nothing is not attaching {}.
  expect((mechanicsEntry(row(2),'zh-Hans',saved)!.presentation?.details as any).presentation).toBeUndefined();
  expect((mechanicsEntry(row(3),'zh-Hans',saved)!.presentation?.details as any).presentation).toBeUndefined();
  expect(await draftPresentations(undefined)).toEqual(new Map());
  expect(await draftPresentations({campaign:'absent',home,play_language:'zh-Hans'})).toEqual(new Map());
});

it('lane words come from the built presenter, and each saved projection says what its lane still lacks',async()=>{
  const repo=resolve(import.meta.dirname,'../../../..');
  const summary='Corbitt can form pools of blood on floor, ceiling, or walls to frighten intruders away from his secret.';
  const view={play_language:'zh-Hans',investigators:[{id:'inv-1',objects:[{name:'相机',description:'一台相机。',traits:[{name:'length',value:22,unit:'cm'},{name:'material',value:'mahogany'}],state:{condition:'intact',ammo:null}}]}],
    clues:{discovered:[{clue:'blood-pool-manifest',label:'血泊',summary}]}};
  const words=await laneWords(repo,'possessions',view);
  expect(words).toEqual(['cm','condition','intact','length','mahogany','material']);
  const clueWords=await laneWords(repo,'clues',view);
  expect(clueWords).toEqual([summary,'血泊']);
  const home=await mkdtemp(join(tmpdir(),'coc-lanes-'));
  const context={campaign:'c1',home,play_language:'zh-Hans'};
  expect(await laneProjection(context,'possessions',words)).toEqual({texts:{},missing:words});
  const folder=join(home,'.coc/campaigns/c1/setup/presentations');await mkdir(folder,{recursive:true});
  const texts={cm:'厘米',condition:'状态',intact:'完好',length:'长度',material:'材质'};
  await writeFile(join(folder,'possessions-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts}));
  expect(await laneProjection(context,'possessions',words)).toEqual({texts,missing:['mahogany']});
  // Each lane reads its own file: the possession words say nothing about the clues.
  expect(await laneProjection(context,'clues',clueWords)).toEqual({texts:{},missing:clueWords});
  const said={[summary]:'科比特能让地板、天花板或墙上渗出血泊，把闯入者吓离他的秘密。','血泊':'血泊'};
  await writeFile(join(folder,'clues-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:said}));
  expect(await laneProjection(context,'clues',clueWords)).toEqual({texts:said,missing:[]});
  // A projection in another language is no projection at all.
  await writeFile(join(folder,'possessions-zh-Hans.json'),JSON.stringify({play_language:'en',texts:{cm:'cm'}}));
  expect((await laneProjection(context,'possessions',words)).missing).toEqual(words);
});

it('a bound sheet read merges every lane\'s saved words under the kernel glossary and starts no run for a sheet that lacks nothing',async()=>{
  const {cp}=await import('node:fs/promises');
  const {createPiHostBackend}=await import('../src/index.js');
  const repo=resolve(import.meta.dirname,'../../../..'),root=await mkdtemp(join(tmpdir(),'coc-possession-host-'));
  const client=new KernelClient({command:['uv','run','--frozen','python','-m','coc.rpc','--workspace',root,'--content',join(repo,'content')],cwd:repo,env:{PYTHONPATH:join(repo,'kernel'),UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'}});
  try {await client.call('campaign.create',{id:'carried',module:'the-haunting',pregen:'thomas-hayes',play_language:'zh-Hans'});}finally{await client.close();}
  const folder=join(root,'.coc/campaigns/carried/setup/presentations');await mkdir(folder,{recursive:true});
  // The projection may not outrank the glossary: the kernel's word for a skill stays the kernel's.
  await writeFile(join(folder,'possessions-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:{intact:'完好','Spot Hidden':'不是这个'}}));
  const summary='Corbitt can form pools of blood on floor, ceiling, or walls to frighten intruders away from his secret.';
  await writeFile(join(folder,'clues-zh-Hans.json'),JSON.stringify({play_language:'zh-Hans',texts:{[summary]:'科比特能让地板、天花板或墙上渗出血泊，把闯入者吓离他的秘密。'}}));
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root,UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'},piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},spawn:()=>{throw new Error('Pi must remain asleep');}});
  try {
    await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
    const session=await backend.handle('newSession',[projects[0].id]) as any;
    const located=await (backend as any).locate(session.id);
    await writeFile(located.path+'.coc.json',JSON.stringify({campaign:'carried',home:root,play_language:'zh-Hans'}));
    const result=await backend.handle('invokeExtension',['coc-keeper','sheet',{}, {sessionId:session.id}]) as any;
    expect(result.ok).toBe(true);expect(result.data.status).toBe('ready');
    expect(result.data.view.labels.intact).toBe('完好');
    expect(result.data.view.labels[summary]).toBe('科比特能让地板、天花板或墙上渗出血泊，把闯入者吓离他的秘密。');
    expect(result.data.view.labels['Spot Hidden']).toBe('侦查');
    expect((backend as any).cocLaneJobs.size).toBe(0);
  } finally {await backend.close();}
},40000);
