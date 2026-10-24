/**
 * Contract §258.13: what became of deals, read back from the delivered reply in the background (the owner, 2026-10-24: a
 * background task after the final text recognises the marks and writes them back, as kept looks do). The Keeper rarely marks an agreement in its packet, and a
 * service it prices with `cash` never became a proposal at all, so the deal ledger stayed empty. After a delivery the host
 * asks `table.deals.job` what is still open for the people of the scene and what was paid that turn, the deal lane answers
 * from the reply, and `table.deals` writes the marks onto that turn's `communication`, where `agreementView` reads them.
 *
 * Nothing here reads prose for meaning: which deal the reply settled, and whether a paid thing is still owed, is the lane's
 * answer; the kernel checks references, transitions and that a paid receipt is that turn's own purchase.
 */
import { RpcError } from '../errors.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, number, row, string, type Row } from '../read/values.js';
import { agreementView, DEAL_NEXT } from './communication.js';
import { isNpcReference, npcReference } from './references.js';

/** Marks and paid deals one submission may write. */
export const DEAL_MARKS_MAX = 16;
/** Deals and purchases one job names. */
const JOB_DEALS_MAX = 12, JOB_PAID_MAX = 8;

export interface DealPerson { ref: string; name: string }
export interface DealJob { deals: Row[]; paid: Row[]; people: DealPerson[]; spoken: Row[] }
/** Spoken events one job names for the aside question. */
const JOB_SPOKEN_MAX = 12;

/**
 * The paid purchases a turn's receipts hold: a `cash` purchase with a positive amount that was settled. A quote is an offer,
 * not a payment, and a cancelled bill paid nothing (app re-test: the tyres' quote and their payment became two deals).
 */
function purchases(record: Row): Row[] {
    return array(record.receipts).map(row).filter(receipt => receipt.kind === 'cash' && receipt.category === 'purchase'
        && number(receipt.purchase_amount) > 0 && typeof receipt.id === 'string' && !['quote', 'cancelled'].includes(string(receipt.settlement)));
}
const what = (receipt: Row): string => {
    const lines = array(receipt.items).map(item => string(row(item).name)).filter(Boolean).join(', ');
    return [...(typeof receipt.why === 'string' && receipt.why.trim() ? receipt.why.trim() : lines)].slice(0, 160).join('');
};

/**
 * What the lane is asked about one delivered turn: the open proposals and accepted commitments of the people present (their
 * own, newest first), and that turn's paid purchases not yet recorded as a deal. `people` are the candidates a paid deal's
 * seller is chosen from, by the word the table calls them.
 */
export function dealJob(graph: ModuleGraph, world: Row, present: Row[], records: Row[], record: Row, scope: Row, name: (node: Row) => string,
    refName: (ref: string) => string = ref => ref): DealJob {
    const turn = number(record.turn), people: DealPerson[] = [];
    for (const node of present) {
        const ref = npcReference(graph, world, node);
        if (ref && !people.some(person => person.ref === ref)) people.push({ ref, name: name(node) });
    }
    const label = new Map(people.map(person => [person.ref, person.name]));
    const deals = people.flatMap(person => agreementView(records, person.ref, scope, turn + 1).filter(deal => deal.by === person.ref)
        .map(deal => ({ content_id: deal.content_id, by: deal.by, by_name: label.get(deal.by) ?? deal.by, status: deal.status,
            ...(deal.gist ? { gist: deal.gist } : {}), made_turn: deal.made_turn }))).slice(0, JOB_DEALS_MAX);
    const recorded = new Set(array(row(record.communication).paid).map(deal => string(row(deal).receipt)));
    const paid = purchases(record).filter(receipt => !recorded.has(string(receipt.id))).map(receipt => ({ receipt: receipt.id,
        ...(typeof (receipt.with_label ?? receipt.with) === 'string' ? { with: receipt.with_label ?? receipt.with } : {}), what: what(receipt),
        amount: number(receipt.purchase_amount), ...(typeof receipt.currency === 'string' ? { currency: receipt.currency } : {}) })).slice(0, JOB_PAID_MAX);
    // The turn's lines said aloud (no channel), with who said them to whom: the lane asks whether the reply has them said low.
    const spoken = array(row(record.communication).events).map(row).filter(event => !event.channel && event.status === 'attested' && typeof event.id === 'string'
        && array(event.heard).some(ref => isNpcReference(ref))).map(event => ({ event: event.id, speaker: label.get(string(event.actor)) ?? refName(string(event.actor)),
        to: array(event.to).map(ref => label.get(string(ref)) ?? refName(string(ref))),
        said: [...array(event.items).map(item => string(row(item).gist)).filter(Boolean).join(' ')].slice(0, 200).join('') })).slice(0, JOB_SPOKEN_MAX);
    return { deals, paid, people, spoken };
}

