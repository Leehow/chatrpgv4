/**
 * Contract §194.5 item 2 at the host's real entry: the kernel extension opens the farm's table (`farm-book.mjs`, with a real public
 * figure in its cast) and judges the cast's rows in the background through the product's own Jev adapter, whose `fetch` is
 * answered here, so the verdicts are on disk before the Keeper's first delivery. (The delivery-time path, the gate and the
 * roster are `two-ledgers-names.test.mjs`'s, on the in-process kernel with the host's hooks.)
 *
 * Real table TR-F2 (Cold Harvest, turn 2): the cast listed Stalin, whom the book names only as the leader in whose name the farm
 * works, and §177.11's gate refused the Keeper's 「以斯大林的名义」.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {openTable} from './harness.mjs';
import {CAMPAIGN, buildFarm} from './farm-book.mjs';

const root = resolve(import.meta.dirname, '../..');
const JEV = 'https://api.typesafe.ai/v1/systemone';

/** The in-process kernel that builds the farm in the table's workspace before the session opens it, then lets go of it. */
async function prepareFarm(workspace) {
	await mkdir(join(root, '.coc'), {recursive: true});
	const dir = await mkdtemp(join(root, '.coc', 'public-figures-table-'));
	try {
		await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
			outfile: join(dir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
		const api = await import(pathToFileURL(join(dir, 'api.mjs')).href);
		const context = await api.createKernelContext({workspace, content: join(root, 'content'), seed: 'public-figures-table',
			locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
		const runtime = api.createKernelRuntime(context);
		try { return await buildFarm((method, params = {}) => runtime.handlers[method](params), workspace, {figures: true, open: false}); }
		finally { await runtime.close(); }
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

/** Jev's endpoint: the public-figure batch answered (Stalin yes, everyone else no), every other family unavailable. */
function answerJev(t) {
	const original = globalThis.fetch, asked = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV) return original(url, init);
		const body = JSON.parse(init.body), keys = Object.keys(body.questions ?? {});
		if (!keys.length || !keys.every(key => /^public_p\d+$/.test(key)))
			return new Response(JSON.stringify({error: {message: 'this test answers the public-figure family only'}}), {status: 503});
		asked.push(body);
		const answers = Object.fromEntries(keys.map(key => [key, {type: 'noul', noul: body.state.items[key.slice('public_'.length)].names.includes('斯大林') ? 0.97 : 0.05}]));
		return new Response(JSON.stringify({model: body.model, answers, usage: {input_tokens: 800, output_tokens: keys.length}}), {status: 200});
	};
	t.after(() => { globalThis.fetch = original; });
	return asked;
}

const until = async (condition, ms = 15_000) => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) if (await condition()) return true;
	return false;
};

test('§194.5: the table opens and its cast is judged in the background, before the Keeper delivers anything', async t => {
	const asked = answerJev(t);
	let built;
	const table = await openTable({realKernel: true, seedCampaign: false, campaign: CAMPAIGN, env: {EXT_JEV_APIKEY: 'test-jev-key'},
		prepareWorkspace: async workspace => { built = await prepareFarm(workspace); }});
	t.after(() => table.dispose());
	const verdicts = join(table.workspace, '.coc', 'modules', built.mid, 'cast-public.json');
	assert.ok(await until(() => existsSync(verdicts)), `judged in the background at the table's opening: ${JSON.stringify(table.telemetry().filter(row => row.lane === 'public-figures'))}`);
	const stalin = built.stored.people.find(row => row.book.includes('斯大林'));
	const kept = JSON.parse(await readFile(verdicts, 'utf8'));
	assert.equal(kept.rows[stalin.id].public, true);
	assert.equal(Object.values(kept.rows).filter(row => row.public).length, 1, 'nobody else');
	assert.equal(Object.keys(kept.rows).length, built.stored.people.length, 'every row judged');
	assert.equal(asked.length, 1, 'one request for the whole cast');
	assert.ok(JSON.stringify(asked[0].questions.public_p1).includes('real public figure'), 'the product\'s own question');
	// The host's telemetry row is written after the verdicts land; the kernel's row beside it.
	assert.ok(await until(() => table.telemetry().some(row => row.lane === 'public-figures')));
	assert.deepEqual(table.telemetry().filter(row => row.lane === 'public-figures').map(row => [row.event, row.people, row.public]), [['judged', built.stored.people.length, 1]]);
	assert.deepEqual(table.telemetry().filter(row => row.lane === 'cast-public').map(row => [row.event, row.written, row.public]), [['submitted', built.stored.people.length, 1]]);
});
