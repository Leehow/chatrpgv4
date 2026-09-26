/**
 * Contract §138.8 (BR-04 of docs/specs/band-then-roll.md, decision D9): the shadow lane for the Keeper's own `time`
 * and `damage` numbers.
 *
 * The real extension over the fake kernel, with a controlled typed endpoint behind the real decision adapter (`fetch`
 * answers the pinned Jev model). Asserted: the one `lane: "band-shadow"` row per effect and every field on it; what
 * Jev was shown (the declaration and what settled before the call, never the Keeper's `why` or number); that the
 * kernel received no write the Keeper did not send; that no row is written for a `stated` or a `band` effect; that
 * the turn does not wait for the answer; and the row without a key.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, toolResultTexts, waitFor, waitForIdle } from "./harness.mjs";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const PLAYER = "我把书房的每个抽屉都拉开，一格一格地翻。";
// A sentence and numbers only the Keeper's own call carries: none of them may reach the question.
const WHY = "SENTINEL-WHY the Keeper's own account of the minutes";
const ENV = { EXT_JEV_APIKEY: "test-jev-key" };
const TIME_ROWS = ["speak_briefly", "quick_observation", "single_room_search", "careful_house_search", "library_research",
	"first_aid", "medicine_treatment", "short_rest", "sleep_night", "therapy_week", "therapy_month", "spell_learning",
	"tome_study", "investigation_recovery"];
const RUNGS = ["minor", "moderate", "severe", "deadly", "terminal", "splat"];

const isShadow = (body) => Object.hasOwn(body.questions, "time_cost") || Object.hasOwn(body.questions, "severity");
function spread(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** One answer on the wire for any question: `pick(key, question)` names the choice (or level) and its confidence. */
function reply(key, question, pick) {
	if (question.type === "noul") return { type: "noul", noul: 0.5 };
	const { choice, confidence } = pick(key, question);
	if (question.type === "choice") {
		// Another lane's question (none is expected here) gets its first option rather than an answer it did not offer.
		const keys = Object.keys(question.criteria), chosen = keys.includes(choice) ? choice : keys[0];
		return { type: "choice", choice: chosen, confidence, probabilities: spread(keys, chosen, confidence) };
	}
	const levels = question.criteria.map((_, index) => String(index));
	const probabilities = spread(levels, String(choice), confidence);
	const score = levels.reduce((sum, level) => sum + Number(level) * probabilities[level], 0);
	return { type: "score", score, confidence, legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])), probabilities };
}

/** A controlled typed endpoint; `hold(entry)` can keep an answer back. Returns the shadow requests, in order. */
function installJev(t, { pick, hold }) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		const entry = { body, at: Date.now() };
		if (isShadow(body)) {
			requests.push(entry);
			if (hold) await hold(entry);
		}
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => [key, reply(key, question, pick)]));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 400, output_tokens: 10 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

// `run_id` is the telemetry writer's own stamp on every row of a skill run, not the lane's.
const shadowRows = (table) => table.telemetry().filter((row) => row.lane === "band-shadow").map(({ run_id: _run, ...row }) => row);
const writes = (table) => table.kernelRequests().filter((entry) => ["table.resolve", "table.apply", "table.narrate", "table.ask"].includes(entry.method));
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

async function play(t, { keeper, env = ENV, pick = () => ({ choice: "unknown", confidence: 0.9 }), hold, onTable }) {
	const requests = installJev(t, { pick, hold });
	const table = await openTable({ responses: [...keeper, call("narrate", { text: "抽屉一格格空了。" }), fauxAssistantMessage("done")], env });
	t.after(() => table.dispose());
	onTable?.(table);
	// The fake kernel owes no opening, so nothing runs before the player speaks.
	await table.session.prompt(PLAYER);
	return { table, requests };
}

