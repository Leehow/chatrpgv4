/**
 * SL-97 phase 2b, the typed reviewer settles a line only where the measurement says it may (contract §32.12.3.2; the
 * integrator's ruling within the owner's "长线改 Jev").
 *
 * - The typed reading is the role-first design (revision 2a.3), v1 kept for comparison and never settling.
 * - A line settles by `jev` alone only when its class is on the data's list (`admission.typed_settle.classes`, today
 *   `["time"]`) and its admitting confidence is at the data's threshold (0.87) or above. Every other line is the lane's.
 * - The typed call and the line's lane call run together: when the typed reading settles the line, that line's lane call is
 *   cancelled (and only its own); when it does not, the lane's verdict stands, with no wall time added over the lane alone.
 * - A typed refusal never stands: the lane decides refusals.
 * - A batch partly typed-settled and partly lane-reviewed lands whole or not at all (§32.10).
 * - Each line's row says who decided (`reviewer`), its class, its typed confidence, whether its lane was cancelled, and `ms`.
 *
 * The seam: the real `apply`/`resolve` tools and admission seam, the shared decision adapter behind a controlled typed
 * endpoint (`typed-admission-endpoint.mjs`), the harness's scripted `admission/a1` lane -- here a step that sees its own
 * abort signal -- the fake kernel, and where the subject is time the admission clock (`coc:test-admission-clock`, SL-87).
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { admissionProposes, openTable, waitFor } from "./harness.mjs";
import { manualClock, runWaitsPastRound } from "./manual-clock.mjs";
import { installTypedEndpoint, questionKeys } from "./typed-admission-endpoint.mjs";
import {
	ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE,
	FAST_PATH_KINDS,
	lateAdmission,
	typedSettlePolicy,
	typedSettles,
} from "../../extensions/kernel/admission.ts";
import { ADMISSION_TYPED_FALLBACK, admissionTypedBudget, resetAdmissionTypedBudgetCache } from "../../runtime/jev/host-budgets.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTENT = join(REPO, "content");
const KEY = { EXT_JEV_APIKEY: "test-jev-key", PI_COC_ADMISSION_JEV_TIMEOUT_MS: "60000" };
const applies = (table) => table.kernelRequests().filter((entry) => entry.method === "table.apply").map((entry) => entry.params.effects.map((effect) => effect.kind));
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const laneEnds = (table) => table.telemetry().filter((row) => row.lane === "lane-call" && row.subsession === "admission" && row.phase === "end");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const userText = (context) => (context?.messages ?? []).flatMap((message) => (message.role === "user" ? message.content : [])).map((block) => block.text ?? "").join("");
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你把查到的事说给诺特听。" }), fauxAssistantMessage("after")];
const toolResults = (session, tool) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
	.map((message) => ({ isError: message.isError, details: message.details }));

const WORDS = "我回诺特办公室，把查到的告诉他。";
const TIME = { kind: "time", minutes: 45, why: "Travel back to Knott's office in the afternoon." };
const CLUE = { kind: "clue", clue: "corbitt-diaries", how: "Knott confirms what he knew of the house.", from: "Steven Knott" };
const MOVE = { kind: "move", to: "newspaper-morgue", travel_minutes: 30 };
const ok = (grounds) => ({ verdict: "authorized", grounds });

/**
 * The admission lane, on `clock` when given: each call answers by the one line it is asked about (`cases`: `[pattern, row,
 * at]`), at `T0 + at` on the clock (or after `at` ms of real time), unless its own abort signal fires first. `calls` says,
 * per call, what it proposed, when it started and whether it was cancelled.
 */
function cancellableLane(cases, { clock, T0 = 0, count = 8 } = {}) {
	const calls = [];
	const step = async (context, options) => {
		const proposed = admissionProposes(userText(context));
		const [, row, at] = cases.find(([pattern]) => pattern.test(proposed)) ?? [null, ok("default"), 0];
		const signal = options?.signal;
		const entry = { proposed, startedAt: clock ? clock.at() - T0 : undefined, cancelled: false };
		calls.push(entry);
		const aborted = new Promise((resolve) => {
			if (signal?.aborted) { entry.cancelled = true; resolve(); }
			signal?.addEventListener("abort", () => { entry.cancelled = true; resolve(); }, { once: true });
		});
		await Promise.race([clock ? clock.until(T0 + at) : sleep(at), aborted]);
		return fauxAssistantMessage(JSON.stringify(row));
	};
	return { calls, responses: Array.from({ length: count }, () => step) };
}
const callFor = (lane, pattern) => lane.calls.find((entry) => pattern.test(entry.proposed));

