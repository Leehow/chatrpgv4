/**
 * SL-101, a batch's lines are reviewed in parallel, one lane call each (contract §32.12.3.1; the owner's ruling after long
 * gate #23, 2026-09-26: the admission lane took a median 6.1 s on one-line batches and hit the 13 s cap on almost every
 * batch of two or three lines).
 *
 * - An `apply` batch of more than one reviewed line sends one lane call per line, all at once, on the same lane model;
 *   each call reads the same §32.3 context and exactly one proposed line. The call waits for its slowest line, not the sum.
 * - The batch's verdict is the lines' combined (§32.10's mapping, as §32.12.3 maps a remainder): admitted only when every
 *   line is; a line refused on grounds refuses the batch whole, and `not_authorized` decides it at once, stopping the
 *   lines still running.
 * - The cap, the late admission and `review_pending` apply per call: the batch is pending only on the lines still under
 *   review, and its resend re-joins only those.
 * - Verdict reuse (§32.4) keys by line. Since §32.12.3.1.1 (SL-104) each line's call also reads its batch-mates, and its key
 *   carries them: the same batch reuses a line's verdict, a batch whose other lines changed is reviewed again
 *   (`admission-line-batch-context.test.mjs` pins the rule).
 * - A one-line batch and a `resolve` are what they were; the compile's and the consequence route's own admissions are
 *   pinned by `admission-within-turn.test.mjs` and `consequence-admission.test.mjs`, unchanged. Since §32.12.3.2 (SL-97
 *   phase 2b) the typed reading settles a line of the batch (a listed class at the settle confidence) as that line's own
 *   outcome, cancelling only that line's call; §32.12.3's split, which aborted every line's call and reviewed a fresh
 *   remainder, no longer happens (`admission-typed-settle.test.mjs` pins the rule).
 *
 * The seam: the real `apply`/`resolve` tools and admission seam, the harness's scripted `admission/a1` lane answering by
 * the line it is asked about, the fake kernel, and -- where the subject is time -- the admission clock
 * (`coc:test-admission-clock`, SL-87), so the lines' answers land at scripted times and nothing sleeps.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { admissionProposes, laneByLine, openTable, waitFor } from "./harness.mjs";
import { manualClock, runWaitsPastRound } from "./manual-clock.mjs";
import { installTypedEndpoint } from "./typed-admission-endpoint.mjs";
import { KernelError } from "../../extensions/kernel/client.ts";
import {
	BESIDE_HEADING,
	REVIEW_PENDING,
	admissionPending,
	admissionRefusal,
	admissionTimedOut,
	admissionUnavailable,
	batchRefusal,
	lineProposal,
	lineReading,
	reviewedPerLine,
} from "../../extensions/kernel/admission.ts";

const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");
const laneEnds = (table) => table.telemetry().filter((row) => row.lane === "lane-call" && row.subsession === "admission" && row.phase === "end").length;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const userText = (context) => (context?.messages ?? []).flatMap((message) => (message.role === "user" ? message.content : [])).map((block) => block.text ?? "").join("");
const proposedLines = (text) => admissionProposes(text).split("\n").filter((line) => line.startsWith("- "));
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const close = [call("narrate", { text: "你把查到的事说给诺特听。" }), ];
const toolResults = (session, tool) => session.messages.filter((message) => message.role === "toolResult" && message.toolName === tool)
	.map((message) => ({ isError: message.isError, details: message.details,
		text: (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("") }));

// Long gate #23 turn 8's shape: the walk back and two things Knott tells on the report.
const WORDS = "我回诺特办公室，把查到的告诉他。";
const TIME = { kind: "time", minutes: 45, why: "Travel back to Knott's office in the afternoon." };
const DIARIES = { kind: "clue", clue: "corbitt-diaries", how: "Knott confirms what he knew of the house.", from: "Steven Knott" };
const COMMISSION = { kind: "clue", clue: "knott-commission", how: "The standing hire terms remain clear from Knott.", from: "Steven Knott" };
const MOVE = { kind: "move", to: "newspaper-morgue", travel_minutes: 30 };
const ok = (grounds) => ({ verdict: "authorized", grounds });

/**
 * The admission lane on the manual clock: each call answers by the one line it is asked about, at `T0 + at`. `calls` says,
 * per call, when it started and what it proposed.
 */
