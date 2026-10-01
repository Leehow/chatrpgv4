/**
 * Contracts §160 and §160.1: a Keeper tool string argument that carries its own JSON serialization, whole or in part.
 *
 * The provider hands the call's arguments over as JSON, so a string argument is already decoded once when it reaches
 * the host. Some calls carried the serialization a second time inside that JSON, and the player read it as written:
 *
 *   literal   narrate: "\"\\u4e00\\u4e5d…\\n\\n…\""          the whole JSON string literal (§160)
 *   envelope  narrate: "{\"text\": \"…\\n\\n…\"}"            the carried tool's arguments object around the literal,
 *             narrate: "text\":\"…\""   narrate: "\"…\"}}"  or a head or the closers of that object (§160.1)
 *   body      text: "…\\n\\n…"                               the literal's body, without its quotes (§160.1)
 *
 * Everything here is the JSON grammar, anchored on names the tool's schema declares; nothing reads what the text says
 * or what language it is in. The evidence a value was serialized is syntax prose sent as an argument does not carry:
 * an escape the decoding consumed, a declared key followed by `":`, or the object's closing brace beside such an
 * escape. Outer quotes alone are not enough, since a whole value can be one quoted line. The repair runs where the
 * model's arguments enter the host (the Keeper tools' `prepareArguments`), after §144's markup unwrapping and before
 * §144.1's label strip.
 */
import type { TSchema } from "typebox";
import { EMBEDDED_ARGUMENTS } from "./dialect-prefix.ts";

export type SerializedShape = "literal" | "envelope" | "body";
export type StringDecode = { field: string; layers: number; shapes: SerializedShape[] };

type Schema = { type?: unknown; properties?: Record<string, Schema> };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parsedString(text: string): string | undefined {
	try {
		const decoded: unknown = JSON.parse(text);
		return typeof decoded === "string" ? decoded : undefined;
	} catch {
		return undefined;
	}
}

/** The text `value` encodes when it is a JSON string literal whose decoding consumed an escape, otherwise `undefined`. */
export function decodedStringLiteral(value: string): string | undefined {
	const text = value.trim();
	if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return undefined;
	const decoded = parsedString(text);
	// Every escape shortens the text, so an unchanged interior means only the two quotes were removed.
	return decoded !== undefined && decoded !== text.slice(1, -1) ? decoded : undefined;
}

/**
 * The text a value encodes when it is the literal with part of its arguments object still around it: a head naming one
 * of `keys` (`{"K":`, `"K":`, `K":`), the closing braces of the objects it sat in (`}`, `}}` for `arguments` inside a
 * `{name, arguments}` envelope), or both. Braces alone need an escape the decoding consumed.
 */
export function decodedEnvelope(value: string, keys: readonly string[]): string | undefined {
	const text = value.trim();
	const head = keys.length ? new RegExp(`^(?:\\{\\s*)?"?(?:${keys.map(escape).join("|")})"\\s*:\\s*`).exec(text) : null;
	let rest = head ? text.slice(head[0].length) : text;
	const tail = /\s*\}(?:\s*\})*$/.exec(rest);
	if (tail) rest = rest.slice(0, tail.index);
	if (!head && !tail) return undefined;
	if (rest.length < 2 || !rest.startsWith('"') || !rest.endsWith('"')) return undefined;
	const decoded = parsedString(rest);
	if (decoded === undefined) return undefined;
	return head || decoded !== rest.slice(1, -1) ? decoded : undefined;
}

/**
 * The text a value encodes when it is a JSON string's body without its quotes and carries an escape. JSON forbids a raw
 * control character inside a string, so a value with a real line break never parses as a body.
 */
export function decodedStringBody(value: string): string | undefined {
	if (!value.includes("\\")) return undefined;
	return parsedString(`"${value}"`);
}

function decodedOnce(value: string, keys: readonly string[]): { text: string; shape: SerializedShape } | undefined {
	const literal = decodedStringLiteral(value);
	if (literal !== undefined) return { text: literal, shape: "literal" };
	const envelope = decodedEnvelope(value, keys);
	if (envelope !== undefined) return { text: envelope, shape: "envelope" };
	const body = decodedStringBody(value);
	if (body !== undefined) return { text: body, shape: "body" };
	return undefined;
}

/**
 * Decodes every declared string parameter of `tool`'s call that carries its own serialization, as many times as it
 * was serialized. Arguments with nothing to decode are returned as the same object.
 */
export function decodeSerializedStrings(tool: string, parameters: TSchema, args: unknown): { args: unknown; decodes: StringDecode[] } {
	if (!args || typeof args !== "object" || Array.isArray(args)) return { args, decodes: [] };
	const properties = ((parameters as Schema).properties ?? {}) as Record<string, Schema>;
	const input = args as Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	const decodes: StringDecode[] = [];
	for (const [field, declared] of Object.entries(properties)) {
		if (declared?.type !== "string" || typeof input[field] !== "string") continue;
		// The envelope's key: the field's own name, or the parameter it carries for another tool (§144.1).
		const carried = EMBEDDED_ARGUMENTS[tool]?.[field];
		const keys = carried ? [field, carried] : [field];
		let value = input[field] as string;
		const shapes: SerializedShape[] = [];
		for (let next = decodedOnce(value, keys); next; next = decodedOnce(value, keys)) {
			value = next.text;
			shapes.push(next.shape);
		}
		if (!shapes.length) continue;
		(output ??= { ...input })[field] = value;
		decodes.push({ field, layers: shapes.length, shapes });
	}
	return { args: output ?? args, decodes };
}
