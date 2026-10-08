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
 *
 * §194.5: the gate counts the people the delivery's own handouts tell as told, so the prose's places are found with every
 * document place telling. When a document place is cleared, its person stays untold and their names are places again: the
 * hook asks `table.untold_spans` once more with the document's clearances and judges the prose's places that answer gives.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { NAME_SPAN_AT, NAME_SPANS_FAMILY, NAME_SPANS_PER_BATCH, NAME_SPANS_PER_CALL, NAME_SPANS_WAIT_MS, judgeNameSpans, markSpan, nameSpanBatch, nameSpanBindings, type NameSpan } from "../../runtime/jev/untold-name-spans.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";

type Row = Record<string, unknown>;
type Span = { name: string; nth: number; start: number; end: number };
/** One place as Jev is asked about it: the name, its key, and its words marked; a document's place carries its handout. */
type Place = { name: string; nth: number; text: string; handout?: string };
/** The delivering methods whose `text` the gate reads. */
const DELIVERING = new Set(["table.narrate", "table.ask"]);
/** The params only this hook may set; the client drops them from a caller's params whenever the hook fails. */
export const UNTOLD_HOST_PARAMS: readonly string[] = ["untold_cleared"];

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
		const own = Object.fromEntries(Object.entries(params).filter(([key]) => !UNTOLD_HOST_PARAMS.includes(key)));
		// From here on every way out is `own`: a getter, a lease or a malformed answer that throws must not hand the client
		// back the caller's params, which may carry an `untold_cleared` the Keeper wrote itself.
		const note = (row: Row) => { try { deps.record(row); } catch { /* telemetry never decides the delivery */ } };
		try {
			// An ask may carry no text and still hand over a document (§194.3), whose places are asked about all the same.
			const text = typeof own.text === "string" ? own.text : "";
			const campaign = typeof own.campaign === "string" ? own.campaign : undefined;
			const spansOf = (answer: Row): Place[] => (Array.isArray(answer?.spans) ? answer.spans as Span[] : [])
				.map(span => ({ name: span.name, nth: span.nth, text: markSpan(text, span.start, span.end) }));
			let places: Place[] = [];
			try {
				const answer = (await direct("table.untold_spans", { campaign: own.campaign, text })) as Row;
				places = spansOf(answer);
				// §194.3: the documents this turn hands over, each place keyed by its handout and shown in the document's own words.
				for (const document of Array.isArray(answer?.documents) ? answer.documents as Row[] : []) {
					if (typeof document?.handout !== "string" || typeof document.text !== "string" || !Array.isArray(document.spans)) continue;
					const source = document.text, handout = document.handout;
					places.push(...(document.spans as Span[]).map(span => ({ name: span.name, nth: span.nth, handout, text: markSpan(source, span.start, span.end) })));
				}
			} catch {
				return own;
			}
			if (!places.length) return own;
			const began = Date.now();
			const judged = await judgePlaces(places.map(place => ({ name: place.name, text: place.text })), deps.decision(), { campaign, waitMs: deps.waitMs });
			const ms = Date.now() - began;
			const documentPlaces = places.filter(place => place.handout !== undefined).length;
			if ("fallback" in judged) {
				note({ lane: "untold-spans", event: "fallback", method, places: places.length, ...(documentPlaces ? { document_places: documentPlaces } : {}), reason: judged.fallback, ms });
				return own;
			}
			let cleared = places.filter((_place, i) => judged.names[i]! < NAME_SPAN_AT)
				.map(place => ({ name: place.name, nth: place.nth, ...(place.handout !== undefined ? { handout: place.handout } : {}) }));
			note({ lane: "untold-spans", event: "judged", method, places: places.length, ...(documentPlaces ? { document_places: documentPlaces } : {}), cleared: cleared.length,
				names: judged.names.map(value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null), ms, ...(judged.partial ? { partial: judged.partial } : {}) });
			// §194.5: the prose's places were found with every document place telling its person (the gate counts what the delivery's
			// own handouts tell as told). A document place cleared as another word tells nobody, so that person stays untold and
			// their names are places again: ask once more with the document's clearances, and judge the prose's places it gives.
			// Anything failing on the way sends only the document's clearances, so every prose place is held as a name.
			const documentCleared = cleared.filter(place => place.handout !== undefined);
			if (documentCleared.length) {
				let again: Place[];
				try { again = spansOf((await direct("table.untold_spans", { campaign: own.campaign, text, untold_cleared: documentCleared })) as Row); }
				catch { return { ...own, untold_cleared: documentCleared }; }
				cleared = documentCleared;
				if (again.length) {
					const second = await judgePlaces(again.map(place => ({ name: place.name, text: place.text })), deps.decision(), { campaign, waitMs: deps.waitMs });
					if ("fallback" in second) {
						note({ lane: "untold-spans", event: "fallback", method, round: 2, places: again.length, reason: second.fallback });
						return { ...own, untold_cleared: documentCleared };
					}
					cleared = [...documentCleared, ...again.filter((_place, i) => second.names[i]! < NAME_SPAN_AT).map(place => ({ name: place.name, nth: place.nth }))];
					note({ lane: "untold-spans", event: "judged", method, round: 2, places: again.length, cleared: cleared.length - documentCleared.length,
						names: second.names.map(value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null), ...(second.partial ? { partial: second.partial } : {}) });
				}
			}
			return cleared.length ? { ...own, untold_cleared: cleared } : own;
		} catch (error) {
			note({ lane: "untold-spans", event: "fallback", method, reason: "error", message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
			return own;
		}
	};
}
