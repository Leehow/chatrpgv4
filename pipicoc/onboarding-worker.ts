/** Host-owned source preparation and deterministic setup; never a Keeper substitute. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { KernelClient, isKernelError } from '../extensions/kernel/client.ts';
import { ReadingService } from '../extensions/module/reading-service.ts';
import { prepareCharacterGuidance, guidanceFingerprint, acceptedGuidance } from '../extensions/module/character-guidance.ts';
import { prepareCharacterPresentation, prepareStandingPresentation } from '../extensions/module/character-presentation.ts';
import { labelsFor } from './panel.js';
import { sourceInfo } from '../extensions/module/source.ts';
import { presentDocument } from '../extensions/mods/document-presentation.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [action, raw] = process.argv.slice(2);
const input = JSON.parse(raw || '{}');
const emit = (type: string, data: unknown) => process.stdout.write(JSON.stringify({type, data}) + '\n');
const kernel = new KernelClient({command: ['uv', 'run', '--frozen', 'python', '-m', 'coc.rpc', '--workspace', input.home, '--content', join(repo, 'content')],
  cwd: repo, env: {...process.env, PYTHONPATH: join(repo, 'kernel'), PYTHONDONTWRITEBYTECODE: '1'} as Record<string,string>});
let reader: ReadingService | undefined;
let stopping = false;
const guidanceAbort = new AbortController();
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => {stopping = true; guidanceAbort.abort(); reader?.dispose();});
const call = (method: string, params: Record<string, unknown> = {}) => kernel.call<any>(method, params);
async function withGuidance(prepared: any) {
  emit('progress', {stage: 'guidance'});
  const occupations = await call('setup.occupations');
  const options = {home: input.home, module_id: input.module_id,
    play_language: input.play_language || 'zh-Hans', opening: input.start_scene,
    occupations: occupations.occupations, model: input.model, thinking: input.thinking, signal: guidanceAbort.signal};
  const guidance = await prepareCharacterGuidance(options);
  const guidance_key = await guidanceFingerprint(options);
  const meta = JSON.parse(await readFile(join(input.home,'.coc/modules',input.module_id,'module.json'),'utf8'));
  return {...prepared, guidance, ...(meta.character_guidance?.[guidance_key] ? {guidance_key} : {})};
}
/** The play languages the picker is authored in; the same closed set the host validates
 *  on `select` and the onboarding `<select>` offers. */
const PLAY_LANGUAGES = ['zh-Hans', 'en'];
/** The player-facing scenario catalog.
 *
 *  `content/starters/` is a build directory, not a shelf: next to the curated scenarios it
 *  holds the rule gym every CoC7 settle path is exercised against and the build lane's
 *  source-bound counterpart to `the-haunting` (same module `name`, so listing it put two
 *  indistinguishable rows in front of players). A starter reaches players only by shipping
 *  `starter-listing.json` with `listed: true`, so a folder that declares nothing — a
 *  fixture, a future build artifact — stays out instead of leaking into the picker. Title
 *  and blurb are authored per play language there; the module node's `name` is the fallback
 *  for a starter whose listing carries no title in any offered language. */
