export type SceneSupplyDecision =
  | { action: "allow"; supply: Record<string, unknown> }
  | { action: "retry_with_minimal"; supply: Record<string, unknown> }
  | {
    action: "wait";
    supply: Record<string, unknown>;
    playerWaitText: string;
    instruction: string;
  }
  | {
    action: "blocked";
    supply: Record<string, unknown>;
    instruction: string;
  };

/**
 * Completed waits after which an unready, fallback-less destination stops
 * being a wait and becomes an admitted block.
 *
 * Without a terminal state the gate has no exit: the KP re-requests the same
 * move, gets `scene_supply_pending` again, says 「场景载入中……」 again, and the
 * player spends turn after turn on a loading message. Observed live: a KP that
 * could not dispatch the steward repeated that turn until the player changed
 * the subject.
 */
export const MAX_SOURCE_WAITS = 2;

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Pure Pi-only policy for a source-material gate. It never judges whether an
 * action, transition, clue, or story beat is appropriate: it only decides
 * whether a destination has source-bound material ready for the KP.
 *
 * Instructions name the exact callable. Telling the KP to "dispatch
 * steward-scene" describes an intent and leaves it to guess which tool carries
 * it out; a capable model bridges that gap and a weaker one loops forever on
 * the same blocked move. Every instruction here names the tool it wants
 * called, so following the contract is a lookup rather than an inference.
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
  if (completedWaits >= MAX_SOURCE_WAITS) {
    return {
      action: "blocked",
      supply,
      instruction: (
        "Source material for this destination did not arrive after "
        + `${completedWaits} completed waits and no source-bound minimal `
        + "fallback exists. Stop repeating the loading line: it costs the "
        + "player a turn and says nothing. Tell the player plainly, in "
        + "fiction, that this place stays closed to you for now, keep the "
        + "destination unestablished, invent nothing about it, and offer the "
        + "leads that are open. Retry the move only after steward-scene "
        + "reports the bundle is ready."
      ),
    };
  }
  return {
    action: "wait",
    supply,
    playerWaitText: "场景载入中……",
    instruction: (
      "Do not move or narrate the destination yet. Call the "
      + "`coc_dispatch_source_work` tool with the repository-produced "
      + "steward-scene task for this scene plus its neighboring prefetch "
      + "(resume the existing dispatch instead of submitting a duplicate when "
      + "one is already in flight), await its completion, then retry the same "
      + "state.move_scene call. If you cannot produce that task, say so to the "
      + "player instead of repeating the loading line. This is a "
      + "source-material wait only; it does not judge or reorder play."
    ),
  };
}
