/** Closed damage ownership and canonical receipts preserved by combat snapshots. */
import { isJsonObject, jsonDigest } from '../json.js';
import { array, entries, integer, number, row, string, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
export function damageBindingsForTurn(turn: Row): Row[] {
    const bindings: Row[] = [];
    const add = (id: any, kind: string, index: string, source: any, target: any) => {
        if (typeof id === 'string' && id)
            bindings.push({ damage_roll_id: id, binding_kind: kind, binding_index: index, source_actor_id: source ?? null, target_actor_id: target ?? null });
    };
    const actor = turn.actor_id ?? null, target = turn.target_actor_id ?? null, counter = turn.outcome === 'maneuver_failed_fight_back_damage';
    add(turn.damage_roll_id, 'primary', '0', counter ? target : actor, counter ? actor : target);
    add(turn.fight_back_damage_roll_id, 'fight_back', '0', target, actor);
    for (const [i, shot] of array(turn.shots).entries())
        if (isJsonObject(shot))
            add(shot.damage_roll_id, 'shot', String(i), actor, target);
    for (const [i, volley] of array(turn.volleys).entries())
        if (isJsonObject(volley))
            for (const [j, id] of array(volley.damage_roll_ids).entries())
                add(id, 'volley', `${i}:${j}`, actor, target);
    for (const [i, target] of array(turn.suppression_targets).entries())
        if (isJsonObject(target))
            for (const [j, id] of array(target.damage_roll_ids).entries())
                add(id, 'suppression', `${i}:${j}`, actor, target.target_actor_id);
    return bindings;
}
export function damageTransactionReceipt(roundNumber: number, turn: Row, damage: Row, binding: Row): Row {
    const payload = { round: roundNumber,
        turn: Object.fromEntries(['turn_id', 'actor_id', 'target_actor_id', 'resolution_hint', 'outcome', 'roll_id', 'damage_roll_id', 'fight_back_damage_roll_id', 'resolution_command_id'].map(key => [key, turn[key] ?? null])),
        binding: { ...binding }, damage: Object.fromEntries(entries(damage).filter(([key]) => key !== 'provenance')) };
    return { kind: 'combat_damage_transaction_v1', round: roundNumber, turn_id: turn.turn_id ?? null,
        binding_kind: binding.binding_kind, binding_index: binding.binding_index, transaction_sha256: jsonDigest(payload) };
}
export function externalDamageReceipt(turn: Row, damage: Row): Row {
    return { kind: 'combat_damage_external_v1', command_id: turn.resolution_command_id ?? null, roll_id: damage.damage_roll_id ?? null,
        source_turn_id: damage.source_turn_id ?? null, source_actor_id: damage.source_actor_id ?? null, target_actor_id: damage.target_actor_id ?? null,
        weapon_id: damage.weapon_id ?? null, die: damage.die ?? null, die_rolls: [...array(damage.die_rolls)], rolled_total: damage.rolled_total ?? null,
        raw_damage: damage.raw_damage ?? null, total: damage.raw_damage ?? damage.rolled_total ?? null, hp_before: damage.hp_before ?? null, hp_delta: damage.hp_delta ?? null, hp_after: damage.hp_after ?? null,
        status_after: { ...row(damage.status_after) }, internal_provenance: { ...row(damage.provenance) } };
}
export function damageEvidenceRows(combatId: string, rounds: Row[], damageChain: Row[]): Row[] {
    const turns = new Map(rounds.flatMap(round => array(round.turns)).filter(turn => isJsonObject(turn) && typeof turn.turn_id === 'string').map(turn => [turn.turn_id, turn]));
    const result: Row[] = [];
    for (const damage of damageChain) {
        const id = damage.damage_roll_id;
        if (typeof id !== 'string')
            continue;
        const turn = turns.get(damage.source_turn_id);
        if (!turn)
            valueError('combat damage lacks its source turn');
        const receipt = externalDamageReceipt(turn, damage);
        if (typeof receipt.command_id !== 'string' || !receipt.command_id)
            valueError('combat damage lacks a resolution command ID');
        // The card's number is what was applied, not the dice sum: an extreme or critical success
        // settles at maximum damage (`extremeDamage`), and a receipt that reported the roll made
        // the card unable to explain the hit points the player lost -- it read "damage 1" while
        // eight came off, twice fatally (contract section 16.2, decision of 2026-09-12). `faces`
        // and `rolled_total` still carry the dice, so the roll stays auditable.
        const total = Object.hasOwn(damage, 'raw_damage') ? damage.raw_damage : damage.rolled_total;
        result.push({ event_type: 'roll', type: 'roll', roll_id: id, actor: damage.source_actor_id, visibility: 'consequence_public', source: 'combat_session',
            source_ref: `combat:${combatId}#${id}`, command_id: receipt.command_id, payload: { event_type: 'combat_roll', roll_id: id, roll_role: 'amount', visibility: 'consequence_public',
                actor_id: damage.source_actor_id, skill: 'HP Damage', source_command_id: receipt.command_id, target_actor_id: damage.target_actor_id,
                rolled_total: damage.rolled_total ?? total, dice: { expression: damage.die, raw: [...damage.die_rolls], total },
                combat_damage_receipt: receipt }, ts: 'trusted-in-memory' });
    }
    return result;
}
export function reconstructDamageRoll(expression: any, dice: any): number {
    const fail = (): never => valueError('combat damage roll evidence is invalid');
    if (typeof expression !== 'string' || !expression || !Array.isArray(dice))
        fail();
    let index = 0, total = 0;
    for (const token of expression.replaceAll('-', '+-').split('+').map((part: string) => part.trim()).filter(Boolean)) {
        const match = /^(\d+)D(\d+)$/.exec(token);
        if (match)
            for (let i = 0; i < Number(match[1]); i++) {
                const value = dice[index++];
                if (!integer(value) || value < 1 || value > Number(match[2]))
                    fail();
                total += number(value);
            }
        else {
            if (!/^[+-]?\d+(?:_\d+)*$/.test(token))
                fail();
            total += Number(token.replaceAll('_', ''));
        }
    }
    if (index !== dice.length)
        fail();
    return total;
}
export function canonicalSkipSourceReceipt(actorId: string, round: Row, damageChain: Row[]): Row | null {
    const positions = new Map(array(round.initiative_order).filter(isJsonObject).map((item, i) => [item.actor_id, i]));
    const position = positions.get(actorId);
    if (position === undefined)
        return null;
    const allowed = array(round.turns).filter(turn => isJsonObject(turn) && positions.has(turn.actor_id) && positions.get(turn.actor_id)! < position && typeof turn.turn_id === 'string').map(turn => turn.turn_id);
    let found: Row | null = null;
    for (const turn of allowed)
        for (const damage of damageChain) {
            if (!isJsonObject(damage) || damage.source_turn_id !== turn || damage.target_actor_id !== actorId || typeof damage.damage_roll_id !== 'string' || !isJsonObject(damage.status_after))
                continue;
            const status = damage.status_after, hp = status.hp_current, conditions = status.conditions;
            if (!integer(hp) || !Array.isArray(conditions) || hp !== damage.hp_after)
                continue;
            if (number(hp) > 0 && !conditions.some(value => ['dead', 'dying', 'unconscious', 'fled'].includes(string(value))))
                continue;
            found = { kind: 'damage_status', round: round.round ?? null, source_turn_id: turn, damage_roll_id: damage.damage_roll_id, hp_current: hp, conditions: [...conditions] };
        }
    return found;
}
