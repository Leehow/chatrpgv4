/** Host-owned source preparation and deterministic setup; never a Keeper substitute. */
import { dirname, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { KernelError, isKernelError } from '../extensions/kernel/client.ts';
import { composeRuntimeContext, createRuntime, type HostRuntime, type RuntimeContext } from '../runtime/host.ts';
import { ReadingService } from '../extensions/module/reading-service.ts';
import type { ReaderRequest } from '../extensions/module/reader.ts';
import { prepareCharacterGuidance, guidanceFingerprint, acceptedGuidance } from '../extensions/module/character-guidance.ts';
import { prepareCharacterPresentation, prepareCluePresentation, preparePossessionPresentation, prepareStandingPresentation } from '../extensions/module/character-presentation.ts';
import { labelsFor } from './panel.js';
import { presentDocument } from '../extensions/mods/document-presentation.ts';

const [action, raw, configuration] = process.argv.slice(2);
let input: any;
const emit = (type: string, data: unknown) => process.stdout.write(JSON.stringify({type, data}) + '\n');
let runtime: HostRuntime | undefined;
let context: RuntimeContext;
let reader: ReadingService | undefined;
let stopping = false;
const guidanceAbort = new AbortController();
function stop() {
  stopping = true; guidanceAbort.abort(); reader?.dispose();
  // ReadingService releases its claimed jobs before the kernel closes.
  if (!reader) void runtime?.close().catch(reportError);
}
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, stop);
const call = (method: string, params: Record<string, unknown> = {}) => runtime!.openKernel().call<any>(method, params);
const runTask = ({signal, ...request}: ReaderRequest) => runtime!.runTask({kind: 'reader', request}, signal);
async function withGuidance(prepared: any) {
  emit('progress', {stage: 'guidance'});
  const occupations = await call('setup.occupations');
  const options = {home: input.home, contentRoot: context.contentRoot, module_id: input.module_id,
    play_language: input.play_language || 'zh-Hans', opening: input.start_scene,
    occupations: occupations.occupations, model: input.model, thinking: input.thinking, signal: guidanceAbort.signal, runner: runTask};
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
  const root = join(context.contentRoot, 'starters');
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
    return presentDocument({...input, owner:runtime!, resourceRoot:context.resourceRoot, signal:guidanceAbort.signal, runner:runTask}, document);
  }
  if(action==='presentation') {
    if(input.standing) {
      const view=await call('table.view',{campaign:input.campaign});
      // The current sidebar hides canonical NPC identities, even if table.view carries them.
      view.present=[];
      return prepareStandingPresentation({...input,contentRoot:context.contentRoot,view,known_labels:view.labels||{},signal:guidanceAbort.signal,runner:runTask});
    }
    if(input.possessions) {
      const view=await call('table.view',{campaign:input.campaign});
      // The sidebar's own captions for the kernel's item fields are settled words, never a question.
      const known_labels={...(view.labels||{}),...labelsFor(input.play_language).itemFields};
      return preparePossessionPresentation({...input,contentRoot:context.contentRoot,view,known_labels,signal:guidanceAbort.signal,runner:runTask});
    }
    if(input.clues) {
      // Only what table.view already shows the player: discovered rows, never the scene's unfound offer.
      const view=await call('table.view',{campaign:input.campaign});
      return prepareCluePresentation({...input,contentRoot:context.contentRoot,view,known_labels:view.labels||{},signal:guidanceAbort.signal,runner:runTask});
    }
    // The draft row already carries the kernel's glossary. When the caller hands it over there is
    // no campaign-scoped read left to make, so this projection never queues behind the Keeper's
    // own turn on the campaign lock.
    const glossary=input.labels&&typeof input.labels==='object'&&!Array.isArray(input.labels)?input.labels
      :((await call('setup.steps',{campaign:input.campaign})).state?.draft?.labels||{});
    const ui=labelsFor(input.play_language);
    const known_labels={...glossary,Finance:ui.finance,Equipment:ui.equipment,Weapons:ui.weapons,cash:ui.cash,assets:ui.assets,spending:ui.spending,credit_rating:ui.creditRating,living_standard:ui.livingStandard};
    return prepareCharacterPresentation({...input,contentRoot:context.contentRoot,known_labels,signal:guidanceAbort.signal,runner:runTask});
  }
  if (action === 'catalog') {
    const presets = await starterCatalog(input.play_language);
    const library = await call('module.list');
    const occupations = await call('setup.occupations');
    return {presets, modules: library.modules.filter((row: any) => row.source !== 'starter' && (row.status === 'installed'||row.setup_ready)), occupations: occupations.occupations};
  }
  if (action === 'inspect') {
    const source = await runtime!.sourceInfo({pdf: input.pdf, cache: join(dirname(input.pdf), 'pages')}, guidanceAbort.signal);
    const bound = await call('module.source.bind', {source, title: input.name.replace(/\.pdf$/i, '')});
    return {...bound, page_count: source.page_count};
  }
  if (['prepare','guidance','opening'].includes(action)) {
    if (input.source === 'starter') {
      await call('module.register', {module_id: input.module_id});
      return await withGuidance({module_id: input.module_id, opening_ready: true});
    }
    reader = new ReadingService({call, runtime:runtime!, home: input.home, model: () => ({id: input.model, vision: true, thinking: input.thinking}),
      progress: data => emit('progress', data), record: data => emit('telemetry', data)});
    let retry = input.retry === true;
    const occupations = await call('setup.occupations');
    const guidanceOptions = {home:input.home,contentRoot:context.contentRoot,module_id:input.module_id,play_language:input.play_language||'zh-Hans',
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
function reportError(error: any) {
  emit('error', {message: error.message, code: error.code, reason: error.details?.reason, fix: error.fix,
    candidates: error.details?.candidates?.map((row: any) => ({scene: row.scene, name: row.name, summary:row.summary}))});
  process.exitCode = 1;
}
async function run() {
  try {
    input = JSON.parse(raw || '{}');
    const host = JSON.parse(configuration || '{}');
    const binding = {owner: 'preparation' as const, home: input.home, campaign: input.campaign};
    context = composeRuntimeContext(binding, host);
    runtime = createRuntime(binding, {...host, ...context});
    input.home = runtime.home;
    if (stopping) throw new Error('Preparation paused');
    const result = await main();
    if (stopping) throw new Error('Preparation paused');
    emit('result', result);
  } catch (error) { reportError(error); }
  finally {
    let deadline: NodeJS.Timeout | undefined;
    try {
      if (reader) await Promise.race([reader.close(), new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new KernelError({code: 'internal',
          message: 'Preparation readers did not stop after cancellation', details: {reason: 'runtime_shutdown'}})), 5000);
      })]);
    }
    finally {
      clearTimeout(deadline);
      await runtime?.close();
      for (const signal of ['SIGTERM','SIGINT'] as const) process.removeListener(signal, stop);
    }
  }
}
void run().catch(reportError);
