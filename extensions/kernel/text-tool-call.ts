/**
 * Complete tool envelopes are syntax, not player-facing prose (§158.7, §160.2, §160.4, and in setup §160.4.1).
 *
 * A body may open with one label (an identifier and a colon). The rest is one bare JSON value, or one or more fenced
 * blocks each holding one JSON value, with nothing but whitespace outside them. Each value is an envelope or a
 * non-empty array of envelopes. An envelope is `{"<tool>": {arguments}}`, `{"name": "<tool>", "arguments": ...}` or
 * `{"name": "<tool>", "parameters": ...}`. Every envelope must name an offered tool and validate unchanged against its
 * closed schema, or nothing is routed; a body of this form that cannot be routed is still a call list, not prose.
 */
import {randomUUID} from 'node:crypto';
import {validateToolArguments} from '@earendil-works/pi-ai';
import type {COC_TOOLS} from './tools.ts';

/** How the call was written: the label before the JSON, whether it sat in an array, and which key held its arguments. */
export type TextCallForm = {label: string | null; array: boolean; key: 'tool' | 'arguments' | 'parameters'};
type Call = {name: string; arguments: Record<string, unknown>};
type Envelope = {name: string; args: unknown; form: TextCallForm};

/**
 * A serialized call list: every call routed, each with the form it was written in, or why each envelope could not be
 * (`error` is absent for one that could).
 */
export type TextCallReading =
    | {kind: 'calls'; calls: Call[]; forms: TextCallForm[]}
    | {kind: 'unroutable'; envelopes: Array<{tool: string; error?: string}>};

function closed(value: any): any {
    if (Array.isArray(value)) return value.map(closed);
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closed(child)]));
    if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The `(name, arguments)` an envelope spells, in any of its shapes, before any tool or schema is consulted. */
function envelope(parsed: unknown, label: string | null, array: boolean): Envelope | undefined {
    if (!isObject(parsed)) return;
    const keys = Object.keys(parsed);
    if (keys.length === 1 && isObject(parsed[keys[0]])) return {name: keys[0], args: parsed[keys[0]], form: {label, array, key: 'tool'}};
    if (keys.length !== 2 || !keys.includes('name') || typeof parsed.name !== 'string') return;
    for (const key of ['arguments', 'parameters'] as const)
        if (keys.includes(key)) return {name: parsed.name, args: parsed[key], form: {label, array, key}};
}

/** The envelopes one JSON value holds: itself, or each element of a non-empty array of envelopes. */
function envelopes(source: string, label: string | null): Envelope[] | undefined {
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { return; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (!items.length) return;
    const out: Envelope[] = [];
    for (const item of items) {
        const found = envelope(item, label, Array.isArray(parsed));
        if (!found) return;
        out.push(found);
    }
    return out;
}

/** The arguments an envelope routes with, or why it cannot be routed. */
function route(found: Envelope, tools: typeof COC_TOOLS): {call: Call} | {error: string} {
    const spec = tools.find(tool => tool.name === found.name);
    if (!spec) return {error: `${found.name} is not one of the table tools a call written as text can run as`};
    if (!isObject(found.args)) return {error: `its arguments are not a JSON object`};
    try {
        // Pi's validator may coerce. A dialect repair must not broaden the supplied JSON value.
        const original = JSON.stringify(found.args);
        const validated = validateToolArguments({...spec, parameters: closed(spec.parameters)},
            {type: 'toolCall', id: 'validation', name: spec.name, arguments: structuredClone(found.args)});
        if (JSON.stringify(validated) !== original) return {error: `its arguments only pass ${spec.name}'s schema once converted`};
        return {call: {name: spec.name, arguments: validated as Record<string, unknown>}};
    } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)};
    }
}

const FENCE = /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g;
const LABEL = /^([A-Za-z_][A-Za-z0-9_.-]*):\s*/;

