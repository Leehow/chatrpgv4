/**
 * The preparation worker's presentation lanes run on the lane setting (contract §23.1).
 *
 * A projection run outside any session -- the App's own UI-words lane, or an operator running the
 * worker by hand -- used to take whatever `model` its caller named. The host's cold path does not work
 * that way: `PI_COC_MOD_MODEL` (the operator's override) first, then the App's lane setting
 * (`ext.coc-keeper.laneModel` / `laneThinking` in the agent home's `pipiui-settings.json`), and only
 * then the caller's model. The real worker bundle is run here against a content root whose play
 * language has no seed, so the UI-words lane must launch a child; that child is an argv recorder, and
 * the `--model`/`--thinking` it was launched with is the evidence.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t, settings) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'worker lane model ')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const contentRoot = join(base, 'content'), home = join(base, 'home'), agentHome = join(base, 'agent');
	for (const path of [contentRoot, home, agentHome, join(contentRoot, 'ui/en'), join(contentRoot, 'setup')]) mkdirSync(path, { recursive: true });
	writeFileSync(join(contentRoot, 'languages.json'), JSON.stringify({ source: 'en', default: 'en', suggested: ['en'] }));
	writeFileSync(join(contentRoot, 'ui/en/sheet.json'), JSON.stringify({ clues: 'Clues' }));
	writeFileSync(join(contentRoot, 'setup/ui-presentation.md'), 'Project the captions.');
	if (settings) writeFileSync(join(agentHome, 'pipiui-settings.json'), JSON.stringify(settings));
	// The "pi" every lane child is launched through: it records its argv in its working directory and exits.
	const recorder = join(base, 'record-argv.mjs'), launcher = join(base, 'selected node');
	writeFileSync(recorder, `import {writeFileSync} from 'node:fs';\nwriteFileSync('launch-argv.json',JSON.stringify(process.argv.slice(2)));\n`);
	writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(recorder)} "$@"\n`, { mode: 0o755 });
	return { contentRoot, home, agentHome, launcher };
}

/** Run the built worker's UI-words projection for a tag with no seed, and read how its child was launched. */
async function projected(f, input, env = {}) {
	const configuration = { layout: 'source', backend: 'typescript', resourceRoot: root, contentRoot: f.contentRoot,
		agentHome: f.agentHome, nodeExecutable: f.launcher };
	const childEnv = { ...process.env, PI_COC_READER_CMD: '', PI_COC_MOD_MODEL: '', PI_COC_MOD_THINKING: '', ...env };
	const child = spawn(process.execPath, [join(root, 'build/pipicoc/onboarding-worker.mjs'), 'presentation',
		JSON.stringify({ ui: true, play_language: 'yy', home: f.home, ...input }), JSON.stringify(configuration)],
		{ env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
	let stderr = '';
	child.stderr.on('data', chunk => { stderr += chunk; });
	await new Promise(done => child.once('close', done));
	const attempts = join(f.home, '.coc/ui-words/attempts');
	assert.ok(existsSync(attempts), `the lane never launched a child:\n${stderr}`);
	const argv = readdirSync(attempts).map(id => join(attempts, id, 'launch-argv.json')).filter(existsSync)
		.map(path => JSON.parse(readFileSync(path, 'utf8')));
	assert.ok(argv.length > 0, `no child recorded its launch:\n${stderr}`);
	const flag = (args, name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
	return { model: flag(argv[0], '--model'), thinking: flag(argv[0], '--thinking') };
}

const SETTING = { extensions: { 'coc-keeper': { settings: {
	'ext.coc-keeper.laneModel': { model: 'lanes/settled-model' },
	'ext.coc-keeper.laneThinking': { level: 'off' },
} } } };

test('with no model named, the worker takes the lane setting from the agent home', async t => {
	assert.deepEqual(await projected(fixture(t, SETTING), {}), { model: 'lanes/settled-model', thinking: 'off' });
});

test('a caller\'s model does not outrank the lane setting; it is only the fallback when nothing is set', async t => {
	assert.deepEqual(await projected(fixture(t, SETTING), { model: 'hand/picked', thinking: 'high' }),
		{ model: 'lanes/settled-model', thinking: 'off' });
	assert.deepEqual(await projected(fixture(t, null), { model: 'table/current', thinking: 'low' }),
		{ model: 'table/current', thinking: 'low' });
});

test('the operator\'s environment override still outranks the setting', async t => {
	assert.deepEqual(await projected(fixture(t, SETTING), {}, { PI_COC_MOD_MODEL: 'operator/override', PI_COC_MOD_THINKING: 'minimal' }),
		{ model: 'operator/override', thinking: 'minimal' });
});
