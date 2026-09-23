/**
 * Contract §134.13: a stated obligation's check with the identical recipe of an active Mod check is served
 * by that Mod check -- the frozen result when the pair already has one -- and issues no check of its own.
 *
 * The haunting ships no such step (Dooley is SO-05), so each case derives a content root whose morgue gate
 * carries `natural-npc`'s own recipe (APP or Credit Rating, the higher, regular) and drives the real
 * entries: `campaign.create`, `table.apply`, `table.apply.options` and `table.resolve`. The comparison is
 * structural; a recipe one key away from the Mod's is not served by it.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '../..'), content = join(root, 'content');
const scratch = await mkdtemp(join(tmpdir(), 'scene-obligations-'));
await mkdir(join(root, '.coc'), {recursive: true});
const bundleDir = await mkdtemp(join(root, '.coc', 'scene-obligations-'));
after(async () => { await rm(scratch, {recursive: true, force: true}); await rm(bundleDir, {recursive: true, force: true}); });
await build({stdin: {contents:
    `export {createKernelContext} from './kernel-ts/context.ts';` +
    `export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';` +
    `export {createKernelRuntime} from './kernel-ts/registry.ts';`,
    resolveDir: root, sourcefile: 'scene-obligations-api.ts'},
    outfile: join(bundleDir, 'api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
const api = await import(pathToFileURL(join(bundleDir, 'api.mjs')).href);

const SHIPPED = JSON.parse(await readFile(join(content, 'starters/the-haunting/module-graph.json'), 'utf8'));
const ACCESS = 'requirement-globe-clippings-access', HANDLE = 'globe-clippings-access', FLAG = 'newspaper-morgue-clippings-access';
const MOD_CHECK = 'natural-npc:first-impression';

/** The shipped graph with the gate's check step replaced by `natural-npc`'s recipe, then `edit`ed. */
async function contentWith(edit = () => {}) {
    // The built-in Mods sit beside the content root (`readModCatalog`), so the derived root keeps that neighbour.
    const base = await mkdtemp(join(scratch, 'root-')), dir = join(base, 'content');
    await mkdir(dir);
    await symlink(join(root, 'mods'), join(base, 'mods'));
    for (const name of await readdir(content))
        if (name !== 'starters') await symlink(join(content, name), join(dir, name));
    const starter = join(dir, 'starters', 'the-haunting'), shipped = join(content, 'starters', 'the-haunting');
    await mkdir(starter, {recursive: true});
    for (const name of await readdir(shipped))
        if (name !== 'module-graph.json') await symlink(join(shipped, name), join(starter, name));
    const graph = structuredClone(SHIPPED), node = graph.nodes.find(entry => entry.node_id === ACCESS);
    const step = node.properties.obligation.demand.find(entry => entry.kind === 'check');
    // The Mod's value paths under labels of the author's own: identity is structural, labels are never compared.
    step.values = [{path: 'characteristics.APP', label: 'APP'}, {path: 'skills.Credit Rating', label: 'Credit'}];
    step.selection = 'maximum';
    delete node.properties.obligation.reaction;
    edit(node.properties.obligation, step);
    await writeFile(join(starter, 'module-graph.json'), JSON.stringify(graph, null, 2));
    return dir;
}

