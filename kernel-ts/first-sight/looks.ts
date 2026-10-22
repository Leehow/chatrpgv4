/**
 * Contract §255: kept looks. What a delivered reply showed of how a person or a place looks, and the pronoun the prose
 * used for a person, kept on the first-sight ledger so that every later capsule and the sole author's input carry it.
 *
 * The sole author may give an undescribed person a look and an unsourced place its surface detail (§254.6); before this,
 * those words lived only in that reply, and the next author invented again. The background check after a delivery
 * (host, `runtime/jev/first-sight.ts`) names the prose's own sentences that show a target's look and the pronoun it
 * used; the kernel keeps an excerpt only where it finds it in that turn's delivered text or the delivery before it, so
 * nothing the player did not read is ever kept. A field is written once: the first delivered look is the table's look.
 *
 * Nothing here reads prose for meaning. Which sentence shows whom, and which pronoun the prose uses, is the model's
 * answer; the kernel checks shapes, graph references and that each excerpt is the delivered text's own span.
 */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { npcsPresent } from '../read/capsule.js';
import { locateExcerpt } from '../read/excerpt.js';
import { array, chars, length, number, repr, row, type Row } from '../read/values.js';

export const LOOK_KINDS: readonly string[] = Object.freeze(['place', 'person']);
/** How the prose refers to a person; `they` is a person the prose deliberately keeps unspecified. */
export const PRONOUNS: readonly string[] = Object.freeze(['he', 'she', 'they']);
/** One excerpt is one sentence or clause of the delivered text. */
export const LOOK_EXCERPT_CHARS = 240;
/** Excerpts one look keeps: a person's look is a few lines, a place's a few more. */
export const LOOK_EXCERPTS: Readonly<Record<string, number>> = Object.freeze({ person: 3, place: 5 });
/** Targets one job names; the scene a turn ended in rarely holds more people than this who still want a look. */
export const LOOK_TARGETS_MAX = 8;
/** A field is asked for on this many checked deliveries at most; a person the prose never describes is not asked forever. */
export const LOOK_TRIES_MAX = 4;
/** The capsule section's own budget; nothing else's budget cuts it. */
export const KEPT_LOOKS_BUDGET = 2048;
/** What the capsule shows of one look: a person's, a place's. */
const SHOWN_CHARS: Readonly<Record<string, number>> = Object.freeze({ person: 300, place: 600 });

export interface Look { excerpts: string[]; pronoun?: string; turn: number; at: string }
export interface KeptLooks { people: Record<string, Look>; places: Record<string, Look>; tries: Record<string, number> }
/** One checked item as the kernel keeps it. */
export interface LookResult { kind: string; id: string; excerpts: string[]; pronoun?: string }

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const shelf = (kind: string): 'places' | 'people' => kind === 'place' ? 'places' : 'people';
const key = (kind: string, id: string, field: string): string => `${kind}:${id}:${field}`;

function look(value: unknown): Look | null {
    const stored = row(value), excerpts = array(stored.excerpts).filter((item): item is string => typeof item === 'string' && item !== '');
    const pronoun = PRONOUNS.includes(text(stored.pronoun)) ? text(stored.pronoun) : undefined;
    if (!excerpts.length && !pronoun) return null;
    return { excerpts, ...(pronoun ? { pronoun } : {}), turn: number(stored.turn), at: text(stored.at) };
}
/** The `looks` field of a stored first-sight ledger; anything malformed is left out. */
export function keptLooks(value: unknown): KeptLooks {
    const stored = row(value), shelfOf = (entry: unknown): Record<string, Look> => Object.fromEntries(Object.entries(row(entry))
        .flatMap(([id, item]) => { const kept = look(item); return id && kept ? [[id, kept]] : []; }));
    const tries = Object.fromEntries(Object.entries(row(stored.tries)).filter(([, count]) => Number.isSafeInteger(count) && number(count) > 0)) as Record<string, number>;
    return { people: shelfOf(stored.people), places: shelfOf(stored.places), tries };
}
export const emptyLooks = (looks: KeptLooks): boolean =>
    !Object.keys(looks.people).length && !Object.keys(looks.places).length && !Object.keys(looks.tries).length;

