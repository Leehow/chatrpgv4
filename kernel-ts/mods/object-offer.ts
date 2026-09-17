/**
 * Contract §NN. An offer is not a delivery.
 *
 * The object model had one word for where a thing is -- who owns it -- and none for a thing held
 * out and not yet taken. Turn 125 of `game-1c0faba5` is what that costs. The Keeper wrote the
 * transfer of a sealed abstract to Knott at call `t125-c2`, then rolled the Persuade that was to
 * decide whether he would take it at `t125-c4`; the roll came up 34 against a threshold of 25 and
 * failed, the prose had him push the paper back to the middle of the table, and `world.json` said
 * it was his. Turn 126 carried it back with `from: "Steven Knott"`, no check and nobody's leave,
 * and the engine took that too. Neither move needed anyone to agree, and the roll that was supposed
 * to decide the first one had no connection to the write at all.
 *
 * So two things are added, and both are accounting rather than any reading of what was said.
 *
 * `offer` is the missing position: `made` records that the holder is holding it out to someone and
 * moves nothing, `declined` clears that and moves nothing, `accepted` closes it and moves the
 * object. A refused offer therefore has an answer to "where is the paper" -- still with the person
 * who held it out, which is what the prose already said.
 *
 * `handover` is the ground a person-to-person move stands on, and `check` is the one ground that
 * names a number: a roll receipt already recorded in this turn. Already recorded is the whole
 * mechanism -- a call that has not settled cannot be cited, so writing the outcome first and
 * rolling for it afterwards has no expressible form; and a cited roll that did not pass refuses the
 * move, because the dice decided it and the dice said no.
 *
 * §31's three ends. Writes it: `apply object`, through `stageModEffect`. Reads it: `publicItems`
 * and `objectLook` carry it on the instance, and `offerObligations` puts every open one in the
 * capsule with the call that closes it. Acts on it: the Keeper, which must close an open offer
 * before it may move that object between those two again.
 *
 * Nothing here is §31.2's offer ledger, which counts capabilities the Keeper was shown and never
 * reached for. This is world state about a physical object, and it does belong in the capsule.
 *
 * Deployment (§NN.5): what this file requires, `extensions/kernel/tools.ts` must already offer. The
 * kernel is rebuilt live and that schema is read once at server start, so a rebuild without a restart
 * refuses every person-to-person move for a field the Keeper has no way to write.
 */
import {RpcError} from '../errors.js';
import {array, clone, equal, row, string, truth, type Row} from '../read/values.js';

export const GROUNDS = ['given', 'taken', 'check'] as const;
export const DISPOSITIONS = ['made', 'accepted', 'declined'] as const;
export const isPerson = (owner: Row | null): boolean => owner !== null && ['investigator', 'npc'].includes(string(row(owner).kind));

/** A move between two different people. Everything else -- a place, a container, a first award with no giver -- is not. */
export const betweenPeople = (source: Row | null, owner: Row): boolean => isPerson(source) && isPerson(owner) && !equal(source, owner);

export const openOffer = (item: Row | null): Row | null => item && truth(item.offer) ? row(item.offer) : null;

/**
 * What to call someone in a refusal. §76 and §79: this table's own word for a person or a place is
 * `world.person_labels` / `world.scene_labels`, and a `fix` a Keeper executes literally should be in
 * the words that table is using. The caller resolves it (it holds the world); the authored identity
 * name is the fallback, which is what it already was.
 */
export type Names = {from: string; to: string};
const label = (owner: Row): string => string(row(owner).name || row(owner).id);
const said = (names: Names | null, side: 'from' | 'to', owner: Row): string => names ? names[side] : label(owner);

/**
 * The ground the move stands on, and -- for the one ground that names a number -- the roll it names.
 *
 * `turnReceipts` is this turn's already-committed receipts. A roll minted by the call now in flight
 * is not in it and cannot become citable by anything this call does, which is what makes the
 * ordering mechanical rather than advisory.
 */
