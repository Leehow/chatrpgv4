/**
 * Contract §158.5: an owed row lands through an ordinary `apply` whose effect names it (`owed: <name>`).
 *
 * The row is the review's, anchored against the delivered record when it was written (§158.3), so the Keeper's own
 * words cannot make one: an effect may only land a row that is open, that it matches, and whose quote is still in
 * what that turn delivered. A row the ledger comes to agree with any other way closes as `satisfied`.
 */
import { cashDecimal, compareCash } from '../apply/cash.js';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { personNode, referencedPerson } from '../read/capsule.js';
import { actor } from '../read/handlers.js';
import { ownerIn } from '../mods/stage.js';
import { locateExcerpt } from '../read/excerpt.js';
import { repr, row, type Row } from '../read/values.js';
import { clueOf, resolveOwedEquipment, owedSatisfied, closeSatisfied, readOwed, writeOwed, type OwedLedger } from './index.js';

const text = (value: unknown): string => typeof value === 'string' ? value : '';
/** A place as the kernel knows it: its handle when the graph has it, else the name (a place still to be established). */
function sceneKey(graph: ModuleGraph, name: unknown): string {
    try { return graph.handle(graph.scene(text(name).trim())); }
    catch { return text(name).trim().normalize('NFKC').toLowerCase(); }
}
function personKey(graph: ModuleGraph, world: Row, name: unknown): string {
    const node = text(name).trim() ? personNode(graph, world, text(name).trim()) : null;
    return node ? graph.handle(node) : text(name).trim().normalize('NFKC').toLowerCase();
}
/**
 * §188.4: whether a landing effect names the row's stored reference, compared as what each names, never by spelling. `read`
 * answers an identity for a value, or null when the value names nothing it knows; only then is the spelling compared, as
 * it always was. A refusal `read` throws (a word two people carry) is the effect's refusal.
 */
function sameReference(given: unknown, stored: unknown, read: (value: string) => string | null): boolean {
    const identity = (value: unknown) => text(value).trim() ? read(text(value).trim()) : null;
    const now = identity(given), then = identity(stored);
    return now !== null && then !== null ? now === then : given === stored;
}
/** The investigator a cash row's `subject` names, as `apply cash` reads it (sheet id or registered name), else null. */
function investigatorId(party: readonly Row[], name: string): string | null {
    try { return text(actor([...party], name).id) || null; }
    catch (error) { if (error instanceof RpcError && error.code === 'unknown_entity') return null; throw error; }
}
/** The owner an object row's `to` names, as `apply object` reads it (`ownerIn`), else null; a word two people carry is refused. */
function ownerId(party: readonly Row[], graph: ModuleGraph, world: Row, name: string): string | null {
    try { const owner = ownerIn(party, graph, world, name); return `${text(owner.kind)}:${text(owner.id)}`; }
    catch (error) { if (error instanceof RpcError && error.details?.field === 'object.owner') return null; throw error; }
}
function refusal(reason: string, message: string, fix: string, details: Row = {}): RpcError {
    return new RpcError('invalid_params', message, { fix, details: { field: 'owed', reason, ...details } });
}
/** Whether `effect` lands exactly what `entry` owes; `world` is the staged world (a person "here" is where the party stands now). */
function lands(graph: ModuleGraph, world: Row, party: readonly Row[], entry: Row, effect: Row): boolean {
    const owed = row(entry.effect);
    if (entry.kind === 'move') return sceneKey(graph, effect.to) === sceneKey(graph, owed.to);
    if (entry.kind === 'time') return text(effect.band) !== '' && text(effect.band) === text(owed.band);
    // §201.1: the clue is compared as the clue the graph names, and lands as the authored clue it was told as.
    if (entry.kind === 'clue') {
        const given = clueOf(graph, effect.clue), told = clueOf(graph, owed.clue);
        return !!given && !!told && graph.handle(given) === graph.handle(told) && effect.establish === undefined;
    }
    if (entry.kind === 'npc') {
        if (personKey(graph, world, effect.name) !== personKey(graph, world, owed.name)) return false;
        if (owed.to === 'away' || effect.to === 'away') return owed.to === effect.to;
        return sceneKey(graph, effect.to === 'here' ? world.active_scene : effect.to) === sceneKey(graph, owed.to);
    }
    if (entry.kind === 'object') {
        // §188.4: the receiver is compared as the owner `apply object` reads, never by spelling.
        return ['name','definition','adopt','quantity'].every(key => effect[key] === owed[key]) && sameReference(effect.to, owed.to, name => ownerId(party, graph, world, name))
            && !['from','part','condition','document','offer','handover','check'].some(key => effect[key] !== undefined);
    }
    if (entry.kind === 'cash') {
        const keys = ['currency', 'source', 'settlement'];
        const amount = cashDecimal(effect.delta), expected = cashDecimal(owed.delta);
        // §188.4: the purse is compared as the investigator `apply cash` reads, and the counterparty as the person the
        // junction reads (§87.8: the graph, then this table's word); only a value that names nobody compares its spelling.
        const subject = sameReference(effect.subject, owed.subject, name => investigatorId(party, name));
        const counterparty = sameReference(effect.with, owed.with, name => { const person = referencedPerson(graph, world, name); return person ? graph.handle(person) : null; });
        return !!amount && !!expected && compareCash(amount,expected) === 0 && keys.every(key => effect[key] === owed[key]) && subject && counterparty
            && !['stated', 'band', 'price_id'].some(key => effect[key] !== undefined);
    }
    return false;
}
/**
 * The open row `given` (the effect as sent, before any band or stated amount is bound) lands, or `null` when it names
 * none. Refuses an unknown or closed name, a row it does not land, and a row whose quote the delivered text lost.
 */