/** A content root that is the real one except for `host-budgets.json`'s `admission` entry (the SL-93 overlay pattern). */
function contentRootWithAdmission(t, admission) {
	const overlay = mkdtempSync(join(tmpdir(), "admission-typed-content-"));
	for (const entry of readdirSync(CONTENT)) if (entry !== "rulesets") symlinkSync(join(CONTENT, entry), join(overlay, entry));
	mkdirSync(join(overlay, "rulesets"));
	for (const entry of readdirSync(join(CONTENT, "rulesets"))) if (entry !== "coc7") symlinkSync(join(CONTENT, "rulesets", entry), join(overlay, "rulesets", entry));
	mkdirSync(join(overlay, "rulesets", "coc7"));
	for (const entry of readdirSync(join(CONTENT, "rulesets", "coc7"))) if (entry !== "host-budgets.json")
		symlinkSync(join(CONTENT, "rulesets", "coc7", entry), join(overlay, "rulesets", "coc7", entry));
	const original = JSON.parse(readFileSync(join(CONTENT, "rulesets", "coc7", "host-budgets.json"), "utf8"));
	writeFileSync(join(overlay, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ ...original, admission }));
	t.after(() => rmSync(overlay, { recursive: true, force: true }));
	return overlay;
}
/** Every test reads the budget fresh: the one before it may have read a fixture. */
function freshBudget(t) {
	resetAdmissionTypedBudgetCache();
	t.after(() => resetAdmissionTypedBudgetCache());
}

// ---- the data and the pure rule ----------------------------------------------------------------------------------------------

test("§32.12.3.2: the shipped data names the measured design, the classes that met the bar (time) and the threshold (0.87)", async (t) => {
	freshBudget(t);
	const budget = await admissionTypedBudget();
	assert.deepEqual({ ...budget, settleClasses: [...budget.settleClasses] }, { design: "roles-2a.3", settleClasses: ["time"], settleMinConfidence: 0.87 });
	assert.equal(ADMISSION_FAST_DEFAULT_MIN_CONFIDENCE, 0.87);
});

test("§32.12.3.2: the loader reads a fixture's values and fails closed -- an unreadable file or a bad class list settles nothing", async (t) => {
	const root = (admission) => contentRootWithAdmission(t, admission);
	const read = async (admission) => { const value = await admissionTypedBudget(root(admission)); return { ...value, settleClasses: [...value.settleClasses] }; };
	assert.deepEqual(await read({ typed_design: "v1", typed_settle: { classes: ["move", "time", "move", 7, ""], min_confidence: 0.95 } }),
		{ design: "v1", settleClasses: ["move", "time"], settleMinConfidence: 0.95 });
	assert.deepEqual(await read({ typed_design: "v9", typed_settle: { classes: "time", min_confidence: 1.5 } }),
		{ design: "roles-2a.3", settleClasses: [], settleMinConfidence: 0.87 }, "an unknown design is the measured one; a class list that is not a list settles nothing");
	assert.deepEqual(await read(undefined), { design: "roles-2a.3", settleClasses: [], settleMinConfidence: 0.87 }, "no entry: nothing settles");
	assert.equal(await admissionTypedBudget(join(tmpdir(), "admission-typed-does-not-exist")), ADMISSION_TYPED_FALLBACK);
	assert.deepEqual([...ADMISSION_TYPED_FALLBACK.settleClasses], []);
});

test("§32.12.3.2 typedSettlePolicy: the data's classes inside §32.11's closed set; none under v1; the environment overrides the threshold", () => {
	const budget = (settleClasses, design = "roles-2a.3", settleMinConfidence = 0.87) => ({ design, settleClasses, settleMinConfidence });
	assert.deepEqual(typedSettlePolicy(budget(["time", "cash", "resolve", "item", "object", "usage", "map", "person"]), {}).classes, ["time"],
		"data can narrow the rule, never widen it past move, clue, handout and time");
	assert.deepEqual([...FAST_PATH_KINDS].sort(), ["clue", "handout", "move", "time"]);
	assert.deepEqual(typedSettlePolicy(budget(["time"], "v1"), {}).classes, [], "a v1 reading settles nothing");
	assert.equal(typedSettlePolicy(budget(["time"], "roles-2a.3", 0.93), {}).minConfidence, 0.93, "the data's threshold");
	assert.equal(typedSettlePolicy(budget(["time"], "roles-2a.3", 0.93), { PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "0.95" }).minConfidence, 0.95);
	assert.equal(typedSettlePolicy(budget(["time"]), { PI_COC_ADMISSION_FAST_MIN_CONFIDENCE: "off" }).minConfidence, undefined);
});