function clockLane(clock, T0, cases, count = 8) {
	const calls = [];
	const step = async (context) => {
		const text = userText(context), proposed = admissionProposes(text);
		const [, row, at] = cases.find(([pattern]) => pattern.test(proposed)) ?? [null, ok("default"), 0];
		// §32.12.3.1.1: the context every line's call shares ends where its batch-mates are listed.
		const shared = text.includes(BESIDE_HEADING) ? text.indexOf(BESIDE_HEADING) : text.indexOf("[The Keeper now proposes]");
		const entry = { startedAt: clock.at() - T0, proposed, lines: proposedLines(text).length, context: text.slice(0, shared),
			beside: text.slice(shared, text.indexOf("[The Keeper now proposes]")).split("\n").filter((line) => line.startsWith("- ")) };
		calls.push(entry);
		await clock.until(T0 + at);
		return fauxAssistantMessage(JSON.stringify(row));
	};
	return { calls, responses: Array.from({ length: count }, () => step) };
}
/** Move the clock to `T0 + at` and let the lane calls due by then land (`ends` lane-call end rows in all) before the next move. */
async function advance(table, clock, T0, at, ends) {
	clock.advanceTo(T0 + at);
	if (ends !== undefined) await waitFor(() => laneEnds(table) >= ends, { timeoutMs: 60_000, label: `${ends} lane calls answered by ${at} ms` });
	await sleep(40);
}

/** The typed endpoint (the role-first design): `lines[i]` is line i's `{verdict, confidence}`, answered after `delayMs` on `clock` when given. */
const installJev = (t, lines, delayMs = 0, clock) => installTypedEndpoint(t, lines, { delayMs, clock });

// ---- the pure rules ---------------------------------------------------------------------------------------------------

test("§32.12.3.1 reviewedPerLine / lineProposal: only an apply batch of more than one reviewed line, one line at a time, beside the others (§32.12.3.1.1)", () => {
	const batch = { tool: "apply", key: "k", lines: ["apply time: a", "apply clue: b", "apply move: c"], kinds: ["time", "clue", "move"], effects: [0, 2, 3],
		signatures: ["sa", "sb", "sc"] };
	assert.equal(reviewedPerLine(batch), true);
	assert.equal(reviewedPerLine({ ...batch, lines: ["apply time: a"], kinds: ["time"], effects: [0] }), false, "a one-line batch is unchanged");
	assert.equal(reviewedPerLine({ tool: "resolve", key: "r", lines: ["resolve: x"] }), false, "a resolve is one line");
	assert.deepEqual(lineProposal(batch, 1), { tool: "apply", key: "k", lines: ["apply clue: b"], kinds: ["clue"], effects: [2], signatures: ["sb"],
		beside: { lines: ["apply time: a", "apply move: c"], signatures: ["sa", "sc"] } });
});

test("§32.12.3.1 lineReading: the batch's typed answer as one line reads it -- that line's verdict and confidence", () => {
	const answer = { status: "decided", verdict: "not_authorized", grounds: "typed", missing: "the target: apply clue", confidence: 0.3,
		calls: 1, elapsedMs: 400, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
		lines: [{ verdict: "entailed", confidence: 0.72, missing: "none" }, { verdict: "not_authorized", confidence: 0.3, missing: "target" }] };
	const first = lineReading({ typed: answer, meta: {} }, 0);
	assert.deepEqual([first.status, first.verdict, first.confidence, first.lineVerdicts], ["decided", "entailed", 0.72, ["entailed"]]);
	assert.equal(first.missing, undefined);
	const second = lineReading({ typed: answer, meta: {} }, 1);
	assert.deepEqual([second.verdict, second.confidence, second.missing], ["not_authorized", 0.3, "the target: apply clue"]);
	assert.deepEqual(lineReading({ typed: { status: "fallback", reason: "timeout", calls: 0, elapsedMs: 4000, usage: {} }, meta: {} }, 0),
		{ status: "fallback", reason: "timeout" }, "a typed non-verdict stays one");
	assert.equal(lineReading(undefined, 0), undefined);
});

