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

export const MECHANICAL_OUTPUT_GATE_INSTRUCTION = (
  "你的上一条输出包含正式机械标记（【明骰】／掷骰：N／SAN·HP 数值转移），"
  + "但本回合没有对应的权威收据，已被门禁拦截、未送达玩家。"
  + "机械数字只能来自规则/状态收据：先经 coc_invoke 执行——骰点走 "
  + "rules.roll / rules.opposed / sanity.execute / rules.damage 等并取得返回的 "
  + "roll_id，结算与 SAN/HP 落账走 state.* 并取得 decision_id——"
  + "再按收据数字渲染正式标记；禁止凭叙述编造或推算骰点与数值变动。"
  + "执行完成后重新输出即可放行。"
);

export type MechanicalMarkerClass = "dice" | "resource";

export type MechanicalMarker = {
  class: MechanicalMarkerClass;
  pattern: string;
  sample: string;
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
