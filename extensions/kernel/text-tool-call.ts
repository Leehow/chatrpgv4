/** A complete tool envelope is syntax, not player-facing prose (§158.7). */
import {validateToolArguments} from '@earendil-works/pi-ai';
import type {COC_TOOLS} from './tools.ts';

function closed(value: any): any {
    if (Array.isArray(value)) return value.map(closed);
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closed(child)]));
    if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
}
export function textToolCall(text: string, tools: typeof COC_TOOLS): {name: string; arguments: Record<string, unknown>} | undefined {
    let body = text.trim();
    const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(body);
    if (fence) body = fence[1].trim();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const keys = Object.keys(parsed);
    if (keys.length !== 1) return;
    const spec = tools.find(tool => tool.name === keys[0]);
    if (!spec) return;
    const args = (parsed as Record<string, unknown>)[spec.name];
    if (!args || typeof args !== 'object' || Array.isArray(args)) return;
    try {
        // Pi's validator may coerce. A dialect repair must not broaden the supplied JSON value.
        const original = JSON.stringify(args);
        const validated = validateToolArguments({...spec, parameters: closed(spec.parameters)},
            {type: 'toolCall', id: 'validation', name: spec.name, arguments: structuredClone(args) as Record<string, unknown>});
        if (JSON.stringify(validated) !== original) return;
        return {name: spec.name, arguments: validated as Record<string, unknown>};
    } catch { return; }
}
