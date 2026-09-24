/**
 * SL-32 (contract §20 addendum 2026-09-24): the App's PDF import on a book nobody has read yet.
 *
 * The App runs the built onboarding worker as `inspect` → `guidance` → `opening` → `converse`
 * (Electron/packages/pi-backend/src/coc-onboarding.ts through runtime/preparation.ts). On an unread
 * book `inspect` registers the source and no graph exists; the `guidance` reading is that book's
 * first reading and publishes the first graph together with the guidance. Since d552e5f77 the
 * worker computed the guidance key by reading `module-graph.json` first, so every unread import
 * stopped at once with ENOENT and no reader ever started (SL-29A, 血色公路, book-1).
 *
 * This runs the real worker bundle, the emitted kernel and the real source helper on a PDF the
 * test writes, with the reader replaced by a stand-in (PI_COC_READER_CMD) that records the task it
 * was launched for and then waits: reaching it is the evidence that `guidance` went through the
 * reading instead of failing before it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { guidanceFingerprint } from '../../extensions/module/character-guidance.ts';

const root = resolve(import.meta.dirname, '../..');
const worker = join(root, 'build/pipicoc/onboarding-worker.mjs');

/** A two-page text PDF the source helper can open and render. */
function pdf() {
	const streams = ['BT /F1 12 Tf 20 160 Td (The Blood Road: opening) Tj ET', 'BT /F1 12 Tf 20 160 Td (The roadhouse) Tj ET'];
	const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${streams.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
	for (const [i, stream] of streams.entries()) objects.push(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	let text = '%PDF-1.7\n';
	const offsets = [0];
	for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

function fixture(t) {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'unread pdf import ')));
	const home = join(base, 'home'), agentHome = join(base, 'agent'), upload = join(base, 'upload');
	for (const path of [home, agentHome, upload]) mkdirSync(path, { recursive: true });
	writeFileSync(join(upload, 'source.pdf'), pdf());
	// The stand-in reader: it runs in the job's work directory, records the task it was given, and waits
	// to be stopped the way a real reader would still be reading. It never outlives the test by much.
	const reader = join(base, 'stand-in-reader.mjs');
	writeFileSync(reader, `import {readFileSync,writeFileSync} from 'node:fs';
const task=JSON.parse(readFileSync('task.json','utf8'));
writeFileSync('stand-in-launched.json',JSON.stringify({purpose:task.purpose,play_language:task.play_language,cwd:process.cwd()}));
setTimeout(()=>process.exit(1),60000);\n`);
	const children = [];
	t.after(async () => {
		for (const child of children) if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
			await new Promise(done => child.once('close', done));
		}
		rmSync(base, { recursive: true, force: true });
	});
	return { base, home, agentHome, upload, reader, children };
}

/** Start one worker action exactly as runtime/preparation.ts does: argv action, input JSON, host configuration. */
function start(f, action, input) {
	const configuration = { layout: 'source', backend: 'typescript', resourceRoot: root, contentRoot: join(root, 'content'),
		agentHome: f.agentHome, nodeExecutable: process.execPath, kernelEntrypoint: join(root, 'build/kernel/rpc.mjs') };
	const child = spawn(process.execPath, [worker, action, JSON.stringify({ ...input, home: f.home }), JSON.stringify(configuration)], {
		cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PI_CODING_AGENT_DIR: f.agentHome,
			PI_COC_READER_CMD: JSON.stringify([process.execPath, f.reader]), PI_COC_MOD_MODEL: '', PI_COC_MOD_THINKING: '' },
	});
	f.children.push(child);
	const events = [];
	let stdout = '', stderr = '';
	child.stdout.on('data', chunk => {
		stdout += chunk;
		for (let at = stdout.indexOf('\n'); at >= 0; at = stdout.indexOf('\n')) {
			const line = stdout.slice(0, at); stdout = stdout.slice(at + 1);
			if (line.trim()) events.push(JSON.parse(line));
		}
	});
	child.stderr.on('data', chunk => { stderr += chunk; });
	const closed = new Promise(done => child.once('close', done));
	return { child, events, closed, stderr: () => stderr };
}

/** Every stand-in launch under this home, by the task it recorded. */
function launches(home) {
	const found = [];
	const walk = directory => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name === 'stand-in-launched.json') found.push(JSON.parse(readFileSync(path, 'utf8')));
		}
	};
	if (existsSync(join(home, '.coc'))) walk(join(home, '.coc'));
	return found;
}

test('SL-32: guidance on a freshly registered PDF goes through the reading instead of failing on the missing graph', { timeout: 120_000 }, async t => {
	const f = fixture(t);
	const inspect = start(f, 'inspect', { pdf: join(f.upload, 'source.pdf'), name: 'blood-road.pdf' });
	await inspect.closed;
	const inspected = inspect.events.find(event => event.type === 'result');
	assert.ok(inspected, `inspect answered nothing: ${JSON.stringify(inspect.events)}\n${inspect.stderr()}`);
	const moduleId = inspected.data.module_id, folder = join(f.home, '.coc/modules', moduleId);
	assert.equal(inspected.data.page_count, 2);
	const meta = JSON.parse(readFileSync(join(folder, 'module.json'), 'utf8'));
	assert.equal(meta.graph_file, undefined, 'the book is unread: inspect registers the source and publishes no graph');
	assert.equal(existsSync(join(folder, 'module-graph.json')), false);

	// The App's guidance phase: no start scene yet (the guidance reading names it), the table's language and model.
	const guidance = start(f, 'guidance', { source: 'pdf', module_id: moduleId, play_language: 'zh-Hans', model: 'fixture/vision', thinking: 'low' });
	const deadline = Date.now() + 90_000;
	let reached;
	while (!reached && Date.now() < deadline) {
		const failed = guidance.events.find(event => event.type === 'error');
		assert.equal(failed, undefined, `guidance stopped before any reading: ${JSON.stringify(failed?.data)}\n${guidance.stderr()}`);
		assert.equal(guidance.child.exitCode, null, `the worker exited before any reading: ${JSON.stringify(guidance.events)}\n${guidance.stderr()}`);
		reached = launches(f.home).find(row => row.purpose === 'guidance');
		if (!reached) await new Promise(done => setTimeout(done, 200));
	}
	assert.ok(reached, `no guidance reading was launched within the wait: ${JSON.stringify(guidance.events)}\n${guidance.stderr()}`);
	assert.equal(reached.play_language, 'zh-Hans');

	// The job the kernel queued carries a key computed before any graph exists, and that key is the
	// source-bound one: publishing the first graph cannot re-key the same book (§22.9).
	const queued = JSON.parse(readFileSync(join(folder, 'deepen-queue.json'), 'utf8')).filter(job => job.purpose === 'guidance');
	assert.equal(queued.length, 1);
	const options = { home: f.home, contentRoot: join(root, 'content'), module_id: moduleId, play_language: 'zh-Hans',
		opening: undefined, occupations: queued[0].occupations };
	assert.equal(queued[0].guidance_key, await guidanceFingerprint(options));
	writeFileSync(join(folder, 'module-graph.json'), JSON.stringify({ nodes: [{ node_id: 'scene-roadhouse', node_kind: 'scene', name: 'The roadhouse' }] }));
	assert.equal(await guidanceFingerprint(options), queued[0].guidance_key, 'the first graph does not change the key the reading was queued under');

	// The App pauses a preparation by stopping the worker; the paused reading is released, not failed.
	guidance.child.kill('SIGTERM');
	await guidance.closed;
	const error = guidance.events.find(event => event.type === 'error');
	assert.notEqual(error?.data?.code, 'ENOENT');
});
