/** Routes exercised from Electron/packages/pi-backend/src/index.ts; no Keeper or model calls. */
import {afterEach,it,expect,vi} from 'vitest';
import {cp,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as coldApi from '../src/coc-view.js';
import {createPiHostBackend} from '../src/index.js';
import {EventEmitter} from 'node:events';
import {registerModsPanel} from '../../../../pipicoc/mods.ts';
import * as renderer from '../../../../extensions/kernel/map-view.ts';

afterEach(()=>vi.restoreAllMocks());
const queued={id:'reference-one',actor_id:'investigator-one',worldline:'main',name:'Public image',handout:'issued-public-map',presentation:'map',status:'queued',editing:'read_only'};
const ready={...queued,status:'ready'};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'coc-reference-host-')),repo=resolve(import.meta.dirname,'../../../..');
  const profile=join(root,'profile'),pack=join(profile,'extensions/coc-keeper');await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',
    managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root},piCommand:{executable:join(repo,'pipicoc/rpc'),env:{PATH:process.env.PATH!}},
    spawn:()=>{throw Error('A reference must not start a Keeper prompt');}});
  const host=backend as any;
  await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
  const session=await backend.handle('newSession',[projects[0].id]) as any,path=(await host.locate(session.id)).path;
  await writeFile(path+'.coc.json',JSON.stringify({campaign:'bound-campaign',home:root,play_language:'en'}));await host.sidebarPrefsLoaded;
  const invoke=(method:string,params:any)=>backend.handle('invokeExtension',['coc-keeper',method,params,{sessionId:session.id}]) as Promise<any>;
  const finish=async()=>{await Promise.allSettled([...host.cocReferenceScans.values(),...host.cocReferenceWorkers.values()]);};
  return {backend,host,root,session,path,invoke,finish,async close(){host.live.clear();await finish();await backend.close();await rm(root,{recursive:true,force:true});}};
}

it('cold and hot reference selections return queued before completion, use the bound home/campaign and never send a prompt',async()=>{
  for(const hot of [false,true]){
    const f=await fixture(),frames:any[]=[];let release!:(value:any)=>void;
    const completed=new Promise(resolve=>{release=resolve;});
    const cold=vi.spyOn(coldApi,'callColdKernel').mockImplementation(async(_repo,home,method,params)=>{
      expect(home).toBe(f.root);expect(params.campaign).toBe('bound-campaign');
      if(method==='mods.document.collect')return {reference:queued};
      if(method==='mods.document.reference_finish'){expect(params).toEqual({campaign:'bound-campaign',reference_id:queued.id});return completed;}
      throw Error('Unexpected reference RPC '+method);
    });
    const forward=vi.spyOn(f.host,'enqueueExtInvoke'),handle=vi.spyOn(f.host,'handle');
    if(hot)f.host.live.set(f.session.id,{session:{id:f.session.id}});
    f.backend.subscribe((frame:any)=>frames.push(frame));
    try{
      const answer=await f.invoke('mods.document.collect',{actor:'investigator-one',handout:'issued-public-map',presentation:'map'});
      expect(answer).toMatchObject({ok:true,data:{reference:{status:'queued',id:queued.id}}});
      expect(forward).not.toHaveBeenCalled();
      release({reference:ready});await f.finish();
      expect(cold.mock.calls.map(row=>row[2])).toEqual(['mods.document.collect','mods.document.reference_finish']);
      expect(handle.mock.calls.some(row=>row[0]==='sendPrompt')).toBe(false);
      expect(frames.some(frame=>frame.event?.type==='sheet_changed'&&frame.event.payload.reference?.status==='ready')).toBe(true);
    }finally{release({reference:ready});cold.mockRestore();forward.mockRestore();handle.mockRestore();await f.close();}
  }
},40000);

it('renderer-owned map metadata uses only the existing internal no-prompt recovery transport',async()=>{
  const f=await fixture(),live={session:{id:f.session.id}},cold=vi.spyOn(coldApi,'callColdKernel').mockResolvedValue({reference:queued,_reference_source:{map:'canonical-public-map'}});
  f.host.live.set(f.session.id,live);vi.spyOn(f.host,'liveProcessUsable').mockReturnValue(true);vi.spyOn(f.host.extensions,'isMounted').mockReturnValue(true);
  const ensure=vi.spyOn(f.host,'ensure').mockResolvedValue(live),forward=vi.spyOn(f.host,'enqueueExtInvoke').mockResolvedValue({ok:true,data:{reference:ready}});
  try{
    const answer=await f.invoke('mods.document.collect',{actor:'investigator-one',handout:'wrapper-map',presentation:'map'});
    expect(answer.data._reference_source).toBeUndefined();await f.finish();
    expect(ensure).toHaveBeenCalledWith(f.session.id,undefined,true);
    expect(forward).toHaveBeenCalledWith(f.session.id,'coc-keeper','mods.document.reference_finish',{reference_id:queued.id});
    expect(cold.mock.calls.map(row=>row[2])).toEqual(['mods.document.collect']);
  }finally{await f.close();}
},40000);