/** A fresh haunting campaign over `contentRoot`, standing in the morgue with Arty introduced. */
async function atMorgue(contentRoot) {
    const home = await mkdtemp(join(scratch, 'home-'));
    const context = await api.createKernelContext({workspace: home, content: contentRoot, seed: 'scene-obligations',
        locks: api.nativeAdvisoryLocks(), env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}});
    const runtime = api.createKernelRuntime(context), call = (method, params = {}) => runtime.handlers[method]({campaign: 'c1', ...params});
    await runtime.handlers['campaign.create']({id: 'c1', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
    await call('table.narrate', {call_id: 't0-c1', text: 'The opening.'});
    await call('table.player_input', {text: 'I go to the Globe.'});
    await call('table.apply', {call_id: 't1-c1', effects: [{kind: 'move', to: 'newspaper-morgue'}]});
    await call('table.apply', {call_id: 't1-c2', effects: [{kind: 'person', who: 'Arty Wilmot', name: 'Arty'}]});
    const access = async () => (await call('table.apply.options')).obligations.find(row => row.handle === HANDLE);
    const flags = async () => JSON.parse(await readFile(join(home, '.coc', 'campaigns', 'c1', 'world.json'), 'utf8')).flags ?? {};
    return {runtime, call, access, flags};
}
const settling = level => !['failure', 'fumble'].includes(level);

test('a check with the Mod recipe is served by the Mod check and settles on its frozen result', async () => {
    const table = await atMorgue(await contentWith());
    try {
        const issued = await table.access();
        assert.deepEqual(issued.next.served_by, {mod: 'natural-npc', check: MOD_CHECK});
        assert.equal(issued.next.selection, 'maximum');
        // The first impression lands first, unclaimed: it freezes the pair's result and settles nothing.
        const impression = await table.call('table.resolve', {call_id: 't1-c3', action: {intent: 'social', decision: MOD_CHECK, target: 'Arty Wilmot'}});
        assert.equal(impression.decision, MOD_CHECK);
        assert.equal(Object.hasOwn(impression, 'obligation'), false);
        assert.equal(Object.hasOwn(await table.flags(), FLAG), false);
        // The claim is served by that frozen result -- no second roll -- and settles by its level.
        const claimed = await table.call('table.resolve', {call_id: 't1-c4', action: {intent: 'social', obligation: HANDLE}});
        assert.equal(claimed.decision, MOD_CHECK);
        assert.equal(claimed.reused, true);
        assert.equal(claimed.outcome.level, impression.outcome.level);
        assert.equal(claimed.obligation.settled, settling(impression.outcome.level));
        assert.equal((await table.flags())[FLAG] === true, settling(impression.outcome.level));
        assert.equal((await table.access()).state, settling(impression.outcome.level) ? 'settled' : 'open');
    } finally { await table.runtime.close(); }
});

test('a claim on a served step with no frozen result rolls the Mod check once, and it is then frozen', async () => {
    const table = await atMorgue(await contentWith());
    try {
        const claimed = await table.call('table.resolve', {call_id: 't1-c3', action: {intent: 'social', obligation: HANDLE}});
        assert.equal(claimed.decision, MOD_CHECK);
        assert.notEqual(claimed.reused, true);
        assert.equal(claimed.obligation.settled, settling(claimed.outcome.level));
        const again = await table.call('table.resolve', {call_id: 't1-c4', action: {intent: 'social', decision: MOD_CHECK, target: 'Arty Wilmot'}});
        assert.equal(again.reused, true);
        assert.equal(again.outcome.level, claimed.outcome.level);
    } finally { await table.runtime.close(); }
});

test('a recipe one key away from the Mod check is not served by it', async () => {
    for (const edit of [(ob, step) => { step.difficulty = 'hard'; }, (ob, step) => { step.values.pop(); }]) {
        const table = await atMorgue(await contentWith(edit));
        try {
            const issued = await table.access();
            assert.equal(issued.next.kind, 'check');
            assert.equal(Object.hasOwn(issued.next, 'served_by'), false);
            const claimed = await table.call('table.resolve', {call_id: 't1-c3', action: {intent: 'social', obligation: HANDLE}});
            assert.equal(claimed.decision, 'core-check:ordinary-check');
        } finally { await table.runtime.close(); }
    }
});

test('without reaction: preordained the Mod contact check is left to the clerk as today', async () => {
    const table = await atMorgue(await contentWith());
    try {
        const issued = await table.access();
        assert.equal(Object.hasOwn(issued, 'reaction'), false);
        assert.equal(Object.hasOwn(issued, 'mod_contact'), false);
    } finally { await table.runtime.close(); }
});
