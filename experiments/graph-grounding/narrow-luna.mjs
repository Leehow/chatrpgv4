import {resolve} from 'node:path';
/** Narrow questions to gpt-6-luna (thinking low), the model that wrote and reviewed read-30. Keys read from the App's auth.json in memory. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
const ROOT = resolve(import.meta.dirname, '../..');
const {ModelRuntime, ModelRegistry} = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const {runLane} = await import(`${ROOT}/extensions/lanes/subsession.ts`);
const scratch = process.argv[2];
const runtime = await ModelRuntime.create({authPath: join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent/auth.json'), modelsPath: null,
	modelsStorePath: join(scratch, 'models-store.json'), refreshOnCreate: false});
const registry = new ModelRegistry(runtime);
const [provider, id] = (process.argv[3] ?? 'openai-codex/gpt-6-luna').split('/');
const model = registry.find(provider, id);
if (!model) throw new Error('model not found');
process.env.PI_COC_PROBE_MODEL = `${provider}/${id}`;
process.env.PI_COC_PROBE_MODEL_THINKING = process.argv[4] ?? 'low';
const ctx = {cwd: scratch, model, modelRegistry: registry, sessionManager: {getSessionId: () => 'gg-narrow-probe'}};
const page34 = JSON.parse(readFileSync(join(scratch, 'home/.coc/modules/book-2/cast-source.json'), 'utf8')).pages.find(p => p.page === 34).text;
const SYSTEM = 'You read short Chinese texts from a scenario book and answer one question as JSON only: {"vasili":"alive|dead|not_stated","galena":"alive|dead|not_stated"}. vasili is 瓦西里 (Vasili Smolsky); galena is 嘉琳娜 (Galena).';
const cases = {
	F1: 'Statement about 瓦西里: 「嘉琳娜已故的丈夫。」\nAccording to this statement alone, who is alive and who is dead?',
	T1: 'Statement about 瓦西里: 「嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。」\nAccording to this statement alone, who is alive and who is dead?',
	PAGE: `Page 34 of the book:\n${page34}\nAccording to this page alone, is each of them alive or dead?`,
};
for (const [name, input] of Object.entries(cases)) for (let r = 0; r < 3; r++) {
	const lane = await runLane({ctx, envName: 'PI_COC_PROBE_MODEL', lane: 'gg-narrow', systemPrompt: SYSTEM, input, timeoutMs: 120000,
		shape: parsed => parsed && typeof parsed === 'object' ? parsed : undefined});
	console.log(name, r, lane.ok ? JSON.stringify(lane.value) : `FAIL ${lane.reason} ${String(lane.detail).slice(0, 200)}`);
}
