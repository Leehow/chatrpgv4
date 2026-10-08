import {resolve} from 'node:path';
/** GG-04 live: the fixed epithet lane's requests (one person, no id) on a clone of the TR-F2 campaign at generation 74, the App's lane model. */
import {readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {kernel} from './kernel-api.mjs';
const ROOT = resolve(import.meta.dirname, '../..');
const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {runLane} = await import(`${ROOT}/extensions/lanes/subsession.ts`);
const {epithetSystemPrompt, epithetUserInput, shapeEpithet} = await import(`${ROOT}/extensions/npc-epithets/index.ts`);
const home = process.argv[2], campaign = 'game-565055f1-8a99-4e69-9932-ca64c0e27d93';
const cdir = join(home, '.coc/campaigns', campaign);
const world = JSON.parse(await readFile(join(cdir, 'world.json'), 'utf8'));
delete world.person_epithets; delete world.person_labels;
await writeFile(join(cdir, 'world.json'), JSON.stringify(world));
await writeFile(join(cdir, 'epithets.json'), JSON.stringify({people: {}}));
await rm(join(cdir, 'npc-journal.json'), {force: true});
await rm(join(cdir, 'turns'), {recursive: true, force: true});
const k = await kernel(home);
const runtime = await ModelRuntime.create({authPath: join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent/auth.json'), modelsPath: null,
	modelsStorePath: join(home, 'models-store.json'), refreshOnCreate: false});
const registry = new ModelRegistry(runtime);
process.env.PI_COC_EPITHETS_MODEL = 'opencode-go/deepseek-v4.1-flash';
process.env.PI_COC_EPITHETS_MODEL_THINKING = 'off';
const ctx = {cwd: home, model: registry.find('opencode-go', 'deepseek-v4.1-flash'), modelRegistry: registry, sessionManager: {getSessionId: () => 'gg-epithets-live'}};
const graph = JSON.parse(await readFile(join(home, '.coc/module-campaigns', campaign, 'modules/book-2', JSON.parse(await readFile(join(home, '.coc/module-campaigns', campaign, 'modules/book-2/module.json'), 'utf8')).graph_file), 'utf8'));
const handles = JSON.parse(await readFile(join(home, '.coc/modules/book-2/handles.json'), 'utf8')).nodes;
const nodeOf = Object.fromEntries(Object.entries(handles).map(([id, row]) => [row.handle, id]));
const out = [];
for (let round = 0; round < 4; round++) {
	const job = await k.call('epithets.job', {campaign});
	if (!job.job_id) break;
	const taken = [...job.taken];
	for (const person of job.people) {
		let word;
		for (let attempt = 0; attempt < 2 && !word; attempt++) {
			const lane = await runLane({ctx, envName: 'PI_COC_EPITHETS_MODEL', lane: 'epithets', systemPrompt: epithetSystemPrompt(job),
				input: epithetUserInput(job, person, taken, attempt ? out.at(-1)?.refusal : undefined), timeoutMs: 60000, shape: parsed => shapeEpithet(parsed, job)});
			if (!lane.ok) { out.push({id: person.id, error: lane.reason}); break; }
			const answer = await k.call('epithets.submit', {campaign, entries: [{id: person.id, word: lane.value}]});
			if (answer.written.length) { word = lane.value; taken.push(word); }
			else out.push({id: person.id, refused: lane.value, refusal: `- ${JSON.stringify(lane.value)} refused (${answer.refused[0]?.reason}): ${answer.refused[0]?.message}`});
		}
		const node = graph.nodes.find(n => n.node_id === nodeOf[person.id]);
		out.push({id: person.id, node: node?.node_id ?? null, role: person.role, looks: person.looks, word});
	}
}
const graphPeople = graph.nodes.filter(n => n.node_kind === 'npc').map(n => n.node_id);
const offered = new Set(out.filter(row => row.node).map(row => row.node));
console.log('graph people', graphPeople.length, 'offered', offered.size, 'not offered:', graphPeople.filter(id => !offered.has(id)).join(' '));
for (const row of out) if (row.word || row.refused) console.log(row.node ?? row.id, '|', row.word ?? `REFUSED ${row.refused}`, '|', (row.looks ?? '').slice(0, 60));
await writeFile(join(home, 'epithets-live.json'), JSON.stringify(out, null, 1));
k.runtime.close?.();