it('client overrides, public finish, archived sessions and nonwritable leases are refused before collection RPC',async()=>{
  const f=await fixture(),cold=vi.spyOn(coldApi,'callColdKernel'),request={actor:'investigator-one',handout:'issued-public-map',presentation:'map'};
  try{
    for(const extra of [{home:'/foreign'},{campaign:'foreign'},{path:'/foreign.png'},{image:'injected'},{_reference_source:{map:'private'}}]){
      expect(await f.invoke('mods.document.collect',{...request,...extra})).toMatchObject({ok:false,error:{code:'invalid_params'}});
    }
    expect(await f.invoke('mods.document.reference_finish',{reference_id:queued.id})).toMatchObject({ok:false,error:{code:'capability_denied'}});
    f.host.sidebarArchivedCache.add(f.session.id);
    expect(await f.invoke('mods.document.collect',request)).toMatchObject({ok:false,error:{code:'capability_denied'}});
    f.host.sidebarArchivedCache.delete(f.session.id);
    vi.spyOn(f.host,'leaseFor').mockReturnValue({query:async()=>({writable:false})});
    expect(await f.invoke('mods.document.collect',request)).toMatchObject({ok:false,error:{code:'capability_denied'}});
    expect(cold).not.toHaveBeenCalled();
    const reply={ok:true,data:{status:'ready',view:{investigators:[]}}};
    expect((await f.host.cocReferenceSheetAccess(reply,f.session.id)).data.collection_writable).toBe(false);
  }finally{await f.close();}
},40000);

it('listing resumes queued durable references, deduplicates completion and strips private job metadata',async()=>{
  const f=await fixture();let release!:(value:any)=>void;const completed=new Promise(resolve=>{release=resolve;});
  const cold=vi.spyOn(coldApi,'callColdKernel').mockImplementation(async(_repo,_home,method)=>{
    if(method==='mods.document.references')return {references:[queued],_reference_jobs:[{reference_id:queued.id}]};
    if(method==='mods.document.reference_finish')return completed;throw Error('Unexpected RPC '+method);
  });
  try{
    for(let i=0;i<2;i++){const answer=await f.invoke('mods.document.references',{actor:'investigator-one'});expect(answer.data._reference_jobs).toBeUndefined();}
    release({reference:ready});await f.finish();expect(cold.mock.calls.filter(row=>row[2]==='mods.document.reference_finish')).toHaveLength(1);
    expect((await f.host.cocReferenceSheetAccess({ok:true,data:{}},f.session.id)).data.collection_writable).toBe(true);
    f.host.sidebarArchivedCache.add(f.session.id);
    expect((await f.host.cocReferenceSheetAccess({ok:true,data:{}},f.session.id)).data.collection_writable).toBe(false);
  }finally{release({reference:ready});await f.close();}
},40000);

it('a restored session scans only its retained queue and surfaces worker transport failure',async()=>{
  const f=await fixture(),frames:any[]=[];f.backend.subscribe((frame:any)=>frames.push(frame));
  const folder=join(f.root,'.coc/campaigns/bound-campaign');await mkdir(folder,{recursive:true});await writeFile(join(folder,'reference-items.json'),'{}');
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const cold=vi.spyOn(coldApi,'callColdKernel').mockImplementation(async(_repo,_home,method)=>{
    if(method==='table.view')return {investigators:[{id:'investigator-one'}]};
    if(method==='mods.document.references')return {references:[queued],_reference_jobs:[{reference_id:queued.id}]};
    if(method==='mods.document.reference_finish')throw Error('Cold transport unavailable');throw Error('Unexpected RPC '+method);
  });
  try{
    f.host.startCocReferenceRecovery(f.session.id,f.path);await f.finish();await f.finish();
    expect(cold.mock.calls.map(row=>row[2])).toEqual(['table.view','mods.document.references','mods.document.reference_finish']);
    expect(warn).toHaveBeenCalled();expect(frames.some(frame=>frame.event?.type==='reference_failed'&&frame.event.payload.reference_id===queued.id)).toBe(true);
  }finally{await f.close();}
},40000);

it('the pack retains a refused kernel record even when authorized map rendering fails first',async()=>{
  const root=await mkdtemp(join(tmpdir(),'reference-pack-host-')),events=new EventEmitter(),handlers=new Map<string,(raw:unknown)=>Promise<any>>();
  const symbol=Symbol.for('pipiui.ext-invoke.registry'),prior=(globalThis as any)[symbol];
  (globalThis as any)[symbol]={version:1,register:(_id:string,method:string,fn:any)=>{handlers.set(method,fn);return ()=>{};}};
  const calls:string[]=[],render=vi.spyOn(renderer,'renderMapView').mockRejectedValue(Error('Canvas failed')),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
  const owner={home:root,resourceRoot:root,signal:new AbortController().signal};
  try{
    registerModsPanel({events,on(){}} as any);
    events.emit('coc:kernel-bridge',{campaign:'bound-campaign',runtime:owner,call:async(method:string)=>{
      calls.push(method);
      if(method==='mods.document.collect')return {reference:queued,_reference_source:{map:'canonical-public-map'}};
      if(method==='table.look'){await barrier;return {map_views:[{map:'canonical-public-map'}]};}
      if(method==='mods.document.reference_finish')return {reference:{...queued,status:'refused'},error:{code:'document_unavailable',message:'Pinned map cache unavailable'}};
      throw Error('Unexpected pack RPC '+method);
    }});
    const answer=await handlers.get('mods.document.collect')!({actor:'investigator-one',handout:'wrapper-map',presentation:'map'});
    expect(answer.reference.status).toBe('queued');expect(answer._reference_source).toBeUndefined();release();
    await vi.waitFor(()=>expect(calls).toContain('mods.document.reference_finish'));
    expect(render).toHaveBeenCalled();expect(warn).toHaveBeenCalled();
    expect(calls).toEqual(['mods.document.collect','table.look','mods.document.reference_finish']);
  }finally{release();(globalThis as any)[symbol]=prior;await rm(root,{recursive:true,force:true});}
},40000);
