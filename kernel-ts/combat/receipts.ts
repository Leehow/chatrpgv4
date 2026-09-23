/** Public combat attribution follows engine roll ids, never card order or graph identities. */
import { array, string, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
import { recordEngineRolls } from '../resolve/session-receipts.js';

export interface DamageReceipt { damage: Row; receipt: string }
export function recordCombatRolls(context: SettleContext, turn: Row | null, rolls: Row[], damageChain: Row[], round: number): DamageReceipt[] {
    const bindings = new Map<string, Row>();
    const bind = (id: any, actor: any, target: any, action: string) => {
        if (typeof id === 'string' && typeof actor === 'string' && typeof target === 'string')
            bindings.set(id, { actor, target, combat_action: action });
    };
    if (turn) {
        bind(turn.roll_id, turn.actor_id, turn.target_actor_id, 'attack');
        bind(turn.cover_reroll_roll_id, turn.actor_id, turn.target_actor_id, 'attack');
        bind(turn.opposed_roll_id, turn.target_actor_id, turn.actor_id, 'defense');
        for (const shot of [...array(turn.shots), ...array(turn.volleys), ...array(turn.suppression_targets)])
            bind(shot.roll_id, turn.actor_id, shot.target_actor_id ?? turn.target_actor_id, 'attack');
        for (const [actor, id] of Object.entries(turn.dive_rolls ?? {}))
            bind(id, actor, turn.actor_id, 'defense');
    }
    const damages = damageChain.filter(damage => turn && damage.source_turn_id === turn.turn_id);
    const byRoll = new Map(damages.map(damage => [damage.damage_roll_id, damage]));
    const ids = new Map<string, string>();
    for (const record of rolls) {
        const damage = byRoll.get(record.roll_id), binding = bindings.get(record.roll_id);
        const [id] = recordEngineRolls(context, [record], 'combat_check', { round, session_kind: 'combat' });
        if (!id) continue;
        ids.set(record.roll_id, id);
        if (damage || binding) {
            const receipt = context.receipts.find(receipt => receipt.id === id)!;
            Object.assign(receipt, {
                public_combat: true,
                public_actor_label: context.publicCombatLabel(string(damage?.source_actor_id ?? binding?.actor)),
                public_target_label: context.publicCombatLabel(string(damage?.target_actor_id ?? binding?.target)),
                ...(binding && !damage ? { combat_action: binding.combat_action } : {}),
            });
        }
    }
    return damages.flatMap(damage => {
        const receipt = ids.get(damage.damage_roll_id);
        return receipt ? [{ damage, receipt }] : [];
    });
}

/** One HP change per real damage record retains every hit and its exact before/after values. */
export function recordCombatDamage(context: SettleContext, damages: DamageReceipt[]): Map<string, number> {
    const after = new Map<string, number>();
    for (const { damage, receipt } of damages) {
        const target = string(damage.target_actor_id);
        after.set(target, damage.hp_after);
        if (damage.hp_before === damage.hp_after) continue;
        const id = context.addDelta('hp', target, damage.hp_before, damage.hp_after, { source_receipt: receipt });
        const delta = context.receipts.find(row => row.id === id);
        // Public display attribution belongs to the receipt, not outcome.effects: the latter
        // remains the closed resource-change shape consumed by rule and session callers.
        if (delta) Object.assign(delta, {
            public_combat: true,
            public_subject_label: context.publicCombatLabel(target),
            public_source_label: context.publicCombatLabel(string(damage.source_actor_id)),
        });
    }
    return after;
}
