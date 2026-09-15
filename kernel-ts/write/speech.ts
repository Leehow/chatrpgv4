/**
 * The say token (contract §40.1): `{{say:<name>}}…{{/say}}` around every spoken line. The name is the
 * person as `present[].name` gives it — a name, never an id (§16.6's invariant) — and this file does
 * two things with the token: repairs its shape (a token is a rendering hint, never a reason to refuse,
 * §34.14) and resolves the name to a person by exact name, deterministically. No fuzzy matching, no
 * word list deciding what kind of person a label denotes: a name that matches nobody stays a label.
 */
import { ModuleGraph } from '../read/module-graph.js';
import { npcsPresent } from '../read/capsule.js';
import { array, normalize, string, truth, type Row } from '../read/values.js';

/** Who a span resolved to. `npc` is the graph handle (a name the model may hold), never a node id. */
export type Speaker = { npc: string; name: string } | { investigator: string; name: string } | { label: string };
export type SpeakerResolver = (name: string) => Speaker;

const TOKEN = /\{\{say:([^}\n]*)\}\}|\{\{\/say\}\}/g;
const MECHANIC = /\{\{([a-z0-9][a-z0-9:_-]*)\}\}/g;
const PARAGRAPH = /\n[ \t]*\n/;
export const NAME_LIMIT = 60;
/** Every say token, open or close; what `stripMarkers` removes beside the mechanics markers. */
export const SAY_TOKENS = /\{\{say:[^}\n]*\}\}|\{\{\/say\}\}/g;
export const isSayMarker = (marker: string): boolean => marker.startsWith('say:');

/** Repair the tokens and lift the spans out (§40.1). Returns the text with normalised tokens and the
 *  spans in text order. Repairs: an open before a close closes the previous span at the new open; an
 *  open with no close closes at the end of its paragraph or of the text; a close with no open is
 *  removed; a mechanics marker inside a span is moved to just after the span's close; a span with no
 *  words is unwrapped. */
export function speechPass(text: string, resolve: SpeakerResolver): { text: string; speech: Row[] } {
    const out: string[] = [], speech: Row[] = [];
    let open: { name: string; words: string[]; moved: string[] } | null = null;
    const close = () => {
        if (!open) return;
        const words = open.words.join('').trim();
        if (words) {
            out.push('{{/say}}');
            speech.push({ who: resolve(open.name), text: words });
        } else {
            // Nothing was said: the open token is withdrawn rather than left standing on silence.
            const at = out.lastIndexOf(`{{say:${open.name}}}`);
            if (at >= 0) out.splice(at, 1);
        }
        out.push(...open.moved);
        open = null;
    };
    const content = (chunk: string) => {
        if (!open) { out.push(chunk); return; }
        // A paragraph break ends the line whatever the Keeper forgot.
        const gap = PARAGRAPH.exec(chunk);
        if (gap) {
            content(chunk.slice(0, gap.index));
            close();
            out.push(chunk.slice(gap.index));
            return;
        }
        const kept = chunk.replace(MECHANIC, (whole: string, marker: string) => {
            if (isSayMarker(marker)) return whole;
            open!.moved.push(whole);
            return '';
        });
        out.push(kept);
        open.words.push(kept);
    };
    let last = 0;
    for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
        content(text.slice(last, match.index));
        last = match.index + match[0].length;
        if (match[1] === undefined) { close(); continue; }
        const name = match[1].trim();
        close();
        if (!name || name.length > NAME_LIMIT) continue;
        open = { name, words: [], moved: [] };
        out.push(`{{say:${name}}}`);
    }
    content(text.slice(last));
    close();
    TOKEN.lastIndex = 0;
    return { text: out.join(''), speech };
}

/** §40.1 resolution: someone present, by any of their names; an investigator of the party; any NPC of
 *  the graph when exactly one carries the name. Otherwise the name is a label. */
export function speakerResolver(graph: ModuleGraph, world: Row, party: Row[]): SpeakerResolver {
    let present: Row[] | null = null;
    const keysOf = (node: Row) => graph.nameKeys(node).map(normalize).filter(Boolean);
    const only = (nodes: Row[], key: string): Row | null => {
        const hits = nodes.filter(node => keysOf(node).includes(key));
        return hits.length === 1 ? hits[0] : null;
    };
    return (name: string): Speaker => {
        const key = normalize(name);
        if (!key) return { label: name };
        if (!present) {
            try { present = npcsPresent(graph, world, graph.scene(world.active_scene)); } catch { present = []; }
        }
        const here = only(present, key);
        if (here) return { npc: graph.handle(here), name: graph.displayName(here) };
        const investigators = party.filter(sheet => [sheet.name, sheet.id].map(normalize).includes(key));
        if (investigators.length === 1) return { investigator: string(investigators[0].id), name: string(investigators[0].name) };
        const anyone = only([...graph.nodes.values()].filter(node => node.node_kind === 'npc'), key);
        if (anyone) return { npc: graph.handle(anyone), name: graph.displayName(anyone) };
        return { label: name };
    };
}

/** What the Keeper is told back beside the rows (§40.2): the labels that matched nobody, when any. */
export function unresolvedSpeakers(speech: Row[]): string[] {
    return [...new Set(array(speech).flatMap(entry => truth(entry) && typeof (entry as Row).who === 'object' && (entry as Row).who && typeof ((entry as Row).who as Row).label === 'string' ? [string(((entry as Row).who as Row).label)] : []))];
}
