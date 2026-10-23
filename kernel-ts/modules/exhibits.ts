/**
 * Contract §257: exhibits, what the investigators perceive, as the shard contract v5 carries them.
 *
 * `checkExhibits` is the deterministic checker. It never throws and never blocks the shard: an exhibit that fails any law is
 * dropped with its named reasons, and the rest of the draft publishes. Nothing here decides what is a secret; the only text
 * test is an exact substring of a person's own `name` or `aliases` from the graph, outside `{{who:<node_id>}}` references.
 */
import { isJsonObject } from '../json.js';
import { array, row, string, type Row } from '../read/values.js';
import { validSemanticId, validSourceLanguage } from './contract.js';

/** §257.R: the detail material that reads for exhibits alone, as `map` reads for a map and `pregens` for the book's investigators. */
export const EXHIBITS_MATERIAL = 'exhibits';
/** §257.R: the focus-less question the kernel names for it, so one focus has one identity for its exhibits reading. */
export const EXHIBITS_QUESTION = 'Extract the exhibits an investigator can perceive or be told for this focus; write no nodes or claims.';

/** §257.R: the pointer an exhibit is reviewed at: its position in the draft's own `exhibits` array. */
export function exhibitPointer(drafted: unknown, item: Row): string { return `/exhibits/${Array.isArray(drafted) ? drafted.indexOf(item) : -1}`; }

export const EXHIBIT_KINDS = ['description', 'appearance', 'document', 'perception', 'testimony', 'voice'] as const;
export const EXHIBIT_CHANNELS = ['sight', 'text', 'speech', 'sound', 'touch', 'smell'] as const;
export const EXHIBIT_STANCES = ['fact', 'belief', 'rumor', 'lie', 'deflection'] as const;
export const EXHIBIT_KEYS = ['exhibit_id', 'kind', 'carrier', 'channel', 'owners', 'stance', 'teaches', 'keeper_note', 'label', 'surface', 'source_refs'];
/** Kinds that speak through persons: owners required for them, forbidden for the rest. */
export const SPOKEN_KINDS: readonly string[] = ['testimony', 'voice'];
/** A surface is at most this many UTF-8 bytes. */
export const EXHIBIT_SURFACE_BYTES = 4096;
/** The relation kinds that give a person knowledge of something (§257.2). */
export const KNOWLEDGE_PREDICATES: readonly string[] = ['knows', 'believes', 'asserts'];
/** The reference a surface uses for a person; the host resolves it before the author sees the text. */
export const WHO_REFERENCE = /\{\{who:([^{}]*)\}\}/g;

export interface ExhibitRefusal { exhibit_id: string | null; path: string; rule: string; rules: string[]; message: string }
export interface ExhibitCheck { accepted: Row[]; refused: ExhibitRefusal[] }
export interface ExhibitScope {
    /** Every node the draft would publish into, by id: the known nodes overlaid by the draft's. */
    nodes: ReadonlyMap<string, Row>;
    /** Known claims and the draft's. */
    claims: readonly Row[];
    /** Page validation for `source_refs`; throws when a reference is unusable. */
    references: (value: any) => void;
}

const names = (node: Row): string[] => [node.name, ...array(node.aliases)].filter((name): name is string => typeof name === 'string' && name.trim() !== '');
const noted = (found: Array<[string, string]>, rule: string, message: string): void => { found.push([rule, message]); };

