/**
 * Contract §131: parsed files, the rule index and published graphs are kept per process by file
 * identity, and `clone` is a structural copy with the round trip's exact shape.
 *
 * A CPU profile of one `table.workspace.read` (2026-09-22, starter table) put 72% of a 600 ms
 * request in the Python-compatible JSON parser/serializer, most of it re-parsing unchanged bytes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rename, symlink, writeFile, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..'), evidence = await mkdtemp(join(tmpdir(), 'coc-parsed-cache-'));
await symlink(join(ROOT, 'node_modules'), join(evidence, 'node_modules'), 'dir');
await build({stdin: {contents: [
	"export {readJson, readJsonl, forgetParsedFiles} from './kernel-ts/snapshots.ts';",
	"export {clone} from './kernel-ts/read/values.ts';",
	"export {PythonFloat, parsePythonJson, pythonJsonDumps, pythonObjectEntries, jsonDigest} from './kernel-ts/json.ts';",
	"export {RuleObservations} from './kernel-ts/read/rule-facts.ts';",
	"export {readPublishedGraph, forgetParsedGraphs} from './kernel-ts/read/published-graph.ts';",
	"export {createKernelContext} from './kernel-ts/context.ts';",
	"export {ModuleStore} from './kernel-ts/modules/store.ts';",
].join('\n'), resolveDir: ROOT}, outfile: join(evidence, 'api.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);

// Atomic replacement, as the kernel's writers do it: a fresh inode renamed into place.
async function replaceAtomically(path, text) {
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, text);
	await rename(tmp, path);
}

test('readJson answers unchanged bytes with the same frozen object and a changed file with a new one', async () => {
	const path = join(evidence, 'a.json');
	await writeFile(path, '{"n": 1.0, "10": "ten", "2": "two"}');
	const first = await api.readJson(path), again = await api.readJson(path);
	assert.equal(again, first, 'unchanged bytes are served from the cache');
	assert.ok(Object.isFrozen(first));
	assert.ok(first.n instanceof api.PythonFloat);
	assert.deepEqual(api.pythonObjectEntries(first).map(([k]) => k), ['n', '10', '2'], 'insertion order survives the cache');
	// Same size, different content, rewritten in place: mtime moves.
	await writeFile(path, '{"n": 2.0, "10": "ten", "2": "two"}');
	await utimes(path, new Date(), new Date(Date.now() + 5_000));
	const changed = await api.readJson(path);
	assert.notEqual(changed, first);
	assert.equal(changed.n.value, 2);
	// Atomic replacement: a new inode.
	await replaceAtomically(path, '{"n": 3}');
	const replaced = await api.readJson(path);
	assert.notEqual(replaced, changed);
	assert.equal(replaced.n, 3);
	assert.equal(await api.readJson(path), replaced);
});

test('readJsonl caches whole logs and sees an append', async () => {
	const path = join(evidence, 'log.jsonl');
	await writeFile(path, '{"a": 1}\n{"a": 2}\n');
	const first = await api.readJsonl(path);
	assert.equal(await api.readJsonl(path), first);
	assert.equal(first.length, 2);
	await writeFile(path, '{"a": 3}\n', {flag: 'a'});
	const grown = await api.readJsonl(path);
	assert.notEqual(grown, first);
	assert.equal(grown.length, 3);
});

test('forgetParsedFiles drops every cached parse', async () => {
	const path = join(evidence, 'b.json');
	await writeFile(path, '[1, 2]');
	const first = await api.readJson(path);
	api.forgetParsedFiles();
	const fresh = await api.readJson(path);
	assert.notEqual(fresh, first);
	assert.deepEqual([...fresh], [1, 2]);
});

test('clone keeps the round trip shape: order, float identity, bigint, and an unfrozen copy', () => {
	const source = api.parsePythonJson('{"10": "ten", "2": "two", "f": 1.0, "i": 7, "big": 123456789012345678901234567890, "nested": {"z": [1, 2.5, {"q": null}], "a": "b"}}');
	Object.freeze(source);
	const copied = api.clone(source);
	assert.notEqual(copied, source);
	assert.equal(api.pythonJsonDumps(copied), api.pythonJsonDumps(source), 'byte-identical serialization');
	assert.equal(api.jsonDigest(copied), api.jsonDigest(source));
	assert.ok(copied.f instanceof api.PythonFloat);
	assert.equal(typeof copied.big, 'bigint');
	assert.equal(copied.i, 7);
	assert.deepEqual(api.pythonObjectEntries(copied).map(([k]) => k), ['10', '2', 'f', 'i', 'big', 'nested'], 'integer-looking keys keep Python dict order');
	assert.ok(!Object.isFrozen(copied) && !Object.isFrozen(copied.nested) && !Object.isFrozen(copied.nested.z));
	copied.nested.z.push(9);
	assert.equal(source.nested.z.length, 3, 'the source is untouched');
	// A plain JS non-integer number is what the serializer would have written as a float.
	const plain = api.clone({half: 0.5, whole: 2, negativeZero: -0});
	assert.ok(plain.half instanceof api.PythonFloat && plain.half.value === 0.5);
	assert.equal(plain.whole, 2);
	assert.ok(plain.negativeZero instanceof api.PythonFloat);
	assert.equal(api.pythonJsonDumps(plain), api.pythonJsonDumps(api.parsePythonJson(api.pythonJsonDumps({half: 0.5, whole: 2, negativeZero: -0}))));
	assert.throws(() => api.clone({bad: undefined}), TypeError);
	assert.throws(() => api.clone({huge: 2 ** 60}), TypeError);
});

test('RuleObservations.load builds the index once per graph object and again after the file changes', async () => {
	const content = join(evidence, 'content-rules'), directory = join(content, 'rulesets', 'coc7');
	const original = join(ROOT, 'content', 'rulesets', 'coc7');
	await (await import('node:fs/promises')).mkdir(directory, {recursive: true});
	for (const name of ['manifest.json', 'rule-graph.json', 'rule-graph-manifest.json'])
		await writeFile(join(directory, name), await readFile(join(original, name)));
	const context = await api.createKernelContext({workspace: await mkdtemp(join(evidence, 'ws-')), content});
	const first = await api.RuleObservations.load(context);
	assert.equal(await api.RuleObservations.load(context), first, 'same graph object, same index');
	// A rewritten (identical) graph is a new file identity: a new index, still valid.
	await replaceAtomically(join(directory, 'rule-graph.json'), await readFile(join(original, 'rule-graph.json'), 'utf8'));
	const rebuilt = await api.RuleObservations.load(context);
	assert.notEqual(rebuilt, first);
	assert.equal(rebuilt.nodes.size, first.nodes.size);
});

test('readPublishedGraph serves unchanged bytes from the cache and still refuses changed bytes', async () => {
	const home = await mkdtemp(join(evidence, 'home-')), context = await api.createKernelContext({workspace: home, content: join(ROOT, 'content')}),
		store = new api.ModuleStore(context), meta = {id: 'cache-book', source: 'pdf', generation: 0};
	const rawGraph = {contract_id: 'coc.module-graph.v3', schema_version: 3, module_id: meta.id,
		nodes: [{node_id: `module-${meta.id}`, node_kind: 'module', name: 'Book', properties: {value: new api.PythonFloat(1)}}], relations: [], claims: []};
	await store.writeGraph(meta, rawGraph); await store.writeModule(meta);
	const path = await store.graphPath(meta.id), bound = await store.module(meta.id);
	const first = await api.readPublishedGraph(context, path, bound, meta.id);
	const again = await api.readPublishedGraph(context, path, bound, meta.id);
	assert.equal(again.raw, first.raw, 'unchanged bytes: the same frozen graph');
	assert.equal(again.digest, first.digest);
	// Changed bytes under the same metadata: the digest check refuses, cache or no cache.
	const text = await readFile(path, 'utf8');
	await replaceAtomically(path, text.replace('"Book"', '"Tome"'));
	await assert.rejects(api.readPublishedGraph(context, path, bound, meta.id), error => error.details?.component === 'graph_digest');
	// Restored bytes read again (new inode, same digest) and verify.
	await replaceAtomically(path, text);
	const restored = await api.readPublishedGraph(context, path, bound, meta.id);
	assert.equal(restored.digest, first.digest);
	assert.deepEqual(restored.raw, first.raw);
});
