/**
 * Contract §216.1: after every delivery, the host reads how much in-world time the delivered text told the investigators
 * spending, and the ledger follows the story forward (§158), as §190.2 does for the told position and §201.1 for told clues.
 *
 * The read runs after the delivery has committed, on a zero-delay timer the delivery never awaits. It asks the kernel for
 * the told turn's time receipts, whether a session was running, and the time-cost rows (`table.owe.options`' `time` and
 * `time_bands`); a turn that already charged time, or ran a session, is not read. Otherwise it asks Jev
 * (`runtime/jev/told-time.ts`) and, in `on` mode, names the row through `table.owe` (`source: "told-time"`), which writes
 * §158.3's owed time row; §158.4's clerk lands it first on the next run, and the kernel rolls the band. It never reviews,
 * edits, retracts or annotates the prose (the exception §190.2 records to §166, used for told time by §216).
 */
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { toldTimeBudget, type ToldTimeBudget } from "../../runtime/jev/host-budgets.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { TOLD_TIME_FAMILY, actRows, runToldTime, toldTimeBindings, toldTimeDecision, toldTimeSentences,
	type ToldTimeInput, type ToldTimeResult } from "../../runtime/jev/told-time.ts";
import type { TimeBandRow } from "../../runtime/jev/band-shadow-domain.ts";
import type { ReviewFlight } from "./owed-review.ts";

type Row = Record<string, unknown>;

export interface ToldTimeDeps {
	env: NodeJS.ProcessEnv;
	campaign: string;
	/** The delivered turn. */
	turn: number;
	/** What the player read: the delivery's `rendered_text`. */
	text: string | undefined;
	/** §218.4: the delivering input's interaction scope (the interaction-scope lane's decision); not `world` is never read. */
	scope?: "world" | "reference";
	call: (method: string, params: Row) => Promise<unknown>;
	record: (row: Row) => unknown;
	signal?: AbortSignal;
	/** For tests only: the budget instead of the shipped file's. */
	budget?: ToldTimeBudget;
}

/** `PI_COC_TOLD_TIME=off|shadow|on` overrides the mode alone, per process; the bars stay data. */
function override(env: NodeJS.ProcessEnv): ToldTimeBudget["mode"] | undefined {
	const value = env.PI_COC_TOLD_TIME?.trim();
	return value === "off" || value === "shadow" || value === "on" ? value : undefined;
}

/** The kernel's time-cost rows, kept to the fields the question uses. */
function bandsOf(value: unknown): TimeBandRow[] {
	return (Array.isArray(value) ? value : []).flatMap((entry): TimeBandRow[] => {
		const row = entry as Row | null;
		if (!row || typeof row.handle !== "string" || !Number.isInteger(row.min) || !Number.isInteger(row.max)) return [];
		return [{handle: row.handle, min: Number(row.min), max: Number(row.max), ...(Number.isInteger(row.default) ? {default: Number(row.default)} : {}),
			...(typeof row.covers === "string" && row.covers.trim() ? {covers: row.covers.trim()} : {})}];
	});
}

/** §216.1: the told turn's own `time` receipts -- not an owed landing, which is an earlier delivery's time. */
export function chargedTime(time: unknown): number[] {
	const receipts = time && typeof time === "object" && Array.isArray((time as Row).receipts) ? (time as {receipts: unknown[]}).receipts : [];
	return receipts.filter((entry): entry is Row => !!entry && typeof entry === "object" && typeof (entry as Row).owed !== "string")
		.map(entry => Number.isFinite(entry.minutes) ? Number(entry.minutes) : 0);
}

async function ask(input: ToldTimeInput, deps: ToldTimeDeps, deadlineAt: number): Promise<ToldTimeResult> {
	const began = Date.now(), bindings = toldTimeBindings(input), goal = "Read how much in-world time the delivered text told the investigators spending";
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	const signal = deps.signal ?? new AbortController().signal;
	try {
		accounting = preparationBudget({
			decision: createDecisionAdapter({env: deps.env, maxConcurrency: 2, retryPolicies: {[TOLD_TIME_FAMILY]: {maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 1_000}}}),
			campaign: input.campaign, deadlineAt, signal, owner: TOLD_TIME_FAMILY, goal,
		});
		lease = new TaskLease({owner: TOLD_TIME_FAMILY, goal, scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: {deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 10_000, remainingCostUsd: 0.02, remainingActions: 3}});
		return await runToldTime(input, accounting.decision, lease);
	} catch {
		return {status: "failed", reason: "told_time_owner_error", elapsedMs: Date.now() - began, usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}};
	} finally {
		lease?.close();
		accounting?.close();
	}
}

/**
 * One read of one delivery: the kernel read, the guards, the questions, `table.owe` in `on` mode, one `told-time` row.
 * Answers the owed row's name when one was written. Never throws.
 */