test("§32.12.3.2 typedSettles: a listed class, an admitting line at the threshold or above; never a refusal, never another class", () => {
	const policy = { design: "roles-2a.3", classes: ["time"], minConfidence: 0.87 };
	const proposal = (kinds) => ({ tool: "apply", key: "k", lines: kinds.map((kind) => `apply ${kind}: x`), kinds });
	const typed = (...lines) => ({ status: "decided", verdict: "entailed", grounds: "g", confidence: 0, calls: 1, elapsedMs: 1, usage: {},
		lines: lines.map(([verdict, confidence]) => ({ verdict, confidence, missing: "none" })) });
	const reading = typed(["entailed", 0.87], ["authorized", 0.99]);
	assert.equal(typedSettles(proposal(["time", "move"]), reading, 0, policy), true, "0.87 is at the threshold");
	assert.equal(typedSettles(proposal(["time", "move"]), reading, 1, policy), false, "a move never, however confident");
	assert.equal(typedSettles(proposal(["time"]), typed(["entailed", 0.869]), 0, policy), false, "under it is not");
	assert.equal(typedSettles(proposal(["time"]), typed(["not_authorized", 0.99]), 0, policy), false, "a refusal never settles");
	assert.equal(typedSettles(proposal(["time"]), typed(["uncertain", 0.99]), 0, policy), false);
	assert.equal(typedSettles(proposal(["time"]), typed(["not_player_action", 0.9]), 0, policy), true);
	assert.equal(typedSettles(proposal(["time"]), typed(["entailed", 0.99]), 0, { ...policy, minConfidence: undefined }), false, "off");
	assert.equal(typedSettles({ tool: "resolve", key: "r", lines: ["resolve"] }, typed(["authorized", 0.99]), 0, { ...policy, classes: ["time", "resolve"] }), false,
		"a resolve's class is never on the closed list the policy is built from, and a hand-made one naming it still needs the reading to match");
	assert.equal(typedSettles(proposal(["time", "clue"]), typed(["entailed", 0.99]), 0, policy), false, "a reading whose lines do not match the proposal's");
	assert.equal(typedSettles(proposal(["time"]), { status: "fallback", reason: "timeout", calls: 0, elapsedMs: 1, usage: {} }, 0, policy), false);
});

test("§32.12.3.2 lateAdmission: at the cap too, only a listed class is admitted on the typed reading", () => {
	const apply = (kinds) => ({ tool: "apply", key: kinds.join("+"), lines: kinds.map((kind) => `apply ${kind}: x`), kinds });
	const reading = (verdict, confidence) => ({ status: "decided", verdict, confidence, lineVerdicts: [verdict], grounds: "g" });
	const reason = (proposal, typed, classes) => { const late = lateAdmission(proposal, typed, {}, classes); return late.ok ? late.verdict.path : late.reason; };
	assert.equal(reason(apply(["time"]), reading("entailed", 0.75), ["time"]), "typed_late");
	assert.equal(reason(apply(["time", "person"]), reading("entailed", 0.75), ["time"]), "typed_late", "a non-triggering kind rides along");
	assert.equal(reason(apply(["move"]), reading("authorized", 0.99), ["time"]), "class_not_listed");
	assert.equal(reason(apply(["cash"]), reading("authorized", 0.99), ["time"]), "class_not_listed");
	assert.equal(reason(apply(["time"]), reading("entailed", 0.99), []), "class_not_listed", "no class named (design v1), nothing late");
	assert.equal(reason(apply(["time"]), reading("entailed", 0.99)), "class_not_listed", "a caller that names none admits nothing late");
	assert.equal(reason(apply(["item"]), reading("authorized", 0.99), ["time"]), "not_bookkeeping");
});

// ---- the seam: a line the typed reading settles -----------------------------------------------------------------------------

