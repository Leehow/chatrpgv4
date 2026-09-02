/**
 * Host provenance pledges: never-model-authored required arguments.
 *
 * Some keeper-facing operations require an identity the model is forbidden to
 * author — it is stripped from the model-owned schema and raw validation
 * rejects it as host material. The documented way such a field reaches
 * arguments is by provenance: the host retains it from an earlier accepted
 * operation and attaches it after raw validation.
 *
 * Until this table existed, nothing performed that attachment for
 * `timeline.fork_confirm` or `state.assets_liquidate`. The runtime demanded a
 * field the model could not write and the host did not supply, so both
 * operations were structurally uncallable: the KP received `missing_param`
 * naming a field absent from the very `expected_schema` it was told to
 * correct itself with, and the non-retry circuit then blocked every further
 * attempt. A worldline fork could be requested and never confirmed.
 *
 * Each row states where the value comes from. Nothing here is module-specific
 * — the pledge is a property of the operation pair, not of any campaign.
 *
 * Scope: pledges live in host memory for the session that minted them. The
 * producers write durable ledger rows (`timeline.fork_confirm` resolves its
 * request from the ledger, not from this table), so a pledge minted in an
 * earlier session is not carried across a restart — the consumer then reports
 * `host_pledge_unavailable` naming its producer, and calling that producer
 * again re-mints it. That is a real limitation, not an oversight: reading the
 * durable ledger from here would need a host query lane this layer does not
 * have. It costs one extra operation after a restart and never loses state.
 */

type JsonRecord = Record<string, unknown>;

export type HostProvenancePledge = {
  /** Operation whose acceptance mints the value. */
  readonly producer: string;
  /** `result` reads the accepted envelope's `data`; `argument` reads the
   * dispatched arguments, for producers that do not echo the value back. */
  readonly from: "result" | "argument";
  /** Dotted path read on that source. */
  readonly key: string;
  /** Argument name attached to the consumer call. */
  readonly field: string;
  /** Contract precondition on the producer's result, when it has one. */
  readonly accepts?: (data: JsonRecord | null) => boolean;
  /** Actionable sentence returned when no pledge is retained. */
  readonly missingMessage: string;
};

export const HOST_PROVENANCE_PLEDGES:
  Readonly<Record<string, HostProvenancePledge>> = {
    "timeline.fork_confirm": {
      producer: "timeline.fork_request",
      from: "result",
      key: "decision_id",
      field: "request_decision_id",
      missingMessage: (
        "no accepted timeline.fork_request is retained for this campaign; "
        + "call timeline.fork_request first — the request identity is attached "
        + "by the host and is never a model argument"
      ),
    },
    "memory.extraction_settle": {
      producer: "turn.finalize",
      from: "result",
      key: "memory_extraction.backlog_id",
      field: "backlog_id",
      // The live path is the host bridge inside MemoryExtractionDispatcher,
      // which reads this same value off the finalize envelope. The operation
      // is `discovery: surface` all the same, so a keeper that calls it
      // directly must not hit the uncallable dead end this table exists for.
      missingMessage: (
        "no finalized turn with a pending memory extraction is retained for "
        + "this campaign; the backlog identity is attached by the host from "
        + "turn.finalize and is never a model argument"
      ),
    },
    "state.assets_liquidate": {
      producer: "state.advance_time",
      from: "argument",
      key: "decision_id",
      field: "linked_time_decision_id",
      // The contract names a settled advance with a positive elapsed delta;
      // a zero-delta advance is not a liquidation window.
      accepts: (data) => typeof data?.delta_minutes === "number"
        && data.delta_minutes > 0,
      missingMessage: (
        "no settled state.advance_time with a positive elapsed delta is "
        + "retained for this campaign; advance time first — the linked time "
        + "decision is attached by the host and is never a model argument"
      ),
    },
  };

/** Producer operation -> the consumers whose pledge it mints. */
export function pledgeConsumersOf(producer: string): string[] {
  return Object.entries(HOST_PROVENANCE_PLEDGES)
    .filter(([, pledge]) => pledge.producer === producer)
    .map(([consumer]) => consumer);
}

/** Read the pledged value from an accepted producer call, or null. */
export function pledgedValue(
  pledge: HostProvenancePledge,
  args: { data: JsonRecord | null; arguments: JsonRecord | null },
): string | null {
  if (pledge.accepts !== undefined && !pledge.accepts(args.data)) return null;
  const source = pledge.from === "result" ? args.data : args.arguments;
  const value = pledge.key.split(".").reduce<unknown>(
    (node, segment) => (node && typeof node === "object")
      ? (node as JsonRecord)[segment]
      : undefined,
    source,
  );
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
