import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPiHostBackend} from '../src/index.js';
import {readDefensePreference} from '../src/coc-defense.js';

it('saves only the selected campaign binding and shares the policy with another session',async()=>{
  const root=await mkdtemp(join(tmpdir(),'defense-host-')), repo=resolve(import.meta.dirname,'../../../..');
  const profile=join(root,'profile'), pack=join(profile,'extensions/coc-keeper');
  await mkdir(pack,{recursive:true});
  await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));
  await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
  const backend=createPiHostBackend({agentDir:profile,sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),env:{...process.env,PI_COC_HOME:root},spawn:()=>{throw new Error('No player message may start Pi');}});
  try {
    await backend.handle('addProject',[root]);
    const [project]=await backend.handle('listProjects',[]) as any[];
    const sessions=await Promise.all([backend.handle('newSession',[project.id]),backend.handle('newSession',[project.id])]) as any[];
    await mkdir(join(root,'.coc/campaigns/first'),{recursive:true});
    await mkdir(join(root,'.coc/campaigns/second'),{recursive:true});
    for(const session of sessions) {
      const found=await (backend as any).locate(session.id);
      await writeFile(found.path+'.coc.json',JSON.stringify({campaign:'first',home:root,play_language:'en'}));
    }
    const save=(session:any,campaign:string,defense:string)=>backend.handle('invokeExtension',['coc-keeper','defense-preference',{campaign,defense},{sessionId:session.id}]);
    expect(await save(sessions[0],'first','fight_back')).toMatchObject({ok:true,data:{defense_preference:'fight_back'}});
    expect(await readDefensePreference(root,'first')).toBe('fight_back');
    expect(await readDefensePreference(root,'second')).toBe('dodge');
    expect(await save(sessions[1],'first','dodge')).toMatchObject({ok:true,data:{defense_preference:'dodge'}});
    expect(await save(sessions[0],'second','fight_back')).toMatchObject({ok:false});
    expect(await save(sessions[0],'first','none')).toMatchObject({ok:false});
    expect(await readDefensePreference(root,'first')).toBe('dodge');
    // The old defense card cannot be submitted even when the persisted ask still matches.
    const invoke=(backend as any).invokeExtension.bind(backend);
    let choice:any={name:'old-defense',binds:'defense:attacker-r1',kind:'mechanics',options:['dodge','fight_back','flee']};
    vi.spyOn(backend as any,'invokeExtension').mockImplementation(async(...args:any[])=>args[1]==='sheet'
      ?{ok:true,data:{view:{play_language:'en',pending_choice:choice}}}:invoke(...args));
    const handle=backend.handle.bind(backend), sent:any[]=[];
    let failSend=false;
    vi.spyOn(backend,'handle').mockImplementation(async(method:any,args:any)=>{
      if(method==='sendPrompt'){if(failSend)throw new Error('Send failed');sent.push(args);return undefined;} return handle(method,args);
    });
    for(const option of choice.options)
      expect(await backend.handle('invokeExtension',['coc-keeper','choose',{choice:choice.name,option},{sessionId:sessions[0].id}])).toMatchObject({ok:false});
    choice={name:'old-story-defense',binds:'defense:attacker-r1',kind:'story',options:['Retreat']};
    expect(await backend.handle('invokeExtension',['coc-keeper','choose',{choice:choice.name,option:'Retreat'},{sessionId:sessions[0].id}])).toMatchObject({ok:false});
    expect(sent).toHaveLength(0);
    choice={name:'ordinary-flee',kind:'mechanics',options:['flee','accept']};
    expect(await backend.handle('invokeExtension',['coc-keeper','choose',{choice:choice.name,option:'flee'},{sessionId:sessions[0].id}])).toMatchObject({ok:true,data:{sent:true}});
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0][1]).action).toBe('flee');
    choice={name:'cash-quote',kind:'mechanics',prompt:'Accept the quoted cash cost?',binds:'cash-quote-47',options:['accept','flee']};
    const choose=(params:any)=>backend.handle('invokeExtension',['coc-keeper','choose',params,{sessionId:sessions[0].id}]);
    expect(await choose({choice:'stale',option:'accept'})).toMatchObject({ok:false});
    expect(await choose({choice:choice.name,option:'invented'})).toMatchObject({ok:false});
    expect(sent).toHaveLength(1);
    expect(await choose({choice:choice.name,option:'accept',binds:'forged',prompt:'Different amount',context:{name:'forged'}})).toMatchObject({ok:true});
    expect(JSON.parse(sent[1][1])).toEqual({kind:'mechanics_choice',action:'accept',choice:{...choice},play_language:'en'});
    expect(await choose({choice:choice.name,option:'accept'})).toMatchObject({ok:false});
    expect(sent).toHaveLength(2);
    choice={name:'ordinary-story',kind:'story',options:['Wait here']};
    expect(await choose({choice:choice.name,option:'Wait here'})).toMatchObject({ok:true});
    expect(sent[2][1]).toBe('Wait here');
    choice={name:'retry-choice',kind:'mechanics',binds:'cash-quote-47',options:['accept']};
    failSend=true;
    await expect(choose({choice:choice.name,option:'accept'})).rejects.toThrow('Send failed');
    failSend=false;
    expect(await choose({choice:choice.name,option:'accept'})).toMatchObject({ok:true});
    expect(JSON.parse(sent[3][1]).choice).toEqual(choice);
  } finally {await backend.close(); await rm(root,{recursive:true,force:true});}
});