/** The envelopes a complete assistant text body is, in written order, or `undefined` when it is not only a call list. */
function textCallList(text: string): Envelope[] | undefined {
    let body = text.trim();
    const label = LABEL.exec(body);
    if (label) body = body.slice(label[0].length);
    const fences = [...body.matchAll(FENCE)];
    // Nothing but whitespace may stand outside the fences.
    if (fences.length && body.replace(FENCE, '').trim()) return;
    const sources = fences.length ? fences.map(fence => fence[1].trim()) : [body];
    const found: Envelope[] = [];
    for (const source of sources) {
        const read = envelopes(source, label ? label[1] : null);
        if (!read) return;
        found.push(...read);
    }
    return found;
}

/**
 * What a complete assistant text body is, read as a serialized call list: its calls, in written order, when every
 * envelope routes; the envelopes and why, when one does not; `undefined` when the body is not only a call list.
 */
export function readTextToolCalls(text: string, tools: typeof COC_TOOLS): TextCallReading | undefined {
    const found = textCallList(text);
    if (!found) return;
    const routed = found.map(item => route(item, tools));
    if (routed.every(item => 'call' in item))
        return {kind: 'calls', calls: routed.map(item => (item as {call: Call}).call), forms: found.map(item => item.form)};
    return {kind: 'unroutable', envelopes: found.map((item, index) => {
        const result = routed[index];
        return {tool: item.name, ...('error' in result ? {error: result.error} : {})};
    })};
}

/** The calls a complete assistant text body spells, in written order, or `undefined` when they are not all routable. */
export function textToolCalls(text: string, tools: typeof COC_TOOLS): Call[] | undefined {
    const reading = readTextToolCalls(text, tools);
    return reading?.kind === 'calls' ? reading.calls : undefined;
}

/**
 * The turn-close steer's fix for a call list that could not be routed (§160.4): which envelopes did not run and why,
 * in the validator's own words, and that the calls have to be made as calls.
 */
export function textToolCallFix(envelopes: Array<{tool: string; error?: string}>): string {
    const lines = envelopes.map(({tool, error}) => error
        ? `- ${tool}: ${error.length > 800 ? `${error.slice(0, 800)}...` : error}`
        : `- ${tool}: valid, but not run, because a list runs only when every call in it can`);
    return 'Your last message wrote tool calls as JSON text instead of calling the tools, so none of them ran and the player '
        + `was shown nothing:\n${lines.join('\n')}\nMake each call you still need as a real tool call, then deliver the turn with narrate.`;
}

type Block = {type: string; text?: string; [key: string]: unknown};

/**
 * Setup's reading (§160.4.1): a message whose whole text is a call list, with no call of its own, carries those calls in
 * written order in place of its text, and `stop` becomes `toolUse`, as §160.3 restores its calls. Nothing is validated
 * here: Pi answers each restored call as it answers a native one. `undefined` when the message is not such a list.
 */
export function restoreTextCallList<T extends {role?: string; content?: unknown; stopReason?: string}>(message: T):
    {message: T; restored: string[]; forms: TextCallForm[]} | undefined {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return;
    if (['error', 'aborted', 'length'].includes(String(message.stopReason))) return;
    const blocks = message.content as Block[];
    if (blocks.some(block => block?.type === 'toolCall')) return;
    const text = blocks.filter(block => block?.type === 'text').map(block => String(block.text ?? '')).join('');
    const found = text.trim() ? textCallList(text) : undefined;
    if (!found) return;
    const calls = found.map(item => ({type: 'toolCall', id: `textcall_${randomUUID().replace(/-/g, '').slice(0, 24)}`, name: item.name,
        arguments: isObject(item.args) ? item.args : {}}));
    return {
        message: {...message, content: [...blocks.filter(block => block?.type !== 'text'), ...calls],
            ...(message.stopReason === 'stop' ? {stopReason: 'toolUse'} : {})},
        restored: found.map(item => item.name),
        forms: found.map(item => item.form),
    };
}
