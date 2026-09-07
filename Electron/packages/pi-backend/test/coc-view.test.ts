import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mechanicsEntry,readCocBinding,readColdSheet} from '../src/coc-view.js';
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
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),spawn:()=>{spawns++;throw new Error('Pi must remain asleep');}});
  try {
    await backend.handle('addProject',[root]);const projects=await backend.handle('listProjects',[]) as any[];
    const first=await backend.handle('newSession',[projects[0].id]) as any;
    const result=await backend.handle('invokeExtension',['coc-keeper','sheet',{}, {sessionId:first.id}]) as any;
    expect(result).toMatchObject({ok:true,data:{status:'unbound',view:null}});
    expect(spawns).toBe(0);
    const anonymous=await backend.handle('invokeExtension',['coc-keeper','sheet',{}]) as any;
    expect(anonymous).toMatchObject({ok:true,data:{status:'unbound'}});
  }finally{await backend.close();}
});
