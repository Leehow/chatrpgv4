/**
 * Contract §138: a Keeper tool argument that carries the model's own tool-call markup.
 *
 * Some models write a tool call in an XML dialect and the provider hands it back as JSON, so a string argument can
 * arrive with its own closing tag inside it, and sometimes with the next parameter swallowed after that tag:
 *
 *   text: "…the last spoken line.\n</text>\n"
 *   text: "…the last sentence.</text>\n<parameter name=\"workpad_patch\">{\"focus\":…}"
 *
 * The first delivered a literal `</text>` to the player; the second delivered the Keeper's private workpad JSON to the
 * player and lost the patch itself. Everything here is derived from the tool's declared parameters: a tag is markup
 * when it names the argument it sits in or another parameter of the same tool. Nothing is decided by what the prose
 * says. The repair runs where the model's arguments first enter the host (the Keeper tools' `prepareArguments`),
 * before Pi's schema check, so a recovered parameter is validated like any other.
 */
import type { TSchema } from "typebox";

export type MarkupRepair = { field: string; recovered: string[]; kept: string[] };
export type MarkupRefusal = {
	code: string; code_detail: string; message: string; fix: string; retryable: false; next: "change_input"; details: Record<string, unknown>;
};
export type MarkupResult = { ok: true; args: unknown; repairs: MarkupRepair[] } | { ok: false; refusal: MarkupRefusal };

type Schema = { type?: unknown; properties?: Record<string, Schema> };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Any tag-shaped token; used only on what is left after the argument's own closing tag, never on the argument itself. */
const TAG_SHAPED = /<\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*)?>/g;

/** An opening tag for one of `names`, in either spelling the dialect uses: `<parameter name="k">` or `<k>`. */
function openingPattern(names: readonly string[]): RegExp {
	const alternatives = names.map(escape).join("|");
	return new RegExp(`<parameter\\s+name\\s*=\\s*"(${alternatives})"[^>]*>|<(${alternatives})>`, "g");
}

/** A recovered value keeps the declared type: a string parameter stays text, anything else is read as JSON if it parses. */
function decode(schema: Schema | undefined, raw: string): unknown {
	const text = raw.trim();
	if (schema?.type === "string") return text;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * Unwraps every top-level string argument that carries its own tool-call markup, and recovers any declared parameter
 * the markup swallowed. An argument with no such markup is returned untouched (the same object when nothing changed).
 * Text after the argument's closing tag that is neither a declared parameter nor tag-shaped is refused, never
 * dropped: the host cannot tell whether it was meant as prose.
 */
export function unwrapArgumentMarkup(tool: string, parameters: TSchema, args: unknown): MarkupResult {
	if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: true, args, repairs: [] };
	const properties = ((parameters as Schema).properties ?? {}) as Record<string, Schema>;
	const names = Object.keys(properties);
	const input = args as Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	const repairs: MarkupRepair[] = [];
	for (const field of names) {
		const value = input[field];
		if (typeof value !== "string") continue;
		const others = names.filter((name) => name !== field);
		const leading = new RegExp(`^\\s*(?:<parameter\\s+name\\s*=\\s*"${escape(field)}"[^>]*>|<${escape(field)}>)`);
		const opened = leading.exec(value);
		// The argument's own closing tag, in the spelling it was opened with (or its bare name when it was not opened).
		const ownClose = new RegExp(`</${escape(field)}>${opened?.[0].includes("parameter") ? "|</parameter>" : ""}`);
		const from = opened ? opened[0].length : 0;
		const ends = [value.slice(from).search(ownClose), others.length ? value.slice(from).search(new RegExp(openingPattern(others).source)) : -1]
			.filter((at) => at >= 0).map((at) => at + from);
		if (!opened && !ends.length) continue;
		const end = ends.length ? Math.min(...ends) : value.length;
		const body = value.slice(from, end);
		const rest = value.slice(end).replace(new RegExp(`^(?:${ownClose.source})`), "");
		// What follows the value: declared parameters the dialect swallowed, then only markup.
		const recovered: string[] = [], kept: string[] = [];
		let leftover = rest;
		if (others.length) {
			const found = [...rest.matchAll(openingPattern(others))];
			const spans: Array<[number, number]> = [];
			found.forEach((match, index) => {
				const name = match[1] ?? match[2];
				const start = match.index! + match[0].length;
				const next = index + 1 < found.length ? found[index + 1].index! : rest.length;
				const tail = rest.slice(start, next);
				const close = tail.search(new RegExp(`</(?:${escape(name)}|parameter)>`));
				const raw = close < 0 ? tail : tail.slice(0, close);
				if (Object.prototype.hasOwnProperty.call(input, name)) kept.push(name);
				else {
					(output ??= { ...input })[name] = decode(properties[name], raw);
					recovered.push(name);
				}
				spans.push([match.index!, next]);
			});
			for (const [start, stop] of spans.reverse()) leftover = leftover.slice(0, start) + leftover.slice(stop);
		}
		const stray = leftover.replace(TAG_SHAPED, "").trim();
		if (stray) {
			return {
				ok: false,
				refusal: {
					code: "invalid_params", code_detail: "argument_markup", retryable: false, next: "change_input",
					message: `${tool}: ${field} carries tool-call markup with text after it that is not one of ${tool}'s parameters`,
					fix: `Send ${field} as its plain value only: no <${field}> or </${field}> tags around it and nothing after it, and give each other parameter as its own field of the same call. Nothing in this call was written.`,
					details: { field, after: stray.slice(0, 80) },
				},
			};
		}
		(output ??= { ...input })[field] = body.replace(/\s+$/, "");
		repairs.push({ field, recovered, kept });
	}
	return { ok: true, args: output ?? args, repairs };
}
