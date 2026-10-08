/**
 * Contract §154 (prototype, 2026-09-29): lean `apply` arguments behind `PI_COC_LEAN_APPLY=1`.
 *
 * Measured the same day: the Keeper spends more output on `apply` arguments than on prose, and the player waits for
 * every token of it. Much of it is read by nobody (a `why` the kernel files on a receipt no projection shows), or
 * repeats what the kernel already derives (`object.definition` equal to `name`, `define.category` item), or
 * double-books what another effect already did (a `time` effect for the journey a `move` already put on the clock).
 *
 * The flag changes what the Keeper is told, never what the tool accepts: the schema's shape (types, required fields,
 * bounds) is the ordinary one, byte for byte, and only descriptions of the fields below differ. What the Keeper then
 * leaves out is either audit-only or derived where it is read (the kernel's own `definition ?? name`, `category ??
 * item`, and -- with the host's `_lean` on `table.apply` -- the origin line of a person established without a `why`).
 * Every `why` a projection, the NPC act lane or the obligation ledger reads is still asked for, by name.
 *
 * Unset or any value other than `1` is today's behaviour: the ordinary `COC_TOOLS` are registered and no `table.apply`
 * carries `_lean`.
 */

import type { CocToolSpec } from "./tools.ts";
import { SENTENCE_MAX } from "./tools.ts";

export const LEAN_APPLY_ENV = "PI_COC_LEAN_APPLY";

/**
 * Whether this process runs with lean `apply` arguments. On by default since 2026-09-29 (user: merge
 * to the mainline, on by default): only an explicit `0` turns it off, kept as the operator's escape hatch.
 */
export function leanApplyEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
	return env[LEAN_APPLY_ENV]?.trim() !== "0";
}

const sentence = (text: string) => `${text}; one sentence, at most ${SENTENCE_MAX} characters`;

/**
 * What the Keeper is told instead, per effect kind and field (`kind` is the effect's own kind property). A string
 * replaces the field's description; `{append}` keeps the ordinary description and adds to it. Closed and keyed by
 * schema field names: nothing here reads the Keeper's words.
 */
export const LEAN_FIELD_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string | { append: string }>>>> = Object.freeze({
	time: {
		why: sentence("leave it out: nothing reads it back (the receipt keeps the minutes)"),
	},
	person: {
		name: { append: ". A word already recorded for them is not sent again" },
		why: sentence("leave it out: nothing reads it back"),
	},
	npc: {
		why: sentence("required with defense, action or disposition; keep it with stance, skill, conditions, dead, walk_on or intent_outcome abandoned (you and their own next act read it back); leave it out when the effect only moves them (to), reports a done result or writes a mood (the line is its own reason)"),
	},
	object: {
		definition: "Accepted definition name when first placing the instance; leave it out when it is the same as name (the kernel reads name)",
	why: sentence("required for a condition change or any physical document operation; keep it when an NPC gives, takes or is offered the thing (their next act reads it back); otherwise leave it out, and never on adopt, which records none"),
	},
	define: {
		category: { append: "; leave it out for an ordinary item" },
	},
	flag: {
		why: sentence("leave it out, except when this flag is a scene obligation's and you are waiving it: why is what makes it a waiver (without it the obligation reads as settled)"),
	},
	threat: {
		why: sentence("leave it out: nothing reads it back"),
	},
	clock: {
		why: sentence("leave it out: nothing reads it back"),
	},
	ability: {
		why: sentence("leave it out: the receipt records none"),
	},
});

/** Added to the apply tool's own description under the flag. */
export const LEAN_APPLY_NOTE =
	" Lean arguments (§154): write only what something reads. Each effect's why says whether it is read; leave out the ones that say so, object.definition when it is the object's own name, and define.category for an ordinary item: the kernel fills them.";

/**
 * A copy of a TypeBox schema that keeps every own property with its descriptor: TypeBox 1.x marks a schema's kind and
 * optionality with non-enumerable keys (`~kind`, `~optional`), which a spread or `structuredClone` would drop, and Pi
 * validates arguments against them.
 */
function cloneSchema<T>(value: T): T {
	if (Array.isArray(value)) return value.map((item) => cloneSchema(item)) as T;
	if (!value || typeof value !== "object") return value;
	const copy = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if ("value" in descriptor) descriptor.value = cloneSchema(descriptor.value);
		Object.defineProperty(copy, key, descriptor);
	}
	return copy as T;
}

/** The kind an effect variant of the apply union declares (`enum: [kind]` or `const: kind`). */
function variantKind(variant: Record<string, any>): string | undefined {
	const kind = variant?.properties?.kind;
	return typeof kind?.const === "string" ? kind.const : Array.isArray(kind?.enum) && kind.enum.length === 1 ? kind.enum[0] : undefined;
}

/**
 * The tool list a lean process registers: the ordinary list with the apply tool's description and the field
 * descriptions above replaced, on a copy. Throws when a field it names is not in the schema, so a renamed field
 * cannot silently leave the Keeper with the old instruction.
 */
export function leanTools(tools: readonly CocToolSpec[]): readonly CocToolSpec[] {
	return tools.map((spec) => {
		if (spec.name !== "apply") return spec;
		const parameters = cloneSchema(spec.parameters) as Record<string, any>;
		const variants: Array<Record<string, any>> = parameters.properties.effects.items.anyOf;
		for (const [kind, fields] of Object.entries(LEAN_FIELD_DESCRIPTIONS)) {
			const variant = variants.find((candidate) => variantKind(candidate) === kind);
			if (!variant) throw new Error(`lean apply: no ${kind} effect in the apply schema`);
			for (const [field, text] of Object.entries(fields)) {
				const property = variant.properties[field];
				if (!property) throw new Error(`lean apply: the ${kind} effect has no ${field}`);
				property.description = typeof text === "string" ? text : `${property.description ?? ""}${text.append}`;
			}
		}
		return { ...spec, description: `${spec.description}${LEAN_APPLY_NOTE}`, parameters: parameters as CocToolSpec["parameters"] };
	});
}

/** The tools this process offers the Keeper. */
export function offeredTools(tools: readonly CocToolSpec[], env: Readonly<Record<string, string | undefined>> = process.env): readonly CocToolSpec[] {
	return leanApplyEnabled(env) ? leanTools(tools) : tools;
}