export function validateHandover(effect: Row, source: Row | null, owner: Row, turnReceipts: Row[], disposition: string | null = null, names: Names | null = null): Row | null {
    const ground = effect.handover, cited = effect.check;
    if (disposition === 'made' || disposition === 'declined') {
        if (ground !== undefined || cited !== undefined)
            throw new RpcError('invalid_params', `offer ${JSON.stringify(disposition)} moves nothing, so it stands on no ground`,
                {fix: 'drop handover and check; the ground belongs on the offer "accepted" that closes this, if a roll decides it',
                 details: {field: 'object.handover', offer: disposition}});
        return null;
    }
    if (!betweenPeople(source, owner)) {
        if (ground !== undefined || cited !== undefined)
            throw new RpcError('invalid_params', 'handover states how one person parted with a thing and another took it; this move has no second person in it',
                {fix: 'drop handover and check: a place, a container, and an award with no named giver need no ground',
                 details: {field: 'object.handover', from: source ? said(names, 'from', source) : null, to: said(names, 'to', owner)}});
        return null;
    }
    if (typeof ground !== 'string' || !(GROUNDS as readonly string[]).includes(ground))
        throw new RpcError('invalid_params', `moving ${string(effect.name)} from ${said(names, 'from', source!)} to ${said(names, 'to', owner)} needs its ground; ${JSON.stringify(ground ?? null)} is not one of ${GROUNDS.join(', ')}`,
            {fix: 'handover "given" when both sides were willing and nobody asked the dice, "taken" when one side\'s leave was neither sought nor needed, or handover "check" with check set to the call_id of a roll already settled in this turn that decided it. If the dice are still to decide whether they take it, do not move it: apply object offer "made" holds it out, and offer "accepted" or "declined" closes that once the roll is in',
             details: {field: 'object.handover', supported: [...GROUNDS], from: said(names, 'from', source!), to: said(names, 'to', owner)}});
    if (ground !== 'check') {
        if (cited !== undefined)
            throw new RpcError('invalid_params', `handover ${ground} names no roll`,
                {fix: 'drop check, or set handover to "check" when a settled roll decided this', details: {field: 'object.check', handover: ground}});
        return {handover: ground};
    }
    if (typeof cited !== 'string' || !cited.trim())
        throw new RpcError('invalid_params', 'handover "check" names the roll that decided it',
            {fix: 'set check to the call_id of a resolve already settled in this turn', details: {field: 'object.check'}});
    const rolls = turnReceipts.filter(receipt => row(receipt).kind === 'roll');
    const found = rolls.find(receipt => string(row(receipt).call_id) === cited.trim());
    if (!found)
        throw new RpcError('invalid_params', `no roll settled in this turn under call ${JSON.stringify(cited.trim())}`,
            {fix: rolls.length
                ? 'a roll can be cited only after it has settled: name one of details.settled, or settle the roll first and apply this afterwards'
                : 'nothing has been rolled in this turn yet. Settle the check first and apply the handover after it, or use handover "given" or "taken" when no roll decides this',
             details: {field: 'object.check', settled: [...new Set(rolls.map(receipt => string(row(receipt).call_id)))]}});
    if (!truth(row(found).passed))
        throw new RpcError('invalid_params', `${string(row(found).skill || 'that check')} did not pass, so it did not carry this`,
            {fix: `the dice decided this and they said no: do not move ${string(effect.name)}. Record apply object offer "declined" with the same from and to, which leaves it with ${said(names, 'from', source!)} and closes the offer; next time, hold it out with offer "made" before the roll`,
             details: {field: 'object.check', check: cited.trim(), level: row(found).level ?? null, passed: false}});
    return {handover: ground, check: cited.trim()};
}

