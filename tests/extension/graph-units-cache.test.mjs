/**
 * Contract §131.3: a book node's material units are cut once per process per frozen graph and
 * handed back frozen; a table person's are cut on every call; a different scope, revision or
 * readiness is a different cut.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..'), evidence = await mkdtemp(join(tmpdir(), 'coc-graph-units-'));
await symlink(join(ROOT, 'node_modules'), join(evidence, 'node_modules'), 'dir');
await build({stdin: {contents: [
	"export {graphMaterialCandidates, forgetCutUnits} from './kernel-ts/read/workspace-candidates.ts';",
	"export {loadModule} from './kernel-ts/read/campaign.ts';",
	"export {createKernelContext} from './kernel-ts/context.ts';",
	"export {pythonJsonDumps} from './kernel-ts/json.ts';",
].join('\n'), resolveDir: ROOT}, outfile: join(evidence, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);

const scope = {owner: 'campaign:c1', campaign: 'c1', worldline: 'main', loop: 0, audience: 'keeper'};
async function haunting() {
	const context = await api.createKernelContext({workspace: await mkdtemp(join(evidence, 'ws-')), content: join(ROOT, 'content')});
	return api.loadModule(context, 'the-haunting');
}

test('a book node is cut once: the same frozen rows come back for the same inputs', async () => {
	const module = await haunting(), node = module.graph.find('steven-knott');
	assert.ok(node && Object.isFrozen(node));
	const first = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', true);
	const again = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', true);
	assert.ok(first.length >= 2, 'identity plus authored units');
	assert.notEqual(first, again, 'each call gets its own array');
	for (const [index, row] of first.entries()) {
		assert.equal(again[index], row, 'the same frozen row object');
		assert.ok(Object.isFrozen(row) && Object.isFrozen(row.coverage));
	}
	assert.equal(api.pythonJsonDumps(first), api.pythonJsonDumps(again));
	// A second load of the same file shares the frozen raw graph, so it shares the cut too.
	const reloaded = await haunting();
	assert.equal(reloaded.graph.raw, module.graph.raw);
	assert.equal(api.graphMaterialCandidates(reloaded.graph, reloaded.graph.find('steven-knott'), scope, 'rev-1', true)[0], first[0]);
});

test('scope, revision and readiness each key a different cut, with the expected bytes', async () => {
	const module = await haunting(), node = module.graph.find('steven-knott');
	const base = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', true);
	const otherScope = api.graphMaterialCandidates(module.graph, node, {...scope, campaign: 'c2', owner: 'campaign:c2'}, 'rev-1', true);
	assert.notEqual(otherScope[0], base[0]);
	assert.equal(otherScope[0].scope.campaign, 'c2');
	const otherRevision = api.graphMaterialCandidates(module.graph, node, scope, 'rev-2', true);
	assert.notEqual(otherRevision[0].key, base[0].key);
	const unready = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', false);
	assert.equal(unready.length, 1);
	assert.equal(unready[0].coverage.status, 'unavailable');
	assert.equal(api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', false)[0], unready[0]);
});

test('a table person is cut on every call and never shares rows', async () => {
	const module = await haunting();
	const person = module.graph.addTablePerson('npc-table-clerk', 'the clerk at the archive window', {reason: 'test', turn: 1});
	const first = api.graphMaterialCandidates(module.graph, person, scope, 'rev-1', true);
	const again = api.graphMaterialCandidates(module.graph, person, scope, 'rev-1', true);
	assert.notEqual(first[0], again[0]);
	assert.deepEqual(first, again);
	assert.ok(!Object.isFrozen(first[0]));
});

test('forgetCutUnits drops a graph\'s cut', async () => {
	const module = await haunting(), node = module.graph.find('steven-knott');
	const first = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', true);
	api.forgetCutUnits(module.graph);
	const fresh = api.graphMaterialCandidates(module.graph, node, scope, 'rev-1', true);
	assert.notEqual(fresh[0], first[0]);
	assert.deepEqual(fresh, first);
});
