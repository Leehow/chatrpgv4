/**
 * The writer's half of contract §142: which intention of which person an effect or a roll is a result of, checked
 * before anything lands. An intention is named either by its reference (`intent_ref`, from the card or the offer) or
 * by the line itself (`intends`, a new thing this person tries). Nothing here reads prose: a line is its own identity,
 * and a settled intention is found by that identity, never by what the words resemble. The ledger is the only place
 * an intention is known from (§143.6: the response bank that could also name one is retired).
 */
import {RpcError} from '../errors.js';
import type {KernelContext} from '../context.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {CampaignSnapshot} from '../read/campaign.js';
import {personNode} from '../read/capsule.js';
import {array, clone, number, row, string, type Row} from '../read/values.js';
import {INTENT_OUTCOMES, INTENT_TEXT_LIMIT, canonicalIntentRef, foldIntent, intentOf, intentOwner, intentParts, intentRef, intentsOf, isSettled, receiptGenerated, shownIntentRef} from '../npc/intents.js';

export interface IntentScope {
    readonly kernel: KernelContext;
    readonly campaign: {readonly id: string};
    readonly graph: ModuleGraph;
    readonly world: Row;
    readonly turn: Row;
    staged?(): Row[];
}
/**
 * `options` are this person's intentions under way when the name was resolved -- what every refusal about it lists, so
 * a refusal that has already resolved the person never reads the ledger a second time. `generated` says the table's
 * own act of this person set the intention out (the ledger row's mark, §143.6); a new line is not.
 */
export interface ResolvedIntent { ref: string; text: string; status: string | null; turn: number | null; generated: boolean; options: Row[] }

/**
 * §143.7: where a writer finds a ref, said in every refusal about one (live gate A, T12: the Keeper wrote
 * `intent_ref: "@intent-placeholder"` for an intention it had started in the same batch). The rendering puts the
 * `details.options` this names on a line of its own (contract §8).
 */
const REFS_ARE = 'refs are on the capsule at present[].history.intents[].ref, or in details.options here';

/**
 * §185.2: the person an intention reference's owner segment names, resolved like any person reference -- the §87.8
 * junction, the table's word included, and §185.3's retry in a legacy campaign (`ModuleGraph.resolve`) -- or null. A
 * word two people carry is refused naming both, never picked (§87.8).
 */
export function intentOwnerNode(scope: Pick<IntentScope, 'graph' | 'world'>, owner: string): Row | null {
    return personNode(scope.graph, scope.world, owner);
}
/** §185.2: whether an owner segment, given or stored, names `node`. The handle is the usual spelling and is read first. */
function ownedBy(scope: Pick<IntentScope, 'graph' | 'world'>, node: Row): (owner: string) => boolean {
    const handle = scope.graph.handle(node);
    return owner => {
        if (owner === handle) return true;
        try { return intentOwnerNode(scope, owner)?.node_id === node.node_id; }
        catch (error) { if (error instanceof RpcError) return false; throw error; }
    };
}

/** This person's ledger entry as it stands now: the committed ledger, then this turn's receipts, then this call's. */
export async function intentEntry(scope: IntentScope, node: Row): Promise<Row> {
    const snapshot = new CampaignSnapshot(scope.kernel, scope.campaign.id);
    const entry = clone(row(row(await snapshot.optional('npc-ledger.json'))[string(node.node_id)]));
    const handle = scope.graph.handle(node);
    for (const receipt of [...array(scope.turn.receipts), ...(scope.staged?.() ?? [])]) {
        const intent = row(row(receipt).intent);
        if (typeof intent.ref === 'string' && intent.npc === handle)
            foldIntent(entry, intent, number(scope.turn.turn), row(receipt).id, receiptGenerated(receipt), true);
    }
    return entry;
}
/** What a writer may name: this person's intentions under way. */
export async function intentOptions(scope: IntentScope, node: Row, entry?: Row): Promise<Row[]> {
    const current = entry ?? await intentEntry(scope, node), handle = scope.graph.handle(node);
    return intentsOf(current).filter(item => !isSettled(item.status)).map(item => ({ref: shownIntentRef(item.ref, handle), intent: item.text, status: item.status}));
}
/**
 * §143.7: what a writer may name when the ref it gave names nobody (so there is no person to ask): every intention under
 * way at this table, whoever's -- the committed ledger, then this turn's receipts, then this call's -- each with the
 * handle of the person it belongs to. §185.2: one entry per person, so a receipt finds its row by person and digest, and
 * each row is shown in its canonical form.
 */
