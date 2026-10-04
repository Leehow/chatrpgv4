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
import { NAME_SPAN_AT, NAME_SPANS_FAMILY, NAME_SPANS_PER_BATCH, NAME_SPANS_WAIT_MS, judgeNameSpans, markSpan, nameSpanBindings, type NameSpan } from "../../runtime/jev/untold-name-spans.ts";

type Row = Record<string, unknown>;
/** The delivering methods whose `text` the gate reads. */
const DELIVERING = new Set(["table.narrate", "table.ask"]);

export interface PlaceJudgement { cleared: Array<{ name: string; nth: number }>; ms: number; asked: number; fallback?: string }

/** One request for a list of places; `null` when no place was judged (unconfigured, failed, late). */
export async function judgePlaces(spans: readonly NameSpan[], decision: DecisionPort | undefined, options: { campaign?: string; waitMs?: number; signal?: AbortSignal } = {}): Promise<{ names: number[] } | { fallback: string }> {
	if (!spans.length) return { names: [] };
	if (!decision) return { fallback: "unconfigured" };
	const startedAt = Date.now(), deadlineAt = startedAt + (options.waitMs ?? NAME_SPANS_WAIT_MS);
	const signal = AbortSignal.any([AbortSignal.timeout(deadlineAt - startedAt), ...(options.signal ? [options.signal] : [])]);
	const asked = spans.slice(0, NAME_SPANS_PER_BATCH);
	const lease = new TaskLease({ owner: NAME_SPANS_FAMILY, goal: "Judge whether each place a text writes an untold person's name is that name",
		...nameSpanBindings(asked, options.campaign), capabilities: ["decision"], signal,
		budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 60_000, remainingCostUsd: 0.02, remainingActions: 1 } });
	try {
		const judged = await judgeNameSpans(asked, decision, lease, options.campaign);
		if (judged.status !== "scored") return { fallback: judged.reason };
		return { names: [...judged.names, ...spans.slice(NAME_SPANS_PER_BATCH).map(() => 1)] };
	} catch (error) {
		return { fallback: signal.aborted ? "late" : error instanceof Error ? error.message : "unavailable" };
	} finally {
		lease.close();
	}
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
			names: judged.names.map(value => Math.round(value * 100) / 100), ms });
		return cleared.length ? { ...own, untold_cleared: cleared } : own;
	};
}
