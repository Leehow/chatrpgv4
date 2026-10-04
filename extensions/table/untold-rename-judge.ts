/**
 * Contract §177.15: the request's rename (§103.5) asks, once per place, whether a place where a host message or tool result
 * writes an untold person's name is that name or part of another word. Table 27 (turn 8): a source excerpt and the gate's own
 * refusal wrote Dallas in Chinese, whose last two characters are the station owner's printed nickname, and the Keeper was
 * shown the owner's word in the middle of a city.
 *
 * A decision is made once and kept: a place renamed in one request stays renamed in every later one, so the request's prefix
 * does not change under the provider's cache (§184.2). A place Jev did not judge in time, or could not, is renamed. Handle rows
 * are machine text and are never asked about.
 */
import { createHash } from "node:crypto";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { NAME_SPAN_AT, markSpan } from "../../runtime/jev/untold-name-spans.ts";
import { judgePlaces } from "../kernel/untold-spans.ts";
import { renamePlaces, type RenamePlace, type UntoldPerson } from "../kernel/untold-view.ts";

type Row = Record<string, unknown>;

export function createRenameJudge(deps: { decision: () => DecisionPort | undefined; record: (row: Row) => void; waitMs?: number }) {
	/** Place key to whether it is kept as written. */
	const decided = new Map<string, boolean>();
	const digests = new Map<string, string>();
	const digest = (source: string): string => {
		let value = digests.get(source);
		if (!value) { value = createHash("sha256").update(source).digest("hex"); digests.set(source, value); }
		return value;
	};
	const keyOf = (place: RenamePlace): string => `${digest(place.source)}:${place.start}:${place.person.name}`;
	return {
		/** Judge the places of `messages` not decided yet; returns when they are decided, by Jev or by the fallback. */
		async prepare(messages: readonly unknown[], people: readonly UntoldPerson[], campaign?: string): Promise<void> {
			const fresh = new Map<string, RenamePlace>();
			for (const place of renamePlaces(messages, people)) {
				if (place.person.handle) continue;
				const key = keyOf(place);
				if (!decided.has(key) && !fresh.has(key)) fresh.set(key, place);
			}
			if (!fresh.size) return;
			const places = [...fresh.entries()], began = Date.now();
			const judged = await judgePlaces(places.map(([, place]) => ({ name: place.source.slice(place.start, place.end), text: markSpan(place.source, place.start, place.end) })),
				deps.decision(), { campaign, waitMs: deps.waitMs });
			if ("fallback" in judged) {
				for (const [key] of places) decided.set(key, false);
				deps.record({ lane: "untold-spans", event: "fallback", method: "request", places: places.length, reason: judged.fallback, ms: Date.now() - began });
				return;
			}
			// A place nobody judged (NaN) is renamed.
			places.forEach(([key], i) => decided.set(key, judged.names[i]! < NAME_SPAN_AT));
			deps.record({ lane: "untold-spans", event: "judged", method: "request", places: places.length,
				kept: judged.names.filter(value => value < NAME_SPAN_AT).length, ms: Date.now() - began, ...(judged.partial ? { partial: judged.partial } : {}) });
		},
		/** Whether a place stays as written: only a place Jev judged to be part of another word. */
		keep: (place: RenamePlace): boolean => !place.person.handle && decided.get(keyOf(place)) === true,
		clear(): void { decided.clear(); digests.clear(); },
	};
}