test("§32.12.3.2: a time line typed at or above 0.87 settles by jev and cancels its lane call; the row says so", async (t) => {
	freshBudget(t);
	const clock = manualClock(), T0 = clock.at();
	const typed = installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.9 }], { delayMs: 400, clock });
	const lane = cancellableLane([[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500]], { clock, T0 });
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 1 && typed.length === 1, { timeoutMs: 60_000, label: "the lane call and the typed request" });
	clock.advanceTo(T0 + 400);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end, the clock still at 400 ms" });
	await prompt;
	assert.deepEqual(questionKeys(typed, "role"), ["role_0"], "the role-first design read it");
	assert.deepEqual(questionKeys(typed, "verdict"), [], "not v1");
	assert.deepEqual(applies(table), [["time"]], "it landed on the typed reading");
	assert.equal(lane.calls[0].cancelled, true, "its lane call was cancelled");
	await waitFor(() => laneEnds(table).length === 1, { timeoutMs: 60_000, label: "the cancelled call's end row" });
	assert.equal(laneEnds(table)[0].stop_reason, "aborted");
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.path, row.verdict, row.admitted], ["jev", "typed", "entailed", true]);
	assert.deepEqual([row.line_class, row.typed_confidence, row.lane_cancelled, row.ms], ["time", 0.9, true, 400]);
	assert.equal(row.typed_design, "roles-2a.3");
	assert.equal(row.settle_min_confidence, 0.87);
	assert.equal(row.jev_fallback, undefined);
	assert.equal(row.model, "jev-1.13.0");
});

test("§32.12.3.2: a move line never settles by jev, however confident; the lane decides and nothing is cancelled", async (t) => {
	freshBudget(t);
	installTypedEndpoint(t, [{ verdict: "authorized", confidence: 1 }]);
	const lane = cancellableLane([[/apply move/, { verdict: "not_authorized", grounds: "only interest in the papers", missing: "which archive to visit" }, 300]]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [MOVE] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt("那看看报纸");
	assert.deepEqual(applies(table), [], "the lane's refusal stood over a typed 1.0 admission");
	assert.equal(lane.calls[0].cancelled, false);
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.path, row.verdict], ["lane", "lane", "not_authorized"]);
	assert.deepEqual([row.line_class, row.typed_confidence, row.lane_cancelled], ["move", 1, false]);
	assert.equal(row.jev_fallback, undefined, "a class the reading may not settle names no fallback");
	assert.equal(row.settle_min_confidence, undefined);
});

test("§32.12.3.2: a low-confidence time line takes the lane's verdict, with no wall time added over the lane alone", async (t) => {
	freshBudget(t);
	// The typed answer (0.8, under 0.87) is in at 400 ms; the lane answers at 1200. The review ends at 1200.
	const clock = manualClock(), T0 = clock.at();
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.8 }], { delayMs: 400, clock });
	const lane = cancellableLane([[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }, 1200]], { clock, T0 });
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 1, { timeoutMs: 60_000, label: "the lane call" });
	clock.advanceTo(T0 + 400);
	await sleep(100);
	assert.deepEqual(applies(table), [], "the typed reading did not settle it");
	clock.advanceTo(T0 + 1200);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.path, row.verdict, row.ms, row.lane_ms], ["lane", "lane", "entailed", 1200, 1200], "the lane's own time, nothing added");
	assert.deepEqual([row.line_class, row.typed_confidence, row.lane_cancelled, row.jev_fallback], ["time", 0.8, false, "low_confidence"]);
	assert.equal(lane.calls[0].cancelled, false);
	assert.deepEqual(applies(table), [["time"]]);
});

test("§32.12.3.2: a lane faster than the typed answer stands at once -- the review does not wait for Jev", async (t) => {
	freshBudget(t);
	const clock = manualClock(), T0 = clock.at();
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.99 }], { delayMs: 2000, clock });
	const lane = cancellableLane([[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }, 700]], { clock, T0 });
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 1, { timeoutMs: 60_000, label: "the lane call" });
	clock.advanceTo(T0 + 700);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end, the clock still at 700 ms" });
	await prompt;
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.ms, row.jev_fallback, row.typed_confidence], ["lane", 700, "lane_first", null]);
});