async function tableIntentOptions(scope: IntentScope): Promise<Row[]> {
    const snapshot = new CampaignSnapshot(scope.kernel, scope.campaign.id);
    const people = new Map<string, {handle: string; entry: Row}>();
    for (const [id, stored] of Object.entries(row(await snapshot.optional('npc-ledger.json')))) {
        const rows = clone(intentsOf(row(stored))), node = scope.graph.nodes.get(id);
        if (rows.length) people.set(id, {handle: node ? scope.graph.handle(node) : string(intentOwner(rows[0].ref)), entry: {intents: rows}});
    }
    for (const receipt of [...array(scope.turn.receipts), ...(scope.staged?.() ?? [])]) {
        const intent = row(row(receipt).intent), npc = string(intent.npc);
        if (typeof intent.ref !== 'string') continue;
        let node: Row | null = scope.graph.nodes.get(npc) ?? null;
        try { node ??= scope.graph.actor(npc); } catch (error) { if (!(error instanceof RpcError)) throw error; }
        const id = node ? string(node.node_id) : `npc:${npc}`;
        const person = people.get(id) ?? {handle: node ? scope.graph.handle(node) : npc, entry: {}};
        people.set(id, person);
        foldIntent(person.entry, intent, number(scope.turn.turn), row(receipt).id, false, true);
    }
    return [...people.values()].flatMap(({handle, entry}) => intentsOf(entry).filter(item => !isSettled(item.status))
        .map(item => ({ref: shownIntentRef(item.ref, handle), npc: handle, intent: item.text, status: item.status})));
}

/**
 * Which intention `fields` names for this person. `field` is the effect path the refusal points at. The result carries
 * where the intention stands now (`status`, null when this is its first result).
 */
export async function resolveIntent(scope: IntentScope, node: Row, fields: {intends?: unknown; intent_ref?: unknown}, field: string): Promise<ResolvedIntent> {
    const handle = scope.graph.handle(node), who = scope.graph.displayName(node), entry = await intentEntry(scope, node);
    let text: string | null = null, ref: string | null = null;
    if (fields.intends != null) {
        if (typeof fields.intends !== 'string' || !fields.intends.trim() || Array.from(fields.intends.trim()).length > INTENT_TEXT_LIMIT || fields.intends.includes('{{'))
            throw new RpcError('invalid_params', `${field}.intends must be one line saying what ${who} is trying to do`, {
                fix: `write it in one Keeper-facing sentence of at most ${INTENT_TEXT_LIMIT} characters, no markers`, details: {field: `${field}.intends`}});
        text = fields.intends.trim();
        ref = intentRef(handle, text);
    }
    const mine = ownedBy(scope, node);
    if (fields.intent_ref != null) {
        const parts = intentParts(fields.intent_ref);
        if (parts === null)
            throw new RpcError('invalid_params', `${field}.intent_ref ${JSON.stringify(fields.intent_ref)} is not an intention reference`, {
                fix: `${REFS_ARE}; or write the new thing this person tries with intends`,
                details: {field: `${field}.intent_ref`, options: await intentOptions(scope, node, entry)}});
        // §185.2: the owner segment is a person reference, compared as a person. `belongs to` is refused only when it names
        // somebody else; a segment that names nobody leaves the reference unknown to this person.
        const owner = mine(parts.owner) ? node : intentOwnerNode(scope, parts.owner);
        if (owner && owner.node_id !== node.node_id) {
            const theirs = scope.graph.handle(owner);
            throw new RpcError('invalid_params', `${field}.intent_ref belongs to ${theirs}, not to ${who}`, {
                fix: `name ${who}'s own intention (details.options), or put the result on the effect about ${theirs}`,
                details: {field: `${field}.intent_ref`, owner: theirs, options: await intentOptions(scope, node, entry)}});
        }
        // §185.2: the canonical form, whatever word the writer used for the owner; the ledger is searched by person and digest.
        const given = owner ? canonicalIntentRef(handle, parts.digest) : fields.intent_ref as string;
        if (ref !== null && ref !== given)
            throw new RpcError('invalid_params', `${field}.intends and ${field}.intent_ref name two different intentions`, {
                fix: 'one intention per npc effect: to settle the one on the card and start a new one, send two npc effects in the same batch -- {intent_ref, outcome: done|failed|abandoned} and {intends, outcome: attempted}', details: {field: `${field}.intent_ref`}});
        ref = given;
        // Not `string()`: it renders an absent value as the word "None", which would pass for a line (string-helper trap).
        const known = owner ? intentOf(entry, ref, mine)?.text : undefined;
        text ??= typeof known === 'string' && known ? known : null;
        if (text === null)
            throw new RpcError('invalid_params', `${who} has no intention ${ref} on the card`, {
                fix: `${REFS_ARE}; or write the new thing this person tries with intends`,
                details: {field: `${field}.intent_ref`, reason: 'unknown_intent', options: await intentOptions(scope, node, entry)}});
    }
    if (ref === null || text === null)
        throw new RpcError('invalid_params', `${field} names no intention`, {fix: 'give intent_ref (an intention on the card) or intends (a new one)', details: {field}});
    const known = intentOf(entry, ref, mine);
    return {ref, text, status: known ? string(known.status) : null, turn: known ? number(known.last_turn) : null, generated: known?.generated === true,
        options: await intentOptions(scope, node, entry)};
}

