import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const COC_SYSTEM_INSTRUCTION_CUSTOM_TYPE = "coc-system-instruction";
export const COC_SYSTEM_INSTRUCTION_CONTRACT_ID = (
  "coc.pi-system-instruction.v1"
);

export type CocSystemInstructionEnvelope = Record<string, unknown> & {
  schema_version: 1;
  contract_id: typeof COC_SYSTEM_INSTRUCTION_CONTRACT_ID;
  kind: "system_instruction";
  audience: "keeper_only";
  source_type: string;
  instruction: string;
  player_input: false;
  journal_policy: "never";
};

type MessageSender = Pick<ExtensionAPI, "sendMessage">;

export type CocSystemInstructionSpec = {
  sourceType: string;
  instruction: string;
  context?: Record<string, unknown>;
  customType?: string;
};

export type CocSystemInstructionDispatchOptions = {
  triggerTurn?: boolean;
  deliverAs?: "steer" | "followUp";
};

export function cocSystemInstructionEnvelope(
  spec: CocSystemInstructionSpec,
): CocSystemInstructionEnvelope {
  const instruction = spec.instruction.trim();
  if (!instruction) throw new Error("COC system instruction must not be empty");
  const contextKind = typeof spec.context?.kind === "string"
    ? spec.context.kind
    : null;
  const contextContractId = typeof spec.context?.contract_id === "string"
    ? spec.context.contract_id
    : null;
  return {
    ...(spec.context ?? {}),
    ...(contextKind === null ? {} : { context_kind: contextKind }),
    ...(contextContractId === null
      ? {}
      : { context_contract_id: contextContractId }),
    schema_version: 1,
    contract_id: COC_SYSTEM_INSTRUCTION_CONTRACT_ID,
    kind: "system_instruction",
    audience: "keeper_only",
    source_type: spec.sourceType,
    instruction,
    player_input: false,
    journal_policy: "never",
  };
}

export function sendCocSystemInstruction(
  pi: MessageSender,
  spec: CocSystemInstructionSpec,
  options: CocSystemInstructionDispatchOptions = { triggerTurn: true },
): CocSystemInstructionEnvelope {
  const envelope = cocSystemInstructionEnvelope(spec);
  pi.sendMessage({
    customType: spec.customType ?? COC_SYSTEM_INSTRUCTION_CUSTOM_TYPE,
    content: JSON.stringify(envelope),
    display: false,
    details: envelope,
  }, options);
  return envelope;
}

function userText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "user") return null;
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return null;
  const text = value.content
    .flatMap((part) => (
      part && typeof part === "object"
      && (part as { type?: unknown }).type === "text"
      && typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : []
    ))
    .join("");
  return text || null;
}

/** Return the latest real role=user text in one persistent Pi branch. */
export function latestExternalUserText(branch: unknown): string | null {
  if (!Array.isArray(branch)) return null;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { type?: unknown; message?: unknown };
    if (row.type !== "message") continue;
    const text = userText(row.message);
    if (text !== null) return text;
  }
  return null;
}

export function recoveredOpenTurnPlayerText(
  currentTurn: unknown,
  retainedPlayerText: unknown,
): { text: string; source: "canonical_current_turn" | "pi_session_branch" } | null {
  const turn = currentTurn && typeof currentTurn === "object"
    ? currentTurn as { player_input_text?: unknown }
    : null;
  const canonical = typeof turn?.player_input_text === "string"
    ? turn.player_input_text.trim()
    : "";
  if (canonical) return { text: canonical, source: "canonical_current_turn" };
  const retained = typeof retainedPlayerText === "string"
    ? retainedPlayerText.trim()
    : "";
  return retained ? { text: retained, source: "pi_session_branch" } : null;
}

export function registerCocSystemInstructionCommand(
  pi: Pick<ExtensionAPI, "registerCommand" | "sendMessage">,
  options: {
    beforeDispatch?: (
      instruction: string,
      context: ExtensionContext,
    ) => void;
  } = {},
): void {
  pi.registerCommand("system", {
    description: "Send Keeper-only COC host control; never player input.",
    handler: async (args, context) => {
      const instruction = args.trim();
      if (!instruction) {
        context.ui.notify("Usage: /system <instruction>", "warning");
        return;
      }
      options.beforeDispatch?.(instruction, context);
      const commandContext = context as ExtensionContext & {
        isIdle?: () => boolean;
      };
      sendCocSystemInstruction(pi, {
        sourceType: "operator_command",
        instruction,
      }, commandContext.isIdle?.() === false
        ? { triggerTurn: true, deliverAs: "steer" }
        : { triggerTurn: true });
    },
  });
}