test("§32.12.3.1 batchRefusal: §32.10's order -- a refusal on grounds, then unavailability, then review_timeout, then the lines still pending", () => {
	const lines = ["apply time: a", "apply clue: b", "apply move: c"];
	const one = (index) => ({ tool: "apply", key: `k${index}`, lines: [lines[index]] });
	const refused = (index, verdict, missing) => ({ line: lines[index], error: admissionRefusal(one(index), { verdict, grounds: `g${index}`, missing }) });
	const pending = (index, wait) => ({ line: lines[index], error: admissionPending(one(index), 1000, 1000, wait) });
	const down = (index) => ({ line: lines[index], error: admissionUnavailable(one(index), "model_error", "boom", 1) });
	const timedOut = (index) => ({ line: lines[index], error: admissionTimedOut(one(index), 2000, 2000) });

	const decided = batchRefusal("apply", lines, [pending(0, 900), refused(1, "uncertain", "which"), down(2), refused(2, "not_authorized", "whether to go")]);
	assert.ok(decided instanceof KernelError);
	assert.equal(decided.details.verdict, "not_authorized", "not_authorized before uncertain, whatever the order");
	assert.equal(decided.details.missing, "whether to go");
	assert.deepEqual(decided.details.proposed, lines, "every line of the batch is proposed");
	assert.deepEqual(decided.details.line_outcomes.map((row) => row.reason), [REVIEW_PENDING, "action_not_authorized", "admission_unavailable", "action_not_authorized"]);
	assert.equal(decided.details.pending_lines, undefined, "a refused batch is not pending on anything");

	assert.equal(batchRefusal("apply", lines, [pending(0, 900), refused(1, "uncertain", "which")]).details.verdict, "uncertain");
	assert.equal(batchRefusal("apply", lines, [pending(0, 900), down(1)]).details.reason, "admission_unavailable", "no review, no authority");
	assert.equal(batchRefusal("apply", lines, [pending(0, 900), timedOut(1)]).details.reason, "review_timeout");
	const waiting = batchRefusal("apply", lines, [pending(0, 900), pending(2, 1500)]);
	assert.equal(waiting.details.reason, REVIEW_PENDING);
	assert.deepEqual(waiting.details.pending_lines, [lines[0], lines[2]], "pending only on the lines still under review");
	assert.equal(waiting.details.wait_ms, 1500, "the longest wait");
	assert.match(waiting.fix, /Resend this identical call once, unchanged/);
});

// ---- the seam: concurrency and the wall time ----------------------------------------------------------------------------

test("§32.12.3.1: a three-line batch is three lane calls at once, one line each with the same context, and waits for its slowest line, not the sum", async (t) => {
	const clock = manualClock(), T0 = clock.at();
	const lane = clockLane(clock, T0, [[/apply time/, ok("reporting back takes the walk"), 700], [/corbitt-diaries/, ok("told on the report"), 1200],
		[/knott-commission/, ok("told on the report"), 900]]);
	const table = await openTable({ responses: [call("apply", { effects: [TIME, DIARIES, COMMISSION] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 3, { timeoutMs: 60_000, label: "three lane calls" });
	assert.deepEqual(lane.calls.map((entry) => entry.startedAt), [0, 0, 0], "all three were in flight before any answered");
	assert.ok(lane.calls.every((entry) => entry.lines === 1), "each call proposes exactly one line");
	assert.ok(lane.calls.every((entry) => entry.context === lane.calls[0].context), "each call reads the same context");
	// §32.12.3.1.1: and beside it, the batch's two other lines.
	for (const entry of lane.calls) assert.deepEqual(entry.beside.map((line) => line.split(";")[0]).sort(),
		['- apply clue: clue="corbitt-diaries"', '- apply clue: clue="knott-commission"', "- apply time: minutes=45"].filter((line) => !entry.proposed.includes(line.slice(2))),
		`${entry.proposed.split("\n")[1]} is read beside the other two`);
	assert.match(lane.calls[0].context, /我回诺特办公室，把查到的告诉他。/);
	for (const pattern of [/apply time/, /corbitt-diaries/, /knott-commission/])
		assert.equal(lane.calls.filter((entry) => pattern.test(entry.proposed)).length, 1, `${pattern} on exactly one call`);

	await advance(table, clock, T0, 700, 1);
	await advance(table, clock, T0, 900, 2);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "nothing lands before the slowest line has answered");
	await advance(table, clock, T0, 1200, 3);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;

	const [apply] = kernelCalls(table, "table.apply");
	assert.deepEqual(apply.params.effects.map((effect) => effect.clue ?? effect.kind), ["time", "corbitt-diaries", "knott-commission"], "the whole batch, in its order");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.verdict, row.ms]), [[1, "authorized", 700], [2, "authorized", 1200], [3, "authorized", 900]]);
	for (const row of rows) {
		assert.deepEqual([row.line_level, row.of_lines, row.line_calls, row.path, row.batch_admitted, row.batch_verdict], ["line", 3, 3, "lane", true, "authorized"]);
		assert.deepEqual(row.line_ms, [700, 1200, 900], "each call's own time");
		assert.equal(row.batch_ms, 1200, "the call waited for its slowest line (1.2 s), not the sum (2.8 s)");
		assert.equal(row.proposed.length, 1);
	}
});