/**
 * A settled intention is not tried again (the owner's ruling of 2026-09-26: what a person announces gets a result, and
 * the same thing is not done twice in a row). Refused with what is still open, so the next call has somewhere to go.
 * Its result stands -- also when the table's own act settled it (§143.7): a roll the table made is not re-graded.
 */
export async function refuseSettled(scope: IntentScope, node: Row, resolved: ResolvedIntent, field: string): Promise<void> {
    if (!isSettled(resolved.status)) return;
    const who = scope.graph.displayName(node);
    throw new RpcError('invalid_params', `${who}'s intention "${resolved.text}" was settled (${resolved.status}) on turn ${resolved.turn}; a settled intention is not tried again`, {
        fix: `its result stands. Name another of ${who}'s intentions still under way (${REFS_ARE}), or write the new thing ${who} does now with intends -- given how that one ended`,
        details: {field, reason: 'intent_settled', ref: resolved.ref, status: resolved.status, turn: resolved.turn, options: resolved.options}});
}

/**
 * §142.7: an intention still under way from an earlier turn is not announced again -- it gets a result. Written as
 * `attempted` a second time on a later turn, it is refused; within the same turn it may be written again.
 */
export function refuseRepeat(scope: IntentScope, node: Row, resolved: ResolvedIntent, outcome: string, field: string): void {
    if (outcome !== 'attempted' || resolved.status !== 'attempted' || resolved.turn === null || resolved.turn >= number(scope.turn.turn)) return;
    const who = scope.graph.displayName(node);
    throw new RpcError('invalid_params', `${who} already set out on turn ${resolved.turn} to ${resolved.text}, and it has no result; it is not announced again`, {
        fix: `report how it went instead: details.ref with outcome done, failed or abandoned (a roll or effect with this intent_ref does the same); ${REFS_ARE}. If ${who} tries something else now, that is a new intention`,
        details: {field, reason: 'intent_unresolved', ref: resolved.ref, since_turn: resolved.turn, options: resolved.options}});
}

/**
 * §143.14: what the table's own act of a person set out (a `generated` row) is settled only by the dice, a clock, an
 * arrival or a departure -- what its binding writes (§143.3), whoever writes it -- or given up. Saying it happened is
 * not a result: live table C3 (2026-09-26) had "grab the telephone" made `done` by a clue's `intent_ref` and a
 * threat made `done` by the intention variant, so the situation packet told the generator every turn that the
 * telephone was dealt with, and the same threat came back four times. Refused here, before anything lands: `done` or
 * `failed` on such a row by a write that is not the table's own (`_generated`) and does not itself settle it
 * (`settles`: a roll, a threat clock, an npc `to`). `abandoned` stays the Keeper's (spec D7); a Keeper-written row
 * keeps §142.2's rules; a settled row was refused `intent_settled` before this is asked.
 */
