/** Setup→play handoff parse. Caller: extension after setup.complete. Consumer: server-node/launcher. */

export const COC_SETUP_HANDOFF_EXIT_CODE = 42;

type JsonObject = Record<string, unknown>;

export type SetupHandoffExpectation = {
  campaignId: string;
  decisionId: string;
};

const SETUP_HANDOFF_RECEIPT_KEYS = new Set([
  "schema_version",
  "decision_id",
  "campaign_id",
  "investigator_ids",
  "completed_at",
  "opening_projection_ref",
  "lane_interrupted_at_handoff",
]);

function objectOrNull(value: unknown): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function pickReceipt(result: JsonObject): JsonObject | null {
  const hasHandoff = Object.hasOwn(result, "handoff");
  const hasAlias = Object.hasOwn(result, "handoff_receipt");
  if (hasHandoff === hasAlias) return null;
  return objectOrNull(
    hasHandoff ? result.handoff : result.handoff_receipt,
  );
}

function exactReceipt(
  receipt: JsonObject,
  campaignId: string,
  decisionId: string,
): boolean {
  if (
    Object.keys(receipt).length !== SETUP_HANDOFF_RECEIPT_KEYS.size
    || Object.keys(receipt).some((key) => !SETUP_HANDOFF_RECEIPT_KEYS.has(key))
    || receipt.schema_version !== 1
    || receipt.campaign_id !== campaignId
    || receipt.decision_id !== decisionId
    || typeof receipt.completed_at !== "string"
    || !receipt.completed_at.trim()
    || (
      receipt.opening_projection_ref !== null
      && objectOrNull(receipt.opening_projection_ref) === null
    )
    || typeof receipt.lane_interrupted_at_handoff !== "boolean"
  ) return false;
  const investigatorIds = receipt.investigator_ids;
  if (!Array.isArray(investigatorIds) || investigatorIds.length === 0) return false;
  const seen = new Set<string>();
  for (const value of investigatorIds) {
    if (
      typeof value !== "string"
      || !value
      || value !== value.trim()
      || value === "."
      || value === ".."
      || value.includes("/")
      || value.includes("\\")
      || seen.has(value)
    ) return false;
    seen.add(value);
  }
  return true;
}

/**
 * Extract a setup→play handoff from a canonical tool envelope.
 * Null unless operation is setup.complete, ok is true, and a receipt object exists.
 */
export function handoffFromEnvelope(
  envelope: unknown,
  expected?: SetupHandoffExpectation,
): { campaign_id: string; receipt: JsonObject } | null {
  const root = objectOrNull(envelope);
  if (root === null || root.ok !== true) return null;
  if (root.tool !== "setup.complete") return null;
  const data = objectOrNull(root.data);
  if (
    data === null
    || data.schema_version !== 1
    || data.status !== "PASS"
    || data.kind !== "campaign.complete"
  ) return null;
  const result = objectOrNull(data.result);
  if (
    result === null
    || typeof result.campaign_id !== "string"
    || !result.campaign_id.trim()
    || result.campaign_id !== result.campaign_id.trim()
    || result.ready_for_table !== true
    || result.next !== "table_opening"
  ) return null;
  const receipt = pickReceipt(result);
  if (receipt === null) return null;
  const campaignId = result.campaign_id;
  const decisionId = receipt.decision_id;
  if (
    typeof decisionId !== "string"
    || !decisionId.trim()
    || decisionId !== decisionId.trim()
    || expected !== undefined
    && (
      campaignId !== expected.campaignId
      || decisionId !== expected.decisionId
    )
    || !exactReceipt(receipt, campaignId, decisionId)
  ) return null;
  return { campaign_id: campaignId, receipt };
}
