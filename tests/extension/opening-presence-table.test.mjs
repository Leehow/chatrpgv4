/**
 * Contract §198.3 at the host's real entry: the kernel extension opens `roster-book.mjs`'s campaign (Cold Harvest's history:
 * an anchor opening standing for two read openings, Captain Aganin in both, a visitor the book brings in only if the orders
 * are refused) on the real kernel, and judges the opening's people through the product's own Jev adapter, whose `fetch` is
 * answered here, before the opening run is sent. (The lane alone is `opening-presence.test.mjs`; the kernel's side,
 * `roster-presence.test.mjs`.)
 *
 * Real table TR-F2 run 2 (Cold Harvest): the opening's text put Captain Aganin behind the desk, `present` was empty, and the
 * Keeper narrated an empty room.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {openTable} from './harness.mjs';
import {CAMPAIGN, CAPTAIN, VISITOR, buildRosterBook} from './roster-book.mjs';
import {OPENING_SEAT_WHY} from '../../extensions/kernel/opening-presence.ts';

const root = resolve(import.meta.dirname, '../..');
const JEV = 'https://api.typesafe.ai/v1/systemone';

/** The in-process kernel that builds the roster book in the table's workspace before the session opens it. */
async function prepareRoster(workspace) {
	await mkdir(join(root, '.coc'), {recursive: true});
	const dir = await mkdtemp(join(root, '.coc', 'opening-presence-'));
	try {
		await build({stdin: {contents: `export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`, resolveDir: root},
			outfile: join(dir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
		const api = await import(pathToFileURL(join(dir, 'api.mjs')).href);
		const context = await api.createKernelContext({workspace, content: join(root, 'content'), seed: 'opening-presence', locks: api.nativeAdvisoryLocks(),
			env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
		const runtime = api.createKernelRuntime(context);
		try { return await buildRosterBook((method, params = {}) => runtime.handlers[method](params), workspace); }
		finally { await runtime.close(); await context.git?.close?.(); }
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}
/** Jev's endpoint: the opening-presence batch answered (the captain there, the visitor not), every other family unavailable. */
function answerJev(t) {
	const original = globalThis.fetch, asked = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV) return original(url, init);
		const body = JSON.parse(init.body), keys = Object.keys(body.questions ?? {});
		if (!keys.length || !keys.every(key => /^present_p\d+$/.test(key)))
			return new Response(JSON.stringify({error: {message: 'this test answers the opening-presence family only'}}), {status: 503});
		asked.push(body);
		const answers = Object.fromEntries(keys.map(key => [key, {type: 'noul', noul: body.state.items[key.slice('present_'.length)].name === CAPTAIN ? 0.96 : 0.04}]));
		return new Response(JSON.stringify({model: body.model, answers, usage: {input_tokens: 700, output_tokens: keys.length}}), {status: 200});
	};
	t.after(() => { globalThis.fetch = original; });
	return asked;
}

test('§198.3 at the real entry: the table opens, Jev judges the opening\'s people, and the captain is behind the desk before the opening run', async t => {
	const asked = answerJev(t);
	const table = await openTable({realKernel: true, seedCampaign: false, campaign: CAMPAIGN, env: {EXT_JEV_APIKEY: 'test-jev-key'},
		prepareWorkspace: async workspace => { await prepareRoster(workspace); }});
	t.after(() => table.dispose());
	const world = JSON.parse(await readFile(join(table.workspace, '.coc', 'campaigns', CAMPAIGN, 'world.json'), 'utf8'));
	const seated = Object.keys(world.npc_presence);
	assert.equal(seated.length, 1, `exactly one person seated: ${JSON.stringify(world.npc_presence)}`);
	assert.equal(asked.length, 1, 'one Jev request for the opening');
	assert.deepEqual(Object.values(asked[0].state.items).map(item => item.name).sort(), [CAPTAIN, VISITOR].sort());
	const turn = JSON.parse(await readFile(join(table.workspace, '.coc', 'campaigns', CAMPAIGN, 'turn.json'), 'utf8'));
	assert.deepEqual([turn.turn, turn.state], [0, 'awaiting_player'], 'the opening is still owed');
	assert.ok(turn.receipts.some(receipt => receipt.kind === 'npc' && receipt.why === OPENING_SEAT_WHY), 'the seat is one of the opening\'s receipts');
	const rows = table.telemetry().filter(row => row.lane === 'opening-presence');
	assert.deepEqual(rows.map(row => [row.event, row.seated?.length]), [['seated', 1]]);
});