export const TABLE_ACT_UNSETTLED_FIX = 'a table act that rolled nothing is not done by saying so: abandon it (intent_outcome: abandoned), or let the dice settle it';
export function refuseSaidDone(scope: IntentScope, node: Row, resolved: ResolvedIntent, outcome: string, field: string,
    write: {generated: boolean; settles: boolean; fix?: string}): void {
    if (!resolved.generated || write.generated || write.settles || (outcome !== 'done' && outcome !== 'failed')) return;
    const who = scope.graph.displayName(node);
    throw new RpcError('invalid_params', `${who}'s "${resolved.text}" was the table's own act and nothing has settled it; saying so does not make it ${outcome}`, {
        fix: write.fix ?? TABLE_ACT_UNSETTLED_FIX,
        details: {field, reason: 'table_act_unsettled', ref: resolved.ref, status: resolved.status, outcome}});
}
/**
 * §143.14: the effects that settle a table act by themselves, as its binding's non-roll ways do (§143.3: `clock`,
 * `walk_on`, `leave`) -- a threat clock moving, and a person arriving or departing (an npc effect with `to`). A closed
 * set of effect kinds, never a reading of what the effect is about.
 */
export function effectSettlesAct(effect: Row): boolean {
    return effect.kind === 'threat' || (effect.kind === 'npc' && effect.to != null);
}

/**
 * The `intent` a receipt carries (§142.2). `generated` (§143.3) marks a receipt of an act the table generated and bound
 * (`intent.generated: true`), which the ledger fold reads (§143.6).
 */
export function intentStamp(handle: string, resolved: ResolvedIntent, outcome: string, generated = false): Row {
    if (!INTENT_OUTCOMES.includes(outcome)) throw new Error(`unknown intent outcome ${outcome}`);
    return {ref: resolved.ref, npc: handle, text: resolved.text, outcome, ...(generated ? {generated: true} : {})};
}
/**
 * §143.3: the host's `_generated` beside an intention on an effect or a roll's action -- the call is the table's own act of
 * that person, bound by the clerk from the generated line. Host-only (the kernel extension sets it on the clerk's
 * `npc_act` calls and strips it from every other call); `true` or absent, never read from anything else.
 */
export function generatedOf(value: unknown, field: string): boolean {
    if (value == null) return false;
    if (value !== true) throw new RpcError('invalid_params', `${field} is true or absent`, {details: {field}});
    return true;
}

/**
 * §142.2: an effect of any kind that is the result of what someone set out to do names it with `intent_ref`; the
 * receipt carries the stamp with `intent_outcome` (default `done`: the effect is what happened). The intention may be
 * someone else's than the effect's subject -- the porter comes up the stairs because Knott shouted.
 */
export async function effectIntent(scope: IntentScope, effect: Row, field: string): Promise<Row> {
    const owner = intentOwner(effect.intent_ref);
    // §185.2: the owner segment is a person reference, by any word that names them.
    const node = owner === null ? null : intentOwnerNode(scope, owner);
    if (!node)
        throw new RpcError('invalid_params', `${field}.intent_ref ${JSON.stringify(effect.intent_ref)} names no person's intention`, {
            fix: `${REFS_ARE} (director.offer carries them too); or leave intent_ref out`, details: {field: `${field}.intent_ref`, options: await tableIntentOptions(scope)}});
    const outcome = effect.intent_outcome ?? 'done';
    if (typeof outcome !== 'string' || !INTENT_OUTCOMES.includes(outcome))
        throw new RpcError('invalid_params', `${field}.intent_outcome ${JSON.stringify(outcome)} is not where an intention can stand`, {
            fix: 'one of details.options; leave it out when the effect is the intention done', details: {field: `${field}.intent_outcome`, options: [...INTENT_OUTCOMES]}});
    const generated = generatedOf(effect._generated, `${field}._generated`);
    const resolved = await resolveIntent(scope, node, {intent_ref: effect.intent_ref}, field);
    await refuseSettled(scope, node, resolved, field);
    refuseRepeat(scope, node, resolved, outcome, field);
    // §143.14: a clue, a note or any other effect that carries a table act's ref does not settle it by being written.
    refuseSaidDone(scope, node, resolved, outcome, `${field}.intent_outcome`, {generated, settles: effectSettlesAct(effect)});
    return intentStamp(scope.graph.handle(node), resolved, outcome, generated);
}

/**
 * What a roll's intention stamp does (§142.2 addendum). `stamp` writes it on the call's receipts and says where it
 * landed: on a graded roll (`roll`, settled done or failed), on the call's first receipt (`first`, still `attempted`), or
 * nowhere (`none`). `carried` is the stamp without its outcome, for a call whose roll is still to come (§143.3: an attack
 * waiting for its defence rolls in the defence call).
 */
