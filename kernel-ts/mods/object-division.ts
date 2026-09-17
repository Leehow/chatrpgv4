/**
 * Contract §97. A stack that is partly put down is partly put down.
 *
 * §88 gave the object model the words for a thing held out between two people. It did not touch the
 * other question the model has never been able to answer: *how much of it*.
 *
 * Turn 109 of `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143` is what that costs. The Keeper wrote
 * exactly the right call -- a four-print stack, `to: "here"`, `from` the investigator, `quantity: 2`
 * -- two of the four reprints into the professor's drawer, the other two and the negatives staying
 * in the investigator's pocket. The kernel answered `invalid_params: Transfer preserves the complete
 * instance quantity`, `next: change_input`, with no `fix`. There was no input to change to. The
 * Keeper fell back to `apply note`, which §18.2 defines as the Keeper's own memo and deliberately
 * not a world write, and four turns later the panel still read that stack at four on a sheet that
 * had walked to another building while two of them were locked in a drawer behind somebody else's
 * key.
 *
 * **The root was never the container.** A place and a container have been owners since §19
 * (`objectOwner` mints `kind: "scene"` and `kind: "object"`), the tool schema has said so all along,
 * and the same table used the path twice without trouble -- `item:t79-c3` left a requisition slip at
 * the university archive, `item:t97-c1` left a note with the desk officer. §88.2 counted eleven such
 * receipts across nine tables. What no table has ever been able to say is that a countable thing
 * came apart: an instance's `quantity` was fixed at creation and immutable for the rest of its life,
 * so four photographs, ten cartridges and a box of matches were each one atom that could only ever
 * move whole.
 *
 * So `part` is the missing word, and it is an amount rather than a consent. The person-to-person
 * side needed `handover` because someone had to agree; a drawer agrees to nothing, and §88's
 * `validateHandover` already refuses a ground where there is no second person. Nothing in that
 * section is widened here. What is added is orthogonal to it and composes with it: divide first,
 * and the part that separated is an ordinary instance that can then be handed over, held out,
 * declined or left on a table like any other.
 *
 * §31's three ends. Writes it: `apply object` with `part`, through `stageModEffect`. Reads it: the
 * new instance is an ordinary instance, so `publicItems`, `projectSheet` and `objectLook` carry it
 * and the remainder's reduced count with no new projection at all; the transfer receipt carries
 * `divided_from` and `remaining`, and `facts.committed` says both halves in one sentence. Acts on
 * it: the Keeper, which now has an expressible answer for the half of the stack that stayed behind
 * and no longer has to choose between moving all of it and moving none of it.
 *
 * Deployment (§88.5, which this section does not amend but does obey): `part` is a field of
 * `extensions/kernel/tools.ts`, read once when the server starts, and the kernel that reads it is
 * rebuilt live. The order is safe in the direction it has to be. A kernel without the schema refuses
 * a partial quantity exactly as it does today; a schema without the kernel sends a key the kernel
 * ignores and gets that same refusal. Neither is a closed door, because this section never makes a
 * call that works today start requiring something new -- every call it touches is refused today.
 */
import {RpcError} from '../errors.js';
import {clone, equal, integer, normalize, number, repr, row, string, truth, values, type Row} from '../read/values.js';
import {asciiSlug} from '../write/text.js';
import {ownershipChanged} from './documents.js';
import {assertOwnershipChain, objectRegistry} from './objects.js';
import {openOffer, type Names} from './object-offer.js';

export type Division = {part: string; quantity: number};

const label = (owner: Row): string => string(row(owner).name || row(owner).id);
const said = (names: Names | null, side: 'from' | 'to', owner: Row): string => names ? names[side] : label(owner);

/**
 * Whether this call divides a stack, and if so on what terms.
 *
 * A division is recognised by arithmetic, never by a keyword: an existing instance, a `quantity`
 * the Keeper stated, and that quantity being short of what the instance holds. `part` is what the
 * separated portion is called from here on, and it is required there because a name is the only
 * identity a model is given (`findNamedObject` refuses two instances that answer to one name, so a
 * silent reuse of the stack's name would make both of them unreachable).
 */