export async function owedRowFor(campaign: { readTurnRecord(turn: number): Promise<Row | null>; party(): Promise<readonly Row[]> }, graph: ModuleGraph, world: Row, ledger: OwedLedger, given: Row): Promise<Row | null> {
    if (given.owed === undefined) return null;
    const party = await campaign.party();
    ledger = resolveOwedEquipment(ledger, party);
    const name = text(given.owed).trim(), open = ledger.open.map(entry => text(entry.name));
    if (!['move', 'time', 'npc', 'clue', 'cash', 'object'].includes(text(given.kind)))
        throw refusal('owed_kind', `a ${text(given.kind)} effect cannot land owed state`, 'Leave owed out: only move, time, npc, clue, cash and object effects land an owed row.', { kind: given.kind });
    const entry = ledger.open.find(value => value.name === name);
    if (!name || !entry)
        throw refusal('owed_unknown', `${repr(given.owed)} names no open owed row`, 'Leave owed out, or name a row of the capsule\'s owed section exactly as it is written.', { owed: given.owed ?? null, open });
    if (!entry.effect)
        throw refusal('owed_unresolved', 'This owed row has no issued settlement effect.',
            'Do not guess an effect or attach this owed name to a different action. Resolve its ownership or definition through the existing preparation path; unrelated actions omit owed.', {owed:name});
    if (entry.kind !== given.kind || !lands(graph, world, party, entry, given))
        throw refusal('owed_mismatch', `this ${text(given.kind)} effect does not land owed row ${name} (${text(entry.what)})`,
            'Send the row\'s effect exactly as the capsule\'s owed section gives it, with owed; for a different action, leave owed out.', { owed: name, effect: entry.effect ?? null });
    const record = await campaign.readTurnRecord(Number(entry.turn));
    const equipment = entry.kind === 'object' && entry.equipment_basis === true
        && (await campaign.party()).some(person => person.id === entry.owner_id && Array.isArray(person.equipment)
            && person.equipment.filter((value: unknown) => (typeof value === 'string' ? value : row(value).name) === row(entry.effect).adopt && !row(value).object_id).length === 1);
    if (!equipment && !locateExcerpt(text(record?.rendered_text), entry.quote))
        throw refusal('owed_not_told', `the sentence owed row ${name} quotes is not in what turn ${entry.turn} delivered`,
            'Leave owed out: this row cannot be landed as told state.', { owed: name, turn: entry.turn });
    return entry;
}
/** After a batch landed: the rows its receipts landed close as `landed`, and the rows the ledger now agrees with as `satisfied`. */
export async function settleOwed(kernel: KernelContext, campaign: string, graph: ModuleGraph, world: Row, receipts: Row[], at: string, party: readonly Row[] = []): Promise<Row[]> {
    const ledger = resolveOwedEquipment(await readOwed(kernel, campaign),party);
    if (!ledger.open.length) return [];
    const landed = receipts.filter(receipt => typeof receipt.owed === 'string' && ledger.open.some(entry => entry.name === receipt.owed && (entry.kind !== 'object' || owedSatisfied(graph, world, {...entry,owner_id:entry.owner_id ?? receipt.subject}))));
    const names = new Set(landed.map(receipt => text(receipt.owed)));
    // Any other move that landed after the told turn moved the story on: the told position is the past, not where the
    // party is now, so an owed move still open is superseded -- landing it later would carry the party back.
    const moved = receipts.find(receipt => receipt.kind === 'move' && !receipt.renamed && typeof receipt.owed !== 'string');
    const superseded = moved ? ledger.open.filter(entry => entry.kind === 'move' && !names.has(text(entry.name))) : [];
    let next: OwedLedger = { open: ledger.open.filter(entry => !names.has(text(entry.name)) && !superseded.includes(entry)),
        closed: [...ledger.closed, ...landed.map(receipt => {
            const entry = ledger.open.find(value => value.name === receipt.owed)!;
            return { name: entry.name, turn: entry.turn, kind: entry.kind, ...(entry.kind === 'cash' ? {effect:entry.effect,quote:entry.quote,job:entry.job} : {}), how: 'landed', receipt: receipt.id, at };
        }), ...superseded.map(entry => ({ name: entry.name, turn: entry.turn, kind: entry.kind, how: 'superseded', receipt: moved!.id, at }))] };
    const satisfied = closeSatisfied(graph, world, next, at, party);
    next = satisfied.ledger;
    const closed = [...next.closed.slice(ledger.closed.length)];
    if (closed.length) await writeOwed(kernel, campaign, next);
    return closed;
}
