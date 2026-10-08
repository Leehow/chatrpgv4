/**
 * Contract §201.1: after every delivery, the host reads which of the book's clues the delivered text gave the
 * investigators, and the ledger follows the story forward (§158), as §190.2 does for the told position.
 *
 * The read runs after the delivery has committed, on a zero-delay timer the delivery never awaits. It asks the kernel for
 * the clues in play that the ledger lacks and the clues that turn landed (`table.owe.options`'s `clues` and
 * `clue_receipts`), asks Jev (`runtime/jev/told-clue.ts`) and, in `on` mode, names each given clue through `table.owe`
 * (`source: "told-clue"`), which writes §158.3's owed row; §158.4's clerk lands it first on the next run. A landed clue the
 * text did not give is counted (`landed_untold`, §201.4), and an owed clue the book finds by a check that turn did not pass
 * is counted (`check_skipped`, §201.2); neither is acted on. It never reviews, edits, retracts or annotates the prose
 * (the exception §190.2 records to §166, extended to clues by §201.1).
 */
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { toldClueBudget, type ToldClueBudget } from "../../runtime/jev/host-budgets.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { TOLD_CLUE_FAMILY, runToldClue, toldClueBindings, toldClueDecisions, toldClueSentences,
	type ToldClueCandidate, type ToldClueInput, type ToldClueLanded, type ToldClueResult } from "../../runtime/jev/told-clue.ts";
import type { ReviewFlight } from "./owed-review.ts";

type Row = Record<string, unknown>;

export interface ToldClueDeps {
	env: NodeJS.ProcessEnv;
	campaign: string;
	/** The delivered turn. */
	turn: number;
	/** What the player read: the delivery's `rendered_text`. */
	text: string | undefined;
	call: (method: string, params: Row) => Promise<unknown>;
	record: (row: Row) => unknown;
	signal?: AbortSignal;
	/** For tests only: the budget instead of the shipped file's. */
	budget?: ToldClueBudget;
}

/** `PI_COC_TOLD_CLUE=off|shadow|on` overrides the mode alone, per process; the bars stay data. */
function override(env: NodeJS.ProcessEnv): ToldClueBudget["mode"] | undefined {
	const value = env.PI_COC_TOLD_CLUE?.trim();
	return value === "off" || value === "shadow" || value === "on" ? value : undefined;
}

/** The kernel's clue rows, kept to the fields the read uses. */
function candidatesOf(value: unknown): ToldClueCandidate[] {
	return (Array.isArray(value) ? value : []).filter((entry): entry is Row => !!entry && typeof entry === "object" && typeof (entry as Row).name === "string")
		.map(entry => ({ name: String(entry.name), summary: String(entry.summary ?? ""), scene: String(entry.scene ?? ""), source: String(entry.source ?? ""),
			delivery_kind: String(entry.delivery_kind ?? "unknown"),
			...(entry.check && typeof entry.check === "object" ? { check: entry.check as ToldClueCandidate["check"] } : {}) }));
}
/** The clues the delivered turn landed, but not an owed landing: that one is an earlier delivery's clue. */
function landedOf(value: unknown): ToldClueLanded[] {
	return (Array.isArray(value) ? value : []).filter((entry): entry is Row => !!entry && typeof entry === "object" && typeof (entry as Row).clue === "string"
		&& typeof (entry as Row).owed !== "string").map(entry => ({ clue: String(entry.clue), summary: String(entry.summary ?? "") }));
}

async function ask(input: ToldClueInput, deps: ToldClueDeps, deadlineAt: number, givenMin: number): Promise<ToldClueResult> {
	const began = Date.now(), bindings = toldClueBindings(input), goal = "Read which of the book's clues the delivered text gave the investigators";
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	const signal = deps.signal ?? new AbortController().signal;
	try {
		accounting = preparationBudget({
			decision: createDecisionAdapter({env: deps.env, maxConcurrency: 2, retryPolicies: {[TOLD_CLUE_FAMILY]: {maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 1_000}}}),
			campaign: input.campaign, deadlineAt, signal, owner: TOLD_CLUE_FAMILY, goal,
		});
		lease = new TaskLease({owner: TOLD_CLUE_FAMILY, goal, scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: {deadlineAt, remainingInputTokens: 400_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.04, remainingActions: 6}});
		return await runToldClue(input, accounting.decision, lease, givenMin);
	} catch {
		return {status: "failed", reason: "told_clue_owner_error", elapsedMs: Date.now() - began, usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}};
	} finally {
		lease?.close();
		accounting?.close();
	}
}

/**
 * One read of one delivery: the kernel read, the questions, `table.owe` per given clue in `on` mode, one `told-clue` row.
 * Answers the owed rows' names (empty when none was written). Never throws.
 */
