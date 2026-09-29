/**
 * VT-01 at the preparation worker: a pictured handout's title reaches the play language through the
 * handouts lane, because the host hands it over as input.
 *
 * `apply handout` writes `<campaign>/handouts/<handle>.md` only for a card with a body. A pictured
 * handout (§152.3) writes none, yet `table.view` lists it with a `name`, and `handoutTexts` counts
 * that name as a word the lane owes. The lane's own input (`handoutInput`) reads only the files, so
 * on its own it can never answer the title -- which is what made every sheet or board read start it
 * again. The request's `handout_names` carries the titles the host holds; the worker's `handouts`
 * branch joins them to the files' rows as rows with no body.
 *
 * Travels the real path: the emitted kernel on the shipped starter (its asset row for the map given
 * a cropped image, as a PDF module's visual reader registers one), `apply handout`, `table.view`,
 * and the emitted worker bundle. Only the model is replaced: `PI_COC_READER_CMD` runs a child that
 * answers every word it is issued, in the protocol the lane's checker reads.
 */
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {handoutTexts, handoutTitleRows} from '../../extensions/module/character-presentation.ts';

const root = resolve(import.meta.dirname, '../..');
const MAP = 'Corbitt House Investigator Map';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=', 'base64');

/** One emitted-kernel process over `steps`; every frame must be ok. */
function kernel(home, steps) {
	const input = steps.map(([method, params], index) => JSON.stringify({id: String(index), method, params: {campaign: 'c1', ...params}})).join('\n');
	const run = spawnSync(process.execPath, [join(root, 'build/kernel/rpc.mjs'), '--workspace', home, '--content', join(root, 'content')],
		{cwd: root, input: `${input}\n`, encoding: 'utf8'});
	const frames = run.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
	return frames.map(frame => frame.result);
}

/** A zh-Hans table that holds the investigator map as a picture only. */
function pictured(t) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'handout titles ')));
	t.after(() => rmSync(base, {recursive: true, force: true}));
	const home = join(base, 'home'), agentHome = join(base, 'agent');
	mkdirSync(agentHome, {recursive: true});
	kernel(home, [['campaign.create', {id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'zh-Hans'}]]);
	const module = join(home, '.coc/modules/the-haunting'), file = join(module, 'assets.json');
	const assets = JSON.parse(readFileSync(file, 'utf8'));
	Object.assign(assets.assets.find(row => row.id === 'handout-the-haunting-corbitt-house-investigator-map'),
		{path: 'assets/player/corbitt-house-investigator-map.png', media_type: 'image/png'});
	mkdirSync(join(module, 'assets/player'), {recursive: true});
	writeFileSync(join(module, 'assets/player/corbitt-house-investigator-map.png'), PNG);
	writeFileSync(file, JSON.stringify(assets));
	kernel(home, [['table.open', {}], ['table.narrate', {call_id: 't0-c1', text: 'Mr. Knott hands over the keys.'}],
		['table.player_input', {text: 'I ask for a plan of the house.'}],
		['table.apply', {call_id: 't1-c1', effects: [{kind: 'handout', name: MAP, why: 'Knott unfolds the plan.'}]}],
		['table.narrate', {call_id: 't1-c2', text: 'The plan lies open on the desk.'}]]);
	const [view] = kernel(home, [['table.view', {}]]);
	// The model: every issued word comes back projected.
	const answer = join(base, 'answer.mjs');
	writeFileSync(answer, `import {readFileSync,writeFileSync} from 'node:fs';
const packet=JSON.parse(readFileSync('texts.json','utf8'));
writeFileSync('presentation.json',JSON.stringify({protocol:packet.protocol,texts:packet.sources.map(source=>({source:source.alias,action:'translate',text:'projected: '+source.text})),finance_equipment_sources:[]}));
`);
	return {home, agentHome, view, answer};
}