// ---- per call: the cap, pending and the resend ---------------------------------------------------------------------------

test("one late line is collected by the host while the other lines keep their existing verdicts",async t=>{
 const CAP_MS=1000,HARD_CAP_MS=2*CAP_MS,clock=manualClock(),T0=clock.at();
 const lane=clockLane(clock,T0,[[/apply time/,ok("reporting back takes the walk"),300],[/corbitt-diaries/,ok("told on the report"),1500],[/knott-commission/,ok("told on the report"),400]]);
 const table=await openTable({env:{PI_COC_ADMISSION_TIMEOUT_MS:String(CAP_MS)},responses:[call("apply",{effects:[TIME,DIARIES,COMMISSION]}),...close],laneResponses:{admission:lane.responses}});
 t.after(()=>table.dispose());table.emit("coc:test-admission-clock",clock);let ended=false;const prompt=table.session.prompt(WORDS).finally(()=>{ended=true});
 await waitFor(()=>lane.calls.length===3,{timeoutMs:60000,label:"three parallel reviews"});await advance(table,clock,T0,300,1);await advance(table,clock,T0,400,2);clock.advanceTo(T0+CAP_MS);
 await waitFor(()=>table.telemetry().some(x=>x.lane==="admission-wait"),{timeoutMs:60000,label:"host collects the late line"});assert.equal(kernelCalls(table,"table.apply").length,0);
 await advance(table,clock,T0,1500,3);await runWaitsPastRound(clock,T0+HARD_CAP_MS,()=>ended);await prompt;
 const [result]=toolResults(table.session,"apply");assert.equal(result.isError,false);assert.equal(toolResults(table.session,"apply").length,1);assert.equal(lane.calls.length,3);
 const rows=admissionRows(table);assert.ok(rows.every(x=>x.batch_admitted===true));assert.equal(rows.find(x=>x.lines[0]===2).continuation_wait_ms,500);
 assert.deepEqual(kernelCalls(table,"table.apply")[0].params.effects.map(x=>x.clue??x.kind),["time","corbitt-diaries","knott-commission"]);
});

test("all parallel lines past the soft cap keep their own rounds without another Keeper proposal",async t=>{
 const CAP_MS=1000,HARD_CAP_MS=2*CAP_MS,clock=manualClock(),T0=clock.at();
 const lane=clockLane(clock,T0,[[/apply time/,ok("reporting back takes the walk"),1400],[/corbitt-diaries/,ok("told on the report"),1600]]);
 const table=await openTable({env:{PI_COC_ADMISSION_TIMEOUT_MS:String(CAP_MS)},responses:[call("apply",{effects:[TIME,DIARIES]}),...close],laneResponses:{admission:lane.responses}});
 t.after(()=>table.dispose());table.emit("coc:test-admission-clock",clock);let ended=false;const prompt=table.session.prompt(WORDS).finally(()=>{ended=true});
 await waitFor(()=>lane.calls.length===2,{timeoutMs:60000,label:"two parallel reviews"});clock.advanceTo(T0+CAP_MS);
 await waitFor(()=>table.telemetry().some(x=>x.lane==="admission-wait"),{timeoutMs:60000,label:"host continuation"});await advance(table,clock,T0,1400,1);await advance(table,clock,T0,1600,2);
 await runWaitsPastRound(clock,T0+HARD_CAP_MS,()=>ended);await prompt;
 assert.equal(lane.calls.length,2);assert.equal(toolResults(table.session,"apply").length,1);assert.equal(toolResults(table.session,"apply")[0].isError,false);
 assert.equal(kernelCalls(table,"table.apply").length,1);assert.equal(admissionRows(table).some(x=>x.verdict===REVIEW_PENDING),false);
});

