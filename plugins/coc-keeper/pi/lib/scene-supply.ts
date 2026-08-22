export type SceneSupplyDispatchStatus =
  | { status: "active"; dispatchKey: string }
  | { status: "terminal"; dispatchKey?: string; failureClass?: string }
  | { status: "unavailable"; failureClass: string };

export type SceneSupplyDecision =
  | { action: "allow"; supply: Record<string, unknown> }
  | { action: "retry_with_minimal"; supply: Record<string, unknown> }
  | {
    action: "wait";
    supply: Record<string, unknown>;
    instruction: string;
  }
  | {
    action: "blocked";
    supply: Record<string, unknown>;
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
 *
 * The host supplies the dispatch lifecycle; the KP never owns, constructs,
 * resumes, or polls the source job. Consequently a wait exists only while one
 * real bounded host dispatch is active. Missing capability/task and
 * terminal-without-material are stable blocks, not promises that another model
 * turn will make progress.
 */
export function decideSceneSupply(
  supplyValue: unknown,
  dispatch: SceneSupplyDispatchStatus,
): SceneSupplyDecision {
  const supply = objectOrEmpty(supplyValue);
  if (supply.enforced !== true || supply.ready === true) {
    return { action: "allow", supply };
  }
  if (dispatch.status === "terminal" && supply.fallback_available === true) {
    return { action: "retry_with_minimal", supply };
  }
  if (dispatch.status === "active") {
    return {
      action: "wait",
      supply,
      instruction: (
        "Keep the destination unestablished and settle only parts of the "
        + "player's action that do not depend on it. Do not take any extra "
        + "Keeper action to advance this boundary, and do not promise that "
        + "the destination will become available later. If the table needs an "
        + "immediate response, keep it entirely in fiction without asserting "
        + "facts about the destination."
      ),
    };
  }
  return {
    action: "blocked",
    supply,
    instruction: (
      "Keep the destination unestablished in the fiction. Do not invent facts "
      + "about it or promise a later continuation. Present only an in-world "
      + "limit and offer leads that are already established and open."
    ),
  };
}