test("a model-origin apply time writes one shadow row per effect with every field, asked from the declaration and what settled before", async (t) => {
	const { table, requests } = await play(t, {
		keeper: [
			call("apply", { effects: [{ kind: "clue", clue: "letter", how: "under the blotter" }] }),
			call("apply", { effects: [{ kind: "time", minutes: 37, why: WHY }] }),
			call("apply", { effects: [{ kind: "time", minutes: 240, why: WHY }] }),
		],
		pick: () => ({ choice: "single_room_search", confidence: 0.72 }),
	});
	const rows = await waitFor(() => shadowRows(table).length === 2 && shadowRows(table), { label: "two band-shadow rows" });
	const distribution = spread([...TIME_ROWS, "unknown"], "single_room_search", 0.72);
	const [first, second] = rows.map(({ ms, ...row }) => { assert.ok(Number.isFinite(ms) && ms >= 0, "the Jev time is recorded"); return row; });
	assert.deepEqual(first, { lane: "band-shadow", turn: 1, call_id: "t1-c2", index: 0, kind: "time", table: "time-costs", keeper_value: 37, ok: true,
		band: "single_room_search", range: { min: 10, max: 45 }, inside: true, confidence: 0.72, distribution, gate: 0.5, jev_calls: 1 });
	assert.deepEqual(second, { ...first, call_id: "t1-c3", keeper_value: 240, inside: false });
	// Jev was asked the time-cost categories an action can take (no road), each with its range, and an unknown exit.
	assert.equal(requests.length, 2);
	const [question] = Object.values(requests[0].body.questions);
	assert.equal(question.type, "choice");
	assert.deepEqual(Object.keys(question.criteria), [...TIME_ROWS, "unknown"]);
	assert.equal(question.criteria.single_room_search, "single room search: 10 to 45 minutes");
	// The state is the player's words and what settled before this call: nothing of the Keeper's own call.
	assert.deepEqual(requests[0].body.state, { declaration: PLAYER, settled_this_turn: ["apply landed: clue:t1-c1"] });
	assert.deepEqual(requests[1].body.state, { declaration: PLAYER, settled_this_turn: ["apply landed: clue:t1-c1", "apply landed: time:t1-c2"] });
	assert.ok(requests.every((entry) => !JSON.stringify(entry.body).includes("SENTINEL-WHY")), "the Keeper's why never reaches Jev");
	// The rows were read once, and the shadow sent the kernel nothing else: the writes are the Keeper's, as sent.
	assert.deepEqual(table.kernelRequests().filter((entry) => entry.method === "rules.bands").map((entry) => entry.params), [{ field: "time.band" }]);
	assert.deepEqual(writes(table).map((entry) => [entry.method, entry.params.call_id]),
		[["table.apply", "t1-c1"], ["table.apply", "t1-c2"], ["table.apply", "t1-c3"], ["table.narrate", "t1-c4"]]);
	assert.deepEqual(writes(table)[1].params.effects, [{ kind: "time", minutes: 37, why: WHY }]);
	// The Keeper's tool results are the kernel's, untouched.
	assert.ok(toolResultTexts(table.session).every((text) => !text.includes("band-shadow") && !text.includes("single_room_search")));
});

test("a model-origin apply damage is asked as a Score over the severity ladder, and a below-gate answer is recorded like any other", async (t) => {
	const { table, requests } = await play(t, {
		keeper: [call("apply", { effects: [{ kind: "damage", dice: "1d6", why: WHY }, { kind: "damage", dice: "1D10", why: WHY }] })],
		pick: () => ({ choice: 1, confidence: 0.35 }),
	});
	const rows = await waitFor(() => shadowRows(table).length === 2 && shadowRows(table), { label: "two band-shadow rows" });
	const distribution = Object.fromEntries(RUNGS.map((rung, index) => [rung, index === 1 ? 0.35 : 0.13]));
	const [first, second] = rows.map(({ ms: _ms, score, distribution: seen, ...row }) => {
		assert.ok(score > 0 && score < RUNGS.length - 1, "the Score's weighted level is recorded");
		assert.deepEqual(Object.keys(seen), RUNGS);
		for (const rung of RUNGS) assert.ok(Math.abs(seen[rung] - distribution[rung]) < 1e-9, rung);
		return row;
	});
	assert.deepEqual(first, { lane: "band-shadow", turn: 1, call_id: "t1-c1", index: 0, kind: "damage", table: "hazards", keeper_value: "1d6", ok: true,
		band: "moderate", range: "1D6", inside: true, confidence: 0.35, gate: 0.5, jev_calls: 1 });
	assert.deepEqual(second, { ...first, index: 1, keeper_value: "1D10", inside: false });
	const [question] = Object.values(requests[0].body.questions);
	assert.equal(question.type, "score");
	assert.equal(question.criteria.length, RUNGS.length);
	assert.match(question.criteria[0], /^minor, 1D3: A person could survive/);
	assert.match(question.criteria[5], /^splat, 8D10/);
	assert.deepEqual(requests[0].body.state, { declaration: PLAYER, settled_this_turn: [] });
	assert.ok(requests.every((entry) => !JSON.stringify(entry.body).includes("SENTINEL-WHY")));
	assert.deepEqual(table.kernelRequests().filter((entry) => entry.method === "rules.bands").map((entry) => entry.params), [{ field: "damage.band" }]);
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.apply", "table.narrate"]);
});

