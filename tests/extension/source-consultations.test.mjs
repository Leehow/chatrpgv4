/** Full query ownership under a controlled clock; these are transport tests, not gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SourceConsultations} from '../../extensions/module/source-consultations.ts';

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
const original = text => ({state: 'ready', source_answer: {authority: 'original-source-excerpts', status: 'excerpts',
    source_sha256: 'bound-original', excerpts: [{page: 2, text}], coverage: {partial: true, visual: 'unassessed'}}});
function fixture(t) {
    let now = 0;
    const timers = [], rows = [], owner = new SourceConsultations(row => rows.push(row), () => now,
        (callback, ms) => {const timer = {callback, ms, cancelled: false}; timers.push(timer); return () => {timer.cancelled = true;};});
    t.after(() => owner.close());
    const input = {campaign: 'table-a', moduleId: 'book', worldline: 'main', loop: 0, focus: 'Dock', question: 'Who works here?',
        mode: 'answer', allowanceMs: 100, binding: async () => 'original-sha:g3', reference: async () => undefined,
        fallback: async () => {throw Error('Unexpected fallback');}};
    return {owner, rows, timers, input, advance(value) {now = value;}, expire(index = 0) {now = 100; timers[index].callback();}};
}

test('binding and slow original retrieval share the foreground allowance; pending follows the same source task', async t => {
    const f = fixture(t), binding = deferred(), read = deferred(); let calls = 0, priority;
    const task = f.owner.lookup({...f.input, binding: () => binding.promise, reference: async (_signal, rank) => {
        calls++; priority = rank; return read.promise;}});
    f.expire(); const pending = await task;
    assert.equal(pending.state, 'pending'); assert.equal(calls, 0);
    binding.resolve('original-sha:g3'); await tick();
    assert.equal(calls, 1); assert.equal(priority(), 'background');
    read.resolve(original('Original dock text.'));
    assert.deepEqual(await pending.settled, original('Original dock text.'));
    assert.equal(calls, 1);
});

test('fallback receives only the remainder and cannot renew a consumed foreground allowance', async t => {
    const f = fixture(t), read = deferred(), done = deferred(); let options;
    const task = f.owner.lookup({...f.input, reference: () => read.promise, fallback: async (_signal, value) => {
        options = value; return {state: 'pending', settled: done.promise};}});
    await tick(); f.advance(70); read.resolve(undefined); await tick();
    assert.deepEqual(options, {allowanceMs: 30, foreground: true, blocking: false});
    f.expire(); const pending = await task;
    done.resolve({state: 'ready', source_answer: {status: 'unresolved', answer: '', limitations: 'No checked source answer.'}});
    assert.equal((await pending.settled).source_answer.status, 'unresolved');
});

test('a fallback that starts after expiry is background; explicit preparation retains its blocking policy', async t => {
    for (const mode of ['answer', 'prepare']) {
        const f = fixture(t), read = deferred(); let options;
        const task = f.owner.lookup({...f.input, mode, reference: () => read.promise, fallback: async (_signal, value) => {
            options = value; return {state: 'ready'};}});
        await tick(); f.expire(); const pending = await task; read.resolve(undefined); await pending.settled;
        assert.deepEqual(options, {allowanceMs: 0, foreground: mode === 'prepare', blocking: mode === 'prepare'});
    }
});

test('joined callers share original retrieval, and cancelling one never cancels another waiter', async t => {
    const f = fixture(t), read = deferred(), first = new AbortController(); let calls = 0, sourceSignal;
    const input = {...f.input, reference: async signal => {calls++; sourceSignal = signal; return read.promise;}};
    const a = f.owner.lookup({...input, signal: first.signal}); const refused = assert.rejects(a, error => error.name === 'AbortError');
    const b = f.owner.lookup(input); await tick(); first.abort(); await refused; await tick();
    assert.equal(calls, 1); assert.equal(sourceSignal.aborted, false);
    read.resolve(original('An independently bound original excerpt.')); assert.equal((await b).state, 'ready');
});

test('exact same-version original reuse avoids a new reader; retry and changed scope never reuse it', async t => {
    const f = fixture(t); let calls = 0;
    const input = {...f.input, reference: async () => {calls++; return original('Original text.');}};
    await f.owner.lookup(input); await f.owner.lookup(input); assert.equal(calls, 1);
    for (const change of [{retry: true}, {campaign: 'table-b'}, {worldline: 'branch'}, {loop: 1},
        {binding: async () => 'original-sha:g4'}, {binding: async () => 'other-original:g3'}, {question: 'A different question?'}, {mode: 'prepare'}]) {
        const before = calls; await f.owner.lookup({...input, ...change}); assert.equal(calls, before + 1);
    }
});

test('generated fallback answers are not cached as original text and repeated callers still join the reading service', async t => {
    const f = fixture(t); let falls = 0;
    const input = {...f.input, fallback: async () => {falls++; return {source_answer: {status: 'answered', answer: 'An unbound response.'}};}};
    await f.owner.lookup(input); await f.owner.lookup(input); assert.equal(falls, 2);
});

test('joining a query already in fallback does not restart its original reader', async t => {
    const f = fixture(t), completed = deferred(); let reads = 0, joined = 0;
    const input = {...f.input, reference: async () => {reads++;}, fallback: async () => {joined++; return completed.promise;}};
    const first = f.owner.lookup(input); await tick();
    const second = f.owner.lookup(input); await tick();
    assert.equal(reads, 1); assert.equal(joined, 2, 'each caller joins the existing service with its own waiter');
    completed.resolve({state: 'ready'}); await Promise.all([first, second]);
});

test('an accepted kernel envelope is reused before another excerpt child, without inventing material readiness', async t => {
    const f = fixture(t); let reads = 0, falls = 0;
    const accepted = {state: 'ready', generation: 3, source_answer: {status: 'answered', supported: true,
        authority: 'source-consultation', prepared: false, answer: 'An accepted answer.', source_refs: [{page: 2}]}};
    let cached;
    const input = {...f.input, accepted: async () => cached, reference: async () => {reads++;}, fallback: async () => {falls++; cached = accepted; return accepted;}};
    await f.owner.lookup(input); const reply = await f.owner.lookup(input);
    assert.deepEqual(reply, accepted); assert.equal(reads, 1); assert.equal(falls, 1);
    assert.equal(reply.source_answer.prepared, false);
    cached = undefined;
    await f.owner.lookup({...input, binding: async () => 'original-sha:g4'}); assert.equal(reads, 2); assert.equal(falls, 2);
});

test('an accepted-cache integrity refusal cannot be bypassed with a previously retained original', async t => {
    const f = fixture(t); let refused = false, reads = 0;
    const input = {...f.input, accepted: async () => {if (refused) throw Error('source_answer_integrity');},
        reference: async () => {reads++; return original('Original text.');}};
    await f.owner.lookup(input); refused = true;
    await assert.rejects(f.owner.lookup(input), /source_answer_integrity/); assert.equal(reads, 1);
});

test('cancelling the last active caller aborts its original child and never caches the partial work', async t => {
    const f = fixture(t), caller = new AbortController(); let signal;
    const task = f.owner.lookup({...f.input, signal: caller.signal, reference: value => {signal = value;
        return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(value.reason), {once: true}));}});
    const refused = assert.rejects(task, error => error.name === 'AbortError'); await tick(); caller.abort(); await refused; await tick();
    assert.equal(signal.aborted, true);
    const again = await f.owner.lookup({...f.input, reference: async () => original('Fresh checked original.')});
    assert.equal(again.source_answer.excerpts[0].text, 'Fresh checked original.');
});

test('shutdown cancels retained work; a pending reply never turns cancelled work into source success', async t => {
    const f = fixture(t);
    const task = f.owner.lookup({...f.input, reference: signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once: true});})});
    await tick(); f.expire(); const pending = await task;
    const refused = assert.rejects(pending.settled, error => error.name === 'AbortError'); f.owner.close(); await refused;
    await assert.rejects(f.owner.lookup(f.input), /owner is closed/);
});

test('completed original reuse stays within the existing entry and byte bounds', async t => {
    const f = fixture(t); let calls = 0;
    const input = {...f.input, reference: async () => {calls++; return original('Original text.');}};
    for (let i = 0; i < 17; i++) await f.owner.lookup({...input, question: 'Question ' + i});
    await f.owner.lookup({...input, question: 'Question 16'}); assert.equal(calls, 17);
    await f.owner.lookup({...input, question: 'Question 0'}); assert.equal(calls, 18, 'the oldest completed entry was evicted');
    const large = {...input, reference: async () => {calls++; return original('x'.repeat(40 * 1024));}};
    await f.owner.lookup({...large, question: 'Large A'}); await f.owner.lookup({...large, question: 'Large B'});
    const before = calls; await f.owner.lookup({...large, question: 'Large A'});
    assert.equal(calls, before + 1, 'combined original envelopes cannot exceed the 64 KiB bound');
});
