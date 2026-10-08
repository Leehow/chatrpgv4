/**
 * Contract §190.2: after every delivery, the host reads where the delivered text leaves the investigators, and the ledger
 * follows the story forward (§158).
 *
 * The read runs after the delivery has committed, on a zero-delay timer the delivery never awaits. It asks the kernel for
 * the delivered scene, that turn's move receipts and the places the text may leave the party at (`table.owe.options`);
 * a turn that landed a move is not read (the ledger already followed). Otherwise it asks Jev the three questions
 * (`runtime/jev/told-position.ts`) and, in `on` mode, names the place through `table.owe`, which writes §158.3's owed row;
 * §158.4's clerk lands it first on the next run. In `shadow` (the shipped mode) the row is written and nothing is owed.
 * It never reviews, edits, retracts or annotates the prose (the one exception §190.2 records to §166).
 *
 * The next run's first read watches it through §158.4's `coc:owed-review` port: `startToldPosition` answers the flight
 * that settles once `table.owe` wrote a row.
 */
import { readJevApiKey } from "../jev/agent/config.js";
import { createDecisionAdapter } from "../../runtime/jev/decision-adapter.ts";
import { toldPositionBudget, type ToldPositionBudget } from "../../runtime/jev/host-budgets.ts";
import { preparationBudget } from "../../runtime/jev/preparation-budget.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { TOLD_POSITION_FAMILY, runToldPosition, toldBindings, toldDecision, toldSentences,
	type ToldCandidate, type ToldInput, type ToldResult } from "../../runtime/jev/told-position.ts";
import type { ReviewFlight } from "./owed-review.ts";

type Row = Record<string, unknown>;

export interface ToldPositionDeps {
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
	budget?: ToldPositionBudget;
}

/** `PI_COC_TOLD_POSITION=off|shadow|on` overrides the mode alone, per process; the bars stay data. */
function override(env: NodeJS.ProcessEnv): ToldPositionBudget["mode"] | undefined {
	const value = env.PI_COC_TOLD_POSITION?.trim();
	return value === "off" || value === "shadow" || value === "on" ? value : undefined;
}

/**
 * §190.2: the move receipts of the delivered turn that moved the party -- not an owed landing (an earlier delivery's
 * position, which the clerk lands first) and not a rename. A turn with one is not read.
 */
export function landedMoves(moved: unknown): Row[] {
	return (Array.isArray(moved) ? moved : []).filter((entry): entry is Row => !!entry && typeof entry === "object"
		&& typeof (entry as Row).owed !== "string" && (entry as Row).renamed !== true);
}

async function ask(input: ToldInput, deps: ToldPositionDeps, deadlineAt: number): Promise<ToldResult> {
	const began = Date.now(), bindings = toldBindings(input), goal = "Read where the delivered text leaves the investigators";
	let lease: TaskLease | undefined, accounting: ReturnType<typeof preparationBudget> | undefined;
	const signal = deps.signal ?? new AbortController().signal;
	try {
		accounting = preparationBudget({
			decision: createDecisionAdapter({env: deps.env, maxConcurrency: 2, retryPolicies: {[TOLD_POSITION_FAMILY]: {maxRetries: 1, backoffInitialMs: 250, backoffMaxMs: 1_000}}}),
			campaign: input.campaign, deadlineAt, signal, owner: TOLD_POSITION_FAMILY, goal,
		});
		lease = new TaskLease({owner: TOLD_POSITION_FAMILY, goal, scope: bindings.scope, capabilities: ["decision"], readSet: bindings.readSet, signal,
			budget: {deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 10_000, remainingCostUsd: 0.02, remainingActions: 3}});
		return await runToldPosition(input, accounting.decision, lease);
	} catch {
		return {status: "failed", reason: "told_position_owner_error", elapsedMs: Date.now() - began, usage: {inputTokens: 0, outputTokens: 0, costUsd: 0}};
	} finally {
		lease?.close();
		accounting?.close();
	}
}

/**
 * One read of one delivery: the kernel read, the guard, the questions, `table.owe` in `on` mode, one `told-position`
 * row. Answers the owed row's name when one was written. Never throws.
 */