for (const typedVerdict of ["not_authorized", "uncertain"]) test(`§32.12.3.2: a typed refusal never stands -- a time line typed ${typedVerdict} at 0.99 goes to the lane, whose verdict decides`, async (t) => {
	freshBudget(t);
	installTypedEndpoint(t, [{ verdict: typedVerdict, confidence: 0.99, missing: "method" }]);
	const lane = cancellableLane([[/apply time/, { verdict: "entailed", grounds: "the search takes the time" }, 300]]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(applies(table), [["time"]], "the lane admitted it");
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.verdict, row.jev_fallback, row.lane_cancelled], ["lane", "entailed", "typed_refusal", false]);
	assert.deepEqual(row.line_verdicts, [typedVerdict]);
	assert.equal(lane.calls[0].cancelled, false);
});

// ---- the seam: a batch partly typed-settled ---------------------------------------------------------------------------------

test("§32.12.3.2: a mixed batch -- the time line settles by jev at once and only its lane call is cancelled; the clue's lane admits it; the batch lands whole", async (t) => {
	freshBudget(t);
	const clock = manualClock(), T0 = clock.at();
	const typed = installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.95 }, { verdict: "authorized", confidence: 0.99 }], { delayMs: 300, clock });
	const lane = cancellableLane([[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500],
		[/corbitt-diaries/, ok("told on the report"), 900]], { clock, T0 });
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, CLUE] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 2 && typed.length === 1, { timeoutMs: 60_000, label: "two lane calls and one typed request" });
	assert.deepEqual(lane.calls.map((entry) => entry.startedAt), [0, 0], "both lines' calls start with the typed call");
	clock.advanceTo(T0 + 300);
	await waitFor(() => callFor(lane, /apply time/).cancelled, { timeoutMs: 60_000, label: "the time line's call cancelled at 300 ms" });
	assert.equal(callFor(lane, /corbitt-diaries/).cancelled, false, "the clue's call runs on");
	assert.deepEqual(applies(table), [], "nothing lands before the clue's lane has answered");
	clock.advanceTo(T0 + 900);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;
	assert.deepEqual(questionKeys(typed, "role"), ["role_0", "role_1"], "one typed request over both lines");
	assert.deepEqual(applies(table), [["time", "clue"]], "the whole batch, in its order");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.reviewer, row.path, row.verdict, row.line_class, row.typed_confidence, row.lane_cancelled, row.ms]),
		[[1, "jev", "typed", "entailed", "time", 0.95, true, 300], [2, "lane", "lane", "authorized", "clue", 0.99, false, 900]]);
	for (const row of rows) {
		assert.deepEqual([row.line_level, row.batch_admitted, row.batch_verdict, row.line_calls, row.batch_ms], ["line", true, "authorized", 2, 900]);
		assert.deepEqual(row.line_ms, [null, 900], "the cancelled call has no time of its own");
	}
});

/**
 * Start `WORDS`' turn on the admission clock and wait until `calls` lane calls and the typed request are in flight, so a
 * typed answer due later on the clock finds every line's call running. Returns what the test drives the turn with.
 */
async function onTheClock(t, { effects, env = KEY, typedLines, typedAt, cases, calls, responses }) {
	const clock = manualClock(), T0 = clock.at();
	const typed = installTypedEndpoint(t, typedLines, { delayMs: typedAt, clock });
	const lane = cancellableLane(cases, { clock, T0 });
	const table = await openTable({ env, responses: responses ?? [call("apply", { effects }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	const run = { ended: false };
	run.prompt = table.session.prompt(WORDS).finally(() => { run.ended = true; });
	await waitFor(() => lane.calls.length === calls && typed.length === 1, { timeoutMs: 60_000, label: `${calls} lane call(s) and the typed request in flight` });
	run.at = async (ms, until) => {
		clock.advanceTo(T0 + ms);
		if (until) await waitFor(until, { timeoutMs: 60_000, label: `by ${ms} ms` });
		else await sleep(100);
	};
	run.end = async () => { await waitFor(() => run.ended, { timeoutMs: 60_000, label: "the run's end" }); await run.prompt; };
	return { clock, T0, typed, lane, table, run };
}

test("§32.12.3.2: a mixed batch whose lane-reviewed line is refused lands nothing -- the typed-settled line does not land alone (§32.10)", async (t) => {
	freshBudget(t);
	const { lane, table, run } = await onTheClock(t, { effects: [TIME, CLUE], calls: 2, typedAt: 300,
		typedLines: [{ verdict: "entailed", confidence: 0.95 }, { verdict: "authorized", confidence: 0.99 }],
		cases: [[/apply time/, ok("would admit"), 3000],
			[/corbitt-diaries/, { verdict: "not_authorized", grounds: "the player only said he would report back", missing: "whether to ask about the house" }, 400]] });
	await run.at(300, () => callFor(lane, /apply time/).cancelled);
	await run.at(400);
	await run.end();
	assert.deepEqual(applies(table), [], "refused whole");
	assert.equal(callFor(lane, /corbitt-diaries/).cancelled, false);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.isError, true);
	const details = result.details.coc_error.details;
	assert.deepEqual([details.reason, details.verdict, details.missing], ["action_not_authorized", "not_authorized", "whether to ask about the house"]);
	assert.equal(details.proposed.length, 2, "every line of the batch is proposed");
	assert.equal(result.details.admission, undefined, "no partial landing");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.reviewer, row.verdict, row.admitted, row.lane_cancelled, row.batch_admitted, row.batch_verdict]),
		[[1, "jev", "entailed", true, true, false, "not_authorized"], [2, "lane", "not_authorized", false, false, false, "not_authorized"]]);
});

