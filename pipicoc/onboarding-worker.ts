/** Host-owned source preparation and deterministic setup; never a Keeper substitute. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { KernelClient, isKernelError } from '../extensions/kernel/client.ts';
import { ReadingService } from '../extensions/module/reading-service.ts';
import { sourceInfo } from '../extensions/module/source.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, raw] = process.argv.slice(2);
const input = JSON.parse(raw || '{}');
const emit = (type: string, data: unknown) => process.stdout.write(JSON.stringify({type, data}) + '\n');
const kernel = new KernelClient({command: ['uv', 'run', '--frozen', 'python', '-m', 'coc.rpc', '--workspace', input.home, '--content', join(repo, 'content')],
  cwd: repo, env: {...process.env, PYTHONPATH: join(repo, 'kernel'), PYTHONDONTWRITEBYTECODE: '1'} as Record<string,string>});
let reader: ReadingService | undefined;
let stopping = false;
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => {stopping = true; reader?.dispose();});
const call = (method: string, params: Record<string, unknown> = {}) => kernel.call<any>(method, params);
async function main() {
  if (action === 'catalog') {
    const presets = [];
    for (const id of await readdir(join(repo, 'content/starters'))) {
      try {
        const graph = JSON.parse(await readFile(join(repo, 'content/starters', id, 'module-graph.json'), 'utf8'));
        presets.push({id, title: graph.nodes.find((node: any) => node.node_kind === 'module')?.name || id});
      } catch { /* non-module folders are not presets */ }
    }
    const library = await call('module.list');
    const occupations = await call('setup.occupations');
    return {presets, modules: library.modules.filter((row: any) => row.source !== 'starter' && row.status === 'installed'), occupations: occupations.occupations};
  }
  if (action === 'inspect') {
    const source = await sourceInfo(input.pdf);
    const bound = await call('module.source.bind', {source, title: input.name.replace(/\.pdf$/i, '')});
    return {...bound, page_count: source.page_count};
  }
  if (action === 'prepare') {
    if (input.source === 'starter') {
      await call('module.register', {module_id: input.module_id});
      return {module_id: input.module_id, opening_ready: true};
    }
    reader = new ReadingService({call, home: input.home, model: () => ({id: input.model, vision: true, thinking: input.thinking}),
      progress: data => emit('progress', data), record: data => emit('telemetry', data)});
    let retry = input.retry === true;
    while (!stopping) {
      try { return await reader.prepare({module_id: input.module_id, start_scene: input.start_scene, retry}); }
      catch (error) {
        retry = false;
        if (isKernelError(error) && error.details?.reason === 'reading_timeout') continue;
        throw error;
      }
    }
    throw new Error('Preparation paused');
  }
  if (action === 'create') {
    const campaign = input.campaign;
    const existing = (await call('campaign.list')).campaigns?.some((row: any) => row.id === campaign);
    if (!existing) {
      if (input.start_scene) await call('module.opening.choose', {module_id: input.module_id, scene: input.start_scene});
      await call('campaign.create', {id: campaign, module: input.module_id, title: input.title, play_language: input.play_language});
    }
    let view = await call('table.view', {campaign});
    if (!view.investigators?.length) await call('setup.investigator', {campaign, id: 'investigator',
      name: input.character.name, occupation: input.character.occupation, concept: input.character.concept,
      age: input.character.age, method: 'quick_fire'});
    await call('setup.complete', {campaign});
    view = await call('table.view', {campaign});
    return {campaign, view};
  }
  throw new Error('Unknown onboarding operation');
}
main().then(data => emit('result', data)).catch(error => {
  emit('error', {message: error.message, code: error.code, reason: error.details?.reason, fix: error.fix,
    candidates: error.details?.candidates?.map((row: any) => ({scene: row.scene, name: row.name}))});
  process.exitCode = 1;
}).finally(async () => { await reader?.close(); await kernel.close(); });
