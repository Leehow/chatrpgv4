/**
 * What a person is trying to do, and how it went (docs/specs/npc-as-actor.md D1, contract §142).
 *
 * An intention is one line of Keeper-facing English -- "shout for help and get the man thrown out" -- that belongs to
 * one person. Its identity is the person's handle and a digest of the line itself, so the same line written twice, by
 * the Keeper or by the table's own act of that person (§143), is one intention, and the ledger can be rebuilt from the
 * turn records alone.
 *
 * The truth of where an intention stands is the receipts: every receipt that carries `intent: {ref, npc, text, outcome}`
 * folds into the person's ledger entry (`intents`), exactly as every other ledger field is a fold of receipts (§17.4).
 * Nothing here reads prose, compares wording or classifies what a person does: two different sentences are two
 * intentions, and whether a line was announced, tried or dropped is what a receipt says, never what the text sounds like.
 */
import {sha256Text} from '../json.js';
import {array, normalizeText, number, row, string, type Row} from '../read/values.js';

/** Where an intention stands. `attempted` is under way with no result yet; the other three are settled. */
export const INTENT_OUTCOMES: readonly string[] = Object.freeze(['attempted', 'done', 'failed', 'abandoned']);
export const SETTLED_OUTCOMES: readonly string[] = Object.freeze(['done', 'failed', 'abandoned']);
/** How long an intention line may be. */
export const INTENT_TEXT_LIMIT = 400;
/** How many results of one intention the ledger keeps, and how many intentions a present person's card shows. */
const ATTEMPTS_KEPT = 4, SETTLED_SHOWN = 3;

/** `intent:<handle>:<digest>` -- the handle says whose it is, the digest says which line. */
export function intentRef(handle: string, text: string): string {
    return canonicalIntentRef(handle, sha256Text(normalizeText(text)).slice(0, 12));
}
/** §185.2: the canonical form new receipts store and cards show, from the owner's handle and the line's digest. */
export const canonicalIntentRef = (handle: string, digest: string): string => `intent:${handle}:${digest}`;
/**
 * §185.2: an intention reference's two parts, or null when the string is not one. The owner segment is whatever the
 * writer spelled -- the handle, or the word the request showed in its place -- and is resolved like any person reference.
 */
export function intentParts(ref: unknown): {owner: string; digest: string} | null {
    if (typeof ref !== 'string' || !ref.startsWith('intent:')) return null;
    const body = ref.slice('intent:'.length), cut = body.lastIndexOf(':'), digest = body.slice(cut + 1);
    return cut > 0 && /^[0-9a-f]{12}$/.test(digest) ? {owner: body.slice(0, cut), digest} : null;
}
/**
 * §185.2: what a Keeper-facing view shows for a stored ref -- the canonical form, from the owner's current handle and the
 * row's digest. The stored string stays as stored; a string that is not a reference is shown as it is.
 */
export function shownIntentRef(ref: unknown, handle: string): string {
    const parts = intentParts(ref);
    return parts ? canonicalIntentRef(handle, parts.digest) : string(ref);
}
/** The owner segment of an intention reference, or null when the string is not one. */
export function intentOwner(ref: unknown): string | null {
    return intentParts(ref)?.owner ?? null;
}
export const isSettled = (status: unknown): boolean => SETTLED_OUTCOMES.includes(string(status));

/** The ledger's intentions for one person, oldest first. */
export function intentsOf(entry: Row): Row[] {
    return array(row(entry).intents).map(row).filter(item => typeof item.ref === 'string');
}
/**
 * The ledger row `ref` names (§185.2): the same digest, and an owner `sameOwner` says is the same person. The given
 * reference and every stored one are parsed, so a reference written with any word for the owner finds the row; stored
 * refs are read as written, never rewritten. Without `sameOwner` the two owner segments must be equal.
 */
export function intentOf(entry: Row, ref: string, sameOwner?: (owner: string) => boolean): Row | null {
    const wanted = intentParts(ref);
    if (!wanted) return null;
    const same = sameOwner ?? ((owner: string) => owner === wanted.owner);
    return intentsOf(entry).find(item => {
        const stored = intentParts(item.ref);
        return stored !== null && stored.digest === wanted.digest && same(stored.owner);
    }) ?? null;
}

/**
 * §143.6: whether a receipt is the table's own act of a person -- one the generation step wrote and the host bound
 * (§143, ticket 03), not one the Keeper wrote. Read from the `intent` stamp's `generated` (never from `basis`, which is
 * the string `"stated"` / `"keeper"` of §136.22 on damage, time, threat, flag and cash receipts).
 */
export function receiptGenerated(receipt: unknown): boolean {
    return row(row(receipt).intent).generated === true;
}

/**
 * Fold one receipt's `intent` into a ledger entry. A fold, not a check: the writer refused anything unlawful.
 * `generated` (§143.6) marks the row when the receipt that opens it is the table's own act; it says who set the
 * intention out, so a later result -- the Keeper settling it, or the table continuing it -- never changes it.
 * `onePerson` says `item` is one person's entry (§185.2): a stored row of the same digest is then this intention, whatever
 * word its stored ref spells the owner with, and keeps its ref as stored.
 */
export function foldIntent(item: Row, intent: Row, turn: number, receipt: unknown, generated = false, onePerson = false): void {
    const ref = intent.ref, outcome = intent.outcome, text = intent.text;
    if (typeof ref !== 'string' || !ref || typeof outcome !== 'string' || !INTENT_OUTCOMES.includes(outcome) || typeof text !== 'string') return;
    const list: Row[] = Array.isArray(item.intents) ? item.intents : (item.intents = []);
    const digest = onePerson ? intentParts(ref)?.digest : undefined;
    let found = list.find(entry => row(entry).ref === ref || (digest !== undefined && intentParts(row(entry).ref)?.digest === digest));
    if (!found) {
        found = {ref, text, status: outcome, since_turn: turn, last_turn: turn, attempts: [], ...(generated ? {generated: true} : {})};
        list.push(found);
    }
    found.status = outcome;
    found.last_turn = turn;
    found.attempts = [...array(found.attempts), {turn, receipt: receipt ?? null, outcome}].slice(-ATTEMPTS_KEPT);
}

/**
 * The card's view (§142.3): every intention still under way, then the most recently settled ones, newest first. The
 * `ref` is what a writer names to report the next result, in its canonical form from `handle`, the person's (§185.2).
 * `by: "table"` (§143.6) marks one the table's own act of this person set out; one the Keeper set out carries no `by`.
 */
export function intentsView(entry: Row, handle: string): Row[] {
    const all = intentsOf(entry).sort((a, b) => number(b.last_turn) - number(a.last_turn));
    const shown = [...all.filter(item => !isSettled(item.status)), ...all.filter(item => isSettled(item.status)).slice(0, SETTLED_SHOWN)];
    return shown.map(item => ({ref: shownIntentRef(item.ref, handle), intent: item.text, status: item.status, since_turn: item.since_turn ?? null, turn: item.last_turn ?? null,
        ...(item.generated === true ? {by: 'table'} : {})}));
}
/** Intentions under way with no result yet. */
export function openIntents(entry: Row): Row[] {
    return intentsOf(entry).filter(item => item.status === 'attempted');
}