test("§32.12.3.2: two time lines both settled by jev -- both lane calls cancelled, no lane verdict at all, the batch lands, and its resend reuses it", async (t) => {
	freshBudget(t);
	const REST = { kind: "time", minutes: 10, why: "Wait for Knott to finish his call." };
	const { lane, table, run } = await onTheClock(t, { calls: 2, typedAt: 300,
		responses: [call("apply", { effects: [TIME, REST] }), call("apply", { effects: [TIME, REST] }), ...close],
		typedLines: [{ verdict: "entailed", confidence: 0.9 }, { verdict: "not_player_action", confidence: 0.92 }],
		cases: [[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 3000]] });
	await run.at(300, () => run.ended);
	await run.end();
	assert.deepEqual(applies(table), [["time", "time"], ["time", "time"]]);
	assert.equal(lane.calls.length, 2, "the resend made no lane call");
	assert.ok(lane.calls.every((entry) => entry.cancelled), "both lines' calls were cancelled");
	const rows = admissionRows(table);
	assert.deepEqual(rows.slice(0, 2).map((row) => [row.reviewer, row.path, row.verdict, row.lane_cancelled, row.ms]),
		[["jev", "typed", "entailed", true, 300], ["jev", "typed", "not_player_action", true, 300]]);
	assert.ok(rows.slice(0, 2).every((row) => row.batch_admitted === true && row.batch_ms === 300));
	assert.deepEqual(rows[0].line_ms, [null, null], "no lane call answered");
	assert.deepEqual([rows[2].reused, rows[2].reviewer, rows[2].path], [true, "jev", "typed"], "the batch's kept verdict names the typed reviewer");
});

test("§32.12.3.2: a batch the typed reading does not settle ends at its slowest lane line, with the typed answer still out -- no wall time added", async (t) => {
	freshBudget(t);
	const { table, run } = await onTheClock(t, { effects: [TIME, CLUE], calls: 2, typedAt: 2000,
		typedLines: [{ verdict: "entailed", confidence: 0.99 }, { verdict: "authorized", confidence: 0.99 }],
		cases: [[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }, 700], [/corbitt-diaries/, ok("told on the report"), 900]] });
	await run.at(700);
	await run.at(900, () => run.ended);
	await run.end();
	assert.deepEqual(applies(table), [["time", "clue"]]);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.reviewer, row.ms, row.jev_fallback ?? null, row.typed_confidence]),
		[["lane", 700, "lane_first", null], ["lane", 900, null, null]], "the lanes decided before the typed answer came in");
	assert.ok(rows.every((row) => row.batch_ms === 900), "the call waited for its slowest lane line (900 ms), not for Jev (2000 ms)");
});

// ---- the seam: at the cap ---------------------------------------------------------------------------------------------------