/** The emitted worker's `presentation` action for the handouts lane; its last result or error event. */
async function handoutsLane(f, extra = {}) {
	const configuration = {layout: 'source', backend: 'typescript', resourceRoot: root, contentRoot: join(root, 'content'),
		agentHome: f.agentHome, nodeExecutable: process.execPath};
	const child = spawn(process.execPath, [join(root, 'build/pipicoc/onboarding-worker.mjs'), 'presentation',
		JSON.stringify({campaign: 'c1', play_language: 'zh-Hans', handouts: true, home: f.home, ...extra}), JSON.stringify(configuration)],
		{cwd: root, env: {...process.env, PI_COC_READER_CMD: JSON.stringify([process.execPath, f.answer]), PI_COC_MOD_MODEL: '', PI_COC_MOD_THINKING: ''},
			stdio: ['ignore', 'pipe', 'pipe']});
	let stdout = '', stderr = '';
	child.stdout.on('data', chunk => { stdout += chunk; });
	child.stderr.on('data', chunk => { stderr += chunk; });
	await new Promise(done => child.once('close', done));
	const events = stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
	const last = events.filter(event => event.type === 'result' || event.type === 'error').at(-1);
	assert.ok(last, `the worker answered nothing:\n${stderr}`);
	return last;
}

const attempts = f => {
	const folder = join(f.home, '.coc/character-presentations/attempts');
	return existsSync(folder) ? readdirSync(folder).length : 0;
};

test('a pictured handout\'s title is projected when the request carries it, and the lane then owes nothing', async t => {
	const f = pictured(t);
	assert.deepEqual(f.view.handouts.map(({handout, name, text, media_type}) => ({handout, name, text, media_type})),
		[{handout: 'the-haunting-corbitt-house-investigator-map', name: MAP, text: '', media_type: 'image/png'}]);
	assert.deepEqual(handoutTexts(f.view), [MAP], 'the collector owes the title');

	// The files alone: the lane asks the model for nothing and answers without the title. This is the
	// run a board read used to start after every landing.
	const alone = await handoutsLane(f);
	assert.equal(alone.type, 'result', JSON.stringify(alone));
	assert.equal(alone.data.texts[MAP], undefined);
	assert.equal(attempts(f), 0, 'no model round: the files hold no word the lane lacks');

	// The host's rows: the title is asked once and saved under the string the board looks up.
	const handed = await handoutsLane(f, {handout_names: [MAP]});
	assert.equal(handed.type, 'result', JSON.stringify(handed));
	assert.equal(handed.data.texts[MAP], `projected: ${MAP}`);
	assert.equal(attempts(f), 1);
	const saved = JSON.parse(readFileSync(join(f.home, '.coc/campaigns/c1/setup/presentations/handouts-zh-Hans.json'), 'utf8'));
	for (const word of handoutTexts(f.view)) assert.equal(typeof saved.texts[word], 'string', `the saved projection answers ${word}`);

	// Asked again, it is held: no second model round.
	const again = await handoutsLane(f, {handout_names: [MAP]});
	assert.equal(again.data.texts[MAP], `projected: ${MAP}`);
	assert.equal(attempts(f), 1);
});

test('a malformed handout_names is refused as invalid_params before any file is read', async t => {
	assert.deepEqual(handoutTitleRows(undefined), []);
	assert.deepEqual(handoutTitleRows([MAP, MAP, 'Clipping']), [{name: MAP, text: null}, {name: 'Clipping', text: null}]);
	for (const bad of [MAP, [7], [''], ['   '], [null], ['x'.repeat(401)], Array.from({length: 257}, (_, i) => `t${i}`), {0: MAP}])
		assert.throws(() => handoutTitleRows(bad), error => error.code === 'invalid_params', JSON.stringify(bad).slice(0, 60));
	// The bounds are shape, not taste: the longest and the most it takes still pass.
	assert.equal(handoutTitleRows(['x'.repeat(400)]).length, 1);
	assert.equal(handoutTitleRows(Array.from({length: 256}, (_, i) => `t${i}`)).length, 256);
	// And the worker surfaces the refusal as the code, not as a lane that quietly answered.
	const f = pictured(t);
	const refused = await handoutsLane(f, {handout_names: 'not a list'});
	assert.equal(refused.type, 'error');
	assert.equal(refused.data.code, 'invalid_params');
});
