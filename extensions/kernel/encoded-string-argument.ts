/**
 * Contract §160: a Keeper tool string argument that arrives as a JSON string literal.
 *
 * The provider hands the call's arguments over as JSON, so a string argument is already decoded once when it reaches
 * the host. On 2026-09-30 grok-build/grok-4.7-build-fast twice serialized `apply.narrate` a second time inside that
 * JSON, and the value the host received was itself a quoted, escaped literal:
 *
 *   narrate: "\"\\u4e00\\u4e5d\\u4e8c\\u3007\\u5e74\\u79cb\\uff0c…\\n\\n…{{say:\\u53f2…}}…\""
 *
 * The player read the quotes and the escapes, and so did every reader after it (the speech rows, `recent`, the memory
 * job). Everything here is format: a value is decoded when, trimmed, it is one complete JSON string literal and
 * decoding it consumed at least one escape. Outer quotes alone are not enough, since a whole value can be one quoted
 * line. Nothing reads what the text says or what language it is in. The repair runs where the model's arguments enter
 * the host (the Keeper tools' `prepareArguments`), after §144's markup unwrapping and before §144.1's label strip.
 */
import type { TSchema } from "typebox";

export type StringDecode = { field: string; layers: number };

type Schema = { type?: unknown; properties?: Record<string, Schema> };

/** The text `value` encodes when it is a JSON string literal whose decoding consumed an escape, otherwise `undefined`. */
export function decodedStringLiteral(value: string): string | undefined {
	const text = value.trim();
	if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return undefined;
	let decoded: unknown;
	try {
		decoded = JSON.parse(text);
	} catch {
		return undefined;
	}
	// Every escape shortens the text, so an unchanged interior means only the two quotes were removed.
	return typeof decoded === "string" && decoded !== text.slice(1, -1) ? decoded : undefined;
}

/**
 * Decodes every declared string parameter of the call whose value is such a literal, as many times as it was
 * serialized. Arguments with nothing to decode are returned as the same object.
 */
export function decodeStringLiterals(parameters: TSchema, args: unknown): { args: unknown; decodes: StringDecode[] } {
	if (!args || typeof args !== "object" || Array.isArray(args)) return { args, decodes: [] };
	const properties = ((parameters as Schema).properties ?? {}) as Record<string, Schema>;
	const input = args as Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	const decodes: StringDecode[] = [];
	for (const [field, declared] of Object.entries(properties)) {
		if (declared?.type !== "string" || typeof input[field] !== "string") continue;
		let value = input[field] as string, layers = 0;
		for (let next = decodedStringLiteral(value); next !== undefined; next = decodedStringLiteral(value)) {
			value = next;
			layers += 1;
		}
		if (!layers) continue;
		(output ??= { ...input })[field] = value;
		decodes.push({ field, layers });
	}
	return { args: output ?? args, decodes };
}