test("§32.12.3.2: at the cap a time line typed 0.75 is admitted late; a move typed 0.99 is not (class_not_listed), and is continued only until the hard deadline", async (t) => {
	freshBudget(t);
	const CAP_MS = 1000;
	const clock = manualClock(), T0 = clock.at();
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.75 }, { verdict: "authorized", confidence: 0.99 }], { delayMs: 200, clock });
	const lane = cancellableLane([[/apply (time|move)/, ok("too late"), 10 * CAP_MS]], { clock, T0 });
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_TIMEOUT_MS: String(CAP_MS) },
		responses: [call("apply", { effects: [TIME, MOVE] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 2, { timeoutMs: 60_000, label: "two lane calls" });
	clock.advanceTo(T0 + 200);
	await sleep(100);
	clock.advanceTo(T0 + CAP_MS);
	await waitFor(() => table.telemetry().some(row=>row.lane==="admission-wait"), {timeoutMs:60000,label:"host waits for the move review"});
	clock.advanceTo(T0+2*CAP_MS);
	await runWaitsPastRound(clock,T0+2*CAP_MS,()=>ended);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;
	assert.deepEqual(applies(table), [], "pending on the move line, nothing lands");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.path, row.verdict, row.late_rule, row.line_class, row.typed_confidence]),
		[[1, "typed_late", "entailed", "typed_late", "time", 0.75], [2, "lane", "review_timeout", undefined, "move", 0.99]]);
	const [result] = toolResults(table.session, "apply");
	assert.equal(result.details.coc_error.details.reason, "review_timeout");
});

// ---- the seam: the class list and threshold are data ------------------------------------------------------------------------

for (const [confidence, reviewer] of [[0.96, "jev"], [0.9, "lane"]]) test(`§32.12.3.2: the class list and the threshold are read from data -- with \`move\` listed at 0.95, a move typed ${confidence} is settled by the ${reviewer}`, async (t) => {
	freshBudget(t);
	const root = contentRootWithAdmission(t, { typed_design: "roles-2a.3", typed_settle: { classes: ["move"], min_confidence: 0.95 } });
	const { lane, table, run } = await onTheClock(t, { effects: [MOVE], calls: 1, typedAt: 300, env: { ...KEY, PI_COC_CONTENT_ROOT: root },
		typedLines: [{ verdict: "authorized", confidence }], cases: [[/apply move/, { verdict: "not_authorized", grounds: "only interest", missing: "which archive" }, 1500]] });
	await run.at(300);
	if (reviewer === "lane") await run.at(1500);
	await run.end();
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.line_class, row.settle_min_confidence, row.lane_cancelled, row.ms], [reviewer, "move", 0.95, reviewer === "jev", reviewer === "jev" ? 300 : 1500]);
	assert.deepEqual(applies(table), reviewer === "jev" ? [["move"]] : [], "the lane refuses what the typed reading does not settle");
	assert.equal(lane.calls[0].cancelled, reviewer === "jev");
});

test("§32.12.3.2: data that does not list `time` leaves a time line typed 0.99 to the lane", async (t) => {
	freshBudget(t);
	const root = contentRootWithAdmission(t, { typed_design: "roles-2a.3", typed_settle: { classes: ["move"], min_confidence: 0.95 } });
	installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.99 }]);
	const table = await openTable({ env: { ...KEY, PI_COC_CONTENT_ROOT: root }, responses: [call("apply", { effects: [TIME] }), ...close],
		laneResponses: { admission: cancellableLane([[/apply time/, { verdict: "entailed", grounds: "the walk" }, 200]]).responses } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.line_class, row.settle_min_confidence], ["lane", "time", undefined]);
});

test("§32.12.3.2: design v1 in the data is read for comparison and settles nothing -- the lane decides a time line typed 0.99", async (t) => {
	freshBudget(t);
	const root = contentRootWithAdmission(t, { typed_design: "v1", typed_settle: { classes: ["time"], min_confidence: 0.87 } });
	const typed = installTypedEndpoint(t, [{ verdict: "entailed", confidence: 0.99 }]);
	const lane = cancellableLane([[/apply time/, { verdict: "entailed", grounds: "the walk back" }, 200]]);
	const table = await openTable({ env: { ...KEY, PI_COC_CONTENT_ROOT: root }, responses: [call("apply", { effects: [TIME] }), ...close],
		laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.deepEqual(questionKeys(typed, "verdict"), ["verdict_0"], "the v1 questions were asked");
	assert.deepEqual(questionKeys(typed, "role"), []);
	const [row] = admissionRows(table);
	assert.deepEqual([row.reviewer, row.typed_design, row.typed_confidence, row.lane_cancelled], ["lane", "v1", 0.99, false]);
	assert.deepEqual(row.line_verdicts, ["entailed"], "its reading is recorded");
});
