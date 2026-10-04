/**
 * Contract §177.15: before a delivery reaches the kernel, the places where its text writes an untold person's printed name are
 * asked of Jev, one Noul each: is it that name, or part of another word? The places judged to be another word go to the kernel
 * as `untold_cleared`, and §177.11's gate holds only the rest.
 *
 * Table 27 (turn 8): the Keeper wrote Dallas in Chinese, whose last two characters are a nickname the book prints for the
 * station owner. The gate refused it, and the second delivery replaced it with the owner's word in the player's prose.
 *
 * `untold_cleared` is the host's: whatever the Keeper's arguments carried under that key is dropped first. When Jev is not
 * configured, fails or is late, nothing is cleared and the gate stands exactly as before.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { NAME_SPAN_AT, NAME_SPANS_FAMILY, NAME_SPANS_PER_BATCH, NAME_SPANS_PER_CALL, NAME_SPANS_WAIT_MS, judgeNameSpans, markSpan, nameSpanBatch, nameSpanBindings, type NameSpan } from "../../runtime/jev/untold-name-spans.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";

type Row = Record<string, unknown>;
/** The delivering methods whose `text` the gate reads. */
const DELIVERING = new Set(["table.narrate", "table.ask"]);

/** One request's places, split in halves while the packer refuses them; a reason string for places nobody judged. */
async function judgeChunk(spans: readonly NameSpan[], decision: DecisionPort, campaign: string | undefined, deadlineAt: number, signal: AbortSignal): Promise<Array<number | string>> {
	try { packDecisionBatch(nameSpanBatch(spans, campaign)); }
	catch {
		if (spans.length < 2) return ["packing_limit"];
		const half = Math.ceil(spans.length / 2);
		return [...await judgeChunk(spans.slice(0, half), decision, campaign, deadlineAt, signal), ...await judgeChunk(spans.slice(half), decision, campaign, deadlineAt, signal)];
	}
	const lease = new TaskLease({ owner: NAME_SPANS_FAMILY, goal: "Judge whether each place a text writes an untold person's name is that name",
		...nameSpanBindings(spans, campaign), capabilities: ["decision"], signal,
		budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 60_000, remainingCostUsd: 0.02, remainingActions: 1 } });
	try {
		const judged = await judgeNameSpans(spans, decision, lease, campaign);
		return judged.status === "scored" ? judged.names : spans.map(() => judged.reason);
	} catch (error) {
		return spans.map(() => signal.aborted ? "late" : error instanceof Error ? error.message : "unavailable");
	} finally {
		lease.close();
	}
}

/**
 * The probability each place is the name, `NaN` for a place nobody judged (left as a name); `fallback` when none was judged.
 * Places go in requests of `NAME_SPANS_PER_BATCH`, in parallel, under one wait; past `NAME_SPANS_PER_CALL` they are names.
 */
export async function judgePlaces(spans: readonly NameSpan[], decision: DecisionPort | undefined, options: { campaign?: string; waitMs?: number; signal?: AbortSignal } = {}): Promise<{ names: number[]; partial?: string } | { fallback: string }> {
	if (!spans.length) return { names: [] };
	if (!decision) return { fallback: "unconfigured" };
	const startedAt = Date.now(), deadlineAt = startedAt + (options.waitMs ?? NAME_SPANS_WAIT_MS);
	const signal = AbortSignal.any([AbortSignal.timeout(deadlineAt - startedAt), ...(options.signal ? [options.signal] : [])]);
	const asked = spans.slice(0, NAME_SPANS_PER_CALL), chunks: NameSpan[][] = [];
	for (let at = 0; at < asked.length; at += NAME_SPANS_PER_BATCH) chunks.push(asked.slice(at, at + NAME_SPANS_PER_BATCH));
	const answers = (await Promise.all(chunks.map(chunk => judgeChunk(chunk, decision, options.campaign, deadlineAt, signal)))).flat();
	const reasons = answers.filter((value): value is string => typeof value === "string");
	if (reasons.length === answers.length) return { fallback: reasons[0] ?? "unavailable" };
	const names = [...answers.map(value => typeof value === "number" ? value : NaN), ...spans.slice(NAME_SPANS_PER_CALL).map(() => NaN)];
	return { names, ...(reasons.length || spans.length > NAME_SPANS_PER_CALL ? { partial: reasons[0] ?? "per_call_limit" } : {}) };
}

export function createUntoldSpanJudge(deps: { decision: () => DecisionPort | undefined; record: (row: Row) => void; waitMs?: number }) {
	/** `KernelClientOptions.prepareCall`: the delivering call's params with the host's `untold_cleared`. */
	return async function prepareCall(method: string, params: Row, direct: (method: string, params: Row) => Promise<unknown>): Promise<Row> {
		if (!DELIVERING.has(method)) return params;
		const { untold_cleared: _dropped, ...own } = params;
		const text = own.text;
		if (typeof text !== "string" || !text) return own;
		let spans: Array<{ name: string; nth: number; start: number; end: number }> = [];
		try {
			const answer = (await direct("table.untold_spans", { campaign: own.campaign, text })) as Row;
			spans = Array.isArray(answer?.spans) ? answer.spans as typeof spans : [];
		} catch {
			return own;
		}
		if (!spans.length) return own;
		const began = Date.now();
		const judged = await judgePlaces(spans.map(span => ({ name: span.name, text: markSpan(text, span.start, span.end) })), deps.decision(),
			{ campaign: typeof own.campaign === "string" ? own.campaign : undefined, waitMs: deps.waitMs });
		const ms = Date.now() - began;
		if ("fallback" in judged) {
			deps.record({ lane: "untold-spans", event: "fallback", method, places: spans.length, reason: judged.fallback, ms });
			return own;
		}
		const cleared = spans.filter((_span, i) => judged.names[i]! < NAME_SPAN_AT).map(span => ({ name: span.name, nth: span.nth }));
		deps.record({ lane: "untold-spans", event: "judged", method, places: spans.length, cleared: cleared.length,
			names: judged.names.map(value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null), ms, ...(judged.partial ? { partial: judged.partial } : {}) });
		return cleared.length ? { ...own, untold_cleared: cleared } : own;
	};
}