async function starterCatalog(playLanguage?: string) {
  const language = PLAY_LANGUAGES.includes(playLanguage as string) ? playLanguage as string : PLAY_LANGUAGES[0];
  const root = join(repo, 'content/starters');
  const rows: Array<{id: string; order: number; title: string; blurb: string}> = [];
  for (const id of await readdir(root)) {
    let listing: any, name = '';
    try {listing = JSON.parse(await readFile(join(root, id, 'starter-listing.json'), 'utf8'));}
    catch {continue; /* undeclared folders are not player-facing */}
    if (listing?.listed !== true) continue;
    try {
      const graph = JSON.parse(await readFile(join(root, id, 'module-graph.json'), 'utf8'));
      name = graph.nodes.find((node: any) => node.node_kind === 'module')?.name || '';
    } catch {continue; /* a listing without a graph is nothing the kernel can open */}
    const authored = (field: any): string =>
      (typeof field?.[language] === 'string' && field[language]) ||
      PLAY_LANGUAGES.map(other => field?.[other]).find((value: any) => typeof value === 'string') || '';
    rows.push({id, order: Number.isFinite(listing.order) ? Number(listing.order) : Number.MAX_SAFE_INTEGER,
      title: authored(listing.title) || name || id, blurb: authored(listing.blurb)});
  }
  return rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(({order, ...row}) => row);
}
async function main() {
  if (action === 'document-presentation') {
    const document = await call('mods.document.view', {campaign:input.campaign, actor:input.actor, name:input.name});
    if (document.version !== input.version) throw Object.assign(new Error('The document changed; reload before saving'), {code:'revision_conflict'});
    return presentDocument({...input, signal:guidanceAbort.signal}, document);
  }
  if(action==='presentation') {
    if(input.standing) {
      const view=await call('table.view',{campaign:input.campaign});
      // The current sidebar hides canonical NPC identities, even if table.view carries them.
      view.present=[];
      return prepareStandingPresentation({...input,view,known_labels:view.labels||{},signal:guidanceAbort.signal});
    }
    const state=await call('setup.steps',{campaign:input.campaign});
    const ui=labelsFor(input.play_language);
    const known_labels={...(state.state?.draft?.labels||{}),Finance:ui.finance,Equipment:ui.equipment,Weapons:ui.weapons,cash:ui.cash,assets:ui.assets,spending:ui.spending,credit_rating:ui.creditRating,living_standard:ui.livingStandard};
    return prepareCharacterPresentation({...input,known_labels,signal:guidanceAbort.signal});
  }
  if (action === 'catalog') {
    const presets = await starterCatalog(input.play_language);
    const library = await call('module.list');
    const occupations = await call('setup.occupations');
    return {presets, modules: library.modules.filter((row: any) => row.source !== 'starter' && (row.status === 'installed'||row.setup_ready)), occupations: occupations.occupations};
  }
  if (action === 'inspect') {
    const source = await sourceInfo(input.pdf);
    const bound = await call('module.source.bind', {source, title: input.name.replace(/\.pdf$/i, '')});
    return {...bound, page_count: source.page_count};
  }
  if (['prepare','guidance','opening'].includes(action)) {
    if (input.source === 'starter') {
      await call('module.register', {module_id: input.module_id});
      return await withGuidance({module_id: input.module_id, opening_ready: true});
    }
    reader = new ReadingService({call, home: input.home, model: () => ({id: input.model, vision: true, thinking: input.thinking}),
      progress: data => emit('progress', data), record: data => emit('telemetry', data)});
    let retry = input.retry === true;
    const occupations = await call('setup.occupations');
    const guidanceOptions = {home:input.home,module_id:input.module_id,play_language:input.play_language||'zh-Hans',
      opening:input.start_scene,occupations:occupations.occupations};
    const guidance_key = action==='guidance' ? await guidanceFingerprint(guidanceOptions) : undefined;
    while (!stopping) {
      try {
        const prepared = await reader.prepare({module_id: input.module_id, start_scene: input.start_scene, retry,
          ...(action==='guidance'?{purpose:'guidance',guidance_key,play_language:guidanceOptions.play_language,occupations:occupations.occupations}:{}),
          ...(action==='opening'?{targeted:true}:{})},guidanceAbort.signal);
        if(action==='guidance')return {...prepared,guidance_key,guidance:await acceptedGuidance(input.home,input.module_id,guidance_key!)};
        return action==='opening'?prepared:await withGuidance(prepared);
      }
      catch (error) {
        retry = false;
        if (isKernelError(error) && error.details?.reason === 'reading_timeout') continue;
        throw error;
      }
    }
    throw new Error('Preparation paused');
  }
  if (action === 'converse') {
    const campaign=input.campaign;
    const existing=(await call('campaign.list')).campaigns?.some((row:any)=>row.id===campaign);
    if(!existing)await call('campaign.create',{id:campaign,module:input.module_id,title:input.title,play_language:input.play_language,
      start_scene:input.start_scene,guidance_key:input.guidance_key});
    return {campaign,play_language:input.play_language};
  }
  throw new Error('Unknown onboarding operation');
}
main().then(data => emit('result', data)).catch(error => {
  emit('error', {message: error.message, code: error.code, reason: error.details?.reason, fix: error.fix,
    candidates: error.details?.candidates?.map((row: any) => ({scene: row.scene, name: row.name, summary:row.summary}))});
  process.exitCode = 1;
}).finally(async () => { await reader?.close(); await kernel.close(); });