export async function readToldClue(deps: ToldClueDeps): Promise<string[]> {
	const began = Date.now();
	const shipped = deps.budget ?? await toldClueBudget(), mode = override(deps.env) ?? shipped.mode;
	if (mode === "off" || deps.signal?.aborted) return [];
	const base = {lane: "told-clue", event: "read", turn: deps.turn, mode};
	try {
		if (!deps.text?.trim()) { await deps.record({...base, ok: true, skipped: "no_text"}); return []; }
		// Without Jev nothing can be read, and the kernel is not asked for anything.
		if (!readJevApiKey(deps.env)) { await deps.record({...base, ok: true, skipped: "unconfigured"}); return []; }
		let read: Row;
		try { read = (await deps.call("table.owe.options", {campaign: deps.campaign, turn: deps.turn, limit: 1, clue_limit: shipped.maxCandidates}) ?? {}) as Row; }
		catch (error) {
			if (deps.signal?.aborted) return [];
			await deps.record({...base, ok: false, reason: "options_failed", outcome: "stay", owed: [],
				code: (error as {code?: unknown})?.code ?? null, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
			return [];
		}
		if (deps.signal?.aborted) return [];
		const candidates = candidatesOf(read.clues), landed = landedOf(read.clue_receipts);
		const {sentences, total} = toldClueSentences(deps.text);
		if (!sentences.length) { await deps.record({...base, ok: true, skipped: "no_text"}); return []; }
		if (!candidates.length && !landed.length) { await deps.record({...base, ok: true, skipped: "no_candidates"}); return []; }
		const input: ToldClueInput = {campaign: deps.campaign, turn: deps.turn, candidates, landed, sentences};
		const result = await ask(input, deps, began + shipped.timeoutMs, shipped.givenMin);
		if (deps.signal?.aborted) return [];
		const decided = toldClueDecisions(result, shipped, input);
		const owed: Row[] = [], dropped: Row[] = [];
		if (mode === "on") for (const entry of decided.owe) {
			if (deps.signal?.aborted) break;
			try {
				const answer = (await deps.call("table.owe", {campaign: deps.campaign, turn: deps.turn, effect: {kind: "clue", clue: entry.clue},
					quote: entry.quote, source: TOLD_CLUE_FAMILY}) ?? {}) as Row;
				if (typeof answer.owed === "string") owed.push({clue: entry.clue, owed: answer.owed, ...(answer.check_skipped === true ? {check_skipped: true} : {})});
				else dropped.push({clue: entry.clue, reason: String(answer.dropped ?? "unknown")});
			} catch (error) {
				dropped.push({clue: entry.clue, reason: "kernel_refused", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
			}
		}
		const outcome = !decided.owe.length ? "stay" : mode !== "on" ? "shadow" : owed.length ? "owed" : "dropped";
		await deps.record({...base, ok: result.status === "answered", candidates: candidates.map(candidate => candidate.name), landed: landed.map(entry => entry.clue),
			sentences: {total, offered: sentences.length},
			...(result.status === "answered" ? {given: result.given, landed_given: result.landedGiven, sentence_request: result.sentenceRequest,
				sentences_chosen: Object.fromEntries(Object.entries(result.sentences).map(([clue, sentence]) => [clue, {key: sentence.key, confidence: sentence.confidence}])),
				usage: result.usage} : {reason: result.reason}),
			owe: decided.owe.map(entry => entry.clue), stay: decided.stay, outcome, owed, dropped,
			check_skipped: owed.filter(entry => entry.check_skipped === true).map(entry => entry.clue), landed_untold: decided.landedUntold, ms: Date.now() - began});
		return owed.map(entry => String(entry.owed));
	} catch (error) {
		if (deps.signal?.aborted) return [];
		await deps.record({...base, ok: false, reason: "lane_crashed", outcome: "stay", owed: [],
			detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
		return [];
	}
}

/**
 * The shipped budget as it is known synchronously: read once per process, warmed when this module loads, so the close can
 * decide at once whether the read is a flight to watch. Undefined only until then.
 */
let shippedKnown: ToldClueBudget | undefined;
function knownBudget(): ToldClueBudget | undefined {
	if (!shippedKnown) void toldClueBudget().then(budget => { shippedKnown = budget; }, () => undefined);
	return shippedKnown;
}
knownBudget();

/**
 * Start the read of one delivery on a zero-delay timer the delivery never awaits. Answers the flight §158.4's watch reads
 * only when the read may owe -- the mode is `on` and Jev is configured -- and it settles only once `table.owe` wrote a
 * row; otherwise nothing is registered. `ended` runs when the read is over, whatever it found.
 */
export function startToldClue(deps: ToldClueDeps, ended?: () => void): ReviewFlight | undefined {
	const mode = override(deps.env) ?? (deps.budget ?? knownBudget())?.mode;
	if (mode === "off") { ended?.(); return undefined; }
	let settle: (() => void) | undefined;
	const flight = mode === "on" && readJevApiKey(deps.env) ? {turn: deps.turn, done: new Promise<void>(resolve => { settle = resolve; })} : undefined;
	const timer = setTimeout(() => {
		void readToldClue(deps).then(owed => { if (owed.length) settle?.(); }, () => undefined).finally(() => ended?.());
	}, 0);
	(timer as {unref?: () => void}).unref?.();
	return flight;
}
