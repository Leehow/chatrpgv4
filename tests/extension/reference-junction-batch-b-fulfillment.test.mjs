/**
 * Contract §188.4, batch B (NR-04b): a promise's counterparty is compared as the person it names.
 *
 * - A cash receipt's stored `with` against the term's payer (`memory/fulfillment-view.ts`, left over from NR-04a): a
 *   receipt a kernel wrote before §185.2 read the counterparty kept the Keeper's word, and the payer is a handle.
 * - The giver of a promised item (`effectOwners`, which read `EntityIndex` over the graph's names alone): since NR-04a
 *   `apply item from` stores what this table calls the giver, and the prepared label is now that same word.
 *
 * The Haunting in process, Steven Knott worded by this table; the promises are made in turn 1 and kept in turn 2.
 */
import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';

const root = resolve(import.meta.dirname, '../..'), WORD = 'the letting agent', CASE = 'Accepted travel case';
let api, bundle, fixture;
before(async () => {
	await mkdir(join(root, '.tmp'), {recursive: true});
	bundle = await mkdtemp(join(root, '.tmp/junction-b-fulfillment-'));
	await build({stdin: {contents: [
		"export * from './kernel-ts/memory/fulfillment-receipt.ts';",
		"export {createKernelContext} from './kernel-ts/context.ts';",
		"export {createKernelRuntime} from './kernel-ts/registry.ts';",
		"export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';",
		"export {CampaignWriter} from './kernel-ts/write/store.ts';",
		"export {CampaignSnapshot,loadCampaignModule} from './kernel-ts/read/campaign.ts';",
		"export {stageItem} from './kernel-ts/apply/inventory.ts';",
		"export {clone} from './kernel-ts/read/values.ts';",
	].join('\n'), resolveDir: root, sourcefile: 'junction-b-fulfillment.ts'}, outfile: join(bundle, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
	api = await import(pathToFileURL(join(bundle, 'api.mjs')).href);
	fixture = await createFixture();
});
after(async () => { await fixture?.runtime.close(); if (bundle) await rm(bundle, {recursive: true, force: true}); });

async function createFixture() {
	const home = playtestScratch('junction-b-fulfillment');
	await writeFile(join(home, 'classification.json'), JSON.stringify({kind: 'contract-fixture', live_play: false, model_calls: 0}));
	const kernel = await api.createKernelContext({workspace: home, content: join(root, 'content'), seed: 'junction-b', locks: api.nativeAdvisoryLocks(),
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
	const runtime = api.createKernelRuntime(kernel), call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
	await call('campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	await call('table.open');
	await call('table.player_input', {text: 'I ask for the exact terms.'});
	const draft = {name: CASE, category: 'item', description: 'An ordinary travel case.', basis: 'Contract fixture physical facts', parameters: {effects: []}, player_view: {description: 'A travel case.', fields: []}};
	const job = await call('mods.job', {role: 'create', input: {name: draft.name, category: 'item', description: draft.description}});
	await writeFile(join(job.cwd, 'result.json'), JSON.stringify(draft));
	const accepted = await call('mods.accept', {job: job.job}), party = await new api.CampaignWriter(kernel, 'c1').party();
	await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'define', name: CASE, category: 'item', description: draft.description, _definition: accepted.definition, _provenance: accepted.provenance},
		{kind: 'person', who: 'Steven Knott', name: WORD}, {kind: 'cash', subject: party[0].name, source: 'found', currency: 'USD', delta: 5, why: 'A float.'},
		{kind: 'time', minutes: 1, why: 'The inspection completes.'}]});
	await call('table.narrate', {call_id: 't1-c2', text: `{{say:Steven Knott}}I will pay 30 USD when the work is completed.{{/say}}\n{{say:Steven Knott}}I will give you 2 ${CASE} when the work is completed.{{/say}}`});
	const packet = await call('memory.job', {turn: 1, mode: 'referenced'});
	const decisions = packet.step.segments.map(segment => segment.role === 'keeper'
		? {source: segment.alias, outcome: 'retain', annotations: [{kind: 'promise', subject: 'Steven Knott', entities: [party[0].name], state: 'accurate'}]}
		: {source: segment.alias, outcome: 'skip'});
	await call('memory.submit', {job_id: packet.job_id, referenced: {step: packet.step.key, decisions,
		...(packet.story_context ? {story: {status: 'unclear', thread: null, frame_source: null, bridge_delivered: false, delivery_source: null}} : {})}});
	await call('table.player_input', {text: 'The work is done.'});
	const campaign = new api.CampaignWriter(kernel, 'c1'), world = await campaign.readWorld(), turn = await campaign.readTurn(), meta = await campaign.readCampaign();
	const module = await api.loadCampaignModule(kernel, meta.module_id, world, 'c1'), context = {kernel, campaign, world, turn, graph: module.graph};
	const promises = (await new api.CampaignSnapshot(kernel, 'c1').log('memory/candidates.jsonl')).filter(value => value.kind === 'promise');
	const sources = await Promise.all(promises.map(promise => api.promiseFulfillmentSources(context, promise.id))), record = await campaign.readTurnRecord(1);
	return {runtime, call, context, party: await campaign.party(), promises, sources, record, condition: record.receipts.find(value => value.kind === 'time'),
		payer: module.graph.handle(module.graph.npc('Steven Knott'))};
}
function binding(index, terms) {
	const source = fixture.sources[index], value = {version: 1, promiseId: fixture.promises[index].id, promiseRefs: api.clone(source.refs), scope: source.scope, terms,
		conditionReceipts: [fixture.condition.id], coverage: {complete: true, used: [], omitted: []}, digest: ''};
	value.coverage.used = [...value.promiseRefs, ...value.terms.map(term => term.total.source)];
	value.digest = api.fulfillmentBindingDigest(value);
	return value;
}
const reason = expected => error => error?.details?.reason === expected;

const cashTerms = () => binding(0, [{ordinal: 0, kind: 'cash', total: {source: fixture.sources[0].scalars.find(value => value.value === '30').ref, value: '30'},
	currency: 'USD', beneficiary: fixture.party[0].id, payer: fixture.payer}]);
/** A payment of 10 toward the cash promise, as a kernel that stored the counterparty's spelling in `with` wrote it. */
const paid = (cash, id, by) => ({id, kind: 'cash', call_id: id, subject: fixture.party[0].id, with: by, currency: 'USD', delta: 10, before: 5, after: 15,
	fulfillment: {version: 1, promise: cash.promiseId, promise_source_refs: cash.promiseRefs, scope: cash.scope, terms_digest: cash.digest, terms: cash.terms,
		term: 0, condition_receipts: [fixture.condition.id], applied: '10', status: 'partial'}});

test('§188.4: a cash receipt that stored the table\'s word as its counterparty pays the promise of the person it names', async () => {
	const cash = cashTerms();
	const withReceipts = receipts => ({...fixture.context, turn: {...fixture.context.turn, receipts: [...fixture.context.turn.receipts, ...receipts]}});
	const remainder = {kind: 'cash', subject: fixture.party[0].name, with: 'Steven Knott', source: 'found', currency: 'USD', delta: 20};
	for (const by of [WORD, 'Steven Knott', fixture.payer]) {
		const plan = await api.prepareFulfillments({...withReceipts([paid(cash, `old-${by}`, by)]), bindings: [{binding: cash, effects: [{effect: 0, term: 0}]}], effects: [remainder]});
		assert.deepEqual([plan.prior.get(cash.promiseId).status, plan.prior.get(cash.promiseId).terms[0].remaining], ['partial', '20'], by);
	}
	for (const by of ['Mr. Dooley', 'a passing stranger'])
		await assert.rejects(api.prepareFulfillments({...withReceipts([paid(cash, `old-${by}`, by)]), bindings: [{binding: cash, effects: [{effect: 0, term: 0}]}], effects: [remainder]}),
			reason('fulfillment_receipt_invalid'), by);
});

test('§188.4: a promised item given by the table\'s word or the told name attaches to the receipt apply item writes', async () => {
	const item = binding(1, [{ordinal: 0, kind: 'item', total: {source: fixture.sources[1].scalars.find(value => value.value === '2').ref, value: '2'},
		item: CASE, beneficiary: fixture.party[0].id, payer: fixture.payer}]);
	for (const [index, from] of [WORD, 'Steven Knott', fixture.payer].entries()) {
		const effect = {kind: 'item', name: CASE, from, to: fixture.party[0].name, quantity: 2};
		const plan = await api.prepareFulfillments({...fixture.context, bindings: [{binding: item, effects: [{effect: 0, term: 0}]}], effects: [effect]});
		const staged = {...fixture.context, world: api.clone(fixture.context.world), callId: `t2-c${index + 1}`, ordinal: index + 1, mint: base => base};
		const {receipt} = await api.stageItem(staged, effect, new Map());
		assert.deepEqual([receipt.from, receipt.from_id], [WORD, fixture.payer], 'the giver is stored by identity under the table\'s word');
		plan.attach(new Map([[0, [receipt]]]), staged.world);
		assert.equal(receipt.fulfillment.status, 'complete', from);
	}
	await assert.rejects(api.prepareFulfillments({...fixture.context, bindings: [{binding: item, effects: [{effect: 0, term: 0}]}],
		effects: [{kind: 'item', name: CASE, from: 'Mr. Dooley', to: fixture.party[0].name, quantity: 2}]}), reason('fulfillment_target_changed'), 'another giver');
});

test('§188.4: the capsule shows such a payment toward the promise, not an unavailable account', async () => {
	const cash = cashTerms();
	await fixture.call('table.narrate', {call_id: 't2-c9', text: 'He counts out ten dollars.'});
	const path = join(fixture.context.campaign.directory, 'turns/0002.json'), record = JSON.parse(await readFile(path, 'utf8'));
	record.receipts = [...record.receipts, paid(cash, 'old-capsule', WORD)];
	await writeFile(path, JSON.stringify(record));
	const {capsule} = await fixture.call('table.player_input', {text: 'And the rest?'});
	const row = capsule.obligations.find(value => value.kind === 'promise' && value.state.startsWith('I will pay 30 USD'));
	assert.equal(row?.fulfillment?.status, 'partial', JSON.stringify(capsule.obligations.filter(value => value.kind === 'promise')));
	// His card (`present[]`) projects the same account.
	const promise = capsule.present.find(person => person.name === 'Steven Knott')?.history?.promises?.find(value => value.statement.startsWith('I will pay 30 USD'));
	assert.deepEqual([promise?.fulfillment?.status, promise?.fulfillment?.terms?.[0]?.remaining], ['partial', '20'], JSON.stringify(promise));
	// And so does the scene's present[] a look reads, which projects the memory itself.
	const looked = (await fixture.call('table.look', {focus: 'scene'})).present.find(person => person.name === 'Steven Knott')?.history?.promises?.find(value => value.statement.startsWith('I will pay 30 USD'));
	assert.equal(looked?.fulfillment?.status, 'partial', JSON.stringify(looked));
});
