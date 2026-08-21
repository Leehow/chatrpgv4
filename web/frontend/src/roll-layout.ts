import type {
  CombatPayload,
  DamagePayload,
  KeeperContentBlock,
  MechanicEffect,
  OpposedPayload,
  RollDisplay,
  RollGroupLayout,
  SanityPayload,
} from "./types";

export type RollGroupBlock = Extract<KeeperContentBlock, { type: "roll_group" }>;

export type RollGroupView =
  | {
      kind: "sanity";
      sanity: SanityPayload;
      remaining: RollDisplay[];
      text: string;
      effects?: MechanicEffect[];
    }
  | {
      kind: "combat";
      combat: CombatPayload;
      remaining: RollDisplay[];
      text: string;
      effects?: MechanicEffect[];
    }
  | {
      kind: "opposed";
      opposed: OpposedPayload;
      remaining: RollDisplay[];
      text: string;
      effects?: MechanicEffect[];
    }
  | {
      kind: "damage";
      damage: DamagePayload;
      remaining: RollDisplay[];
      text: string;
      effects?: MechanicEffect[];
    }
  | {
      kind: "check";
      rolls: RollDisplay[];
      text: string;
      effects?: MechanicEffect[];
    };

function usedIds(ids: Array<string | undefined | null>): Set<string> {
  return new Set(ids.filter((id): id is string => Boolean(id)));
}

function remainingRolls(rolls: RollDisplay[], used: Set<string>): RollDisplay[] {
  return rolls.filter((roll) => !used.has(roll.roll_id));
}

export function rollGroupLayout(block: RollGroupBlock): RollGroupLayout {
  return block.layout ?? "check";
}

/** Choose an existing receipt template from the server layout only. */
export function selectRollGroupView(block: RollGroupBlock): RollGroupView {
  const layout = rollGroupLayout(block);
  const effects = block.effects;
  if (layout === "sanity" && block.sanity?.check) {
    return {
      kind: "sanity",
      sanity: block.sanity,
      remaining: remainingRolls(
        block.rolls,
        usedIds([block.sanity.check.roll_id, block.sanity.loss?.roll_id]),
      ),
      text: block.text,
      effects,
    };
  }
  if (layout === "combat" && block.combat) {
    return {
      kind: "combat",
      combat: block.combat,
      remaining: remainingRolls(
        block.rolls,
        usedIds([
          block.combat.attack?.roll_id,
          block.combat.defense?.roll_id,
          block.combat.attack_reroll?.roll_id,
          block.combat.damage?.damage_roll_id,
          block.combat.fight_back_damage?.damage_roll_id,
          ...(block.combat.shots || []).flatMap((shot) => [shot.attack_roll_id, shot.damage_roll_id]),
          ...(block.combat.volleys || []).flatMap((volley) => [
            volley.attack_roll_id,
            ...(volley.damage_roll_ids || []),
          ]),
        ]),
      ),
      text: block.text,
      effects,
    };
  }
  if (layout === "opposed" && block.opposed?.left && block.opposed?.right) {
    return {
      kind: "opposed",
      opposed: block.opposed,
      remaining: remainingRolls(
        block.rolls,
        usedIds([block.opposed.left.roll_id, block.opposed.right.roll_id]),
      ),
      text: block.text,
      effects,
    };
  }
  if (layout === "damage" && block.damage?.roll) {
    return {
      kind: "damage",
      damage: block.damage,
      remaining: remainingRolls(block.rolls, usedIds([block.damage.damage_roll_id])),
      text: block.text,
      effects,
    };
  }
  return { kind: "check", rolls: block.rolls, text: block.text, effects };
}
