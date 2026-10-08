/**
 * GG-05: replay reading read-30 of Cold Harvest (pages 33-34) under §199 on a cp -c clone of the App's library, rolled to
 * generation 35 (the last one without Vasili), with the kernel and host of this worktree and live reader/reviewer children
 * (openai-codex/gpt-6-luna, thinking low, as the App ran them). The job resumes from read-30's own retained draft -- the one
 * whose summary says 「嘉琳娜已故的丈夫。」 -- so the verify phase, the gate and the repair are what run. Nothing in the App is written.
 */
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {kernel, root} from './kernel-api.mjs';
import {ReadingService} from '../../extensions/module/reading-service.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {createRuntime} from '../../runtime/host.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {pythonJsonDumps} from '../../kernel-ts/json.ts';

const [out, base = '35'] = process.argv.slice(2);
const APP = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc');
const READ30 = join(APP, '.coc/module-campaigns/game-56788eff-11bf-4bfb-98e0-b47712330b3e/modules/book-2/work/read-30/attempt-1');
const home = join(out, 'home'), lib = join(home, '.coc/modules/book-2');
await rm(out, {recursive: true, force: true});
await mkdir(join(home, '.coc/modules'), {recursive: true});
// cp -c: APFS clones, nothing in the App is opened for writing.
const {execFileSync} = await import('node:child_process');
execFileSync('cp', ['-c', '-R', join(APP, '.coc/modules/book-2'), lib]);
execFileSync('cp', ['-c', '-R', join(APP, '.coc/source-transcripts'), join(home, '.coc/source-transcripts')]);
const meta = JSON.parse(await readFile(join(lib, 'module.json'), 'utf8'));
const gen = (await readdir(join(lib, 'generations'))).find(name => name.startsWith(`generation-${base}-`));
const graphFile = `generations/${gen}/module-graph.json`;
// The reading's materials as they stood at that generation: a material published later is not yet read.
meta.reading.materials = meta.reading.materials.filter(material => Number(material.generation) <= Number(base));
Object.assign(meta, {generation: Number(base), graph_file: graphFile,
	graph_digest: createHash('sha256').update(await readFile(join(lib, graphFile))).digest('hex')});
await writeFile(join(lib, 'module.json'), JSON.stringify(meta));
const graphBefore = JSON.parse(await readFile(join(lib, graphFile), 'utf8'));
console.log('base generation', base, 'vasili present:', graphBefore.nodes.some(node => node.node_id === 'npc-vasili-viktorovich-smolsky'));

const k = await kernel(home);
const wire = value => value === undefined ? value : JSON.parse(pythonJsonDumps(value));
const call = async (method, params = {}) => {
	try { return wire(await k.runtime.handlers[method](params)); }
	catch (error) { if (typeof error?.toJson === 'function') throw new KernelError(wire(error.toJson())); throw error; }
};
const task30 = JSON.parse(await readFile(join(READ30, 'task.json'), 'utf8'));
const requested = await call('module.read.request', {module_id: 'book-2', purpose: 'detail', focus: task30.focus, question: task30.question,
	source_unit: task30.source_unit, foreground: true});
console.log('requested', JSON.stringify(requested).slice(0, 800));
const job = await call('module.read.claim', {module_id: 'book-2', owner: 'gg05-replay'});
console.log('claimed', JSON.stringify(job).slice(0, 600)); console.log('claimed', job.job_id, job.focus, 'key', String(job.key).slice(0, 12), 'read-30 key', JSON.parse(await readFile(join(READ30, 'packet.json'), 'utf8')).key.slice(0, 12));
// read-30's retained draft as this job's interrupted attempt: the read is complete, verification is owed.
const previous = join(out, 'read-30-attempt');
await mkdir(previous, {recursive: true});
const draftBytes = await readFile(join(READ30, 'draft.json'));
await writeFile(join(previous, 'draft.json'), draftBytes);
const packet = JSON.parse(await readFile(join(job.work_dir, 'packet.json'), 'utf8'));
await writeFile(join(previous, 'packet.json'), JSON.stringify(packet));
const done30 = JSON.parse(await readFile(join(READ30, 'read-complete.json'), 'utf8'));
await writeFile(join(previous, 'read-complete.json'), JSON.stringify({...done30, job_id: job.job_id,
	draft_sha256: createHash('sha256').update(draftBytes).digest('hex')}));
job.resume_from = previous;

const runtime = createRuntime({owner: 'preparation', home}, {agentHome: join(APP, 'agent'), resourceRoot: root, contentRoot: join(root, 'content'), layout: 'source'});
const rows = [];
const reading = new ReadingService({home, runtime, call: (method, params) => call(method, params),
	model: () => ({id: 'openai-codex/gpt-6-luna', vision: true, thinking: 'low'}),
	progress() {}, record: row => { rows.push(row); }});
const began = Date.now();
try { await reading.runJob(job, new AbortController().signal); }
catch (error) { console.log('runJob threw', error?.code ?? '', String(error?.message ?? error).slice(0, 400)); }
finally { await reading.close?.(); await runtime.close(); await closeSourceDocuments(); }
await writeFile(join(out, 'rows.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const metaAfter = JSON.parse(await readFile(join(lib, 'module.json'), 'utf8'));
const graph = JSON.parse(await readFile(join(lib, metaAfter.graph_file), 'utf8'));
const vasili = graph.nodes.find(node => node.node_id === 'npc-vasili-viktorovich-smolsky');
console.log('ms', Date.now() - began, 'generation', metaAfter.generation);
console.log('vasili', JSON.stringify(vasili ?? null));
const queue = JSON.parse(await readFile(join(lib, 'deepen-queue.json'), 'utf8'));
console.log('job state', queue.find(row => row.job_id === job.job_id)?.state);
k.runtime.close?.();