export async function readToldPosition(deps: ToldPositionDeps): Promise<string | null> {
	const began = Date.now();
	const shipped = deps.budget ?? await toldPositionBudget(), mode = override(deps.env) ?? shipped.mode;
	if (mode === "off" || deps.signal?.aborted) return null;
	const base = {lane: "told-position", event: "read", turn: deps.turn, mode};
	try {
		if (!deps.text?.trim()) { await deps.record({...base, ok: true, skipped: "no_text"}); return null; }
		// Without Jev nothing can be read, and the kernel is not asked for anything.
		if (!readJevApiKey(deps.env)) { await deps.record({...base, ok: true, skipped: "unconfigured"}); return null; }
		let read: Row;
		try { read = (await deps.call("table.owe.options", {campaign: deps.campaign, turn: deps.turn, limit: shipped.maxCandidates}) ?? {}) as Row; }
		catch (error) {
			if (deps.signal?.aborted) return null;
			await deps.record({...base, ok: false, reason: "options_failed", outcome: "stay", owed: null,
				code: (error as {code?: unknown})?.code ?? null, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)});
			return null;
		}
		if (deps.signal?.aborted) return null;
		// §190.2: the ledger already followed a delivery whose turn landed a move.
		const moved = landedMoves(read.moved);
		if (moved.length) { await deps.record({...base, ok: true, skipped: "move_landed", landed: moved.map(entry => entry.to)}); return null; }
		const {sentences, total} = toldSentences(deps.text);
		const candidates = (Array.isArray(read.candidates) ? read.candidates : []) as ToldCandidate[];
		if (!sentences.length) { await deps.record({...base, ok: true, skipped: "no_text"}); return null; }
		if (!candidates.length) { await deps.record({...base, ok: true, skipped: "no_candidates"}); return null; }
		const scene = (read.scene ?? {}) as Row;
		const input: ToldInput = {campaign: deps.campaign, turn: deps.turn, sentences, candidates,
			scene: {name: String(scene.name ?? ""), ...(scene.display_name ? {display_name: String(scene.display_name)} : {}), summary: String(scene.summary ?? "")}};
		const result = await ask(input, deps, began + shipped.timeoutMs);
		if (deps.signal?.aborted) return null;
		const decided = toldDecision(result, shipped, input.scene.name);
		let outcome = "stay", owed: string | null = null, dropped: Row = {};
		if (decided.decision === "owe" && mode !== "on") outcome = "shadow";
		else if (decided.decision === "owe" && !deps.signal?.aborted) {
			try {
				const answer = (await deps.call("table.owe", {campaign: deps.campaign, turn: deps.turn, effect: {kind: "move", to: decided.handle},
					quote: decided.quote, source: TOLD_POSITION_FAMILY}) ?? {}) as Row;
				owed = typeof answer.owed === "string" ? answer.owed : null;
				outcome = owed ? "owed" : "dropped";
				if (!owed) dropped = {dropped: String(answer.dropped ?? "unknown")};
			} catch (error) {
				outcome = "dropped";
				dropped = {dropped: "kernel_refused", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200)};
			}
		}
		await deps.record({...base, ok: result.status === "answered", candidates: candidates.map(candidate => candidate.name),
			sentences: {total, offered: sentences.length},
			...(result.status === "answered" ? {moved: result.moved, chosen: result.chosen, distribution: result.distribution, confidence: result.confidence,
				sentence: result.sentence ? {key: result.sentence.key, confidence: result.sentence.confidence, distribution: result.sentence.distribution} : null,
				usage: result.usage} : {reason: result.reason}),
			decision: decided.decision, ...(decided.decision === "owe" ? {handle: decided.handle} : {why: decided.why}),
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
 * The shipped budget as it is known synchronously: read once per process, warmed when this module loads (long before a
 * table delivers), so the close can decide at once whether the read is a flight to watch. Undefined only until then.
 */
let shippedKnown: ToldPositionBudget | undefined;
function knownBudget(): ToldPositionBudget | undefined {
	if (!shippedKnown) void toldPositionBudget().then(budget => { shippedKnown = budget; }, () => undefined);
	return shippedKnown;
}
knownBudget();

/**
 * Start the read of one delivery on a zero-delay timer the delivery never awaits. Answers the flight §158.4's watch reads
 * only when the read may owe -- the mode is `on` and Jev is configured -- and it settles only once `table.owe` wrote a
 * row, so a read that owes nothing never makes the next run read the table again; in `shadow` (the shipped mode), `off`
 * or without Jev nothing is registered. `ended` runs when the read is over, whatever it found.
 */
export function startToldPosition(deps: ToldPositionDeps, ended?: () => void): ReviewFlight | undefined {
	const mode = override(deps.env) ?? (deps.budget ?? knownBudget())?.mode;
	// `ended` runs once whatever happens, so a caller holding several reads' flight knows when all of them are over (§201.1).
	if (mode === "off") { ended?.(); return undefined; }
	let settle: (() => void) | undefined;
	const flight = mode === "on" && readJevApiKey(deps.env) ? {turn: deps.turn, done: new Promise<void>(resolve => { settle = resolve; })} : undefined;
	const timer = setTimeout(() => {
		void readToldPosition(deps).then(owed => { if (owed) settle?.(); }, () => undefined).finally(() => ended?.());
	}, 0);
	(timer as {unref?: () => void}).unref?.();
	return flight;
}
