/** BP-05: the existing visual reader/reviewer over an APFS clone; never writes the App or deletes prior evidence. */
import {readFile, writeFile, appendFile, mkdir, mkdtemp, copyFile, chmod, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir, homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {createRuntime} from '../../runtime/host.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

const args = process.argv.slice(2), out = resolve(args[0] ?? '');
if (!args[0] || !args.includes('--live')) throw Error('supply a new output directory and --live for the authorized BP-05 source probe');
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'openai-codex/gpt-6-luna';
if (!['openai-codex/gpt-6-luna', 'grok-build/grok-4.7'].includes(model)) throw Error('the probe accepts only the preregistered historical or owner-selected reading model');
const root = resolve(import.meta.dirname, '../..'), app = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc');
const home = join(out, 'home'), lib = join(home, '.coc/modules/book-2'), original = join(app, '.coc/modules/book-2/module.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), originalBytes = await readFile(original);
await mkdir(out); // Exclusive by design: never erase or reuse an earlier experiment.
await writeFile(join(out, 'PREREGISTER.json'), JSON.stringify({version: 1, model, thinking: 'low',
  role: model.startsWith('grok-build/') ? 'owner-selected reading model, not a Keeper table' : 'historical reading-model probe, not a Keeper table or a change to the main-model choice',
  source_sha256: JSON.parse(originalBytes).source_document.file_sha256, original_meta_sha256: hash(originalBytes),
  bars: ['the material settles through original-page reader and fresh reviewer children', 'eight source-cited investigator-template sheets are offered',
    'all offered cards load with their reviewed printed numbers preserved', 'each numeric leaf has its own supported publication review'],
  source_pages: [38,39,40,41,42], attempts: 'one ordinary reading job; its existing in-job repairs only', maxWallMs: 1200000,
  exclusions: 'No old npc retirement, independent second numeric transcription, campaign.create book pregen, or gameplay claim.'}, null, 2)+'\n');
await mkdir(join(home, '.coc/modules'), {recursive: true});
execFileSync('cp', ['-c', '-R', join(app, '.coc/modules/book-2'), lib]);
execFileSync('cp', ['-c', '-R', join(app, '.coc/source-transcripts'), join(home, '.coc/source-transcripts')]);
const agent = await mkdtemp(join(tmpdir(), 'pipicoc-book-pregens-agent-')); await chmod(agent, 0o700);
let runtime, kernel, reading, rowWrites = Promise.resolve();
try {
  for (const name of ['auth.json','models.json','models-store.json','settings.json']) {
    try {await copyFile(join(app, 'agent', name), join(agent, name)); await chmod(join(agent, name), 0o600);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  const apiFile = join(root, '.tmp/book-pregens-probe-api.mjs'); await mkdir(join(root, '.tmp'), {recursive: true});
  await build({stdin: {contents: "export {createKernelContext} from './kernel-ts/context.ts';\nexport {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';\nexport {createKernelRuntime} from './kernel-ts/registry.ts';\nexport {pythonJsonDumps} from './kernel-ts/json.ts';", resolveDir: root},
    outfile: apiFile, bundle: true, packages: 'external', format: 'esm', platform: 'node', logLevel: 'silent'});
  const api = await import(pathToFileURL(apiFile).href);
  const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'book-pregens-probe',
    locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
  kernel = api.createKernelRuntime(context);
  const call = async (method, params={}) => {
    try {return JSON.parse(api.pythonJsonDumps(await kernel.handlers[method](params)));}
    catch (error) {if (error.toJson) throw new KernelError(JSON.parse(api.pythonJsonDumps(error.toJson()))); throw error;}
  };
  const requested = await call('module.read.request', {module_id: 'book-2', purpose: 'detail', material: 'pregens', foreground: true});
  if (!requested.job_id) throw Error('a new pregens reading was expected on this frozen library');
  const job = await call('module.read.claim', {module_id: 'book-2', owner: 'book-pregens-probe'});
  if (job.job_id !== requested.job_id || job.material !== 'pregens') throw Error('another job owns the claim; no model request started');
  await writeFile(join(out, 'job.json'), JSON.stringify({job_id: job.job_id, material: job.material, work_dir: job.work_dir}, null, 2)+'\n');
  runtime = createRuntime({owner: 'preparation', home}, {resourceRoot: root, contentRoot: join(root, 'content'), agentHome: agent,
    nodeExecutable: process.execPath, layout: 'source'});
  reading = new ReadingService({home, runtime, call, model: () => ({id: model, vision: true, thinking: 'low'}),
    progress: row => console.log(JSON.stringify({stage: row.stage, purpose: row.purpose})),
    record: row => {rowWrites = rowWrites.then(() => appendFile(join(out, 'rows.jsonl'), JSON.stringify(row)+'\n'));}});
  await reading.runJob(job, AbortSignal.timeout(1200000));
  await call('campaign.create', {id: 'pregen-source-probe', module: 'book-2', play_language: 'en'});
  const listing = await call('investigator.list', {campaign: 'pregen-source-probe'});
  await writeFile(join(out, 'listing.json'), JSON.stringify(listing, null, 2)+'\n');
  if (listing.pregens_read !== 'read' || listing.pregens?.length !== 8) throw Error('the eight printed source sheets were not offered after a settled read');
  for (const pregen of listing.pregens) {
    const loaded = await call('investigator.load', {campaign: 'pregen-source-probe', pregen: pregen.pregen});
    await appendFile(join(out, 'loaded.jsonl'), JSON.stringify(loaded)+'\n');
  }
  console.log(JSON.stringify({offered: listing.pregens.length, source_pages: listing.pregens.map(row=>row.pages), evidence: out}));
} finally {
  await reading?.close(); await runtime?.close(); await kernel?.close(); await closeSourceDocuments(); await rowWrites;
  await rm(agent, {recursive: true}); // Only disposable credential copies; source and turn evidence are retained.
  if (hash(await readFile(original)) !== hash(originalBytes)) throw Error('the App source metadata changed during the isolated probe');
}