/**
 * The lane found these lines said low: each becomes an aside. Who overhears is each bystander's own Listen roll (§258.12),
 * made here for the people who heard it aloud before; only a pass keeps hearing it. Returns the rewritten events.
 */
export function applyAsides(communication: Row, asides: string[], roll: (seq: number, ref: string) => Row): Row[] {
    const changed: Row[] = [];
    communication.events = array(communication.events).map(row).map(event => {
        if (!asides.includes(string(event.id)) || event.channel) return event;
        const rolls = array(event.heard).filter(ref => isNpcReference(ref)).map(ref => roll(number(event.seq), string(ref)));
        const heard = rolls.filter(item => item.passed).map(item => item.ref);
        const next = { ...event, channel: 'aside', heard, ...(heard.length ? { overheard: heard } : {}), ...(rolls.length ? { overhear_rolls: rolls } : {}), aside_by_lane: true };
        changed.push(next);
        return next;
    });
    return changed;
}

/**
 * `table.deals`'s marks and paid deals, checked against the job: a mark names a deal of the job by content and maker and moves
 * it one allowed step (open: accepted, declined, withdrawn; accepted: kept, broken, withdrawn); a paid deal names one of the
 * turn's purchases and a person present as the one who owes it. Anything else is dropped with a reason.
 */
export function checkDealMarks(job: DealJob, params: Row, record: Row, investigator: string): { marks: Row[]; paid: Row[]; asides: string[]; dropped: Row[] } {
    const marksIn = array(params.marks), paidIn = array(params.paid);
    const asides = [...new Set(array(params.asides).filter(id => typeof id === 'string' && job.spoken.some(entry => entry.event === id)) as string[])];
    if (marksIn.length + paidIn.length > DEAL_MARKS_MAX)
        throw new RpcError('invalid_params', `at most ${DEAL_MARKS_MAX} marks and paid deals in one call`, { fix: 'send only what the reply settled' });
    const marks: Row[] = [], paid: Row[] = [], dropped: Row[] = [];
    for (const [index, value] of marksIn.entries()) {
        const mark = row(value), deal = job.deals.find(entry => entry.content_id === mark.content_id && entry.by === mark.by);
        if (!deal) { dropped.push({ index, reason: 'unknown_deal' }); continue; }
        if (!DEAL_NEXT[string(deal.status)]?.includes(string(mark.status))) { dropped.push({ index, reason: 'not_a_next_status', status: mark.status }); continue; }
        if (marks.some(entry => entry.content_id === deal.content_id && entry.by === deal.by)) { dropped.push({ index, reason: 'duplicate' }); continue; }
        marks.push({ content_id: deal.content_id, by: deal.by, status: mark.status, ...(mark.status === 'accepted' ? { with: [investigator] } : {}), by_lane: true });
    }
    const receipts = new Map(purchases(record).map(receipt => [string(receipt.id), receipt]));
    for (const [index, value] of paidIn.entries()) {
        const entry = row(value), receipt = receipts.get(string(entry.receipt)), job_row = job.paid.find(item => item.receipt === entry.receipt);
        if (!receipt || !job_row) { dropped.push({ index: marksIn.length + index, reason: 'unknown_receipt' }); continue; }
        if (!isNpcReference(entry.by) || !job.people.some(person => person.ref === entry.by)) { dropped.push({ index: marksIn.length + index, reason: 'not_present' }); continue; }
        if (paid.some(item => item.receipt === entry.receipt)) { dropped.push({ index: marksIn.length + index, reason: 'duplicate' }); continue; }
        paid.push({ receipt: receipt.id, content_id: `c:${string(receipt.id).replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 118)}`, by: entry.by,
            to: [investigator], ...(job_row.what ? { gist: job_row.what } : {}) });
    }
    return { marks, paid, asides, dropped };
}
