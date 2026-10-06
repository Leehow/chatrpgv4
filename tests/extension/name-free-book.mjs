/**
 * The reader-built fixture book of the name-free handle tests (contract §185; NFH-02's `name-free-handles.test.mjs` keeps
 * its own copy): a three-page PDF bound and read through the kernel's reading lane as far as its opening -- the Dock, with
 * Old Mae in it, and the Tower beyond it -- and its cast read: Old Mae, and an unread keeper the book prints as 西拉斯 and
 * whose notes call him Silas. `before` puts nodes ahead of the opening's in the graph's order, `after` behind them, and
 * `claims` adds relations, so a test can bury the table's nodes deep in the book.
 *
 * The caller hands in the kernel API it bundled (`createKernelContext`, `nativeAdvisoryLocks`, `createKernelRuntime`).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const PAGES = ['The harbor dock smells of tar. Old Mae mends nets by the water.',
	'The old tower stands beyond the harbor. Its keeper, 西拉斯, trims the lamp.',
	'Below the tower a cellar floods at high tide.'];
const REFS = [{page: 1}];
export const DOCK = {node_id: 'scene-dock', node_kind: 'scene', name: 'Dock', source_refs: REFS, properties: {is_entrance: true}};
export const TOWER = {node_id: 'scene-tower', node_kind: 'scene', name: 'Tower', source_refs: [{page: 2}], summary: 'An old tower beyond the harbor.'};
export const MAE = {node_id: 'npc-old-mae', node_kind: 'npc', name: 'Old Mae', source_refs: REFS, summary: 'A net mender on the dock.'};

/** The interim handle a node shows before a fold (§185.4). */
export const interim = (kind, id) => `${kind}-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`;

export async function readerBook(api, {root, temporary, t, seed = 'name-free-book', before = [], after = [], claims = []}) {
	const home = await mkdtemp(join(temporary, 'home-'));
	const context = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed,
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
	const nodes = [...before, DOCK, TOWER, MAE, ...after];
	await read('opening', {nodes,
		claims: [{subject_id: 'scene-dock', predicate: 'route-to', object: {node_id: 'scene-tower'}, truth_status: 'authored-fact', source_refs: REFS},
			{subject_id: 'npc-old-mae', predicate: 'present-in', object: {node_id: 'scene-dock'}, truth_status: 'authored-fact', source_refs: REFS}, ...claims],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ['scene-dock', 'npc-old-mae']},
		[`/nodes/${nodes.indexOf(DOCK)}`, `/nodes/${nodes.indexOf(MAE)}`, ...[0, 1, ...claims.keys().map(index => index + 2)].map(index => `/claims/${index}`), '/coverage']);
	const cast = await raw('cast.job', {module_id: mid, claim: true});
	await raw('cast.source', {module_id: mid, job_id: cast.job_id, lease: cast.lease, pages: PAGES.map((text, index) => ({page: index + 1, text}))});
	const range = await raw('cast.range', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0});
	await writeFile(join(range.cwd, 'draft.json'), JSON.stringify({people: [
		{book: ['Old Mae'], play: ['Old Mae'], notes: ['Old Mae'], pages: [1]},
		{book: ['西拉斯'], play: ['西拉斯'], notes: ['Silas'], pages: [2]}]}));
	assert.equal((await raw('cast.submit', {module_id: mid, job_id: cast.job_id, lease: cast.lease, index: 0})).state, 'complete');
	/** A name-free campaign on the book; `seated` gives it an investigator from a starter pregen (§21.5), sets it up and opens it. */
	const campaign = async (id, {seated = false} = {}) => {
		await raw('campaign.create', {id, module: mid, play_language: 'en'});
		const call = (method, params = {}) => raw(method, {campaign: id, ...params});
		if (seated) {
			if (!campaign.library) {
				await raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
				campaign.library = (await raw('investigator.save', {campaign: 'card-source'})).library_id;
			}
			await call('investigator.load', {library_id: campaign.library});
			await call('setup.complete');
			await call('table.open');
		}
		const file = async name => JSON.parse(await readFile(join(home, '.coc', 'campaigns', id, name), 'utf8'));
		return {id, call, file};
	};
	return {home, mid, raw, campaign};
}
