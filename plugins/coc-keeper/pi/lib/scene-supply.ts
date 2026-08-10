export type SceneSupplyDecision =
  | { action: "allow"; supply: Record<string, unknown> }
  | { action: "retry_with_minimal"; supply: Record<string, unknown> }
  | {
    action: "wait";
    supply: Record<string, unknown>;
    playerWaitText: string;
    instruction: string;
  };

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Pure Pi-only policy for a source-material gate. It never judges whether an
 * action, transition, clue, or story beat is appropriate: it only decides
 * whether a destination has source-bound material ready for the KP.
 */
export function decideSceneSupply(
  supplyValue: unknown,
  completedWaits: number,
): SceneSupplyDecision {
  const supply = objectOrEmpty(supplyValue);
  if (supply.enforced !== true || supply.ready === true) {
    return { action: "allow", supply };
  }
  if (completedWaits >= 1 && supply.fallback_available === true) {
    return { action: "retry_with_minimal", supply };
  }
  return {
    action: "wait",
    supply,
    playerWaitText: "场景载入中……",
    instruction: (
      "Do not move or narrate the destination yet. Dispatch or resume "
      + "steward-scene for the requested scene plus its neighboring prefetch, "
      + "then await its completion and retry the same state.move_scene call. "
      + "This is a source-material wait only; it does not judge or reorder play."
    ),
  };
}