test("§32.12.3.1 with §32.12.4: a response's batch whose line is already known is not prefetched; its call reuses that line and reviews the rest", async (t) => {
	// §32.12.3.1.1: a line is known only beside the same batch, so the known line comes from the identical batch before it,
	// whose diaries line failed (a malformed answer twice, §143.15) and so kept no verdict while the time line kept its own.
	let diaries = 0;
	const step = async (context) => {
		const proposed = admissionProposes(userText(context));
		if (/corbitt-diaries/.test(proposed) && ++diaries <= 2) return fauxAssistantMessage("not json at all");
		if (/apply time/.test(proposed)) return fauxAssistantMessage(JSON.stringify({ verdict: "entailed", grounds: "reporting back takes the walk" }));
		return fauxAssistantMessage(JSON.stringify(ok("told on the report")));
	};
	const table = await openTable({
		responses: [call("apply", { effects: [TIME, DIARIES] }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [TIME, DIARIES] }), fauxToolCall("apply", { effects: [MOVE] }),
				fauxToolCall("narrate", { text: "你把查到的事说给诺特听。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
		laneResponses: { admission: Array.from({ length: 8 }, () => step) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const proposed = table.lanes.admission.requests().map((text) => proposedLines(text)[0].split(":")[0]).sort();
	assert.deepEqual(proposed, ["- apply clue", "- apply clue", "- apply clue", "- apply move", "- apply time"],
		"the time line was reviewed once, in the first call; the second call reused it and reviewed only the diaries line again");
	const rows = admissionRows(table);
	assert.ok(rows.some((row) => row.reused && row.lines?.[0] === 1 && row.batch_admitted === true), JSON.stringify(rows));
	// §32.12.4: the other write's review was started at message_end and collected; the batch with a known line's was not.
	assert.deepEqual(rows.filter((row) => row.concurrent).map((row) => row.proposed[0].split(":")[0]), ["apply move"], JSON.stringify(rows));
	assert.deepEqual(kernelCalls(table, "table.apply").map((entry) => entry.params.effects.map((effect) => effect.clue ?? effect.kind)),
		[["time", "corbitt-diaries"], ["move"]]);
});

test("§32.12.3.1: the cap applies per call -- a line past it is admitted late on its own typed reading while its batch-mate answered", async (t) => {
	// The batch's lowest typed confidence (0.4) is under the late threshold; the late line's own (0.72) is not.
	installJev(t, [{ verdict: "entailed", confidence: 0.72 }, { verdict: "authorized", confidence: 0.4 }]);
	const CAP_MS = 1000;
	const clock = manualClock(), T0 = clock.at();
	const lane = clockLane(clock, T0, [[/apply time/, ok("reporting back takes the walk"), 1500], [/corbitt-diaries/, ok("told on the report"), 300]]);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_TIMEOUT_MS: String(CAP_MS), PI_COC_ADMISSION_JEV_TIMEOUT_MS: "60000" },
		responses: [call("apply", { effects: [TIME, DIARIES] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 2, { timeoutMs: 60_000, label: "two lane calls" });
	await advance(table, clock, T0, 300, 1);
	await advance(table, clock, T0, CAP_MS);
	await waitFor(() => kernelCalls(table, "table.apply").length === 1, { timeoutMs: 60_000, label: "the batch landing at the cap" });
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;
	// The late line's round runs on past the cap and answers at 1.5 s, inside its 2 s round: its late row says so.
	clock.advanceTo(T0 + 1500);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.path, row.verdict, row.ms]), [[1, "typed_late", "entailed", CAP_MS], [2, "lane", "authorized", 300]]);
	assert.equal(rows[0].confidence, 0.72, "the late line's own confidence, not the batch's lowest");
	assert.equal(rows[0].late_rule, "typed_late");
	assert.ok(rows.every((row) => row.batch_admitted === true));
	const late = await waitFor(() => table.telemetry().find((row) => row.lane === "admission-late"), { timeoutMs: 60_000, label: "the late line's own late row" });
	assert.equal(late.answered, "typed_late");
	assert.deepEqual(late.lines, [1]);
});

// ---- the batch's verdict ------------------------------------------------------------------------------------------------

test("§32.12.3.1: a line refused not_authorized decides the batch at once -- the other calls are stopped, nothing lands, nothing is left pending", async (t) => {
	const clock = manualClock(), T0 = clock.at();
	const lane = clockLane(clock, T0, [[/apply time/, ok("reporting back takes the walk"), 1000],
		[/corbitt-diaries/, { verdict: "not_authorized", grounds: "the player only said he would report back", missing: "whether to ask Knott about the house" }, 200],
		[/knott-commission/, ok("told on the report"), 1000]]);
	const table = await openTable({ env: { PI_COC_ADMISSION_TIMEOUT_MS: "5000" },
		responses: [call("apply", { effects: [TIME, DIARIES, COMMISSION] }), call("apply", { effects: [TIME, DIARIES, COMMISSION] }), ...close],
		laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 3, { timeoutMs: 60_000, label: "three lane calls" });
	await advance(table, clock, T0, 200, 1);
	// Refused at 200 ms: the Keeper reads it, resends the same batch (refused again on the kept line), and closes.
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end, with the clock still at 200 ms" });
	await prompt;
	assert.equal(clock.at() - T0, 200, "the call did not wait for the lines still running");
	assert.equal(kernelCalls(table, "table.apply").length, 0);
	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.details.coc_error.details.reason, "action_not_authorized");
	assert.equal(first.details.coc_error.details.missing, "whether to ask Knott about the house");
	assert.equal(first.details.coc_error.details.proposed.length, 3, "the batch is refused whole");
	assert.equal(second.details.coc_error.details.reason, "action_not_authorized");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.verdict, row.reused, row.batch_admitted]),
		[[2, "not_authorized", false, false], [2, "not_authorized", true, false]], "only the refusing line answered; its resend is refused at once by line");
	assert.equal(rows[0].ms, 200);
	assert.deepEqual(rows[0].line_ms, [null, 200, null], "the other two calls were stopped unanswered");
	assert.equal(lane.calls.length, 3, "the resend made no lane call");
	// Past every round's end: the stopped calls leave no pending review and no late row.
	clock.advanceTo(T0 + 20_000);
	await sleep(200);
	assert.ok(!table.telemetry().some((row) => row.lane === "admission-late"), "nothing was left running for a resend");
	assert.ok(!admissionRows(table).some((row) => row.verdict === REVIEW_PENDING));
});

