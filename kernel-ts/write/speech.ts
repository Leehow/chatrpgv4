/**
 * The say token (contract §40.1): `{{say:<name>}}…{{/say}}` around every spoken line. The name is the
 * person as `present[].name` gives it — a name, never an id (§16.6's invariant) — and this file does
 * two things with the token: repairs its shape (a token is a rendering hint, never a reason to refuse,
 * §34.14) and resolves the name to a person by exact name, deterministically. No fuzzy matching, no
 * word list deciding what kind of person a label denotes: a name that matches nobody stays a label.
 */
import { ModuleGraph } from '../read/module-graph.js';
import { npcsPresent, personLabel } from '../read/capsule.js';
import { array, entries, normalize, normalizeText, row, string, truth, type Row } from '../read/values.js';

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

/**
 * §40.1 resolution: someone present, by any of their names; an investigator of the party; any NPC of
 * the graph when exactly one carries the name; and, since §79, the name this table gave them.
 *
 * A table's own name for a person is one of that person's names here, exactly as `world.scene_labels`
 * is a place's name everywhere a place is named. Without it a Keeper writing their own word for
 * somebody resolved to nobody, so the same person was a fresh anonymous label in every turn that
 * spelled them differently -- a different colour on the transcript, no `spoke` row on the ledger and
 * no line in the journal. Otherwise the name is a label.
 *
 * The resolved row carries the table's name too: `npc` / `investigator` is the identity and `name`
 * is what to call them (§76.2), so the journal and the ledger legend read one word for one person.
 */
export function speakerResolver(graph: ModuleGraph, world: Row, party: Row[]): SpeakerResolver {
    let present: Row[] | null = null;
    const keysOf = (node: Row) => graph.nameKeys(node).map(normalize).filter(Boolean);
    const only = (nodes: Row[], key: string): Row | null => {
        const hits = nodes.filter(node => keysOf(node).includes(key));
        return hits.length === 1 ? hits[0] : null;
    };
    const npc = (node: Row): Speaker => ({ npc: graph.handle(node), name: personLabel(world, graph.handle(node), graph.displayName(node)) });
    const sheetSpeaker = (sheet: Row): Speaker => ({ investigator: string(sheet.id), name: personLabel(world, string(sheet.id), string(sheet.name)) });
    const atThisTable = new Map(entries(row(world.person_labels)).flatMap(([id, record]) => {
        const key = normalize(string(row(record).name));
        return key ? [[key, id] as [string, string]] : [];
    }));
    return (name: string): Speaker => {
        const key = normalize(name);
        if (!key) return { label: name };
        if (!present) {
            try { present = npcsPresent(graph, world, graph.scene(world.active_scene)); } catch { present = []; }
        }
        const here = only(present, key);
        if (here) return npc(here);
        const investigators = party.filter(sheet => [sheet.name, sheet.id].map(normalize).includes(key));
        if (investigators.length === 1) return sheetSpeaker(investigators[0]);
        const anyone = only([...graph.nodes.values()].filter(node => node.node_kind === 'npc'), key);
        if (anyone) return npc(anyone);
        const owner = atThisTable.get(key);
        if (owner != null) {
            const node = graph.find(owner, ['npc']);
            if (node) return npc(node);
            const sheet = party.find(value => string(value.id) === owner);
            if (sheet) return sheetSpeaker(sheet);
        }
        return { label: name };
    };
}

/** What the Keeper is told back beside the rows (§40.2): the labels that matched nobody, when any. */
export function unresolvedSpeakers(speech: Row[]): string[] {
    return [...new Set(array(speech).flatMap(entry => truth(entry) && typeof (entry as Row).who === 'object' && (entry as Row).who && typeof ((entry as Row).who as Row).label === 'string' ? [string(((entry as Row).who as Row).label)] : []))];
}

/** The characters of a spoken line that two lines can share: letters and digits only, in order. */
const spokenChars = (text: unknown): string => normalizeText(text).replace(/\s+/gu, '');
/** The longest run of characters two strings share, in order and unbroken. */
function longestSharedRun(a: string, b: string): string {
    let best = '', prev = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        const cur = new Array<number>(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] !== b[j - 1]) continue;
            cur[j] = prev[j - 1] + 1;
            if (cur[j] > best.length) best = a.slice(i - cur[j], i);
        }
        prev = cur;
    }
    return best;
}
/**
 * A person does not repeat (§113 D). A `say` line of this delivery that shares `minimum` or more
 * consecutive characters with a line the same person already spoke at this table is returned with
 * the earlier turn, for the caller to refuse before any audit. Letters and digits only, so quotation
 * marks and punctuation neither hide a repeat nor make one. Twelve characters is a clause in any
 * script the table plays in; a greeting or a name alone is shorter than that and never matches.
 */
export function repeatedLine(speech: Row[], records: Row[], minimum = 12): Row | null {
    const said = new Map<string, Array<{ turn: number; text: string; chars: string }>>();
    for (const record of records)
        for (const line of array(record.speech)) {
            const npc = string(row(row(line).who).npc || ''), text = string(row(line).text || '');
            if (!npc || !text.trim()) continue;
            if (!said.has(npc)) said.set(npc, []);
            said.get(npc)!.push({ turn: Number(record.turn) || 0, text, chars: spokenChars(text) });
        }
    for (const line of speech) {
        const who = row(row(line).who), npc = string(who.npc || ''), chars = spokenChars(row(line).text);
        if (!npc || chars.length < minimum) continue;
        for (const earlier of said.get(npc) ?? []) {
            const shared = longestSharedRun(chars, earlier.chars);
            if (shared.length >= minimum)
                return { npc, name: string(who.name || npc), line: string(row(line).text), earlier_turn: earlier.turn, earlier_line: earlier.text, shared };
        }
    }
    return null;
}
