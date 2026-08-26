import type { JsonObject } from "./runtime.ts";

/**
 * Mechanical-output gate: contract-surface detection of formal mechanical
 * markers in KP assistant output, bound to authoritative same-epoch receipts.
 *
 * This is NOT a prose-quality judge. It detects only the formal render
 * markers of the player-facing mechanics contract:
 * - dice class: `【明骰】` blocks and `掷骰：N` dice lines
 * - resource class: SAN/HP numeric transfers (`SAN 50→46`, `HP 6→4`) and
 *   `损失 N 点` loss lines
 *
 * Binding is presence-based per class within the same player-turn epoch:
 * - dice markers require at least one authoritative dice receipt (a
 *   successful coc_invoke whose data carries a non-empty `roll_id`)
 * - resource markers require at least one successful `state.*` write receipt
 *
 * Markers without binding are intercepted before reaching the player and the
 * KP receives a hidden instruction to execute the canonical operation first,
 * then re-render from the receipt numbers.
 */

export const MECHANICAL_OUTPUT_GATE_CUSTOM_TYPE = "coc-mechanical-output-gate";

export const SETTLED_OUTPUT_GATE_CUSTOM_TYPE = "coc-settled-output-gate";

export const SETTLED_OUTPUT_PREFLIGHT_CUSTOM_TYPE = (
  "coc-settled-output-preflight"
);

export const MECHANICAL_OUTPUT_GATE_INSTRUCTION = (
  "你的上一条输出包含正式机械标记（【明骰】／掷骰：N／SAN·HP 数值转移），"
  + "但本回合没有对应的权威收据，已被门禁拦截、未送达玩家。"
  + "机械数字只能来自规则/状态收据：先经 coc_rules / coc_state 执行——骰点走 "
  + "rules.roll / rules.opposed / sanity.execute / rules.damage 等并取得返回的 "
  + "roll_id，结算与 SAN/HP 落账走 state.* 并取得 decision_id——"
  + "再按收据数字渲染正式标记；禁止凭叙述编造或推算骰点与数值变动。"
  + "执行完成后重新输出即可放行。"
);

export const SETTLED_OUTPUT_GATE_INSTRUCTION = (
  "你的上一条玩家可见正文没有本回合的 turn.finalize 权威收据，已被门禁拦截、"
  + "未送达玩家。不要重掷、不要改写已经产生的规则或状态收据，也不要重新结算"
  + "玩家行动。现在按现有收据与当前玩家原文依次完成 state.journal、"
  + "turn.output_context、turn.finalize；最后只输出 turn.finalize 返回的 exact "
  + "rendered_text。即使本回合没有公开骰或数值变化，也必须走同一个结算边界。"
);

export const SETTLED_OUTPUT_PREFLIGHT_INSTRUCTION = (
  "This external player turn requires a hash-bound finalization receipt before any "
  + "player-visible body is admissible. Begin this inference with the canonical "
  + "tool call(s) needed to ground and settle the player's action; do not spend a "
  + "generation drafting tool-free player-visible prose. Before state.journal, "
  + "semantically decide whether the intended fiction changes the current PC's cash, "
  + "inventory, resources, conditions, or time, and execute the owning state/rules "
  + "operation first. An NPC handoff of money or an item is not true until "
  + "state.cash_grant / state.item_grant succeeds. Later state_authority_review must "
  + "list each such draft claim and bind source_effect_id to its exact current effect id; "
  + "an ungrounded claim forces prose-only revision 2. After all rules and state "
  + "writes, close the same current player input through state.journal, "
  + "turn.output_context, the returned agency review operation when required, and "
  + "turn.finalize. Then output only turn.finalize.rendered_text exactly. This is a "
  + "closure steer, not a fixed semantic pipeline: the Keeper still chooses the "
  + "fiction, grounding, checks, and state changes."
);

export type MechanicalMarkerClass = "dice" | "resource";

export type MechanicalMarker = {
  class: MechanicalMarkerClass;
  pattern: string;
  sample: string;
};

export type SettledOutputRecoveryMetadata = {
  attempt: number;
  maxAttempts: number;
  canonicalProgress: Record<string, unknown>;
};

const DICE_MARKER_PATTERNS: ReadonlyArray<{ pattern: string; re: RegExp }> = [
  { pattern: "formal_dice_block", re: /【明骰】/g },
  { pattern: "dice_line", re: /掷骰[：:]\s*\d+/g },
];

const RESOURCE_MARKER_PATTERNS: ReadonlyArray<{
  pattern: string;
  re: RegExp;
}> = [
  { pattern: "san_transfer", re: /SAN\s*\d+\s*(?:→|->)\s*\d+/g },
  { pattern: "hp_transfer", re: /HP\s*\d+\s*(?:→|->)\s*\d+/g },
  { pattern: "loss_points", re: /损失[^。；\n]{0,24}?\d+\s*点/g },
];

function collectMatches(
  text: string,
  patterns: ReadonlyArray<{ pattern: string; re: RegExp }>,
  markerClass: MechanicalMarkerClass,
  out: MechanicalMarker[],
): void {
  for (const { pattern, re } of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0];
      out.push({
        class: markerClass,
        pattern,
        sample: raw.length > 48 ? `${raw.slice(0, 48)}…` : raw,
      });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

export function detectMechanicalMarkers(text: string): MechanicalMarker[] {
  if (!text) return [];
  const markers: MechanicalMarker[] = [];
  collectMatches(text, DICE_MARKER_PATTERNS, "dice", markers);
  collectMatches(text, RESOURCE_MARKER_PATTERNS, "resource", markers);
  return markers;
}

export function mechanicalMarkerClassesUncovered(
  markers: MechanicalMarker[],
  hasDiceReceipt: boolean,
  hasResourceReceipt: boolean,
): MechanicalMarker[] {
  return markers.filter((marker) => (
    marker.class === "dice" ? !hasDiceReceipt : !hasResourceReceipt
  ));
}

export function buildMechanicalOutputGateEnvelope(
  playerTurnEpoch: number,
  uncoveredMarkers: MechanicalMarker[],
): JsonObject {
  return {
    schema_version: 1,
    kind: "mechanical_output_gate",
    status: "intercepted",
    player_turn_epoch: playerTurnEpoch,
    uncovered_markers: uncoveredMarkers,
    action: "execute_then_render",
    instruction: MECHANICAL_OUTPUT_GATE_INSTRUCTION,
  };
}

export function buildSettledOutputGateEnvelope(
  playerTurnEpoch: number,
  recovery?: SettledOutputRecoveryMetadata,
): JsonObject {
  return {
    schema_version: 1,
    kind: "settled_output_gate",
    status: "intercepted",
    player_turn_epoch: playerTurnEpoch,
    action: "journal_context_finalize_exact",
    instruction: SETTLED_OUTPUT_GATE_INSTRUCTION,
    ...(recovery === undefined
      ? {}
      : {
          recovery_attempt: recovery.attempt,
          recovery_budget: recovery.maxAttempts,
          canonical_progress: recovery.canonicalProgress,
        }),
  };
}

export function buildSettledOutputPreflightEnvelope(
  playerTurnEpoch: number,
): JsonObject {
  return {
    schema_version: 1,
    kind: "settled_output_preflight",
    status: "armed",
    player_turn_epoch: playerTurnEpoch,
    action: "tools_then_journal_context_finalize_exact",
    instruction: SETTLED_OUTPUT_PREFLIGHT_INSTRUCTION,
  };
}