test("§32.12.3.1: an admitted line does not land beside a refused one; the batch is refused whole on the refused line's grounds", async (t) => {
	const table = await openTable({ responses: [call("apply", { effects: [TIME, DIARIES] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }],
			[/corbitt-diaries/, { verdict: "uncertain", grounds: "the player said nothing of the house", missing: "whether to ask about the house" }, 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the admitted time line did not land alone");
	const [result] = toolResults(table.session, "apply");
	const details = result.details.coc_error.details;
	assert.deepEqual([details.reason, details.verdict, details.missing], ["action_not_authorized", "uncertain", "whether to ask about the house"]);
	assert.deepEqual(details.line_outcomes.map((row) => [row.reason, row.verdict]), [["action_not_authorized", "uncertain"]]);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.verdict, row.admitted, row.batch_admitted, row.batch_verdict]),
		[[1, "entailed", true, false, "uncertain"], [2, "uncertain", false, false, "uncertain"]]);
});

test("§32.12.3.1 with §32.12.3.2: once a line's lane has given a verdict, the typed reading no longer settles that line", async (t) => {
	// The typed answer (both lines admitting at 0.95) arrives at 400 ms, after the time line's lane verdict (100 ms) and before
	// the diaries line's (800 ms, uncertain): the time line is the lane's already, and a clue line is never the typed reading's.
	const clock = manualClock(), T0 = clock.at();
	const typed = installJev(t, [{ verdict: "entailed", confidence: 0.95 }, { verdict: "authorized", confidence: 0.95 }], 400, clock);
	const lane = clockLane(clock, T0, [[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }, 100],
		[/corbitt-diaries/, { verdict: "uncertain", grounds: "the player said nothing of the house", missing: "whether to ask about the house" }, 800]]);
	const table = await openTable({ env: { ...KEY, PI_COC_ADMISSION_JEV_TIMEOUT_MS: "60000" },
		responses: [call("apply", { effects: [TIME, DIARIES] }), ...close], laneResponses: { admission: lane.responses } });
	t.after(() => table.dispose());
	table.emit("coc:test-admission-clock", clock);
	let ended = false;
	const prompt = table.session.prompt(WORDS).finally(() => { ended = true; });
	await waitFor(() => lane.calls.length === 2 && typed.length === 1, { timeoutMs: 60_000, label: "two lane calls and the typed request" });
	assert.ok(clock.due().includes(T0 + 400), "the typed answer is due at 400 ms");
	await advance(table, clock, T0, 100, 1);
	await advance(table, clock, T0, 400);
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the typed answer did not settle the batch");
	await advance(table, clock, T0, 800, 2);
	await waitFor(() => ended, { timeoutMs: 60_000, label: "the run's end" });
	await prompt;
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the lane's uncertain line refused the batch");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.verdict, row.batch_verdict]), [["lane", "entailed", "uncertain"], ["lane", "uncertain", "uncertain"]]);
});

// ---- reuse keyed by line ----------------------------------------------------------------------------------------------------

