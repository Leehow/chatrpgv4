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
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitForIdle} from './harness.mjs';
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
/**
 * Jev's endpoint: the opening-presence batch answered (the captain there, the visitor not), every other family unavailable.
 * `delayMs` holds the answer back, as a real round trip does, so an opening run sent without waiting for it would be seen.
 */
function answerJev(t, {delayMs = 0} = {}) {
	const original = globalThis.fetch, asked = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV) return original(url, init);
		const body = JSON.parse(init.body), keys = Object.keys(body.questions ?? {});
		if (!keys.length || !keys.every(key => /^present_p\d+$/.test(key)))
			return new Response(JSON.stringify({error: {message: 'this test answers the opening-presence family only'}}), {status: 503});
		asked.push(body);
		if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
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

test('§198.3 at the real entry: the opening run\'s capsule and the Keeper\'s look carry the seated captain, and not the visitor', async t => {
	// Within OPENING_PRESENCE_WAIT_MS, and long enough that an opening run sent before the seat landed would carry nobody.
	answerJev(t, {delayMs: 600});
	const requests = [];
	const reply = message => context => { requests.push(context); return message; };
	const table = await openTable({realKernel: true, seedCampaign: false, campaign: CAMPAIGN, env: {EXT_JEV_APIKEY: 'test-jev-key'},
		responses: [reply(fauxAssistantMessage([fauxToolCall('look', {})], {stopReason: 'toolUse'})),
			reply(fauxAssistantMessage([fauxToolCall('narrate', {text: 'The captain knocks on the desk with his knuckles.'})], {stopReason: 'toolUse'}))],
		prepareWorkspace: async workspace => { await prepareRoster(workspace); }});
	t.after(() => table.dispose());
	await waitForIdle(table.session, {timeoutMs: 60_000});
	assert.equal(requests.length, 2, 'the opening run: a look, then the narration');
	const text = message => (Array.isArray(message.content) ? message.content : [{text: String(message.content)}]).map(block => block.text ?? '').join('');
	// The capsule the opening run's first request carries (the request exit, not a kernel read beside it).
	const capsule = JSON.parse(requests[0].messages.map(text).find(body => body.startsWith('{"head":"Everything at the start of this turn')) ?? 'null');
	// §194.1: the capsule names an untold person by this table's handle and carries the book's name beside it.
	assert.deepEqual(capsule?.present?.map(row => row.book_name ?? row.name), [CAPTAIN], 'the opening\'s capsule: the captain is behind the desk, the visitor is not there');
	// The Keeper's own look, answered on the real kernel through the extension's tool.
	const looked = requests[1].messages.find(message => message.role === 'toolResult');
	assert.deepEqual(JSON.parse(text(looked)).present.map(row => row.name), [CAPTAIN], 'look: the captain');
	// The opening is narrated over the seat: one turn-0 record holds the seat's receipt and the narration.
	const opening = JSON.parse(await readFile(join(table.workspace, '.coc', 'campaigns', CAMPAIGN, 'turns', '0000.json'), 'utf8'));
	assert.ok(opening.receipts.some(receipt => receipt.kind === 'npc' && receipt.why === OPENING_SEAT_WHY), JSON.stringify(opening.receipts));
	assert.match(opening.text, /knocks on the desk/);
});
