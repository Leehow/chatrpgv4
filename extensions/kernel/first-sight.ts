/**
 * Contract §168.5: the host's half of first sight -- which items a turn's capsule handed the Keeper, the check of a
 * delivery against them, and what the Keeper is handed while a check is still running.
 *
 * The check runs after the delivery and is watched, never waited for (as §158.4's owed review): it lands through
 * `table.first_sight` whenever it finishes, and every capsule read after that reads its result. While an item's check
 * is in flight, that item is left out of the `first_sight` section the Keeper is handed, so the next turn does not
 * describe it a second time; it comes back at the next read if the check found it unshown.
 *
 * Leaving an in-flight item out is the one change the host makes to a kernel section (§13.9 otherwise forbids any):
 * a capsule with nothing in flight is handed over as the very object the kernel returned.
 */
import type { FirstSightItem } from "../../runtime/jev/first-sight.ts";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const itemKey = (kind: string, id: string): string => `${kind}:${id}`;

/** The text an item is checked against: its book words, or the excerpts an earlier check found unshown. */
function described(entry: Row): string {
	if (typeof entry.described === "string") return entry.described;
	return Array.isArray(entry.missing) ? entry.missing.filter((value): value is string => typeof value === "string" && value !== "").join("\n") : "";
}

/** A capsule's `first_sight` section as the check reads it: the place first, then each person. */
export function firstSightItems(section: unknown): FirstSightItem[] {
	const value = object(section), entries: Array<[FirstSightItem["kind"], Row]> = [
		...(value.place ? [["place", object(value.place)] as [FirstSightItem["kind"], Row]] : []),
		...(Array.isArray(value.people) ? value.people.map(person => ["person", object(person)] as [FirstSightItem["kind"], Row]) : []),
	];
	return entries.flatMap(([kind, entry]) => {
		const id = typeof entry.id === "string" ? entry.id : "", text = described(entry);
		return id && text ? [{ id, kind, described: text }] : [];
	});
}

/** The capsule without the `first_sight` items in `omit`; the same object when there is nothing to leave out. */
export function withoutFirstSight<T>(capsule: T, omit: ReadonlySet<string>): { capsule: T; omitted: string[] } {
	const section = object(object(capsule).first_sight);
	if (!omit.size || !Object.keys(section).length) return { capsule, omitted: [] };
	const place = object(section.place), placeOut = typeof place.id === "string" && omit.has(itemKey("place", place.id));
	const people = Array.isArray(section.people) ? section.people : [];
	const kept = people.filter(person => !(typeof object(person).id === "string" && omit.has(itemKey("person", String(object(person).id)))));
	const omitted = [...(placeOut ? [itemKey("place", String(place.id))] : []),
		...people.filter(person => !kept.includes(person)).map(person => itemKey("person", String(object(person).id)))];
	if (!omitted.length) return { capsule, omitted };
	const next: Row = { ...(placeOut || !section.place ? {} : { place: section.place }), ...(kept.length ? { people: kept } : {}) };
	const view: Row = {};
	// The section keeps its seat before `present`; an emptied one is left out, as the kernel leaves it out.
	for (const [key, value] of Object.entries(object(capsule))) {
		if (key !== "first_sight") view[key] = value;
		else if (Object.keys(next).length) view[key] = next;
	}
	return { capsule: view as T, omitted };
}

export interface FirstSightFlight { turn: number; keys: ReadonlySet<string>; done: Promise<void> }

/**
 * One table's first-sight bookkeeping: the items each turn's capsule handed the Keeper (noted as the capsule is handed
 * over), and the checks in flight. The check itself and the kernel call are the caller's (`start`).
 */
export function createFirstSightTracker() {
	const carried = new Map<number, Map<string, FirstSightItem>>();
	const flights = new Set<FirstSightFlight>();
	const inFlight = (): Set<string> => new Set([...flights].flatMap(flight => [...flight.keys]));
	return {
		inFlight,
		/**
		 * What the Keeper is handed for `turn`: the capsule without the items whose check is in flight. What it still
		 * carries is noted as carried on that turn, the latest text of each item kept.
		 */
		view<T>(capsule: T, turn: number): { capsule: T; omitted: string[] } {
			const result = withoutFirstSight(capsule, inFlight());
			const items = firstSightItems(object(result.capsule).first_sight);
			if (items.length) {
				const noted = carried.get(turn) ?? new Map<string, FirstSightItem>();
				for (const item of items) noted.set(itemKey(item.kind, item.id), item);
				carried.set(turn, noted);
			}
			for (const known of carried.keys()) if (known < turn - 1) carried.delete(known);
			return result;
		},
		/** The items `turn`'s capsule carried, and forget them: a delivery is checked once. */
		take(turn: number): FirstSightItem[] {
			const items = [...(carried.get(turn)?.values() ?? [])];
			carried.delete(turn);
			return items;
		},
		/** Track `run` (never awaited by the delivery) as the check of `items`; they are in flight until it settles. */
		start(turn: number, items: readonly FirstSightItem[], run: () => Promise<void>): FirstSightFlight {
			let settle!: () => void;
			const flight: FirstSightFlight = { turn, keys: new Set(items.map(item => itemKey(item.kind, item.id))),
				done: new Promise<void>(resolve => { settle = resolve; }) };
			flights.add(flight);
			const timer = setTimeout(() => {
				void run().catch(() => undefined).finally(() => { flights.delete(flight); settle(); });
			}, 0);
			timer.unref?.();
			return flight;
		},
	};
}
export type FirstSightTracker = ReturnType<typeof createFirstSightTracker>;
