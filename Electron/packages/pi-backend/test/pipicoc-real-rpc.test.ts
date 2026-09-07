import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPiHostBackend } from '../src/index.js';

// Real transport and real Pi/kernel, with no player prompt and no model completion.
it('connects the copied host and sheet bridge to the canonical setup process', async () => {
  const repo = resolve(import.meta.dirname, '../../../..');
  const root = await mkdtemp(join(tmpdir(), 'pipicoc-host-seam-'));
  const agentDir = join(root, 'profile');
  const pack = join(agentDir, 'extensions/coc-keeper');
  await mkdir(pack, {recursive:true});
  await cp(join(repo, 'pipiui-extension.json'), join(pack, 'pipiui-extension.json'));
  await cp(join(repo, 'pipicoc'), join(pack, 'pipicoc'), {recursive:true});
  let spawned = 0;
  const backend = createPiHostBackend({agentDir, sessionsRoot:join(root,'sessions'),
    runtimeRoot:join(root,'runtime'),
    spawn:(command,args,options) => { spawned++; return spawn(command,args,options) as any; }, defaultPack:'coc-keeper', resourceMode:'explicit',
    piPath:join(repo,'pipicoc/rpc'), managedNodeModulesRoot:join(repo,'node_modules'),
    env:{...process.env, PI_COC_MODE:'setup', PI_COC_HOME:join(root,'game'), UV_CACHE_DIR:'/tmp/pi-coc-uv-cache'},
  });
  try {
    await backend.handle('addProject',[root]);
    const projects = await backend.handle('listProjects',[]) as any[];
    const session = await backend.handle('newSession',[projects[0].id]) as any;
    // Open the same lazy runtime used by sendPrompt, without submitting a model request.
    const live = await (backend as any).ensure(session.id);
    expect(live.process.pid).toBeGreaterThan(0);
    await (backend as any).startAutomaticSessionTitle(live, "Prepare the table");
    expect(spawned).toBe(1);
    const result = await backend.handle('invokeExtension',[
      'coc-keeper','sheet',{}, {sessionId:session.id}
    ]) as any;
    expect(result).toMatchObject({ok:true,data:{view:null,campaign:null}});
  } finally {
    await backend.close();
  }
}, 30000);