test("no row for a stated or a banded effect: only the Keeper's own number is shadowed", async (t) => {
	const { table, requests } = await play(t, {
		keeper: [call("apply", { effects: [
			{ kind: "time", band: "single_room_search", why: WHY },
			{ kind: "time", stated: "long-search", why: WHY },
			{ kind: "damage", band: "minor", why: WHY },
			{ kind: "damage", stated: "chapel-floor", why: WHY },
			{ kind: "time", minutes: 5, why: WHY },
		] })],
		pick: () => ({ choice: "quick_observation", confidence: 0.9 }),
	});
	// The effects are asked in order in one lane run, so the last effect's row means every earlier one had its turn.
	const rows = await waitFor(() => shadowRows(table).some((row) => row.index === 4) && shadowRows(table), { label: "the own-number row" });
	assert.deepEqual(rows.map((row) => [row.index, row.kind, row.keeper_value, row.band]), [[4, "time", 5, "quick_observation"]]);
	assert.equal(requests.length, 1);
});

test("the turn never waits for the answer: the tool result and the delivery land while Jev is still being asked", async (t) => {
	let release, table, safety;
	const held = new Promise((resolve) => { release = resolve; });
	t.after(() => clearTimeout(safety));
	const played = await play(t, {
		env: { ...ENV, PI_COC_BAND_JEV_TIMEOUT_MS: "30000" },
		keeper: [call("apply", { effects: [{ kind: "time", minutes: 20, why: WHY }] })],
		pick: () => ({ choice: "single_room_search", confidence: 0.8 }),
		onTable: (opened) => { table = opened; },
		hold: async (entry) => {
			// When Jev is asked, the Keeper's apply has already come back: its telemetry row is on disk.
			entry.applyRow = table.telemetry().find((row) => row.tool === "apply" && row.ok === true && row.call_id === "t1-c1");
			// A safety release from the moment Jev is asked, so a regression fails on its assertions rather than hanging.
			safety = setTimeout(() => release(), 8_000);
			await held;
		},
	});
	assert.deepEqual(shadowRows(played.table), [], "the turn returned with no shadow row: it did not wait for Jev");
	assert.ok(played.table.telemetry().some((row) => row.tool === "narrate" && row.ok === true), "the turn was delivered");
	const [request] = await waitFor(() => played.requests.length === 1 && played.requests, { label: "the held Jev request" });
	release();
	const [row] = await waitFor(() => shadowRows(played.table).length === 1 && shadowRows(played.table), { label: "the shadow row after the answer" });
	assert.equal(row.band, "single_room_search");
	assert.ok(request.applyRow, "the apply's result existed before Jev was asked");
	assert.ok(request.at >= Date.parse(request.applyRow.started_at) + request.applyRow.ms, "Jev was asked after the apply's result");
});

