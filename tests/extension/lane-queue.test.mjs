/** Deterministic scheduling tests; no model, RPC implementation or playtest is simulated here. */
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { setImmediate as drain } from "node:timers/promises";
import { test } from "node:test";
import { createLaneQueue } from "../../extensions/lanes/queue.ts";

const ENV = "PI_COC_QUEUE_TEST_BACKFILL";
const bridge = { campaign: "camp", call: async () => ({}) };
const ctx = { cwd: "/unused" };

function budget(t, value, key = ENV) {
	const previous = process.env[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
	t.after(() => {
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	});
}

function host() {
	const hooks = new EventEmitter();
	const pi = { events: new EventEmitter(), on: (name, handler) => hooks.on(name, handler) };
	return {
		pi,
		async hook(type, context = ctx) {
			for (const handler of hooks.listeners(type)) await handler({ type }, context);
		},
		publish: (value = bridge) => pi.events.emit("coc:kernel-bridge", value),
		commit: (turn) => pi.events.emit("coc:turn-committed", { campaign: "camp", turn }),
	};
}

function gate(t) {
	const { promise, resolve } = Promise.withResolvers();
	t.after(resolve);
	return { promise, open: resolve };
}

function mount(h, runJob, onError = async () => {}, backfillEnv = ENV) {
	return createLaneQueue(h.pi, { backfillEnv, runJob, onError });
}

for (const first of ["bridge", "session"]) {
	test(`backfill waits for both bridge and context (${first} first), then stops on an empty dispatch`, async (t) => {
		budget(t, "5");
		const h = host(), jobs = [];
		const queue = mount(h, async (job) => { jobs.push(job); queue.stopBackfill(); });
		if (first === "bridge") h.publish();
		else await h.hook("session_start");
		await drain();
		assert.deepEqual(jobs, []);
		if (first === "bridge") await h.hook("session_start");
		else h.publish();
		await drain();
		assert.deepEqual(jobs, [{ campaign: "camp", backfill: true }]);
		h.publish();
		await h.hook("agent_settled");
		await drain();
		assert.equal(jobs.length, 1, "an empty default dispatch exhausts this session, not just this pump");
		h.commit(7);
		await drain();
		assert.deepEqual(jobs[1], { campaign: "camp", turn: 7 });
	});
}

test("committed turns stay FIFO, precede remaining backfill and do not overlap a held job", async (t) => {
	budget(t, "2");
	const h = host(), held = gate(t), jobs = [];
	let active = 0, maximum = 0;
	mount(h, async (job) => {
		jobs.push(job);
		maximum = Math.max(maximum, ++active);
		try { if (jobs.length === 1) await held.promise; }
		finally { active--; }
	});
	h.publish();
	await h.hook("session_start");
	await h.hook("agent_start");
	h.commit(8);
	h.commit(9);
	await h.hook("agent_settled");
	h.publish();
	assert.equal(jobs.length, 1, "all event handlers return while the first job is held");
	held.open();
	await drain();
	assert.deepEqual(jobs.map(job => job.turn), [undefined, 8, 9, undefined]);
	assert.equal(maximum, 1);
});

test("an open agent run blocks only new backfill; agent_end is not agent_settled", async (t) => {
	budget(t, "2");
	const h = host(), jobs = [];
	mount(h, async job => { jobs.push(job); });
	await h.hook("session_start");
	await h.hook("agent_start");
	h.publish();
	h.commit(1);
	await drain();
	assert.deepEqual(jobs, [{ campaign: "camp", turn: 1 }]);
	await h.hook("agent_end");
	await drain();
	assert.equal(jobs.length, 1);
	await h.hook("agent_settled");
	await drain();
	assert.deepEqual(jobs.map(job => Boolean(job.backfill)), [false, true, true]);
});

test("backfill budget parsing and reset remain per session, including zero and parseInt inputs", async (t) => {
	budget(t, "0");
	const h = host(), jobs = [];
	mount(h, async job => { jobs.push(job); });
	for (const [raw, expected] of [["0", 0], [undefined, 5], ["  ", 5], ["-1", 5], ["bad", 5], ["Infinity", 5], [" 2 ", 2], ["3tail", 3]]) {
		if (raw === undefined) delete process.env[ENV];
		else process.env[ENV] = raw;
		h.publish();
		await h.hook("session_start");
		await drain();
		assert.equal(jobs.length, expected, `budget ${JSON.stringify(raw)}`);
		h.commit(10);
		await drain();
		assert.equal(jobs.length, expected + 1, "committed turns do not consume the backfill budget");
		await h.hook("session_shutdown");
		jobs.length = 0;
	}
});

test("invalid/revoked bridges cannot start backfill and a restored bridge can", async (t) => {
	budget(t, "2");
	const h = host(), held = gate(t), jobs = [];
	const queue = mount(h, async job => { jobs.push(job); if (jobs.length === 1) await held.promise; });
	await h.hook("session_start");
	for (const payload of [null, {}, { campaign: "camp" }, { campaign: "camp", call: "bad" }, { call: bridge.call }]) {
		h.publish(payload);
		assert.equal(queue.bridge, undefined);
	}
	await drain();
	assert.deepEqual(jobs, []);
	h.publish();
	h.publish(null);
	held.open();
	await drain();
	assert.equal(jobs.length, 1, "revoking the bridge prevents the next default dispatch");
	h.publish();
	await drain();
	assert.equal(jobs.length, 2);
});

test("a failed job is reported and the pump continues; a failed reporter still releases running in finally", async (t) => {
	budget(t, "0");
	const h = host(), held = gate(t), jobs = [], errors = [];
	mount(h, async job => {
		jobs.push(job.turn);
		if (job.turn === 1) { await held.promise; throw new Error("job failed"); }
		if (job.turn === 3) throw new Error("another failure");
	}, async (job, error) => {
		errors.push([job.turn, error.message]);
		if (job.turn === 3) throw new Error("reporter failed");
	});
	h.publish();
	await h.hook("session_start");
	h.commit(1);
	h.commit(2);
	held.open();
	await drain();
	assert.deepEqual(jobs, [1, 2]);
	assert.deepEqual(errors, [[1, "job failed"]]);
	h.commit(3);
	await drain();
	h.commit(4);
	await drain();
	assert.deepEqual(jobs, [1, 2, 3, 4]);
});

test("shutdown aborts without waiting, drops queued turns and reuses the instance without stealing an old pump", async (t) => {
	budget(t, "1");
	const h = host(), held = gate(t), jobs = [];
	const queue = mount(h, async job => { jobs.push(job); if (jobs.length === 1) await held.promise; });
	h.publish();
	await h.hook("session_start");
	const oldSignal = queue.signal;
	h.commit(2);
	await h.hook("session_shutdown");
	assert.equal(oldSignal.aborted, true);
	assert.equal(queue.stopped, true);
	assert.equal(queue.ctx, undefined);
	assert.equal(queue.bridge, undefined);
	h.commit(3);
	h.publish();
	await h.hook("agent_settled");
	assert.equal(jobs.length, 1, "late events cannot restart a stopped lane");
	const nextCtx = { cwd: "/next" };
	await h.hook("session_start", nextCtx);
	assert.equal(queue.stopped, false);
	assert.equal(queue.ctx, nextCtx);
	assert.notEqual(queue.signal, oldSignal);
	assert.equal(queue.signal.aborted, false);
	h.commit(4);
	assert.equal(jobs.length, 1, "session_start must not reset the old continuation's running lock");
	held.open();
	await drain();
	assert.deepEqual(jobs.map(job => job.turn), [undefined, 4, undefined]);
	await h.hook("session_shutdown");
	h.publish();
	await h.hook("session_start");
	await drain();
	assert.equal(jobs.length, 4, "the completed pump also releases its lock across sessions");
});

test("two instances on the same bus have independent budgets, stop flags and running locks", async (t) => {
	budget(t, "1");
	budget(t, "2", "PI_COC_QUEUE_TEST_SECOND_BACKFILL");
	const h = host(), held = gate(t), first = [], second = [];
	const one = mount(h, async job => { first.push(job); await held.promise; });
	const two = mount(h, async job => { second.push(job); }, undefined, "PI_COC_QUEUE_TEST_SECOND_BACKFILL");
	h.publish();
	await h.hook("session_start");
	await drain();
	assert.equal(first.length, 1);
	assert.equal(second.length, 2, "one held lane must not serialize the other lane");
	assert.notEqual(one.signal, two.signal);
	one.stopBackfill();
	h.commit(1);
	await drain();
	assert.equal(second.length, 3);
	held.open();
	await drain();
	assert.equal(first.length, 2);
	await h.hook("session_shutdown");
	assert.equal(one.signal.aborted, true);
	assert.equal(two.signal.aborted, true);
});