/** What a target still wants: a look, and for a person a pronoun; nothing once kept or once asked `LOOK_TRIES_MAX` times. */
function wants(looks: KeptLooks, kind: string, id: string): string[] {
    const kept = looks[shelf(kind)][id];
    return [...(kept?.excerpts.length ? [] : ['look']), ...(kind === 'person' && !kept?.pronoun ? ['pronoun'] : [])]
        .filter(field => (looks.tries[key(kind, id, field)] ?? 0) < LOOK_TRIES_MAX);
}

/**
 * `table.looks.job`'s targets: the scene the turn ended in, and each person present there whom the player can see
 * (`seen`, as first sight decides it), while they still want a field. The place first.
 */
export function lookTargets(graph: ModuleGraph, world: Row, scene: Row, looks: KeptLooks, seen: (node: Row) => boolean,
    name: (node: Row) => string): Row[] {
    const targets: Row[] = [], place = graph.handle(scene), placeWants = wants(looks, 'place', place);
    if (placeWants.length) targets.push({ kind: 'place', id: place, name: name(scene), want: placeWants });
    for (const node of npcsPresent(graph, world, scene)) {
        if (!seen(node)) continue;
        const id = graph.handle(node), want = wants(looks, 'person', id);
        if (want.length) targets.push({ kind: 'person', id, name: name(node), want });
    }
    return targets.slice(0, LOOK_TARGETS_MAX);
}

/** The node a target names, by its handle after identity survival; a reference to anything else is refused. */
function target(graph: ModuleGraph, kind: string, id: string, index: number): string {
    const refuse = (): never => {
        throw new RpcError('invalid_params', `items[${index}].id ${repr(id)} is no ${kind === 'place' ? 'scene' : 'person'} of this campaign's graph`, {
            fix: 'send the id exactly as table.looks.job gave it', details: { index, kind, id } });
    };
    if (kind === 'place') {
        try { return graph.handle(graph.scene(id)); }
        catch { return refuse(); }
    }
    const node = graph.find(id, ['npc']);
    return node ? graph.handle(node) : refuse();
}

/**
 * `table.looks`'s items, checked: closed shapes, graph references, every excerpt located in the delivered text (`prose`,
 * else the delivery before it), the pronoun from the closed list. An excerpt found in neither is dropped; an item left
 * with nothing is not recorded.
 */
export function checkLookItems(graph: ModuleGraph, items: unknown, delivered: readonly string[]): { results: LookResult[]; dropped: Row[] } {
    // An empty list is a check that found nothing: it still counts a try for each field the job wanted.
    if (!Array.isArray(items) || items.length > LOOK_TARGETS_MAX)
        throw new RpcError('invalid_params', `params.items must be a list of at most ${LOOK_TARGETS_MAX} checked targets`,
            { fix: 'send {kind, id, excerpts?, pronoun?} for each target the check answered, or [] when it found nothing' });
    const results: LookResult[] = [], dropped: Row[] = [], seen = new Set<string>();
    for (const [index, entry] of items.entries()) {
        if (!isJsonObject(entry))
            throw new RpcError('invalid_params', `items[${index}] must be an object`, { details: { index } });
        const kind = text(entry.kind), excerpts = entry.excerpts ?? [], pronoun = entry.pronoun;
        if (!LOOK_KINDS.includes(kind))
            throw new RpcError('invalid_params', `items[${index}].kind ${repr(entry.kind)} is not place or person`, { details: { index } });
        if (typeof entry.id !== 'string' || !entry.id.trim())
            throw new RpcError('invalid_params', `items[${index}].id must be the target's handle`, { details: { index } });
        if (!Array.isArray(excerpts) || excerpts.length > LOOK_EXCERPTS[kind]
            || excerpts.some(value => typeof value !== 'string' || !value.trim() || length(value) > LOOK_EXCERPT_CHARS))
            throw new RpcError('invalid_params', `items[${index}].excerpts must be at most ${LOOK_EXCERPTS[kind]} excerpts of the delivered text, each at most ${LOOK_EXCERPT_CHARS} characters`,
                { details: { index } });
        if (pronoun !== undefined && (kind !== 'person' || !PRONOUNS.includes(text(pronoun))))
            throw new RpcError('invalid_params', `items[${index}].pronoun is ${PRONOUNS.join(', ')} for a person, or absent`, { details: { index } });
        const id = target(graph, kind, entry.id.trim(), index);
        if (seen.has(`${kind}:${id}`)) { dropped.push({ index, kind, id, reason: 'duplicate_item' }); continue; }
        seen.add(`${kind}:${id}`);
        const kept = [...new Set((excerpts as string[]).flatMap(excerpt => {
            for (const source of delivered) { const located = locateExcerpt(source, excerpt); if (located) return [located]; }
            return [];
        }))];
        if (kept.length < excerpts.length)
            dropped.push({ index, kind, id, reason: 'excerpt_not_delivered', excerpts: excerpts.length - kept.length });
        if (!kept.length && pronoun === undefined) continue;
        results.push({ kind, id, excerpts: kept, ...(pronoun !== undefined ? { pronoun: text(pronoun) } : {}) });
    }
    return { results, dropped };
}

