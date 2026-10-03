/**
 * Contract §103.1 (owner ruling 2026-10-03): until a person's name has been said to the investigator, the Keeper's copy
 * of the capsule names them by this table's epithet, or by their handle, and keeps the book's name aside.
 *
 * §103 put `untold` beside each such person, but left `present[].name` as the book's name, the field the Keeper writes
 * from. On the installed App (2026-10-02) the Keeper named the station owner, the trucker and the veteran in the prose
 * on first sight, turn after turn, across three tables, before anyone had said a name ("Russell walked over with the
 * nozzle"). Asked to apply an epithet first, it did so once (the veteran) and then kept to it; everyone else it
 * named from `name`.
 *
 * Only the Keeper's copy changes: the raw capsule, the bus copy and every host reader still see the book's name. In this
 * view an untold person's row reads `name: <epithet or handle>`, and `untold.name` holds the book's name for the
 * moment someone in the scene says it. Tool calls and say tokens resolve the handle and the table's epithet as they
 * resolve the name (`ModuleGraph.nameKeys`, §87.8). The first-sight rows for the same people follow the same names.
 */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export const UNTOLD_VIEW_USE = "Nobody has said this person's name to the investigator: in prose they are who they look like. `name` is "
	+ "their handle or this table's epithet, for tool calls and say tokens; untold.name is what they are called, used only once someone in the scene says it.";

/** What each untold person is shown as in the Keeper's copy, by handle and by the book's name. */
export interface UntoldNames { byId: Map<string, string>; byName: Map<string, string> }

/** The Keeper's copy of `capsule` with untold people named by epithet or handle; the input is not changed. */
export function untoldView<T>(capsule: T): { capsule: T; names: UntoldNames } {
	const names: UntoldNames = { byId: new Map(), byName: new Map() };
	const source = object(capsule);
	if (!Array.isArray(source.present)) return { capsule, names };
	const present = (source.present as unknown[]).map((entry) => {
		const row = object(entry), untold = object(row.untold), name = text(row.name), id = text(untold.id);
		if (!Object.keys(untold).length || !name) return entry;
		const shown = text(object(row.called).name) || text(untold.label) || id;
		if (!shown || shown === name) return entry;
		names.byName.set(name, shown);
		if (id) names.byId.set(id, shown);
		const { name: _book, untold: _untold, ...rest } = row;
		return { name: shown, ...rest, untold: { name, ...(text(untold.label) ? { label: text(untold.label) } : {}), use: UNTOLD_VIEW_USE } };
	});
	if (!names.byName.size) return { capsule, names };
	const view: Row = { ...source, present };
	const sight = object(source.first_sight);
	if (Array.isArray(sight.people)) view.first_sight = { ...sight, people: firstSightPeople(sight.people, names) };
	return { capsule: view as T, names };
}

/** First-sight rows renamed the way the capsule's `present` was: by handle, else by the book's name. */
export function firstSightPeople(people: unknown[], names: UntoldNames): unknown[] {
	return people.map((entry) => {
		const row = object(entry), shown = names.byId.get(text(row.id)) ?? names.byName.get(text(row.name));
		return shown && Object.keys(row).length ? { ...row, name: shown } : entry;
	});
}