export function checkExhibits(drafted: unknown[], scope: ExhibitScope): ExhibitCheck {
    const accepted: Row[] = [], refused: ExhibitRefusal[] = [], seen = new Set<string>();
    const persons = [...scope.nodes.values()].filter(node => node.node_kind === 'npc');
    const knowledge = scope.claims.filter(claim => KNOWLEDGE_PREDICATES.includes(string(claim.predicate)));
    for (const [i, value] of drafted.entries()) {
        const found: Array<[string, string]> = [], exhibit = row(value);
        const id = typeof exhibit.exhibit_id === 'string' ? exhibit.exhibit_id : null;
        if (!isJsonObject(value)) noted(found, 'exhibit_shape', 'an exhibit is an object');
        else {
            const extra = Object.keys(exhibit).filter(key => !EXHIBIT_KEYS.includes(key));
            if (extra.length) noted(found, 'exhibit_shape', `unknown exhibit keys: ${extra.sort().join(', ')}`);
            if (!validSemanticId(id) || !id!.startsWith('exhibit-') || seen.has(id!)) noted(found, 'exhibit_id', 'exhibit_id is a unique semantic id starting with exhibit-');
            if (id) seen.add(id);
            if (!EXHIBIT_KINDS.includes(exhibit.kind)) noted(found, 'exhibit_kind', `kind is one of ${EXHIBIT_KINDS.join(', ')}`);
            if (!EXHIBIT_CHANNELS.includes(exhibit.channel)) noted(found, 'exhibit_channel', `channel is one of ${EXHIBIT_CHANNELS.join(', ')}`);
            if (typeof exhibit.label !== 'string' || !exhibit.label.trim()) noted(found, 'exhibit_label', 'label is one English line');
            if (Object.hasOwn(exhibit, 'keeper_note') && (typeof exhibit.keeper_note !== 'string' || !exhibit.keeper_note.trim()))
                noted(found, 'exhibit_shape', 'keeper_note is one English line');
            if (Object.hasOwn(exhibit, 'stance') && (!EXHIBIT_STANCES.includes(exhibit.stance) || exhibit.kind !== 'testimony'))
                noted(found, 'exhibit_stance', `stance belongs to testimony and is one of ${EXHIBIT_STANCES.join(', ')}`);
            if (typeof exhibit.carrier !== 'string' || !scope.nodes.has(exhibit.carrier))
                noted(found, 'exhibit_carrier_unknown', 'carrier must be a node_id of the accepted graph or this draft');
            const owners = exhibit.owners, spoken = SPOKEN_KINDS.includes(exhibit.kind);
            if (Object.hasOwn(exhibit, 'owners') && !spoken) noted(found, 'exhibit_owners_wrong_kind', 'owners belong to testimony and voice only');
            else if (spoken && (!Array.isArray(owners) || !owners.length))
                noted(found, 'exhibit_owners_missing', 'testimony and voice need owners; an owner-less voice is a perception on the sound channel');
            else if (Array.isArray(owners)) {
                const unknown = owners.filter(owner => typeof owner !== 'string' || scope.nodes.get(owner)?.node_kind !== 'npc');
                if (unknown.length) noted(found, 'exhibit_owner_unknown', 'each owner is the node_id of a person');
                else if (exhibit.kind === 'testimony') {
                    const targets = new Set<string>([string(exhibit.carrier), ...array(exhibit.teaches).filter((t): t is string => typeof t === 'string')]);
                    const unlinked = owners.filter(owner => !knowledge.some(claim => {
                        const holders = [claim.subject_id, ...array(claim.known_by_ids), ...array(claim.asserted_by_ids)];
                        return holders.includes(owner) && (targets.has(string(row(claim.object).node_id)) || targets.has(string(claim.claim_id)) || targets.has(string(claim.subject_id)) && claim.subject_id !== owner);
                    }));
                    if (unlinked.length) noted(found, 'exhibit_owner_unlinked', 'a testimony owner needs a knows, believes or asserts relation to the carrier or to what the exhibit teaches');
                }
            }
            if (Object.hasOwn(exhibit, 'teaches')) {
                const bad = !Array.isArray(exhibit.teaches) || !exhibit.teaches.length || exhibit.teaches.some((target: any) => {
                    if (typeof target !== 'string') return true;
                    const node = scope.nodes.get(target);
                    return node ? node.node_kind !== 'clue' : !knowledge.some(claim => claim.claim_id === target);
                });
                if (bad) noted(found, 'exhibit_teaches_target', 'teaches names clue nodes or knowledge claims only');
            }
            try { scope.references(exhibit.source_refs); } catch { noted(found, 'exhibit_source_refs', 'source_refs cites at least one original page this reader viewed'); }
            const surface = row(exhibit.surface);
            if (!isJsonObject(exhibit.surface) || typeof surface.text !== 'string' || !surface.text.trim() || typeof surface.verbatim !== 'boolean' || !validSourceLanguage(surface.language))
                noted(found, 'exhibit_surface', 'surface is {text, language, verbatim} with text non-empty');
            else {
                if (Buffer.byteLength(surface.text) > EXHIBIT_SURFACE_BYTES) noted(found, 'exhibit_surface_oversize', `surface text is at most ${EXHIBIT_SURFACE_BYTES} bytes`);
                const references = [...surface.text.matchAll(WHO_REFERENCE)].map(match => match[1]);
                if (references.some(who => scope.nodes.get(who)?.node_kind !== 'npc')) noted(found, 'exhibit_who_unknown', '{{who:<node_id>}} names a person of the graph');
                const bare = surface.text.replace(WHO_REFERENCE, '');
                // Structural: a brace pair left over once the well-formed tokens are removed is a malformed token that would reach the author raw.
                if (bare.includes('{{') || bare.includes('}}')) noted(found, 'exhibit_who_malformed', 'a surface uses {{who:<node_id>}} exactly; no other {{ or }}');
                // A verbatim surface (a handout, a sign, read-aloud) shows names as printed; the reader quotes them as the page does.
                const named = surface.verbatim ? [] : persons.flatMap(person => names(person).filter(name => bare.includes(name)));
                if (named.length) noted(found, 'exhibit_name_in_surface', `a person's name appears literally in the surface; use {{who:<node_id>}}: ${[...new Set(named)].join(', ')}`);
            }
        }
        if (found.length) refused.push({ exhibit_id: id, path: `/exhibits/${i}`, rule: found[0][0], rules: found.map(item => item[0]), message: found.map(item => item[1]).join('; ') });
        else accepted.push(value as Row);
    }
    return { accepted, refused };
}
