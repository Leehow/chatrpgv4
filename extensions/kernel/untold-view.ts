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
 * view an untold person's row reads `name: <epithet or handle>`. Tool calls and say tokens resolve the handle and the
 * table's epithet as they resolve the name (`ModuleGraph.nameKeys`, §87.8). The first-sight rows for the same people
 * follow the same names.
 *
 * §103.8 (owner, 2026-10-03): the book's name is not in this view at all. It was kept in `untold.name` "for the moment
 * someone says it"; on table 20 the Keeper wrote it as the epithet and then into the prose. When the fiction has the name
 * said, the Keeper writes `{{name:<who>}}` and the kernel puts the book's name in at delivery (kernel-ts/write/names.ts).
 */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export const UNTOLD_VIEW_USE = "Nobody has said this person's name to the investigator, and you do not have it: in prose they are who they look like. "
	+ "`name` is this table's word for them, for tool calls and say tokens; keep it, apply person gives another only when the fiction does. When the fiction has their name said (they give it, "
	+ "someone calls them by it, a paper shows it), put `say_name` there exactly: the delivery puts in the name the book gives them.";

/**
 * §176.5 (spec Q4): the token that says an untold person's name, ready to copy. Neither model on table 21 wrote
 * `{{name:<who>}}` when it had to compose it; each made up a name from the handle instead. Since §176.8 the kernel's
 * untold block carries it (`nameToken`); this builds the same token for a block written before that.
 */
export const sayName = (shown: string): string => `{{name:${shown}}}`;

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
		// §176.8: the kernel's block carries the token on every projection, a budget stub included; the view keeps it.
		const token = text(untold.say_name) || sayName(shown);
		return { name: shown, ...rest, untold: { ...(text(untold.label) ? { label: text(untold.label) } : {}), say_name: token, use: UNTOLD_VIEW_USE } };
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

/** One row of the kernel's `table.untold`: the book's name, the handle, and what the Keeper's request shows instead. `handle`
 *  marks a row whose name is the person's handle or node id (machine text, renamed wherever it stands, §177.15). */
export interface UntoldPerson { name: string; id?: string; shown: string; handle?: boolean }

/** The kernel's `table.untold` answer as rows, dropping any row without both names. */
export function untoldPeople(answer: unknown): UntoldPerson[] {
	const people = object(answer).people;
	if (!Array.isArray(people)) return [];
	return people.flatMap((entry) => {
		const row = object(entry), name = text(row.name), shown = text(row.shown);
		return name && shown && name !== shown ? [{ name, shown, ...(text(row.id) ? { id: text(row.id) } : {}), ...(row.handle === true ? { handle: true } : {}) }] : [];
	});
}

/** A string's JSON-escaped body, so a name is found the same way inside a serialized payload and in plain text. */
const escaped = (value: string): string => JSON.stringify(value).slice(1, -1);

const latin = (char: string | undefined): boolean => !!char && /^[A-Za-z0-9]$/.test(char);

/** §177.15: one place a host message or tool result writes an untold person's name, as the rename finds it in `source`. */
export interface RenamePlace { source: string; start: number; end: number; person: UntoldPerson }
/** The places of `source`, longer names first where two overlap, a Latin name only where no Latin or digit run goes on past
 *  either end (the kernel's `occurs`, journal/naming.ts): "Arty" is not renamed inside "Party". */
function placesIn(source: string, ordered: readonly UntoldPerson[]): RenamePlace[] {
	const found: RenamePlace[] = [];
	for (const person of ordered) {
		const word = escaped(person.name);
		if (!word || !source.includes(word)) continue;
		for (let at = source.indexOf(word); at >= 0; at = source.indexOf(word, at + 1)) {
			if ((latin(word[0]) && latin(source[at - 1])) || (latin(word[word.length - 1]) && latin(source[at + word.length]))) continue;
			const end = at + word.length;
			if (!found.some(other => at < other.end && other.start < end)) found.push({ source, start: at, end, person });
		}
	}
	return found.sort((a, b) => a.start - b.start);
}

/** `source` with each place renamed to its person's word, but the places `keep` keeps (§177.15); the words used go in `shown`. */
function renameText(source: string, people: readonly UntoldPerson[], shown?: Set<string>, keep?: (place: RenamePlace) => boolean): string {
	let out = "", from = 0;
	for (const place of placesIn(source, people)) {
		if (keep?.(place)) continue;
		out += source.slice(from, place.start) + escaped(place.person.shown);
		from = place.end;
		shown?.add(place.person.shown);
	}
	return from ? out + source.slice(from) : source;
}

/**
 * §176.8: what a renamed tool result says after its own text. Replay of game-24bb66cb (2026-10-04, sequence U3, turn 5):
 * asked the veteran's name with his `say_name` in its capsule, the Keeper looked his name up in the book instead; the
 * excerpt came back with his name renamed to his word, read as a book that never names him, and the Keeper made one up.
 */
export function untoldNote(shown: readonly string[]): string {
	return "[untold names] People the investigator has not been told the name of are shown in this result by this table's word for them; "
		+ "the book does name them, and you do not have it. Where the fiction has one of those names said, write that person's say_name there: "
		+ `${shown.map(sayName).join(", ")}.`;
}

/** The text parts the rename reads: host messages and tool results, never the player's words or the Keeper's own. */
function renamedParts(message: unknown): string[] {
	const row = object(message);
	if (row.role !== "custom" && row.role !== "toolResult") return [];
	if (typeof row.content === "string") return [row.content];
	return Array.isArray(row.content) ? row.content.flatMap((part) => { const piece = object(part); return piece.type === "text" && typeof piece.text === "string" ? [piece.text] : []; }) : [];
}

/** §177.15: every place `renameUntold` would rename in `messages`, so the host can ask which are the name. */
export function renamePlaces(messages: readonly unknown[], people: readonly UntoldPerson[]): RenamePlace[] {
	if (!people.length) return [];
	const ordered = [...people].sort((a, b) => b.name.length - a.name.length);
	return messages.flatMap((message) => renamedParts(message).flatMap((part) => placesIn(part, ordered)));
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
export function renameUntold<T>(messages: readonly T[], people: readonly UntoldPerson[], keep?: (place: RenamePlace) => boolean): T[] {
	if (!people.length) return [...messages];
	const ordered = [...people].sort((a, b) => b.name.length - a.name.length);
	return messages.map((message) => {
		const row = object(message);
		if (row.role !== "custom" && row.role !== "toolResult") return message;
		// §176.8: a tool result that had a name renamed says so, with the tokens; host messages are JSON the Keeper's view
		// already carries the tokens in, and are renamed only.
		const shown = row.role === "toolResult" ? new Set<string>() : undefined;
		const content = row.content;
		if (typeof content === "string") {
			const renamed = renameText(content, ordered, shown, keep);
			if (renamed === content) return message;
			return { ...row, content: shown?.size ? `${renamed}\n\n${untoldNote([...shown])}` : renamed } as T;
		}
		if (!Array.isArray(content)) return message;
		let changed = false;
		const parts = content.map((part) => {
			const piece = object(part);
			if (piece.type !== "text" || typeof piece.text !== "string") return part;
			const renamed = renameText(piece.text, ordered, shown, keep);
			if (renamed === piece.text) return part;
			changed = true;
			return { ...piece, text: renamed };
		});
		if (!changed) return message;
		return { ...row, content: shown?.size ? [...parts, { type: "text", text: untoldNote([...shown]) }] : parts } as T;
	});
}
