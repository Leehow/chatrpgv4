/**
 * Contract §144.1: a field that carries another tool's argument, opened with the serialization's own label.
 *
 * `apply.narrate` carries what the narrate tool takes as `text` (§135.5.2 dispatches it as exactly that). On long
 * gates #22 and #23 the Keeper (grok-build/grok-4.5) wrote the name of the parameter it was filling at the head of
 * that value in 7 of 32 calls, and the provider returned it verbatim inside the function-call arguments:
 *
 *   "text intermediate<prose>"   "text interim<prose>"   "text<prose>"   "text"   "text thriftily-placeholder"
 *   "<the same name in the play language>|{{move:...}}<prose>"   "<the same name in the play language>::{{time}}<prose>"
 *
 * Six of them reached the player. Nothing here reads what the prose says or what language it is in: a label is the
 * carried parameter's declared name (plus one identifier-shaped tag) where it meets the end of the value, the
 * serialization's delimiter, or the value's own first character with no separator; or any run of letters that meets
 * the delimiter at once. The repair runs where the model's arguments enter the host (`prepareArguments`), after §144's
 * markup unwrapping, so a value that was only the label reaches the existing floor and kernel refusals as empty.
 */

/**
 * The fields that carry another tool's argument: field -> the carried parameter's declared name. The one embedding
 * the host dispatches (§135.5.2: `apply.narrate` runs as the narrate tool's `text`). A closed structural table, not a
 * vocabulary: its test pins each entry to a declared string field and a declared string parameter.
 */
export const EMBEDDED_ARGUMENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
	apply: Object.freeze({ narrate: "text" }),
});

export type PrefixStrip = { field: string; prefix: string };

/** One identifier-shaped tag after the name (`intermediate`, `interim`, `thriftily-placeholder`): the id grammar, not a list. */
const TAG = /[A-Za-z][A-Za-z0-9_-]*/y;
/** A leading run of letters, any script: the label spelled in the play language. Unicode properties, not a script test. */
const LETTERS = /^\p{L}[\p{L}\p{M}]*/u;
const DELIMITERS = ["::", "|"] as const;

const delimiterAt = (value: string, at: number) => DELIMITERS.find((delimiter) => value.startsWith(delimiter, at));

/**
 * The leading label of `value` when it is one (the text to remove, delimiter included), otherwise `undefined`.
 * `parameter` is the declared name of the parameter the value is serialized as.
 */
export function dialectPrefix(value: string, parameter: string): string | undefined {
	// (a) The carried parameter's own declared name, exactly as declared, and optionally one tag after a space.
	if (parameter && value.startsWith(parameter)) {
		let end = parameter.length;
		if (value[end] === " ") {
			TAG.lastIndex = end + 1;
			if (TAG.test(value)) end = TAG.lastIndex;
		}
		if (end === value.length) return value;
		const delimiter = delimiterAt(value, end);
		if (delimiter) return value.slice(0, end + delimiter.length);
		// No separator at all: the value's own first character, which no ASCII identifier continues, or a marker token.
		if (value.startsWith("{{", end) || value.charCodeAt(end) > 0x7f) return value.slice(0, end);
	}
	// (b) Any run of letters that meets the serialization's delimiter at once.
	const letters = LETTERS.exec(value);
	if (letters) {
		const delimiter = delimiterAt(value, letters[0].length);
		if (delimiter) return value.slice(0, letters[0].length + delimiter.length);
	}
	return undefined;
}

/**
 * Removes the leading label (and the whitespace after it) from every field of `tool` that carries another tool's
 * argument. Arguments with nothing to remove are returned as the same object.
 */
export function stripDialectPrefixes(tool: string, args: unknown): { args: unknown; strips: PrefixStrip[] } {
	const carried = EMBEDDED_ARGUMENTS[tool];
	if (!carried || !args || typeof args !== "object" || Array.isArray(args)) return { args, strips: [] };
	const input = args as Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	const strips: PrefixStrip[] = [];
	for (const [field, parameter] of Object.entries(carried)) {
		const value = input[field];
		if (typeof value !== "string") continue;
		const label = dialectPrefix(value, parameter);
		if (label === undefined) continue;
		const rest = value.slice(label.length).trimStart();
		(output ??= { ...input })[field] = rest;
		strips.push({ field, prefix: value.slice(0, value.length - rest.length) });
	}
	return { args: output ?? args, strips };
}

/** An empty optional carried argument requests no embedded delivery; an explicit text field is unchanged. */
export function omitEmptyEmbeddedArguments(tool: string, args: unknown): {args: unknown; fields: string[]} {
    const carried=EMBEDDED_ARGUMENTS[tool];
    if(!carried||!args||typeof args!=='object'||Array.isArray(args))return {args,fields:[]};
    const input=args as Record<string,unknown>,fields=Object.keys(carried).filter(field=>typeof input[field]==='string'&&!String(input[field]).trim());
    if(!fields.length)return {args,fields};
    const output={...input};for(const field of fields)delete output[field];
    return {args:output,fields};
}
