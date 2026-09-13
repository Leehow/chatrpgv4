import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,cp,writeFile,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPiHostBackend} from '../src/index.js';

/** §35: illustration reads fall back to the campaign's own folder when no live agent answers. */
describe('coc illustration reads (§35)',()=>{
  it('answers list and get cold from the campaign folder, and refuses an unknown message',async()=>{
    const root=await mkdtemp(join(tmpdir(),'coc-illustration-read-'));
    const repo=resolve(import.meta.dirname,'../../../..');
    const pack=join(root,'profile/extensions/coc-keeper');
    await mkdir(pack,{recursive:true});
    await cp(join(repo,'pipiui-extension.json'),join(pack,'pipiui-extension.json'));
    await cp(join(repo,'pipicoc'),join(pack,'pipicoc'),{recursive:true});
    const backend=createPiHostBackend({agentDir:join(root,'profile'),sessionsRoot:join(root,'sessions'),runtimeRoot:join(root,'runtime'),defaultPack:'coc-keeper',managedNodeModulesRoot:join(repo,'node_modules'),spawn:()=>{throw new Error('illustration reads must not start a model');}});
    try {
      await backend.handle('addProject',[root]);      const [project]=await backend.handle('listProjects',[]) as any[];
      const bound=await backend.handle('newSession',[project.id,'Bound']) as any;
      const file=(await (backend as any).locate(bound.id)).path;
      const before=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
      const binding={id:'binding',type:'custom',customType:'coc-session',parentId:before.at(-1).id,timestamp:new Date().toISOString(),data:{campaign:'c1',home:root,play_language:'en'}};
      await appendFile(file,'  '+JSON.stringify(binding)+'\n');
      const folder=join(root,'.coc','campaigns','c1','illustrations');
      await mkdir(folder,{recursive:true});
      await writeFile(join(folder,'ill-abcdef0123456789.png'),Buffer.from('fake-png-bytes'));
      await writeFile(join(folder,'index.json'),JSON.stringify({'msg-1':'ill-abcdef0123456789.png'}));

      const list=await backend.handle('invokeExtension',['coc-keeper','illustration.list',{},{sessionId:bound.id}]) as any;
      expect(list.ok).toBe(true);
      expect(list.data.images).toHaveLength(1);
      expect(list.data.images[0].messageId).toBe('msg-1');
      expect(list.data.images[0].image.startsWith('data:image/png;base64,')).toBe(true);

      const got=await backend.handle('invokeExtension',['coc-keeper','illustration.get',{messageId:'msg-1'},{sessionId:bound.id}]) as any;
      expect(got.ok).toBe(true);
      expect(got.data.messageId).toBe('msg-1');
      expect(got.data.image).toBe(list.data.images[0].image);

      const missing=await backend.handle('invokeExtension',['coc-keeper','illustration.get',{messageId:'nobody'},{sessionId:bound.id}]) as any;
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe('illustration_not_found');

      const unbound=await backend.handle('newSession',[project.id,'Unbound']) as any;
      const empty=await backend.handle('invokeExtension',['coc-keeper','illustration.list',{},{sessionId:unbound.id}]) as any;
      expect(empty.ok).toBe(true);
      expect(empty.data.images).toEqual([]);
    } finally { await (backend as any).close?.(); }
  });
});