test("without a key each own-number effect leaves one unconfigured row, and nothing is read or asked", async (t) => {
	const { EXT_JEV_APIKEY: _key, ...env } = ENV;
	const { table, requests } = await play(t, {
		env,
		keeper: [call("apply", { effects: [{ kind: "time", minutes: 15, why: WHY }] })],
	});
	const rows = await waitFor(() => shadowRows(table).length === 1 && shadowRows(table), { label: "the unconfigured row" });
	assert.deepEqual(rows, [{ lane: "band-shadow", turn: 1, call_id: "t1-c1", index: 0, kind: "time", ok: false, reason: "unconfigured" }]);
	assert.equal(requests.length, 0);
	assert.equal(table.kernelRequests().filter((entry) => entry.method === "rules.bands").length, 0);
});

test("a kernel that cannot list the rows leaves a row saying so, and the turn is untouched", async (t) => {
	const { table, requests } = await play(t, {
		env: { ...ENV, FAKE_KERNEL_ERRORS: JSON.stringify({ "rules.bands": { code: "not_implemented", message: "method rules.bands is not implemented" } }) },
		keeper: [call("apply", { effects: [{ kind: "time", minutes: 15, why: WHY }] })],
	});
	const rows = await waitFor(() => shadowRows(table).length === 1 && shadowRows(table), { label: "the rows_unavailable row" });
	assert.deepEqual(rows.map((row) => [row.ok, row.reason]), [[false, "rows_unavailable"]]);
	assert.equal(requests.length, 0);
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.ok === true));
});

/** A turn record without what differs between any two runs: wall-clock stamps and the commit that stored it. */
function settled(record) {
	if (Array.isArray(record)) return record.map(settled);
	if (!record || typeof record !== "object") return record;
	return Object.fromEntries(Object.entries(record).filter(([key]) => !["at", "opened_at", "closed_at", "commit"].includes(key))
		.map(([key, value]) => [key, settled(value)]));
}

test("over the real kernel: the shadow reads the kernel's own rows, and the turn record is the same with the shadow asking or not", async (t) => {
	const requests = installJev(t, { pick: () => ({ choice: "single_room_search", confidence: 0.66 }) });
	const CAMPAIGN = "shadow-seam";
	async function turn(env) {
		const table = await openTable({ realKernel: true, campaign: CAMPAIGN, env, responses: [
			call("narrate", { text: "诺特把钥匙推过桌面，等你开口。" }),
			fauxAssistantMessage("开场之后多写的一句"),
			call("apply", { effects: [{ kind: "time", minutes: 25, why: WHY }] }),
			call("narrate", { text: "抽屉一格格空了。" }),
			fauxAssistantMessage("done"),
		] });
		// Disposed before the next table opens: the harness restores the environment (the key) only on dispose.
		try {
			await waitForIdle(table.session, { timeoutMs: 60_000 });
			await table.session.prompt(PLAYER);
			const rows = await waitFor(() => shadowRows(table).length === 1 && shadowRows(table), { timeoutMs: 30_000, label: "the shadow row" });
			return { row: rows[0], record: JSON.parse(readFileSync(join(table.workspace, ".coc", "campaigns", CAMPAIGN, "turns", "0001.json"), "utf8")) };
		} finally { await table.dispose(); }
	}
	const asking = await turn(ENV);
	const { EXT_JEV_APIKEY: _key, ...without } = ENV;
	const silent = await turn(without);
	// The real kernel's `rules.bands` answer is what the question was built from: every action row, with its range.
	assert.equal(requests.length, 1);
	assert.deepEqual(Object.keys(requests[0].body.questions.time_cost.criteria), [...TIME_ROWS, "unknown"]);
	assert.equal(requests[0].body.questions.time_cost.criteria.careful_house_search, "careful house search: 60 to 360 minutes");
	assert.deepEqual([asking.row.ok, asking.row.band, asking.row.range, asking.row.inside, asking.row.call_id], [true, "single_room_search", { min: 10, max: 45 }, true, "t1-c1"]);
	assert.deepEqual([silent.row.ok, silent.row.reason], [false, "unconfigured"]);
	// The Keeper's time landed as the Keeper's, and nothing in the turn differs because a question was asked beside it.
	const time = asking.record.receipts.find((receipt) => receipt.kind === "time");
	assert.deepEqual([time.minutes, time.basis ?? "keeper", time.band], [25, "keeper", undefined]);
	assert.deepEqual(settled(asking.record), settled(silent.record));
});
