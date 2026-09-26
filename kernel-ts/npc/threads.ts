/**
 * Contract §139.24 (docs/specs/npc-acts-first-tickets/25-the-keepers-added-lines-pass-the-same-gate.md): the rows a
 * delivery's spoken lines may say again.
 *
 * §139.5 and §139.14 keep the table's generated act of a person from being the same thing twice; the lines the Keeper
 * gives that person in the prose were never held to it (live table B2, turn 9). For a delivery's text this answers who
 * speaks in it by the Keeper's own say tokens -- resolved exactly as `table.narrate` resolves them (§40.1's
 * `speakerResolver`), a span the host wrapped (§128.3) left out -- whether the table acted for that person this turn or
 * they are in the conversation (§139.20), and their rows that were never carried out: under way since an earlier turn,
 * or given up. Whether a line is the same purpose as one of those rows is the host's Jev question (§139.14's wording);
 * the kernel lists the rows (`npc.threads`) and, at delivery, checks that a row the host names is one of them.
 *
 * Structure only: a handle from the say token, a status and turn numbers from the ledger's fold, a receipt's `intent`
 * stamp. Nothing here reads what a line or a row says.
 */
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import {RpcError} from '../errors.js';
import type {CampaignSnapshot} from '../read/campaign.js';
import {readCampaign} from '../read/handlers.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array, number, row, string, type Row} from '../read/values.js';
import {stanceTable} from '../write/contributions.js';
import {speakerResolver, speechPass} from '../write/speech.js';
import {receiptGenerated} from './intents.js';
import {committedOnLine, conversationOf, entryNow, intentHistory, personOf} from './situation.js';

/** One person who speaks in a delivery by the Keeper's own tokens, with the rows of theirs never carried out. */
export interface SpeakerThreads {
    npc: string;
    /** The name the delivery's token resolved to (the table's word for them, §79). */
    name: string;
    /** Why their lines are held to their rows: the table's own act of theirs this turn, or the conversation (§139.20). */
    trigger: 'act' | 'conversation';
    /** Their spoken words in this delivery, text order, tokens stripped (`speech[].text`). */
    lines: string[];
    /** `intentHistory` rows, under way first, then given up, each newest first. */
    threads: Row[];
}

/**
 * A row is a thread for the Keeper's lines when it was never carried out:
 * - under way (`attempted`) since an earlier turn -- a row set out this turn, the table's act or the Keeper's own, is
 *   what the prose renders now, not something said again;
 * - given up (`abandoned`), whenever: a person who put something down without doing it does not say it again.
 * A row settled by a result (`done`, `failed`) is not one: saying it again in a new situation is lawful, as §139.14 has
 * it for an act. Status and turns only. (An earlier row cannot be written `attempted` again on a later turn, §138.7's
 * `refuseRepeat`, so a row under way since an earlier turn has had nothing of this turn but a roll still to come.)
 */
function threadsOf(rows: Row[], n: number): Row[] {
    return rows.filter(item => (item.status === 'attempted' && number(item.since_turn, n) < n) || item.status === 'abandoned');
}

/**
 * For each person who speaks in `speech` (the delivery's rows, as `deliveryText` returns them) by a token the Keeper
 * wrote -- the ordinals in `host` are the host's own wraps and are left out -- and who has at least one thread, in the
 * order their first line comes. A person counts when the table's own act of theirs has a receipt this turn, or when they
 * are in the conversation where the investigators stand (`conversationOf`).
 */
export function speakerThreads(graph: ModuleGraph, campaign: CampaignSnapshot, ledger: Row, table: Row, speech: Row[],
    host: ReadonlySet<number> = new Set()): SpeakerThreads[] {
    const {world, turn} = campaign, n = number(turn.turn), receipts = array(turn.receipts).map(row);
    const speakers = new Map<string, {name: string; lines: string[]}>();
    speech.forEach((line, index) => {
        const who = row(row(line).who), handle = string(who.npc || '');
        if (!handle || host.has(index)) return;
        const words = string(row(line).text || '').trim();
        if (!words) return;
        const entry = speakers.get(handle) ?? {name: string(who.name || handle), lines: []};
        entry.lines.push(words);
        speakers.set(handle, entry);
    });
    if (!speakers.size) return [];
    const previous = committedOnLine(campaign).previous, out: SpeakerThreads[] = [];
    for (const [handle, spoken] of speakers) {
        const node = graph.find(handle, ['npc']);
        if (!node) continue;
        const me = personOf(graph, world, node);
        const own = receipts.filter(receipt => receiptGenerated(receipt) && me.is(row(receipt.intent).npc));
        const trigger = own.length ? 'act' : conversationOf(graph, world, me, turn, previous) ? 'conversation' : null;
        if (!trigger) continue;
        const threads = threadsOf(intentHistory(entryNow(graph, ledger, table, turn, node)), n);
        if (threads.length) out.push({npc: handle, name: spoken.name, trigger, lines: spoken.lines, threads});
    }
    return out;
}

/**
 * The rows the host names (`narrate`'s host-only `purpose_repeats: [{npc, ref}]`) that are this delivery's threads: one
 * per person, the first that names one of their threads. Anything else -- an unknown person, a row not theirs, a row
 * carried out, a person the Keeper's tokens do not make speak -- is ignored: a hint, never a reason to refuse by itself.
 */
export function namedRepeats(value: unknown, found: SpeakerThreads[]): Row[] {
    const named = array(value).map(row);
    const out: Row[] = [];
    for (const person of found) {
        const hit = named.find(entry => string(entry.npc) === person.npc && person.threads.some(item => item.ref === entry.ref));
        const thread = hit ? person.threads.find(item => item.ref === hit.ref) : undefined;
        if (thread) out.push({npc: person.npc, name: person.name, ref: thread.ref, intent: thread.intent, status: thread.status,
            since_turn: thread.since_turn ?? null, turn: thread.turn ?? null, lines: person.lines});
    }
    return out;
}

export function createThreadsHandlers(context: KernelContext): HandlerGroup {
    return {
        'npc.threads': async params => {
            if (typeof params.text !== 'string')
                throw new RpcError('invalid_params', 'params.text must be a string: the delivery the host is about to send', {details: {field: 'text'}});
            const {campaign, module} = await readCampaign(context, params, false, false, {}, true);
            const {graph} = module, {world, turn, party} = campaign;
            let ledger: Row = {};
            try { ledger = row(await campaign.optional('npc-ledger.json')); } catch { /* an unreadable ledger reads as empty, as for look */ }
            const speech = speechPass(params.text, speakerResolver(graph, world, party)).speech;
            const people = speakerThreads(graph, campaign, ledger, await stanceTable(context), speech);
            return {turn: number(turn.turn), people: people as unknown as Row[]};
        },
    };
}
