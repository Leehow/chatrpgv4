import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adaptationService} from '../../extensions/kernel/adaptation.ts';
import {KernelError} from '../../extensions/kernel/client.ts';
import {admissionRequest} from '../../extensions/kernel/admission.ts';

async function fixture({hold = false, fail = false, badDraft = false, rejectReview = false} = {}) {
    const root = await mkdtemp(join(tmpdir(), 'adaptation-host-contract-'));
    for (const role of ['create', 'review']) await mkdir(join(root, role));
    const calls = [], runs = [], owner = new AbortController();
    let status = 'pending', release, draftCalls = 0;
    const delayed = new Promise(resolve => release = resolve);
    const task = role => ({key: 'host-owned', attempt: 1, role, cwd: join(root, role), system_prompt: join(root, role, 'prompt.md')});
    const call = async (method, args) => {
        calls.push({method, args});
        if (method === 'adaptation.prepare') return {name: args.name, status, task: task('create')};
        if (method === 'adaptation.draft') {
            if (badDraft && draftCalls++ === 0) throw new KernelError({code: 'unknown_entity', message: 'Change 0 sources: use an original scene reference', fix: 'Use scene: office'});
            status = 'reviewing'; return {task: task('review')};
        }
        if (method === 'adaptation.review') {
            if (rejectReview) throw new KernelError({code: 'needs', message: 'Source contradiction'});
            status = 'ready';
        }
        if (method === 'adaptation.cancel') status = 'cancelled';
        if (method === 'adaptation.fail' && status !== 'cancelled') status = 'failed';
        return {name: args.name, status};
    };
    const runtime = {signal: owner.signal, runTask: async (task, signal) => {
        runs.push(task);
        if (hold) await Promise.race([delayed, new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}))]);
        return {ok: !fail && !signal.aborted, code: fail ? 1 : 0};
    }};
    const service = adaptationService(runtime, call, () => ({name: 'deepseek/deepseek-v4-flash', thinking: 'low'}));
    return {service, calls, runs, release, owner};
}

test('the host runs a fresh creator and reviewer with tools and explicit model, then returns ready without accepting', async () => {
    const f = await fixture();
    try {
        const result = await f.service.lookup({campaign: 'c1', action: 'prepare', name: 'New route'});
        assert.equal(result.status, 'ready'); assert.equal(f.runs.length, 2);
        for (const run of f.runs) {
            assert.equal(run.request.model, 'deepseek/deepseek-v4-flash');
            assert.equal(run.request.tools, 'read,write,edit,bash');
        }
        assert.notEqual(f.runs[0].request.cwd, f.runs[1].request.cwd);
        assert.deepEqual(f.calls.filter(c => ['adaptation.draft', 'adaptation.review'].includes(c.method)).map(c => c.args.attempt), [1, 1]);
        assert.ok(!f.calls.some(c => c.method === 'table.apply'));
    } finally {f.owner.abort();}
});

test('pending is an honest status and explicit cancellation aborts retained preparation without a late ready result', async () => {
    const previous = process.env.PI_COC_ADAPTATION_WAIT_MS; process.env.PI_COC_ADAPTATION_WAIT_MS = '0';
    const f = await fixture({hold: true});
    try {
        const result = await f.service.lookup({campaign: 'c1', action: 'prepare', name: 'New route'});
        assert.equal(result.status, 'pending'); assert.match(result.service_status, /No fictional event/);
        assert.equal((await f.service.lookup({campaign: 'c1', action: 'cancel', name: 'New route'})).status, 'cancelled');
        f.release(); await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(!f.calls.some(c => c.method === 'adaptation.review'));
        assert.equal((await f.service.lookup({campaign: 'c1', action: 'status', name: 'New route'})).status, 'cancelled');
    } finally {f.owner.abort(); if (previous == null) delete process.env.PI_COC_ADAPTATION_WAIT_MS; else process.env.PI_COC_ADAPTATION_WAIT_MS = previous;}
});

test('a failed author never starts semantic review or silently accepts an adaptation', async () => {
    const f = await fixture({fail: true});
    try {
        assert.equal((await f.service.lookup({campaign: 'c1', action: 'prepare', name: 'New route'})).status, 'failed');
        assert.equal(f.runs.length, 1);
        assert.ok(!f.calls.some(c => c.method === 'adaptation.draft' || c.method === 'table.apply'));
    } finally {f.owner.abort();}
});

test('one deterministic reference repair gets precise feedback; semantic rejection is not retried', async () => {
    const repaired = await fixture({badDraft: true});
    try {
        assert.equal((await repaired.service.lookup({campaign: 'c1', action: 'prepare', name: 'New route'})).status, 'ready');
        assert.equal(repaired.runs.length, 3);
        assert.match(repaired.runs[1].request.brief, /feedback.json/);
        assert.notEqual(repaired.runs[0].request.eventLog, repaired.runs[1].request.eventLog);
    } finally {repaired.owner.abort();}
    const rejected = await fixture({rejectReview: true});
    try {
        assert.equal((await rejected.service.lookup({campaign: 'c1', action: 'prepare', name: 'New route'})).status, 'failed');
        assert.equal(rejected.runs.length, 2);
    } finally {rejected.owner.abort();}
});

test('admission reuse distinguishes travel time, display destination and payment counterparty', () => {
    const effects = [{kind: 'move', to: 'Hotel', label: 'Hotel', travel_minutes: 25}, {kind: 'cash', delta: -2.5, with: 'Clerk'}];
    const key = value => admissionRequest('apply', {effects: value}, {scene: {handle: 'office', label: 'Office'}}).key;
    const base = key(effects);
    for (const [index, field, value] of [[0, 'travel_minutes', 80], [0, 'label', 'Another place'], [1, 'with', 'Another person']]) {
        const changed = structuredClone(effects); changed[index][field] = value;
        assert.notEqual(key(changed), base);
    }
});
