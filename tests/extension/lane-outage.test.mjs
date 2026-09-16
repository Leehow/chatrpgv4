/**
 * Contract §56: an advisory lane that keeps failing says so once, to the operator, and never to the
 * player. Deterministic; no model, no RPC, no playtest.
 *
 * The case this exists for: campaign game-3d8ab658 finished a whole game with the memory lane
 * failing on every one of 31 turns, the same sentence each time, `ok: false` on every row — and no
 * surface anywhere reported it. The rows were written. Nothing read them.
 */
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLaneTelemetry, OUTAGE_STREAK } from "../../extensions/lanes/telemetry.ts";

async function host(t, lane = "memory") {
	const home = await mkdtemp(join(tmpdir(), "coc-lane-outage-"));
	const previous = process.env.PI_COC_HOME;
	process.env.PI_COC_HOME = home;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_COC_HOME;
		else process.env.PI_COC_HOME = previous;
	});
	const entries = [], events = [];
	const pi = {
		events: new EventEmitter(),
		appendEntry: (kind, data) => entries.push({ kind, data }),
	};
	pi.events.on("coc:lane-status", (value) => events.push(value));
	const telemetry = createLaneTelemetry(pi, { lane, modelEnv: "PI_COC_TEST_MODEL", cwd: () => home });
	return {
		telemetry, entries, events,
		notices: () => entries.filter((entry) => entry.kind === "coc-lane-status").map((entry) => entry.data),
		async rows() {
			const text = await readFile(join(home, ".coc", "campaigns", "camp", "telemetry.jsonl"), "utf8");
			return text.trim().split("\n").map((line) => JSON.parse(line));
		},
	};
}

/** The exact row the memory lane wrote on all 31 turns of game-3d8ab658. */
const failure = (turn) => ({
	turn, ok: false, ms: 41, reason: "lane_error",
	detail: "memory.job unknown_entity: entity 'artifacts-two-cultures' is ambiguous",
});

test("a lane failing every turn is reported once, out of fiction, and not on its first blip", async (t) => {
	const h = await host(t);
	for (let turn = 0; turn < OUTAGE_STREAK - 1; turn += 1) await h.telemetry.record("camp", failure(turn));
	assert.deepEqual(h.notices(), [], "the first rounds of a streak read as transient");
	assert.deepEqual(h.events, []);
	await h.telemetry.record("camp", failure(OUTAGE_STREAK - 1));
	assert.equal(h.notices().length, 1);
	const notice = h.notices()[0];
	assert.equal(notice.lane, "memory");
	assert.equal(notice.campaign, "camp");
	assert.equal(notice.status, "down");
	assert.equal(notice.streak, OUTAGE_STREAK);
	assert.equal(notice.reason, "lane_error");
	assert.match(notice.detail, /artifacts-two-cultures/);
	assert.match(notice.fix, /memory lane has failed/);
	assert.deepEqual(h.events, [notice], "the bus carries the same notice for a live consumer");
	// Turn 31 of the real campaign: the streak goes on and the operator is not told 29 more times.
	for (let turn = OUTAGE_STREAK; turn < 31; turn += 1) await h.telemetry.record("camp", failure(turn));
	assert.equal(h.notices().length, 1, "once per streak, not once per failure");
	const rows = await h.rows();
	assert.equal(rows.filter((row) => row.event === "outage").length, 1,
		"the campaign's own evidence names the outage once, beside the failures");
	assert.equal(rows.filter((row) => row.ok === false).length, 31);
	assert.ok(rows.every((row) => row.lane === "memory"));
});

test("a success ends a streak, so a later one is reported again", async (t) => {
	const h = await host(t);
	for (let turn = 0; turn < OUTAGE_STREAK; turn += 1) await h.telemetry.record("camp", failure(turn));
	assert.equal(h.notices().length, 1);
	await h.telemetry.record("camp", { turn: 9, ok: true, ms: 800, candidates: 4 });
	assert.equal(h.telemetry.outage, 0);
	for (let turn = 10; turn < 10 + OUTAGE_STREAK; turn += 1) await h.telemetry.record("camp", failure(turn));
	assert.equal(h.notices().length, 2, "a new streak is a new condition");
	assert.equal(h.notices()[1].streak, OUTAGE_STREAK);
});

/**
 * The mutation this guards: counting every row with an `ok`. `runLane` writes several
 * `lane: "lane-call"` rows per job through this same writer (contract §12.8.1), and a provider call
 * that succeeds on a job that still fails would clear the streak on every turn — the outage would go
 * silent again, in exactly the campaign shape this fix is for.
 */
test("nested lane-call rounds neither raise a streak nor clear one", async (t) => {
	const h = await host(t);
	for (let turn = 0; turn < OUTAGE_STREAK - 1; turn += 1) {
		await h.telemetry.record("camp", { lane: "lane-call", subsession: "memory", phase: "start" });
		await h.telemetry.record("camp", { lane: "lane-call", subsession: "memory", phase: "end", ok: true, ms: 12 });
		await h.telemetry.record("camp", failure(turn));
	}
	assert.equal(h.telemetry.outage, OUTAGE_STREAK - 1, "a successful provider round is not a successful job");
	assert.deepEqual(h.notices(), []);
	await h.telemetry.record("camp", { lane: "lane-call", subsession: "memory", phase: "end", ok: false, ms: 9 });
	assert.deepEqual(h.notices(), [], "nor is a failed provider round a failed job");
	await h.telemetry.record("camp", failure(OUTAGE_STREAK - 1));
	assert.equal(h.notices().length, 1);
});

test("the fix names the model only when the model is the suspect", async (t) => {
	const model = await host(t, "voice");
	for (let turn = 0; turn < OUTAGE_STREAK; turn += 1)
		await model.telemetry.record("camp", { turn, ok: false, reason: "model_unavailable", detail: "no such model" });
	assert.match(model.notices()[0].fix, /PI_COC_TEST_MODEL/);
	const kernel = await host(t, "journal");
	for (let turn = 0; turn < OUTAGE_STREAK; turn += 1) await kernel.telemetry.record("camp", failure(turn));
	assert.doesNotMatch(kernel.notices()[0].fix, /PI_COC_TEST_MODEL/,
		"a kernel error is not repaired by changing the lane's model");
	assert.match(kernel.notices()[0].fix, /host or kernel failure/);
});

test("the notice never travels a player surface", async (t) => {
	const h = await host(t);
	for (let turn = 0; turn < OUTAGE_STREAK; turn += 1) await h.telemetry.record("camp", failure(turn));
	const kinds = new Set(h.entries.map((entry) => entry.kind));
	assert.deepEqual([...kinds].sort(), ["coc-lane-status", "coc-telemetry"],
		"an advisory lane's outage is the operator's business; the table plays on without it");
});
