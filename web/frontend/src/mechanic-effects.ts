import type { MechanicEffect, RollDisplay, RollGroupLayout, SanityPayload } from "./types";
import type { RollGroupView } from "./roll-layout";

const RESOURCE_ENUM = new Set(["hp", "san", "luck"]);

function resourceKey(value?: string): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function presentMechanicEffect(effect: MechanicEffect): string | null {
  if (typeof effect.player_visible_impact === "string" && effect.player_visible_impact.trim()) {
    return effect.player_visible_impact.trim();
  }
  if (effect.effect_kind === "scalar") {
    const resource = resourceKey(effect.resource);
    if (!RESOURCE_ENUM.has(resource) || effect.before == null || effect.after == null) return null;
    const delta = effect.delta != null
      ? `（${effect.delta > 0 ? `+${effect.delta}` : String(effect.delta)}）`
      : "";
    return `${effect.resource} ${effect.before} → ${effect.after}${delta}`;
  }
  if (effect.effect_kind === "condition" && effect.condition) {
    const action = effect.action === "removed" ? "解除" : "新增";
    return `状态：${action}「${effect.condition}」`;
  }
  return null;
}

export function presentMechanicEffects(effects?: MechanicEffect[] | null): string[] {
  if (!effects?.length) return [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const effect of effects) {
    const line = presentMechanicEffect(effect);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

export function effectsVisibleOnView(
  view: Pick<RollGroupView, "kind" | "effects"> & {
    sanity?: { san_before?: number; san_after?: number };
    combat?: { damage?: { hp_before?: number; hp_after?: number } | null };
    damage?: { hp_before?: number; hp_after?: number };
  },
): MechanicEffect[] {
  const effects = view.effects || [];
  return effects.filter((effect) => {
    const resource = resourceKey(effect.resource);
    if (effect.effect_kind !== "scalar") return true;
    if (view.kind === "sanity" && resource === "san") return false;
    if (
      (view.kind === "combat" || view.kind === "damage")
      && resource === "hp"
      && (view.combat?.damage?.hp_after != null || view.damage?.hp_after != null)
    ) {
      return false;
    }
    return true;
  });
}

export function presentRollGroupEffects(view: RollGroupView): string[] {
  return presentMechanicEffects(effectsVisibleOnView(view));
}

export function presentSanityCard(sanity: SanityPayload, fallbackLoss?: RollDisplay): {
  before: number | null;
  after: number | null;
  amount: number | null;
  lossExpression: string | null;
} {
  const check = sanity.check;
  const loss = sanity.loss ?? fallbackLoss;
  const before = sanity.san_before ?? check?.san_before ?? loss?.san_before ?? null;
  const after = sanity.san_after ?? check?.san_after ?? loss?.san_after ?? null;
  const amount = sanity.san_loss
    ?? check?.san_loss
    ?? loss?.san_loss
    ?? (before != null && after != null ? before - after : null)
    ?? (typeof loss?.roll === "number" ? loss.roll : null);
  const lossExpression = sanity.san_loss_expression
    || check?.san_loss_expression
    || loss?.san_loss_expression
    || loss?.die_expression
    || loss?.die
    || null;
  return { before, after, amount, lossExpression };
}

export function presentRollGroup(view: RollGroupView): {
  kind: RollGroupLayout;
  effectLines: string[];
  shotCount: number;
  volleyCount: number;
  hasSpecializedCard: boolean;
} {
  return {
    kind: view.kind,
    effectLines: presentRollGroupEffects(view),
    shotCount: view.kind === "combat" ? view.combat.shots?.length ?? 0 : 0,
    volleyCount: view.kind === "combat" ? view.combat.volleys?.length ?? 0 : 0,
    hasSpecializedCard: view.kind !== "check",
  };
}
