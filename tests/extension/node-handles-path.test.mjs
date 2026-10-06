/**
 * Contract §185.5 and §185.6, on the real path (§185.11 NFH-03): the handle lane mounted in a Pi session, the kernel in
 * process, and the context hooks as installed.
 *
 * A name-free campaign on a book the reading lane built opens with interim handles: no lane has named its nodes yet. The lane
 * then runs at the table, its model stubbed, and writes the book's `handles.json` through `handles.submit`. The next
 * `table.player_input` folds those handles into the campaign, and the Keeper's request, as the installed context hook
 * assembles it, names the dock, the tower and the net mender by the lane's handles: not by the interim ones it showed before,
 * and never by a node id or the book's slug.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {fauxAssistantMessage, fauxProvider} from '@earendil-works/pi-ai';
import {createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager} from './pi.mjs';
import {waitFor} from './harness.mjs';
const root = resolve(import.meta.dirname, '../..');
await mkdir(join(root, '.coc'), {recursive: true});
const temporary = await mkdtemp(join(root, '.coc', 'node-handles-path-'));
after(() => rm(temporary, {recursive: true, force: true}));
await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';
export * from './extensions/table/context-runtime.ts';
export * from './extensions/table/workspace/workpad-store.ts';`, resolveDir: root},
	outfile: join(temporary, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);

const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.',
	'The old tower stands beyond the harbor. Its keeper, 西拉斯, trims the lamp.',
	'Below the tower a cellar floods at high tide.'];
const REFS = [{page: 1}];
const interim = (kind, id) => `${kind}-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`;

/**
 * The fixture book of `name-free-handles.test.mjs` (NFH-02): a PDF read as far as its opening (the Dock with Old Mae in it,
 * the Tower) and its cast read, one unread keeper whose notes call him Silas. Then a campaign on it with an investigator,
 * set up and opened: the first campaign on the book, so everything it stored is under interim handles.
 */
async function openedCampaign(t) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'node-handles-path',
		locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(context); t.after(() => runtime.close());
	const raw = (method, params = {}) => runtime.handlers[method](params);
	const pdf = join(home, 'harbor.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const sha = createHash('sha256').update(await readFile(pdf)).digest('hex');
	const {module_id: mid} = await raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: sha}});
	const read = async (purpose, draft, paths) => {
		await raw('module.read.request', {module_id: mid, purpose});
		const job = await raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: sha, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths, verdict: 'supported', source_refs: REFS, reason: 'fixture support'}], missing: []}));
		return raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Harbor', language: 'en', sections: [{name: 'Harbor and tower', pages: [[1, 3]], source_refs: [{page: 1}],
		entities: ['Dock', 'Tower']}]}, []);
	await read('opening', {nodes: [
		{node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}},
		{node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'},
		{node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: REFS, summary: 'A net mender on the dock.'}],
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			{subject_id: 'npc-old-mae', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-old-mae']},
		['/nodes/0', '/nodes/2', '/claims/0', '/claims/1', '/coverage']);
	const cast = await raw('cast.job', {module_id: mid, claim: true});
	await raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [
		{book: ['Old Mae'], play: ['Old Mae'], notes: ['Old Mae'], pages: [1]},
		{book: ['西拉斯'], play: ['西拉斯'], notes: ['Silas'], pages: [2]}]}));
	assert.equal((await raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	await raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const library = (await raw('investigator.save', {campaign: 'card-source'})).library_id;
	await raw('campaign.create', {id: 'c1', module: mid, play_language: 'en'});
	const call = (method, params = {}) => raw(method, {campaign: 'c1', ...params});
	await call('investigator.load', {library_id: library});
	await call('setup.complete');
	await call('table.open');
	const file = async name => JSON.parse(await readFile(join(home, '.coc', 'campaigns', 'c1', name), 'utf8'));
	return {home, mid, raw, call, file};
}

/** The handle lane in a Pi session (play mode), bridged to the in-process kernel; its model answers by each node's name. */
async function laneAt(t, home, raw, names) {
	const values = {PI_COC_MODE: 'play', PI_COC_HOME: home, PI_OFFLINE: '1', PI_COC_HANDLES_MODEL: 'handles/h1'};
	const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) process.env[key] = value;
	let session;
	t.after(async () => {
		if (session) {
			await session._extensionRunner.emit({type: 'session_shutdown', reason: 'quit'});
			session.dispose();
		}
		for (const [key, value] of previous) value === undefined ? delete process.env[key] : (process.env[key] = value);
	});
	const provider = fauxProvider({provider: 'handles', models: [{id: 'h1'}]});
	const asked = [];
	provider.setResponses(Array.from({length: 8}, () => context => {
		const text = context.messages.flatMap(message => message.content).map(block => block.text ?? '').join('\n'), lines = text.split('\n');
		const nodes = JSON.parse(lines[lines.indexOf('[Nodes]') + 1]);
		asked.push(...nodes);
		return fauxAssistantMessage(JSON.stringify({handles: nodes.map(node => ({key: node.key, handle: names[node.name] ?? `harbor-${node.kind}-${node.key}`}))}));
	}));
	const modelRuntime = await ModelRuntime.create({authPath: join(home, 'auth.json'), modelsPath: null, modelsStorePath: join(home, 'models-store.json'), refreshOnCreate: false});
	modelRuntime.registerNativeProvider(provider.provider);
	const settingsManager = SettingsManager.inMemory({compaction: {enabled: false}, retry: {enabled: false}});
	let pi;
	const resourceLoader = new DefaultResourceLoader({cwd: home, agentDir: join(home, 'agent'), settingsManager,
		additionalExtensionPaths: [join(root, 'extensions/node-handles')], extensionFactories: [{name: 'probe', factory: value => { pi = value; }}]});
	await resourceLoader.reload();
	const created = await createAgentSession({cwd: home, agentDir: join(home, 'agent'), model: provider.getModel(), modelRuntime,
		thinkingLevel: 'off', noTools: 'all', resourceLoader, settingsManager, sessionManager: SessionManager.inMemory()});
	session = created.session;
	assert.deepEqual(created.extensionsResult.errors, []);
	pi.events.emit('coc:kernel-bridge', {campaign: 'c1', call: (method, params) => raw(method, params)});
	await session.bindExtensions({mode: 'print'});
	return {asked};
}