/** The disposition, checked against the offer the instance actually carries. */
export function validateDisposition(effect: Row, prior: Row | null, source: Row | null, owner: Row, names: Names | null = null): string | null {
    const disposition = effect.offer;
    if (disposition === undefined) {
        const open = openOffer(prior);
        if (open && equal(clone(row(open).from), source) && equal(clone(row(open).to), owner))
            throw new RpcError('invalid_params', `${string(effect.name)} is already held out to ${label(owner)} and that is still open`,
                {fix: 'close it with apply object offer "accepted" (with its handover) or offer "declined"; a plain move cannot answer an offer that is standing',
                 details: {field: 'object.offer', offered_to: string(row(open).to_label || label(row(open).to)), since_turn: row(open).turn ?? null}});
        return null;
    }
    if (typeof disposition !== 'string' || !(DISPOSITIONS as readonly string[]).includes(disposition))
        throw new RpcError('invalid_params', `offer is ${DISPOSITIONS.join(', ')}`,
            {fix: 'offer "made" holds a thing out without moving it, "accepted" closes that and moves it, "declined" closes it and leaves it where it is',
             details: {field: 'object.offer', supported: [...DISPOSITIONS]}});
    for (const key of ['adopt', 'document', 'condition'])
        if (Object.hasOwn(effect, key) && effect[key] != null)
            throw new RpcError('invalid_params', `an offer changes nothing about the thing itself, so it carries no ${key}`,
                {fix: `apply the ${key} on its own call`, details: {field: `object.${key}`}});
    if (!betweenPeople(source, owner))
        throw new RpcError('invalid_params', 'an offer has two people in it: whoever holds it out, and whoever it is held out to',
            {fix: 'name the holder in from and the person it is held out to in to', details: {field: 'object.offer', from: source ? said(names, 'from', source) : null, to: said(names, 'to', owner)}});
    const open = openOffer(prior);
    if (disposition === 'made') {
        if (prior && !equal(prior.owner, source))
            throw new RpcError('invalid_params', `${said(names, 'from', source!)} is not holding ${string(effect.name)}`,
                {fix: `name its current holder in from: ${label(row(prior.owner))}`, details: {field: 'object.from', holder: label(row(prior.owner))}});
        if (open)
            throw new RpcError('invalid_params', `${string(effect.name)} is already held out to ${string(row(open).to_label || label(row(open).to))}`,
                {fix: 'close that one first with offer "accepted" or offer "declined"', details: {field: 'object.offer', offered_to: string(row(open).to_label || label(row(open).to))}});
        return disposition;
    }
    if (!open)
        throw new RpcError('invalid_params', `nothing is being held out: ${string(effect.name)} has no open offer to ${disposition === 'accepted' ? 'accept' : 'decline'}`,
            {fix: 'an offer is closed only after it was made; hold it out with offer "made" first, or move it with from, to and its handover',
             details: {field: 'object.offer'}});
    if (!equal(clone(row(open).from), source) || !equal(clone(row(open).to), owner))
        throw new RpcError('invalid_params', `the open offer on ${string(effect.name)} is ${string(row(open).from_label || label(row(open).from))} holding it out to ${string(row(open).to_label || label(row(open).to))}`,
            {fix: 'close it with those same two in from and to, in that order', details: {field: 'object.offer', from: string(row(open).from_label || label(row(open).from)), to: string(row(open).to_label || label(row(open).to))}});
    return disposition;
}

export function recordOffer(item: Row, source: Row, owner: Row, fromLabel: string, toLabel: string, turn: number, callId: string): void {
    item.offer = {from: clone(source), to: clone(owner), from_label: fromLabel, to_label: toLabel, turn, call_id: callId};
    item.changed_turn = turn;
}

export function clearOffer(item: Row, turn: number): void {
    delete item.offer;
    item.changed_turn = turn;
}

/**
 * Every open offer at this table, as a capsule obligation. A row that does not say what closes it is
 * a row the Keeper reads and does nothing about, so the call that closes it is on the row itself.
 */
export function offerObligations(world: Row): Row[] {
    const instances = row(row(world.objects).instances), rows: Row[] = [];
    for (const key of Object.keys(instances)) {
        const item = row(instances[key]), open = openOffer(item);
        if (!open) continue;
        rows.push({kind: 'offer', name: string(item.name), who: string(open.to_label || label(row(open.to))),
            state: `held out by ${string(open.from_label || label(row(open.from)))} since turn ${string(open.turn)}, neither taken nor refused`,
            cue: `apply object name ${JSON.stringify(string(item.name))} from ${JSON.stringify(string(open.from_label || label(row(open.from))))} to ${JSON.stringify(string(open.to_label || label(row(open.to))))} with offer "accepted" and its handover when it is taken, or offer "declined" when it is not`});
    }
    return rows;
}

export const offerReceiptFields = (item: Row): Row => {
    const open = openOffer(item);
    return open ? {offered_to: string(row(open.to).id), offered_to_label: string(open.to_label || label(row(open.to)))} : {};
};

export const publicOffer = (item: Row): Row => {
    const open = openOffer(item);
    return open ? {offered_to: string(open.to_label || label(row(open.to))), offered_since_turn: open.turn ?? null} : {};
};

export const receiptsOf = (turn: Row): Row[] => array(turn.receipts).filter(value => value && typeof value === 'object') as Row[];
