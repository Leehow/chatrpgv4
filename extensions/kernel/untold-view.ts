/**
 * Contract §103.5 (owner ruling 2026-10-03): until a person's name has been said to the investigator, the Keeper's copy
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

/** One row of the kernel's `table.untold`: the book's name, the handle, and what the Keeper's request shows instead. */
export interface UntoldPerson { name: string; id?: string; shown: string }

/** The kernel's `table.untold` answer as rows, dropping any row without both names. */
export function untoldPeople(answer: unknown): UntoldPerson[] {
	const people = object(answer).people;
	if (!Array.isArray(people)) return [];
	return people.flatMap((entry) => {
		const row = object(entry), name = text(row.name), shown = text(row.shown);
		return name && shown && name !== shown ? [{ name, shown, ...(text(row.id) ? { id: text(row.id) } : {}) }] : [];
	});
}

/** A string's JSON-escaped body, so a name is found the same way inside a serialized payload and in plain text. */
const escaped = (value: string): string => JSON.stringify(value).slice(1, -1);

const latin = (char: string | undefined): boolean => !!char && /^[A-Za-z0-9]$/.test(char);

/** Every occurrence of `word` replaced, except where a Latin or digit run goes on past either end (the kernel's
 *  `occurs`, journal/naming.ts): "Arty" is not renamed inside "Party". */
function replaceWord(text: string, word: string, by: string): string {
	let out = "", from = 0;
	for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
		if (at < from) continue;
		if ((latin(word[0]) && latin(text[at - 1])) || (latin(word[word.length - 1]) && latin(text[at + word.length]))) continue;
		out += text.slice(from, at) + by;
		from = at + word.length;
	}
	return out + text.slice(from);
}

function renameText(source: string, people: readonly UntoldPerson[]): string {
	let out = source;
	const kept: string[] = [];
	for (const person of people) {
		const name = escaped(person.name);
		if (!out.includes(name)) continue;
		// The capsule's `untold.name` is the one seat the book's name keeps (untoldView): it is what the person is called
		// once someone in the scene says it.
		const seat = `"untold":{"name":"${name}"`;
		out = out.split(seat).join(`\u0000${kept.push(seat) - 1}\u0000`);
		out = replaceWord(out, name, escaped(person.shown));
	}
	return kept.length ? out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)]) : out;
}

/**
 * Contract §103.5: the Keeper's request with every untold person's book name replaced by what the Keeper's copy shows
 * (this table's word for them, else the handle), in everything the host and the kernel wrote into it: host messages
 * (`role: "custom"`) and tool results. The player's words and the Keeper's own prose are left alone.
 *
 * The capsule was not the only way a name arrived. On the installed App (2026-10-03, Blood Road, turn 1) the clerk moved
 * the table into the gas station before the Keeper's first call; the station's people reached the Keeper in the clerk's
 * note, with the book's names, and on turn 2 the Keeper wrote "Russell" into the prose. A list of message kinds to
 * rename would miss the next kind; the request is where they all meet. Input messages are not changed.
 */
export function renameUntold<T>(messages: readonly T[], people: readonly UntoldPerson[]): T[] {
	if (!people.length) return [...messages];
	const ordered = [...people].sort((a, b) => b.name.length - a.name.length);
	return messages.map((message) => {
		const row = object(message);
		if (row.role !== "custom" && row.role !== "toolResult") return message;
		const content = row.content;
		if (typeof content === "string") {
			const renamed = renameText(content, ordered);
			return renamed === content ? message : { ...row, content: renamed } as T;
		}
		if (!Array.isArray(content)) return message;
		let changed = false;
		const parts = content.map((part) => {
			const piece = object(part);
			if (piece.type !== "text" || typeof piece.text !== "string") return part;
			const renamed = renameText(piece.text, ordered);
			if (renamed === piece.text) return part;
			changed = true;
			return { ...piece, text: renamed };
		});
		return changed ? { ...row, content: parts } as T : message;
	});
}