export async function readToldTime(deps: ToldTimeDeps): Promise<string | null> {
	const began = Date.now();
	const shipped = deps.budget ?? await toldTimeBudget(), mode = override(deps.env) ?? shipped.mode;
	if (mode === "off" || deps.signal?.aborted) return null;
	const base = {lane: "told-time", event: "read", turn: deps.turn, mode};
	try {
		if (!deps.text?.trim()) { await deps.record({...base, ok: true, skipped: "no_text"}); return null; }
		// §218.4: an out-of-fiction answer tells no in-world time; the scope is the lane's typed decision, not a reading of the text.
		if (deps.scope !== undefined && deps.scope !== "world") { await deps.record({...base, ok: true, skipped: "out_of_fiction"}); return null; }
		// Without Jev nothing can be read, and the kernel is not asked for anything.
		if (!readJevApiKey(deps.env)) { await deps.record({...base, ok: true, skipped: "unconfigured"}); return null; }
		let read: Row;
		try { read = (await deps.call("table.owe.options", {campaign: deps.campaign, turn: deps.turn, limit: 1, clue_limit: 1}) ?? {}) as Row; }
		catch (error) {
			if (deps.signal?.aborted) return null;
			await deps.record({...base, ok: false, reason: "options_failed", outcome: "stay", owed: null,
				code: (error as {code?: unknown})?.code ?? null, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
			return null;
		}
		if (deps.signal?.aborted) return null;
		// §216.1: a turn that charged its own time is not read again (the read does not compare amounts), nor a session's rounds.
		const landed = chargedTime(read.time);
		if (landed.length) { await deps.record({...base, ok: true, skipped: "time_landed", landed}); return null; }
		if ((read.time as Row | undefined)?.session === true) { await deps.record({...base, ok: true, skipped: "session"}); return null; }
		const bands = actRows(bandsOf(read.time_bands));
		if (!bands.length) { await deps.record({...base, ok: true, skipped: "no_bands"}); return null; }
		const {sentences, total} = toldTimeSentences(deps.text);
		if (!sentences.length) { await deps.record({...base, ok: true, skipped: "no_text"}); return null; }
		const input: ToldTimeInput = {campaign: deps.campaign, turn: deps.turn, bands, sentences};
		const result = await ask(input, deps, began + shipped.timeoutMs);
		if (deps.signal?.aborted) return null;
		const decided = toldTimeDecision(result, shipped, bands);
		let outcome = "stay", owed: string | null = null, dropped: Row = {};
		if (decided.decision === "owe" && mode !== "on") outcome = "shadow";
		else if (decided.decision === "owe" && !deps.signal?.aborted) {
			try {
				const answer = (await deps.call("table.owe", {campaign: deps.campaign, turn: deps.turn, effect: {kind: "time", band: decided.band},
					quote: decided.quote, source: TOLD_TIME_FAMILY}) ?? {}) as Row;
				owed = typeof answer.owed === "string" ? answer.owed : null;
				outcome = owed ? "owed" : "dropped";
				if (!owed) dropped = {dropped: String(answer.dropped ?? "unknown")};
			} catch (error) {
				outcome = "dropped";
				dropped = {dropped: "kernel_refused", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)};
			}
		}
		await deps.record({...base, ok: result.status === "answered", bands: bands.map(row => row.handle), sentences: {total, offered: sentences.length},
			...(result.status === "answered" ? {chosen: result.chosen, confidence: result.confidence, distribution: result.distribution,
				sentence: result.sentence ? {key: result.sentence.key, confidence: result.sentence.confidence, distribution: result.sentence.distribution} : null,
				extent: result.extent ? {choice: result.extent.choice, confidence: result.extent.top, distribution: result.extent.distribution} : null,
				usage: result.usage} : {reason: result.reason}),
			decision: decided.decision, ...(decided.decision === "owe" ? {band: decided.band} : {why: decided.why}),
			outcome, owed, ...dropped, ms: Date.now() - began});
		return owed;
	} catch (error) {
		if (deps.signal?.aborted) return null;
		await deps.record({...base, ok: false, reason: "lane_crashed", outcome: "stay", owed: null,
			detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
		return null;
	}
}

/**
 * The shipped budget as it is known synchronously: read once per process, warmed when this module loads, so the close can
 * decide at once whether the read is a flight to watch. Undefined only until then.
 */
let shippedKnown: ToldTimeBudget | undefined;
function knownBudget(): ToldTimeBudget | undefined {
	if (!shippedKnown) void toldTimeBudget().then(budget => { shippedKnown = budget; }, () => undefined);
	return shippedKnown;
}
knownBudget();

/**
 * Start the read of one delivery on a zero-delay timer the delivery never awaits. Answers the flight §158.4's watch reads
 * only when the read may owe -- the mode is `on` and Jev is configured -- and it settles only once `table.owe` wrote a
 * row; otherwise nothing is registered. `ended` runs when the read is over, whatever it found.
 */
export function startToldTime(deps: ToldTimeDeps, ended?: () => void): ReviewFlight | undefined {
	const mode = override(deps.env) ?? (deps.budget ?? knownBudget())?.mode;
	if (mode === "off") { ended?.(); return undefined; }
	let settle: (() => void) | undefined;
	const flight = mode === "on" && readJevApiKey(deps.env) ? {turn: deps.turn, done: new Promise<void>(resolve => { settle = resolve; })} : undefined;
	const timer = setTimeout(() => {
		void readToldTime(deps).then(owed => { if (owed) settle?.(); }, () => undefined).finally(() => ended?.());
	}, 0);
	(timer as {unref?: () => void}).unref?.();
	return flight;
}