test("§32.12.3.1 with §32.12.3.1.1: verdict reuse keys by line beside its batch -- the same batch reuses, a changed batch is reviewed again", async (t) => {
	const table = await openTable({
		responses: [call("apply", { effects: [TIME, DIARIES] }),
			call("apply", { effects: [{ ...TIME, why: "The walk back." }, { ...DIARIES, how: "Knott said so." }] }),
			call("apply", { effects: [TIME, COMMISSION] }), call("apply", { effects: [{ ...TIME, why: "Again." }] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "entailed", grounds: "reporting back takes the walk" }],
			[/knott-commission/, { verdict: "authorized", grounds: "told on the report" }],
			[/corbitt-diaries/, { verdict: "not_authorized", grounds: "nothing asked of the house", missing: "whether to ask about the house" }, 150]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const proposed = table.lanes.admission.requests().map((text) => proposedLines(text)[0].split(";")[0]);
	assert.deepEqual(proposed.sort(), ['- apply clue: clue="corbitt-diaries"', '- apply clue: clue="knott-commission"',
		"- apply time: minutes=45", "- apply time: minutes=45", "- apply time: minutes=45"],
		"the rationale-only resend made no call; the batch without the diaries line and the time line alone were each reviewed again");
	const applies = kernelCalls(table, "table.apply");
	assert.deepEqual(applies.map((entry) => entry.params.effects.map((effect) => effect.clue ?? effect.kind)), [["time", "knott-commission"], ["time"]]);
	const results = toolResults(table.session, "apply");
	assert.deepEqual(results.map((result) => result.isError), [true, true, false, false]);
	assert.equal(results[1].details.coc_error.details.missing, "whether to ask about the house", "refused at once on the diaries line's kept verdict");
	const rows = admissionRows(table);
	const shape = (row) => [row.verdict, row.reused, row.proposed[0].split(":")[0]];
	assert.deepEqual(rows.slice(0, 2).map(shape), [["entailed", false, "apply time"], ["not_authorized", false, "apply clue"]]);
	assert.deepEqual(rows.slice(2, 3).map(shape), [["not_authorized", true, "apply clue"]], "the same batch reworded: the kept refusal, no call");
	assert.equal(rows[2].key, rows[1].key);
	// The time line was admitted beside the diaries line; beside the commission, and alone, it is a different proposal.
	assert.deepEqual(rows.slice(3, 5).map(shape).sort(), [["authorized", false, "apply clue"], ["entailed", false, "apply time"]]);
	assert.ok(rows.slice(3, 5).every((row) => row.batch_admitted === true));
	assert.deepEqual(rows.slice(5).map(shape), [["entailed", false, "apply time"]]);
	const timeKeys = new Set(rows.filter((row) => /^apply time/.test(row.proposed[0])).map((row) => row.key));
	assert.equal(timeKeys.size, 3, "beside the diaries, beside the commission, and alone: three keys");
	assert.equal(rows[5].line_level, undefined, "the time line alone is a one-line call");
});

test("§32.12.3.1: a new player input clears the lines' kept verdicts with the rest (§32.4)", async (t) => {
	const table = await openTable({
		responses: [call("apply", { effects: [TIME, DIARIES] }), call("narrate", { text: "诺特点了点头。" }), call("apply", { effects: [TIME, DIARIES] }), ...close],
		laneResponses: { admission: laneByLine([[/apply (time|clue)/, { verdict: "entailed", grounds: "reporting back" }]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	await table.session.prompt("我再跟他说一遍。");
	assert.equal(table.lanes.admission.requests().length, 4, "the second turn reviewed both lines again");
	assert.ok(!admissionRows(table).some((row) => row.reused));
});

// ---- the outage streak --------------------------------------------------------------------------------------------------------

test("§32.12.3.1: the lines of one call are one review for the outage streak -- a batch whose every line failed is one failure", async (t) => {
	const bad = () => fauxAssistantMessage("not json at all");
	const table = await openTable({
		responses: [call("apply", { effects: [TIME, DIARIES, COMMISSION] }), call("apply", { effects: [{ kind: "time", minutes: 10 }, MOVE] }), ...close],
		// §143.15 (gathered 2026-09-27): each line's round asks a malformed answer once more, so five lines are ten answers.
		laneResponses: { admission: Array.from({ length: 10 }, bad) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const [first, second] = toolResults(table.session, "apply");
	assert.equal(first.details.coc_error.details.reason, "admission_unavailable");
	assert.equal(first.details.coc_error.details.streak, 1, "three failed lines, one failed review");
	assert.match(first.text, /The player's next input can try again/);
	assert.equal(second.details.coc_error.details.streak, 2);
	assert.match(second.text, /failed 2 times in a row/);
	assert.equal(table.entries("coc-admission-status").length, 1, "the operator is told once, on the second failed call");
	assert.ok(admissionRows(table).every((row) => row.ok === false && row.batch_admitted === false));
});

// ---- what is unchanged ------------------------------------------------------------------------------------------------------

test("§32.12.3.1: a one-line batch and a resolve are one lane call each, and their rows are what they were", async (t) => {
	const persuade = { action: { intent: "social", skill: "Persuade", target: "Steven Knott", goal: "问清委托条件", method: "直接问" } };
	const table = await openTable({ responses: [call("apply", { effects: [TIME] }), call("resolve", persuade), ...close] });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2);
	assert.ok(requests.every((request) => proposedLines(request).length === 1));
	assert.ok(requests.every((request) => !request.includes(BESIDE_HEADING)), "§32.12.3.1.1: nothing beside a lone line");
	const rows = admissionRows(table);
	assert.equal(rows.length, 2);
	for (const row of rows) for (const field of ["line_level", "line_calls", "line_ms", "batch_ms", "batch_admitted", "batch_key"])
		assert.equal(row[field], undefined, `${row.verb}: no ${field}`);
});

test("§32.12.3.2: a typed reading no longer settles a batch whole -- its time line is settled by jev, its clue line is the lane's, one row each", async (t) => {
	const typed = installJev(t, [{ verdict: "authorized", confidence: 0.9 }, { verdict: "entailed", confidence: 0.88 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, DIARIES] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 1500],
			[/corbitt-diaries/, ok("told on the report"), 300]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(typed.length, 1, "one typed batch over both lines");
	assert.equal(kernelCalls(table, "table.apply").length, 1);
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.lines[0], row.path, row.reviewer, row.line_class, row.lane_cancelled]),
		[[1, "typed", "jev", "time", true], [2, "lane", "lane", "clue", false]]);
	assert.ok(rows.every((row) => row.line_level === "line" && row.batch_admitted === true));
});

test("§32.12.3.2: no split -- a three-line batch whose time line the typed reading settles keeps its other lines' own calls running, and lands whole", async (t) => {
	const typed = installJev(t, [{ verdict: "entailed", confidence: 0.93 }, { verdict: "authorized", confidence: 0.4 }, { verdict: "authorized", confidence: 0.4 }]);
	const table = await openTable({ env: KEY, responses: [call("apply", { effects: [TIME, DIARIES, COMMISSION] }), ...close],
		laneResponses: { admission: laneByLine([[/apply time/, { verdict: "not_authorized", grounds: "a lane that would refuse", missing: "x" }, 3000],
			[/corbitt-diaries|knott-commission/, ok("told on the report"), 150]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.ok(!table.lanes.admission.requests().some((text) => text.includes("admitted in this same call")), "no remainder round");
	assert.ok(table.lanes.admission.requests().length <= 3, "at most one call per line");
	assert.equal(typed.length, 1, "one typed attempt over the three lines, none again");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.path, row.line_level, row.lines, row.remainder ?? false]),
		[["typed", "line", [1], false], ["lane", "line", [2], false], ["lane", "line", [3], false]]);
	assert.ok(rows.every((row) => row.line_calls === 3 && row.batch_admitted === true));
	assert.deepEqual(kernelCalls(table, "table.apply")[0].params.effects.map((effect) => effect.clue ?? effect.kind), ["time", "corbitt-diaries", "knott-commission"]);
});

test("§32.12.3.1 with §32.12.4: a batch the Keeper's response carries beside another write is reviewed line by line from message_end, and its call collects it", async (t) => {
	// §32.12.4 starts the reviews of a response's writes together when it carries more than one.
	const table = await openTable({
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: [TIME, DIARIES] }), fauxToolCall("apply", { effects: [COMMISSION] }),
			fauxToolCall("narrate", { text: "你把查到的事说给诺特听。" })], { stopReason: "toolUse" }), fauxAssistantMessage("after")],
		laneResponses: { admission: laneByLine([[/apply (time|clue)/, ok("reporting back"), 100]]) } });
	t.after(() => table.dispose());
	await table.session.prompt(WORDS);
	assert.equal(table.lanes.admission.requests().length, 3, "one review per write: the batch's two lines and the other write's one, none again when the calls' turns came");
	const rows = admissionRows(table);
	assert.equal(rows.length, 3);
	assert.ok(rows.every((row) => row.concurrent === true), JSON.stringify(rows));
	assert.deepEqual(rows.map((row) => [row.line_calls ?? null, row.batch_admitted ?? null]), [[2, true], [2, true], [null, null]]);
	assert.equal(kernelCalls(table, "table.apply").length, 2);
});