export function validateDivision(world: Row, effect: Row, prior: Row | null, source: Row | null, owner: Row,
                                 disposition: string | null, names: Names | null = null): Division | null {
    const named = Object.hasOwn(effect, 'part') && effect.part != null;
    const stated = Object.hasOwn(effect, 'quantity') ? effect.quantity : undefined;
    // A disposition is read for a division only when `part` says so. §88's offer path has always
    // ignored `quantity` on an instance that already exists -- it holds out the whole of what
    // somebody is holding -- and a short quantity there is that section's business, not this one's.
    // Reading it here would turn a call that works today into a refusal, which is the one direction
    // §88.5 says never to move in.
    const short = disposition === null && prior !== null && integer(stated) && number(stated) < number(prior.quantity);
    if (!named && !short) return null;
    if (!prior)
        throw new RpcError('invalid_params', `there is no ${repr(string(effect.name))} here to divide`,
            {fix: 'part separates some of a stack that already exists; to place a new thing, drop part and give it its own name and quantity',
             details: {field: 'object.part'}});
    const held = number(prior.quantity);
    if (!named)
        throw new RpcError('invalid_params', `${string(prior.name)} is ${held} and this moves ${number(stated)} of them, so the ${held - number(stated)} left behind need a name of their own`,
            {fix: `set part to what the ${number(stated)} that move are called from now on, in the campaign's play_language; the ${held - number(stated)} that stay keep the name ${repr(string(prior.name))}. To move the whole stack, drop quantity`,
             details: {field: 'object.part', held, moving: number(stated)}});
    if (!integer(stated) || number(stated) < 1 || number(stated) >= held)
        throw new RpcError('invalid_params', `part separates some of ${string(prior.name)}, and there are ${held}`,
            {fix: `set quantity to a whole number from 1 to ${held - 1}; to move all ${held} of them, drop part and quantity`,
             details: {field: 'object.quantity', held, quantity: stated ?? null}});
    const wanted = string(effect.part).trim();
    if (!wanted)
        throw new RpcError('invalid_params', 'part is the name the separated portion carries from now on',
            {fix: "name it in the campaign's play_language, the way the table would refer to it", details: {field: 'object.part'}});
    if (normalize(wanted) === normalize(string(prior.name)))
        throw new RpcError('invalid_params', `the portion that separates cannot also be called ${repr(string(prior.name))}`,
            {fix: 'one name answers to one thing here, so give the separated portion its own name',
             details: {field: 'object.part', name: string(prior.name)}});
    const taken = values(row(objectRegistry(world).instances)).find(value => normalize(string(row(value).name)) === normalize(wanted));
    if (taken)
        throw new RpcError('invalid_params', `something at this table is already called ${repr(wanted)}`,
            {fix: 'give the separated portion a name nothing else answers to', details: {field: 'object.part', name: wanted}});
    if (disposition !== null)
        throw new RpcError('invalid_params', 'holding something out is not dividing it',
            {fix: `divide it first with from and to both set to ${said(names, 'from', source ?? prior.owner)}, then hold the separated portion out by its own name`,
             details: {field: 'object.part', offer: disposition}});
    for (const key of ['adopt', 'document', 'condition'])
        if (Object.hasOwn(effect, key) && effect[key] != null)
            throw new RpcError('invalid_params', `dividing a stack changes nothing about the things in it, so it carries no ${key}`,
                {fix: `divide it first, then apply the ${key} to the separated portion by its own name`, details: {field: `object.${key}`}});
    if (truth(prior.document))
        throw new RpcError('invalid_params', `${string(prior.name)} carries its own written text, so it is one thing and not a count of things`,
            {fix: 'move it whole: drop part and quantity', details: {field: 'object.part', name: string(prior.name)}});
    for (const key of ['ammo', 'charges'])
        if (row(prior.state)[key] != null)
            throw new RpcError('invalid_params', `${string(prior.name)} carries its own ${key}, and there is no answer for how much of it goes with a part of the stack`,
                {fix: 'move it whole: drop part and quantity', details: {field: 'object.part', state: key, value: row(prior.state)[key]}});
    if (openOffer(prior))
        throw new RpcError('invalid_params', `${string(prior.name)} is being held out, and what is held out is the whole of it`,
            {fix: 'close that offer with offer "accepted" or offer "declined" first, then divide what is left',
             details: {field: 'object.part', name: string(prior.name)}});
    if (source === null || !equal(prior.owner, source))
        throw new RpcError('invalid_params', `dividing ${string(prior.name)} names whoever is holding it`,
            {fix: `set from to ${label(row(prior.owner))}`, details: {field: 'object.from', holder: label(row(prior.owner))}});
    return {part: wanted, quantity: number(stated)};
}

/**
 * Separate `division.quantity` out of `prior` as its own instance owned by `owner`.
 *
 * The parts are alike by construction: same definition, same physical condition, and no use state
 * to apportion (an instance carrying ammunition or charges is refused above). The remainder keeps
 * its identity -- its id, its name, its documents, every receipt already written about it -- and
 * only its count goes down, which is the whole of what the table observed.
 */
export function divideObject(world: Row, prior: Row, division: Division, owner: Row, turn: number): Row {
    const data = objectRegistry(world);
    assertOwnershipChain(world, owner, prior);
    const id = `object-${asciiSlug(division.part) || 'item'}-${Object.keys(data.instances).length + 1}`;
    const part: Row = {id, name: division.part, definition: prior.definition, owner: clone(owner),
        quantity: division.quantity, state: clone(prior.state), created_turn: turn, changed_turn: turn};
    data.instances[id] = part;
    prior.quantity = number(prior.quantity) - division.quantity;
    prior.changed_turn = turn;
    ownershipChanged(world);
    return part;
}
