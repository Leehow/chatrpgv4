/**
 * Contract §198.3: the people a reference book places in its opening scene are judged before the opening is narrated. Such a
 * book seats nobody at creation (§149.1: a `present-in` edge can carry a conditional or later appearance), and its offer
 * (§187.3) is judged on a later turn's route -- after the opening has already told the player who is there. On TR-F2 run 2
 * (Cold Harvest) the opening's text put Captain Aganin behind the desk, `present` was empty and the Keeper narrated an
 * empty room.
 *
 * When the table opens with the opening still owed, `table.open` lists those people (`opening_people`: the opening scene with
 * the book's text for it, each person with their card and the scene that places them). The host asks Jev one Noul per
 * person (`runtime/jev/opening-presence.ts`) and seats those at or above the bar with one `table.apply` -- the opening admits a
 * seat and nothing else of the kind. Jev unconfigured, failing or late seats nobody: the opening goes on, with the offer and
 * the Keeper's own `apply npc` as the roads. One telemetry row either way.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { OPENING_PRESENCE_AT, OPENING_PRESENCE_FAMILY, OPENING_PRESENCE_PER_BATCH, OPENING_PRESENCE_WAIT_MS, judgeOpeningPresence,
	openingPresenceBindings, type OpeningPerson, type OpeningScene } from "../../runtime/jev/opening-presence.ts";

type Row = Record<string, unknown>;
type Call = (method: string, params: Row) => Promise<unknown>;
/** The seat's `why`, the kernel's own sentence: the receipt says the book placed them, not that anyone arrived. */
export const OPENING_SEAT_WHY = "The book places them in the opening scene as play starts.";

interface Listed { name: string; person: OpeningPerson }
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

/** `table.open`'s `opening_people`: the scene and the people, each with the handle to seat them by; null when it lists nobody. */
export function openingPeopleOf(open: unknown): { scene: OpeningScene; people: Listed[] } | null {
	const view = object(object(open).opening_people), scene = object(view.scene);
	const people = (Array.isArray(view.people) ? view.people : []).map(object).flatMap((row): Listed[] => {
		const name = text(row.name);
		if (!name) return [];
		const placed = object(row.placed_by);
		return [{ name, person: { name: text(row.display_name) || name, ...(text(row.summary) ? { summary: text(row.summary) } : {}),
			...(row.conditions !== undefined ? { conditions: row.conditions as OpeningPerson["conditions"] } : {}),
			...(text(placed.name) ? { placed_by: { name: text(placed.name), ...(text(placed.summary) ? { summary: text(placed.summary) } : {}) } } : {}) } }];
	});
	if (!people.length) return null;
	return { scene: { name: text(scene.display_name) || text(scene.name), text: text(scene.text) }, people };
}

/** Each person's probability of being there as play opens, or a reason string where nobody answered; parts in parallel under one wait. */
async function judge(scene: OpeningScene, people: readonly OpeningPerson[], decision: DecisionPort, campaign: string, waitMs: number): Promise<Array<number | string>> {
	const deadlineAt = Date.now() + waitMs, signal = AbortSignal.timeout(waitMs), parts: OpeningPerson[][] = [];
	for (let at = 0; at < people.length; at += OPENING_PRESENCE_PER_BATCH) parts.push(people.slice(at, at + OPENING_PRESENCE_PER_BATCH));
	return (await Promise.all(parts.map(async part => {
		const lease = new TaskLease({ owner: OPENING_PRESENCE_FAMILY, goal: "Judge whether each person the book links to the opening scene is there as play starts",
			...openingPresenceBindings(scene, part, campaign), capabilities: ["decision"], signal,
			budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 30_000, remainingCostUsd: 0.02, remainingActions: 1 } });
		try {
			const judged = await judgeOpeningPresence(scene, part, decision, lease, campaign);
			return judged.status === "scored" ? judged.present : part.map(() => judged.reason);
		} catch (error) {
			return part.map(() => signal.aborted ? "late" : error instanceof Error ? error.message : "unavailable");
		} finally {
			lease.close();
		}
	}))).flat();
}

export interface OpeningSeatDeps {
	campaign: string;
	/** `table.open`'s result. */
	open: unknown;
	call: Call;
	decision: () => DecisionPort | undefined;
	/** The table's own call ordinal, so the seat is one of the opening's calls and the Keeper's next call mints after it. */
	mintCallId: () => string;
	record: (row: Row) => void;
	waitMs?: number;
}

/** Judge the opening's people and seat the ones Jev puts there; the handles seated. Never throws. */
export async function seatOpeningPeople(deps: OpeningSeatDeps): Promise<string[]> {
	const listed = openingPeopleOf(deps.open);
	if (!listed) return [];
	const note = (row: Row) => { try { deps.record({ lane: "opening-presence", people: listed.people.length, ...row }); } catch { /* telemetry decides nothing */ } };
	let decision: DecisionPort | undefined;
	try { decision = deps.decision(); } catch { decision = undefined; }
	if (!decision) { note({ event: "fallback", reason: "no_jev" }); return []; }
	const began = Date.now();
	const answers = await judge(listed.scene, listed.people.map(entry => entry.person), decision, deps.campaign, deps.waitMs ?? OPENING_PRESENCE_WAIT_MS);
	const ms = Date.now() - began, nouls = answers.map(value => typeof value === "number" ? Math.round(value * 100) / 100 : null);
	const reasons = answers.filter((value): value is string => typeof value === "string");
	if (reasons.length === answers.length) { note({ event: "fallback", reason: reasons[0] ?? "unavailable", ms }); return []; }
	const chosen = listed.people.filter((_entry, index) => typeof answers[index] === "number" && (answers[index] as number) >= OPENING_PRESENCE_AT).map(entry => entry.name);
	const report = { names: listed.people.map(entry => entry.name), nouls, ms, ...(reasons.length ? { partial: reasons[0] } : {}) };
	if (!chosen.length) { note({ event: "seated", seated: [], ...report }); return []; }
	try {
		await deps.call("table.apply", { campaign: deps.campaign, call_id: deps.mintCallId(),
			effects: chosen.map(name => ({ kind: "npc", name, to: "here", why: OPENING_SEAT_WHY })) });
	} catch (error) {
		const detail = object(object(error).details);
		note({ event: "fallback", reason: "seat_refused", code: text(object(error).code) || null, detail: text(detail.reason) || null, ...report });
		return [];
	}
	note({ event: "seated", seated: chosen, ...report });
	return chosen;
}