export interface RollIntentPlan { stamp(receipts: Row[]): 'roll' | 'first' | 'none'; carried: Row }
/**
 * §142.2: a `resolve` whose roll is the result of what someone set out to do (`action.intent_ref`). Checked before the
 * dice are thrown -- an unknown or settled intention refuses without a roll -- and stamped after: the check that passed
 * did it, the one that failed did not, unless `action.intent_outcome` says otherwise (a first step that leaves it under
 * way). A call that rolls nothing yet leaves it `attempted` on its first receipt; an attack waiting for its defence has
 * its stamp wait for the defence call (§143.3, `carryAttackIntent`).
 */
export async function planRollIntent(scope: IntentScope, action: Row): Promise<RollIntentPlan | null> {
    if (action.intent_ref == null) return null;
    const outcome = action.intent_outcome;
    if (outcome != null && (typeof outcome !== 'string' || !INTENT_OUTCOMES.includes(outcome)))
        throw new RpcError('invalid_params', `action.intent_outcome ${JSON.stringify(outcome)} is not where an intention can stand`, {
            fix: 'one of details.options, or leave it out: a passed check is done, a failed one failed', details: {field: 'action.intent_outcome', options: [...INTENT_OUTCOMES]}});
    const owner = intentOwner(action.intent_ref), node = owner === null ? null : intentOwnerNode(scope, owner);
    if (!node)
        throw new RpcError('invalid_params', `action.intent_ref ${JSON.stringify(action.intent_ref)} names no person's intention`, {
            fix: `${REFS_ARE} (director.offer carries them too); or leave intent_ref out`, details: {field: 'action.intent_ref', options: await tableIntentOptions(scope)}});
    const generated = generatedOf(action._generated, 'action._generated');
    const resolved = await resolveIntent(scope, node, {intent_ref: action.intent_ref}, 'action');
    await refuseSettled(scope, node, resolved, 'action');
    if (typeof outcome === 'string') {
        refuseRepeat(scope, node, resolved, outcome, 'action');
        // §143.14: the dice settle a table act; an outcome written beside the roll would overrule them.
        refuseSaidDone(scope, node, resolved, outcome, 'action.intent_outcome', {generated, settles: false,
            fix: 'the dice settle a table act: leave action.intent_outcome out and the roll makes it done or failed; or abandon it (apply npc, intent_outcome: abandoned)'});
    }
    const handle = scope.graph.handle(node);
    const {outcome: _outcome, ...carried} = intentStamp(handle, resolved, 'attempted', generated);
    return {carried, stamp: receipts => {
        const roll = [...receipts].reverse().find(value => value.kind === 'roll' && value.form !== 'dice' && typeof value.passed === 'boolean');
        const target = roll ?? receipts[0];
        if (!target) return 'none';
        const settled = typeof outcome === 'string' ? outcome : roll ? (roll.passed ? 'done' : 'failed') : 'attempted';
        target.intent = intentStamp(handle, resolved, settled, generated);
        return roll ? 'roll' : 'first';
    }};
}

/**
 * §143.3: an attack on an investigator waits for their defence and rolls in the defence call, so the attack call has no
 * receipt for its intention's stamp. The stamp waits beside the pending attack, keyed by its command id, in
 * `save/attack-intents.json` (the fight snapshot's contract admits no extra key); the defence call stamps the
 * attacker's graded roll with it -- done when it hit, failed when it did not -- and removes it.
 */
const CARRIED = 'attack-intents.json';
export interface CarryStore { readSave(name: string): Promise<any>; writeSave(name: string, value: Row): Promise<void> }
export async function carryAttackIntent(store: CarryStore, attackCommandId: string, carried: Row): Promise<void> {
    let held: Row = {};
    try { held = row(await store.readSave(CARRIED)); } catch { held = {}; }
    await store.writeSave(CARRIED, {...held, [attackCommandId]: carried});
}
export async function settleCarriedIntent(store: CarryStore, pending: Row, receipts: Row[]): Promise<void> {
    const id = string(pending.attack_command_id);
    if (!id) return;
    let held: Row = {};
    try { held = row(await store.readSave(CARRIED)); } catch { return; }
    const carried = row(held[id]);
    if (typeof carried.ref !== 'string') return;
    const roll = receipts.find(value => value.kind === 'roll' && value.actor === pending.actor_id && value.form !== 'dice' && typeof value.passed === 'boolean' && value.intent == null);
    if (!roll) return;
    roll.intent = {...carried, outcome: roll.passed ? 'done' : 'failed'};
    const {[id]: _taken, ...rest} = held;
    await store.writeSave(CARRIED, rest);
}
