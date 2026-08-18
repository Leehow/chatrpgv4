/** Setup→play handoff parse. Caller: extension after setup.complete. Consumer: server-node/launcher. */

export const COC_SETUP_HANDOFF_EXIT_CODE = 42;

type JsonObject = Record<string, unknown>;

function objectOrNull(value: unknown): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function pickReceipt(result: JsonObject): JsonObject | null {
  return (
    objectOrNull(result.handoff)
    ?? objectOrNull(result.handoff_receipt)
    ?? objectOrNull(result.receipt)
  );
}

function campaignIdOf(result: JsonObject, receipt: JsonObject): string | null {
  for (const value of [result.campaign_id, receipt.campaign_id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Extract a setup→play handoff from a canonical tool envelope.
 * Null unless operation is setup.complete, ok is true, and a receipt object exists.
 */
export function handoffFromEnvelope(
  envelope: unknown,
): { campaign_id: string; receipt: JsonObject } | null {
  const root = objectOrNull(envelope);
  if (root === null || root.ok !== true) return null;
  const operation = root.operation ?? root.tool;
  if (operation !== "setup.complete") return null;
  const data = objectOrNull(root.data);
  const result = objectOrNull(root.result) ?? objectOrNull(data?.result) ?? data;
  if (result === null) return null;
  const receipt = pickReceipt(result);
  if (receipt === null) return null;
  const campaign_id = campaignIdOf(result, receipt);
  if (campaign_id === null) return null;
  return { campaign_id, receipt };
}