/**
 * Land checked results: a field is written once and never replaced. Every target the job asked about counts a try for
 * each field it still wanted and did not get, so a person the prose never describes stops being asked.
 */
export function applyLooks(looks: KeptLooks, turn: number, asked: readonly Row[], results: readonly LookResult[], at: string): { looks: KeptLooks; kept: Row[] } {
    const next: KeptLooks = { people: { ...looks.people }, places: { ...looks.places }, tries: { ...looks.tries } }, kept: Row[] = [];
    for (const result of results) {
        const shelfOf = next[shelf(result.kind)], before = shelfOf[result.id], fields: string[] = [];
        const excerpts = before?.excerpts.length ? before.excerpts : result.excerpts.slice(0, LOOK_EXCERPTS[result.kind]);
        if (!before?.excerpts.length && excerpts.length) fields.push('look');
        const pronoun = before?.pronoun ?? result.pronoun;
        if (!before?.pronoun && result.pronoun) fields.push('pronoun');
        if (!fields.length) continue;
        shelfOf[result.id] = { excerpts, ...(pronoun ? { pronoun } : {}), turn: before?.turn ?? turn, at: before?.at ?? at };
        kept.push({ kind: result.kind, id: result.id, fields });
    }
    for (const entry of asked) {
        const kind = text(entry.kind), id = text(entry.id), got = next[shelf(kind)][id];
        for (const field of array(entry.want).map(text)) {
            const has = field === 'look' ? !!got?.excerpts.length : !!got?.pronoun;
            if (has) delete next.tries[key(kind, id, field)];
            else next.tries[key(kind, id, field)] = (next.tries[key(kind, id, field)] ?? 0) + 1;
        }
    }
    return { looks: next, kept };
}

/**
 * The capsule's `kept_looks` section, or null when nothing here has one: the current place's look, and each person
 * present with a look or a pronoun, by the same id the `present` row carries. Excerpts are the delivered text's own.
 */
export function keptLooksSection(graph: ModuleGraph, world: Row, scene: Row, looks: KeptLooks): Row | null {
    const shown = (kind: string, value: Look): Row => ({
        ...(value.excerpts.length ? { look: chars(value.excerpts.join(' '), SHOWN_CHARS[kind]) } : {}),
        ...(value.pronoun ? { pronoun: value.pronoun } : {}) });
    const section: Row = {}, place = looks.places[graph.handle(scene)];
    if (place?.excerpts.length) section.place = { id: graph.handle(scene), ...shown('place', place) };
    const people = npcsPresent(graph, world, scene).flatMap(node => {
        const kept = looks.people[graph.handle(node)];
        return kept ? [{ id: graph.handle(node), ...shown('person', kept) }] : [];
    });
    if (people.length) section.people = people;
    return Object.keys(section).length ? section : null;
}

/** What a delivered turn's check kept, for its own record and a fork's carry. */
export function turnLooks(previous: unknown, results: readonly LookResult[], at: string): Row[] {
    const rows = array(previous).map(row).filter(entry => !results.some(result => result.kind === entry.kind && result.id === entry.id));
    return [...rows, ...results.map(result => ({ kind: result.kind, id: result.id, excerpts: [...result.excerpts],
        ...(result.pronoun ? { pronoun: result.pronoun } : {}), at }))];
}
/** A turn record's `looks`, as results to land again on a line that checked out an earlier ledger. */
export function looksOfRecord(record: Row | null): LookResult[] {
    return array(record?.looks).map(row).filter(entry => LOOK_KINDS.includes(text(entry.kind)) && text(entry.id) !== '')
        .map(entry => ({ kind: text(entry.kind), id: text(entry.id),
            excerpts: array(entry.excerpts).filter((item): item is string => typeof item === 'string' && item !== ''),
            ...(PRONOUNS.includes(text(entry.pronoun)) ? { pronoun: text(entry.pronoun) } : {}) }));
}
