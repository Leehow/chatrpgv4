/**
 * Complete tool envelopes are syntax, not player-facing prose (§158.7, §160.2).
 *
 * A body is one bare envelope, or one or more fenced blocks each holding one envelope with nothing but whitespace
 * outside them. An envelope is `{"<tool>": {arguments}}` or `{"name": "<tool>", "arguments": {arguments}}`. Every
 * envelope must name an offered tool and validate unchanged against its closed schema, or nothing is routed.
 */
import {validateToolArguments} from '@earendil-works/pi-ai';
import type {COC_TOOLS} from './tools.ts';

type Call = {name: string; arguments: Record<string, unknown>};

function closed(value: any): any {
    if (Array.isArray(value)) return value.map(closed);
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closed(child)]));
    if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The `(name, arguments)` an envelope spells, in either shape, before any tool or schema is consulted. */
function envelope(parsed: unknown): {name: string; args: unknown} | undefined {
    if (!isObject(parsed)) return;
    const keys = Object.keys(parsed);
    if (keys.length === 1) return {name: keys[0], args: parsed[keys[0]]};
    if (keys.length === 2 && keys.includes('name') && keys.includes('arguments') && typeof parsed.name === 'string')
        return {name: parsed.name, args: parsed.arguments};
}

function call(source: string, tools: typeof COC_TOOLS): Call | undefined {
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { return; }
    const found = envelope(parsed);
    if (!found || !isObject(found.args)) return;
    const spec = tools.find(tool => tool.name === found.name);
    if (!spec) return;
    try {
        // Pi's validator may coerce. A dialect repair must not broaden the supplied JSON value.
        const original = JSON.stringify(found.args);
        const validated = validateToolArguments({...spec, parameters: closed(spec.parameters)},
            {type: 'toolCall', id: 'validation', name: spec.name, arguments: structuredClone(found.args)});
        if (JSON.stringify(validated) !== original) return;
        return {name: spec.name, arguments: validated as Record<string, unknown>};
    } catch { return; }
}

/** The calls a complete assistant text body spells, in written order, or `undefined` when it is not only envelopes. */
export function textToolCalls(text: string, tools: typeof COC_TOOLS): Call[] | undefined {
    const body = text.trim();
    const fences = [...body.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g)];
    // Nothing but whitespace may stand outside the fences.
    if (fences.length && body.replace(/```(?:json)?[ \t]*\n[\s\S]*?\n[ \t]*```/g, '').trim()) return;
    const sources = fences.length ? fences.map(fence => fence[1].trim()) : [body];
    const calls: Call[] = [];
    for (const source of sources) {
        const routed = call(source, tools);
        if (!routed) return;
        calls.push(routed);
    }
    return calls;
}
