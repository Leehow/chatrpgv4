/**
 * The §199 sweep with the same check the verify round runs: the person-state reading (`extensions/module/person-state.ts`) over
 * every person summary of a published Cold Harvest generation (cp -c clone of the App library), live readers on
 * openai-codex/gpt-6-luna (thinking low). Reads only.
 */
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {root} from './kernel-api.mjs';
import {createRuntime} from '../../runtime/host.ts';
import {closeSourceDocuments} from '../../extensions/module/source.ts';
import {personStateRows} from '../../extensions/module/person-state.ts';

const [out, generation = '74'] = process.argv.slice(2);
const APP = join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc');
const home = join(out, 'home'), lib = join(home, '.coc/modules/book-2');
await rm(out, {recursive: true, force: true});
await mkdir(join(home, '.coc/modules'), {recursive: true});
execFileSync('cp', ['-c', '-R', join(APP, '.coc/modules/book-2'), lib]);
const gen = (await readdir(join(lib, 'generations'))).find(name => name.startsWith(`generation-${generation}-`));
const graph = JSON.parse(await readFile(join(lib, 'generations', gen, 'module-graph.json'), 'utf8'));
const pageRefs = refs => [...new Set((refs ?? []).map(ref => Number(ref.pdf_index) + 1))].sort((a, b) => a - b).map(page => ({page}));
const nodes = graph.nodes.filter(node => node.node_kind === 'npc').map(({source_refs: refs, ...rest}) => ({...rest, source_refs: pageRefs(refs)}));
const draft = {nodes, claims: []};
const cwd = join(out, 'work');
await mkdir(cwd, {recursive: true});
const pdf = join(lib, 'source.pdf');
const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
const runtime = createRuntime({owner: 'preparation', home}, {agentHome: join(APP, 'agent'), resourceRoot: root, contentRoot: join(root, 'content'), layout: 'source'});
const controller = new AbortController(), rows = [];
const began = Date.now();
let refused = [];
try {
	refused = await personStateRows({cwd, round: 1, draft, task: {known_nodes: []}, contentRoot: join(root, 'content'),
		model: {id: 'openai-codex/gpt-6-luna', thinking: 'low'}, signal: controller.signal,
		sourceText: pages => runtime.sourceText({pdf, pages, expected_file_sha256: sha}, controller.signal),
		run: request => runtime.runTask({kind: 'reader', request}, controller.signal), record: row => rows.push(row)});
} finally { await runtime.close(); await closeSourceDocuments(); }
console.log('ms', Date.now() - began, JSON.stringify(rows));
for (const row of refused) {
	const node = nodes[Number(row.paths[0].split('/')[2])];
	console.log('REFUSED', node.node_id, JSON.stringify(node.summary), '|', row.reason);
}
try {
	const evidence = JSON.parse(await readFile(join(cwd, 'person-state.json'), 'utf8'));
	console.log('statements', evidence.statements.length, 'mismatches', evidence.mismatches.length);
	await writeFile(join(out, 'summary.json'), JSON.stringify({generation, persons: nodes.length, statements: evidence.statements.length, mismatches: evidence.mismatches,
		statement_readings: evidence.statement_readings, page_readings: evidence.page_readings, people: evidence.people}, null, 1));
} catch (error) { console.log('no evidence', String(error)); }
