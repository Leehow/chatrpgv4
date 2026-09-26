/**
 * Contract §139.23 (ticket 24, docs/specs/npc-acts-first.md section 9, table B2 turn 10): the newest committed turn on
 * the campaign's line, and the exchange it holds while the investigators still stand where it closed -- the player's
 * words that turn and the lines the delivery's speech markers attributed to a person (the record's `speech`,
 * §40.3/§128). `table.status` carries it as `last_exchange` for the host's compile (§135.30), whose addressee question
 * reads a word that points at a person instead of naming them by who was just talking with the investigator.
 * `npc.situation` and `npc.act.options` read the same newest turn and the same "still there" test (§139.1, §139.20).
 *
 * Structure only: nothing here reads what anyone said, and nothing is written. A line whose speaker the markers did not
 * resolve to a person is not the exchange of anyone the compile can name.
 */
import type { CampaignSnapshot } from './campaign.js';
import { personLabel } from './capsule.js';
import type { ModuleGraph } from './module-graph.js';
import { array, number, row, string, truth, type Row } from './values.js';

/** The exchange's named bounds: the delivery's last lines kept, one line's code points, the player's words' code points. */
export const EXCHANGE_LINES = 6, EXCHANGE_LINE_MAX = 200, EXCHANGE_WORDS_MAX = 400;
const ELLIPSIS = '...';

// Absent is empty (a null rendered through `string()` would be Python's "None").
const flat = (value: unknown): string => (value == null ? '' : string(value)).replace(/\s+/g, ' ').trim();
function clip(value: unknown, max: number): string {
    const text = flat(value), points = Array.from(text);
    return points.length <= max ? text : `${points.slice(0, Math.max(0, max - ELLIPSIS.length)).join('')}${ELLIPSIS}`;
}

/** A record on this campaign's current line (the same test `npcPerspective` reads records under). */
export function onLine(value: Row, scope: Row): boolean {
    return value.superseded_by == null && value.status !== 'superseded'
        && (value.worldline == null || scope.worldline == null || value.worldline === scope.worldline)
        && (value.loop == null || scope.loop == null || number(value.loop) === number(scope.loop));
}

/**
 * The committed turn records on the campaign's current line, and the newest of them before this turn. `all` is the
 * campaign's turn records (`campaign.records` once preloaded; a minimal read passes the ones it read itself).
 */
export function committedOnLine(campaign: CampaignSnapshot, all: Row[] = campaign.records): {scope: Row; records: Row[]; previous: Row | null} {
    const worldline = string(campaign.meta.active_worldline || 'main');
    const scope = {worldline, loop: number(row(row(campaign.meta.worldlines)[worldline]).loop)};
    const records = all.filter(record => truth(record.commit) && onLine(record, scope));
    const previous = records.filter(record => number(record.turn) < number(campaign.turn.turn)).sort((a, b) => number(b.turn) - number(a.turn))[0] ?? null;
    return {scope, records, previous};
}

/**
 * Whether the investigators still stand where a committed turn closed: its record's scene is the active scene. Leaving
 * that scene ends the exchange (§139.20's conversation, and this section's `last_exchange`).
 */
export function stillWhereItClosed(graph: ModuleGraph, world: Row, record: Row | null): boolean {
    const active = string(world.active_scene);
    if (!record || !active) return false;
    const scene = graph.find(active, ['scene']), here = scene ? graph.handle(scene) : active;
    return string(row(row(record.world).scene).name) === here;
}

/**
 * The exchange of one committed turn, or null: `{turn, player_text, speech: [{who, line}]}`. `player_text` is the
 * player's words that turn (null when it had none, as the opening has none); `speech` the delivery's last
 * `EXCHANGE_LINES` lines whose speaker the markers resolved to a person, in order, each by the table's name for them
 * now. Null when the investigators no longer stand where it closed, or when it holds neither words nor lines.
 */
export function exchangeOf(world: Row, record: Row): Row | null {
    const said = clip(record.player_text, EXCHANGE_WORDS_MAX);
    const speech = array(record.speech).map(row).flatMap(line => {
        const who = row(line.who), text = clip(line.text, EXCHANGE_LINE_MAX);
        const id = typeof who.npc === 'string' && who.npc ? who.npc : typeof who.investigator === 'string' && who.investigator ? who.investigator : '';
        return id && text ? [{who: personLabel(world, id, string(who.name || id)), line: text}] : [];
    }).slice(-EXCHANGE_LINES);
    return said || speech.length ? {turn: number(record.turn), player_text: said || null, speech} : null;
}

/**
 * `table.status`'s `last_exchange` (§139.23): the exchange of the newest committed turn on the line before this one,
 * while the investigators still stand where it closed; null otherwise. It is context for a model's judgement, never a
 * gate, so a turns directory that cannot be read is no exchange rather than a failed status read (the card of a turn
 * that could not be delivered is drawn from `table.status`, §50).
 */
export async function lastExchange(campaign: CampaignSnapshot, graph: ModuleGraph): Promise<Row | null> {
    try {
        const records = campaign.records.length ? campaign.records : await campaign.files('turns');
        const {previous} = committedOnLine(campaign, records);
        return previous && stillWhereItClosed(graph, campaign.world, previous) ? exchangeOf(campaign.world, previous) : null;
    } catch {
        return null;
    }
}