const NAMES = {'Dock': 'tar-smelling-dock', 'Tower': 'lighthouse-on-the-point', 'Old Mae': 'net-mender-by-the-water'};

test('§185.5/§185.6: the lane names a reader-built book at the table, and after the fold the Keeper\'s request shows its handles', async t => {
	const {home, mid, raw, call, file} = await openedCampaign(t);
	const dock = interim('scene', 'scene-dock'), tower = interim('scene', 'scene-tower'), mae = interim('npc', 'npc-old-mae');
	const opened = await file('world.json');
	assert.equal(opened.active_scene, dock, 'opened before any lane ran: interim handles');
	assert.deepEqual(opened.npc_presence, {[mae]: dock});

	const lane = await laneAt(t, home, raw, NAMES);
	const telemetry = join(home, '.coc', 'campaigns', 'c1', 'telemetry.jsonl');
	const round = await waitFor(() => existsSync(telemetry) && readFileSync(telemetry, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
		.find(row => row.lane === 'handles' && typeof row.ok === 'boolean'), {label: 'the lane\'s round row'});
	assert.equal(round.ok, true, JSON.stringify(round));
	assert.equal(round.written, round.asked, JSON.stringify(round));
	assert.equal(round.given_up, 0);
	// The model saw what the job gave and nothing that spells the node: no id, no slug.
	assert.deepEqual(lane.asked.filter(node => NAMES[node.name]).map(node => node.name).sort(), Object.keys(NAMES).sort());
	for (const id of ['scene-dock', 'scene-tower', 'npc-old-mae', 'old-mae']) assert.ok(!JSON.stringify(lane.asked).includes(id), `${id} reached the lane's model`);
	const stored = JSON.parse(readFileSync(join(home, '.coc', 'modules', mid, 'handles.json'), 'utf8')).nodes;
	assert.deepEqual({dock: stored['scene-dock']?.handle, tower: stored['scene-tower']?.handle, mae: stored['npc-old-mae']?.handle},
		{dock: NAMES.Dock, tower: NAMES.Tower, mae: NAMES['Old Mae']}, 'the book\'s handles.json holds what the lane wrote');
	assert.equal((await file('world.json')).active_scene, dock, 'the lane never writes the campaign: the fold does');

	await call('table.narrate', {call_id: 't0-c1', text: 'The harbor is quiet.'});
	const input = await call('table.player_input', {text: 'I look around the dock.'});
	const world = await file('world.json');
	assert.deepEqual([world.node_handles['scene-dock'], world.node_handles['scene-tower'], world.node_handles['npc-old-mae']],
		[NAMES.Dock, NAMES.Tower, NAMES['Old Mae']], 'folded at the turn\'s start');
	assert.equal(world.active_scene, NAMES.Dock);

	// The Keeper's request, through the installed context hook.
	const hooks = new Map(), bus = new Map();
	api.installContextPolicy({on: (name, fn) => hooks.set(name, fn), events: {on: (name, fn) => bus.set(name, fn)}},
		() => {}, () => api.workpadStoreRoot(home));
	bus.get('coc:kernel-bridge')({campaign: 'c1', call});
	bus.get('coc:capsule')({capsule: input.capsule, context: input._context});
	const {messages: sent} = await hooks.get('context')({messages: [{role: 'user', content: 'I look around the dock.'}]}, {model: {contextWindow: 1000000}});
	const capsule = sent.find(message => message.customType === 'coc-capsule');
	assert.ok(capsule, JSON.stringify(sent.map(message => message.customType ?? message.role)));
	const shown = typeof capsule.content === 'string' ? capsule.content : JSON.stringify(capsule.content);
	const request = JSON.stringify(sent);
	for (const handle of Object.values(NAMES)) assert.ok(shown.includes(handle), `${handle} in the capsule the Keeper is sent: ${shown.slice(0, 2000)}`);
	for (const old of [dock, tower, mae]) assert.ok(!request.includes(old), `the interim handle ${old} still reaches the Keeper`);
	for (const id of ['scene-dock', 'scene-tower', 'npc-old-mae', '"dock"', '"tower"', 'old-mae']) assert.ok(!request.includes(id), `${id} reaches the Keeper`);
});
