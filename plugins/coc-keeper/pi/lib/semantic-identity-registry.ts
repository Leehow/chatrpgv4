/**
 * Pi-only semantic identity registry.
 *
 * ONE typed owner for the canonical↔semantic identity mappings that model
 * content and model arguments use. Every registration carries its domain,
 * exact session epoch, exact campaign, player-turn scope (for turn-lifetime
 * records), the structured semantic facts the handle derives from, and an
 * active/invalidated/retired state. There is no other ad-hoc id map: raw
 * model validation, model-content projection, and host-side restoration all
 * consume this registry.
 *
 * Identifier-law properties (all enforced here, none by convention):
 * - Handles are meaning-bearing: `<domain prefix><semantic slug>` built ONLY
 *   from structured observation facts. Purely numeric or empty slugs are not
 *   meaning-bearing and never become handles; there is no `roll-N` fallback —
 *   a registration without semantic facts fails closed.
 * - Registration is one-to-one and collision-safe: the same canonical id
 *   re-registers to its existing handle; a different canonical id colliding
 *   on the same semantic base receives a stable ordinal suffix
 *   (`<base>-2`, `-3`, …). Handles are never overwritten or flattened across
 *   domains.
 * - Lifetimes are authoritative: `player_turn` records resolve only inside
 *   their exact session epoch + campaign + player turn; `party` investigator
 *   identity is invalidated by empty/ambiguous authority; `authoritative`
 *   persistent effects survive until an authoritative consume/resolve retires
 *   them; `snapshot` items/weapons and routes resolve only while the latest
 *   authoritative snapshot still contains them.
 * - Resolution requires the exact current invocation scope: a stale session
 *   epoch, a different campaign, an older player turn, or an invalidated or
 *   retired record never resolves — fail closed, no echo.
 */

/** Registry domains. `provenance` is projection-only (closed projector). */
export type SemanticIdentityDomain =
  | "investigator"
  | "roll"
  | "effect"
  | "item"
  | "weapon"
  | "route"
  | "affordance"
  | "provenance";

/** Handle prefix presented to the model for each mappable domain. */
const DOMAIN_HANDLE_PREFIX: ReadonlyMap<
  Exclude<SemanticIdentityDomain, "investigator" | "provenance">,
  string
> = new Map([
  ["roll", "roll:"],
  ["effect", "effect:"],
  ["item", "item:"],
  ["weapon", "weapon:"],
  ["route", "route:"],
  ["affordance", "affordance:"],
]);

export type MappableSemanticIdentityDomain =
  Exclude<SemanticIdentityDomain, "investigator" | "provenance">;

/** Record lifetimes. The lifetime picks which scope fields bind liveness. */
export type SemanticIdentityLifetime =
  | "player_turn"
  | "party"
  | "authoritative"
  | "snapshot";

/** Exact invocation scope every projection/resolution is judged against. */
export type SemanticIdentityScope = {
  sessionEpoch: number;
  campaign: string;
  /** Required for `player_turn` records; ignored by the other lifetimes. */
  playerTurnEpoch?: number;
  /**
   * Authoritative owner/container identity for snapshot records — e.g.
   * `inventory:investigator:<id>`, `inventory:npc:<id>`, `scene:<sceneId>`.
   * One owner's snapshot never retires another owner's mappings; REQUIRED
   * for `snapshot` lifetime registrations. For item/weapon records this is
   * the inventory owner; for route records the scene container.
   */
  ownerKey?: string;
  /**
   * Scene container (`scene:<sceneId>`) judged for ROUTE snapshot records
   * when the invocation's owner is an inventory holder, not a scene.
   */
  sceneOwnerKey?: string;
};

export type SemanticIdentityRegistration = {
  domain: MappableSemanticIdentityDomain;
  canonicalId: string;
  /** Meaning-bearing observation facts (attempt id, skill, kind, label…). */
  facts: readonly unknown[];
  scope: SemanticIdentityScope;
  lifetime: SemanticIdentityLifetime;
};

export type SemanticIdentityRegistrationResult =
  | { ok: true; handle: string; created: boolean }
  | {
    ok: false;
    reason: "invalid_canonical_id" | "invalid_scope" | "no_semantic_facts";
  };

export type SemanticIdentityResolution =
  | { ok: true; canonicalId: string }
  | {
    ok: false;
    reason:
      | "unknown_handle"
      | "stale_session"
      | "campaign_mismatch"
      | "stale_turn"
      | "invalidated"
      | "owner_mismatch"
      | "ambiguous_owner";
  };

/** Authoritative current-PC authority, exactly as canonical envelopes state it. */
export type RegistryPartyAuthority =
  | { kind: "empty" }
  | { kind: "ambiguous"; investigatorIds: readonly string[] }
  | {
    kind: "single";
    investigatorId: string;
    pcSubjectRefs: readonly string[];
  };

type PartyRecord = {
  scope: SemanticIdentityScope;
  state: "single" | "empty" | "ambiguous";
  investigatorId: string | null;
  pcSubjectRefs: readonly string[];
};

type IdentityRecord = {
  domain: MappableSemanticIdentityDomain;
  canonicalId: string;
  handle: string;
  scope: SemanticIdentityScope;
  lifetime: SemanticIdentityLifetime;
  state: "active" | "invalidated" | "retired";
};

/**
 * Structured slug: lowercase word/digit segments joined by single dashes.
 * CJK ideographs are meaning-bearing segments too — the zh-Hans play table
 * labels entities in Chinese, and those labels are exactly the semantic
 * facts handles must carry. There is no ASCII-only escape hatch that would
 * force a non-semantic fallback.
 */
function semanticFactSlug(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Purely numeric slugs are ordinals, not meaning-bearing handles.
  if (!slug || /^\d+$/.test(slug)) return "";
  // Never derive handles from random/entropy material.
  if (/[0-9a-f]{16,}/.test(slug) && /^[-0-9a-f]+$/.test(slug)) return "";
  return slug;
}

function isLiveScope(
  record: IdentityRecord,
  scope: SemanticIdentityScope,
): SemanticIdentityResolution {
  if (record.state !== "active") {
    return { ok: false, reason: "invalidated" };
  }
  if (record.scope.sessionEpoch !== scope.sessionEpoch) {
    return { ok: false, reason: "stale_session" };
  }
  if (record.scope.campaign !== scope.campaign) {
    return { ok: false, reason: "campaign_mismatch" };
  }
  if (
    record.lifetime === "player_turn"
    && record.scope.playerTurnEpoch !== scope.playerTurnEpoch
  ) {
    return { ok: false, reason: "stale_turn" };
  }
  // Snapshot records resolve/projection ONLY within their exact
  // owner/container scope: the same canonical id or handle under two owners
  // is never globally resolvable. The judged owner is the inventory owner
  // for item/weapon records and the scene container for routes.
  if (record.lifetime === "snapshot") {
    const judgedOwner = record.domain === "route"
      ? scope.sceneOwnerKey
      : scope.ownerKey;
    if (judgedOwner !== undefined && record.scope.ownerKey !== judgedOwner) {
      return { ok: false, reason: "owner_mismatch" };
    }
  }
  return { ok: true, canonicalId: record.canonicalId };
}

/** Most-specific failure first when several same-name records exist. */
function rankResolutionFailure(resolution: SemanticIdentityResolution): number {
  if (!resolution.ok) {
    switch (resolution.reason) {
      case "stale_turn": return 0;
      case "campaign_mismatch": return 1;
      case "stale_session": return 2;
      case "invalidated": return 3;
      case "owner_mismatch": return 4;
      case "ambiguous_owner": return 5;
      default: return 6;
    }
  }
  return 7;
}

/**
 * Per-domain live canonical→handle projection. Domains are NEVER flattened:
 * a canonical string that exists in two families projects independently per
 * family, and every consumer resolves through the domain it belongs to.
 */
export type SemanticProjectionView = {
  rolls: ReadonlyMap<string, string>;
  effects: ReadonlyMap<string, string>;
  items: ReadonlyMap<string, string>;
  weapons: ReadonlyMap<string, string>;
  routes: ReadonlyMap<string, string>;
  /** Copy-verbatim affordance projection of the actionable route working
   * set (scene.context `action_routes`/`route_index` rows). Same canonical
   * ids as the route family, independently projected per family. */
  affordances: ReadonlyMap<string, string>;
  /** Last-known handles for retired/lost snapshot entities: content may NAME
   * them (lost-id arrays) but resolution stays dead — they cannot be used. */
  lost: {
    items: ReadonlyMap<string, string>;
    weapons: ReadonlyMap<string, string>;
  };
};

/** Boundary view: nothing is live, so every identity field drops. */
export function emptySemanticProjectionView(): SemanticProjectionView {
  return {
    rolls: new Map(),
    effects: new Map(),
    items: new Map(),
    weapons: new Map(),
    routes: new Map(),
    affordances: new Map(),
    lost: { items: new Map(), weapons: new Map() },
  };
}

export type SemanticIdentityRegistry = {
  register(
    input: SemanticIdentityRegistration,
  ): SemanticIdentityRegistrationResult;
  /** Authoritative party authority replaces any prior investigator state. */
  applyPartyAuthority(
    scope: SemanticIdentityScope,
    authority: RegistryPartyAuthority,
  ): void;
  currentParty(
    scope: SemanticIdentityScope,
  ):
    | { live: false }
    | {
      live: true;
      state: "single";
      investigatorId: string;
      pcSubjectRefs: readonly string[];
    }
    | { live: true; state: "empty" | "ambiguous" };
  /**
   * Authoritative snapshot replacement for `item`/`weapon`/`route`/
   * `affordance` domains: members absent from the new snapshot are
   * invalidated; present members are registered (or reused) so removed
   * entities stop resolving immediately.
   */
  applySnapshot(
    domain: Extract<
      MappableSemanticIdentityDomain,
      "item" | "weapon" | "route" | "affordance"
    >,
    scope: SemanticIdentityScope,
    entries: ReadonlyArray<{ canonicalId: string; facts: readonly unknown[] }>,
  ): void;
  /** Authoritative retirement of a persistent (`authoritative`) record. */
  retire(
    domain: MappableSemanticIdentityDomain,
    canonicalId: string,
    scope: SemanticIdentityScope,
  ): void;
  /** Resolve a presented handle (with or without its domain prefix). */
  resolveHandle(
    domain: MappableSemanticIdentityDomain,
    handle: string,
    scope: SemanticIdentityScope,
  ): SemanticIdentityResolution;
  /** Per-domain live canonical→presented-handle projection for one exact
   * scope. Domains are never flattened: identical canonical strings in
   * different families project independently. */
  projectAll(scope: SemanticIdentityScope): SemanticProjectionView;
  /** Drop every record from an earlier session epoch. */
  clearSession(sessionEpoch: number): void;
  clearAll(): void;
};

export function createSemanticIdentityRegistry(): SemanticIdentityRegistry {
  const records = new Map<MappableSemanticIdentityDomain, Map<string, IdentityRecord>>();
  // (domain, epoch, campaign, applicable turn, base) → owning canonical id,
  // for stable collision ordinals. The applicable turn is the player-turn
  // epoch ONLY for `player_turn` records; party/authoritative/snapshot
  // ownership is turn-independent, so persistent entities never collide
  // with turn-local handles of the same semantic base.
  const baseOwners = new Map<
    string,
    {
      recordKey: string;
      lifetime: SemanticIdentityLifetime;
      campaign: string;
    }
  >();
  let party: PartyRecord | null = null;

  const domainRecords = (
    domain: MappableSemanticIdentityDomain,
  ): Map<string, IdentityRecord> => {
    let byDomain = records.get(domain);
    if (byDomain === undefined) {
      byDomain = new Map();
      records.set(domain, byDomain);
    }
    return byDomain;
  };

  const register = (
    input: SemanticIdentityRegistration,
  ): SemanticIdentityRegistrationResult => {
    const { domain, lifetime } = input;
    const canonicalId = typeof input.canonicalId === "string"
      ? input.canonicalId.trim()
      : "";
    if (!canonicalId) return { ok: false, reason: "invalid_canonical_id" };
    const scope = input.scope;
    if (
      !Number.isInteger(scope?.sessionEpoch)
      || typeof scope?.campaign !== "string"
      || !scope.campaign
    ) {
      return { ok: false, reason: "invalid_scope" };
    }
    if (lifetime === "player_turn" && !Number.isInteger(scope.playerTurnEpoch)) {
      return { ok: false, reason: "invalid_scope" };
    }
    if (lifetime === "snapshot" && (!scope.ownerKey || !scope.ownerKey.trim())) {
      return { ok: false, reason: "invalid_scope" };
    }
    const byDomain = domainRecords(domain);
    const recordKey = `${scope.campaign}\u0000${scope.ownerKey ?? "*"}\u0000${canonicalId}`;
    const existing = byDomain.get(recordKey);
    if (existing !== undefined && existing.state === "active") {
      const liveness = isLiveScope(existing, scope);
      // Same canonical id retries reuse the handle (one-to-one mapping).
      if (liveness.ok) {
        return { ok: true, handle: existing.handle, created: false };
      }
    }
    let base = "";
    for (const fact of input.facts) {
      const slug = semanticFactSlug(fact);
      if (slug) {
        base = slug;
        break;
      }
    }
    if (!base) return { ok: false, reason: "no_semantic_facts" };
    const prefix = DOMAIN_HANDLE_PREFIX.get(domain) ?? `${domain}:`;
    // Collision-safe stable ordinal within domain+scope: a different
    // canonical id on the same semantic base never overwrites; it takes the
    // next free ordinal — unless the prior owner is a dead scope (e.g. a
    // previous turn's stale player-turn record), in which case the base is
    // reclaimed so handles stay stable for recurring semantic entities.
    // Ownership is checked across BOTH lifetime buckets of this
    // domain+campaign so a persistent entity and a turn-local record can
    // never present the same handle.
    const epochCampaign = `${domain}\u0000${scope.sessionEpoch}\u0000${scope.campaign}`;
    const turnComponent = lifetime === "player_turn"
      ? String(scope.playerTurnEpoch)
      : "*";
    const ownerTurns = [
      "*",
      scope.playerTurnEpoch === undefined ? "*" : String(scope.playerTurnEpoch),
    ];
    const liveOwnerConflicts = (baseCandidate: string): boolean => {
      for (const ownerTurn of ownerTurns) {
        const owner = baseOwners.get(
          `${epochCampaign}\u0000${ownerTurn}\u0000${baseCandidate}`,
        );
        if (
          owner === undefined
          || owner.recordKey === recordKey
          || owner.campaign !== scope.campaign
        ) continue;
        const ownerRecord = byDomain.get(owner.recordKey);
        // Collision-safety is owner-blind: a semantic base is taken while
        // its owning record is alive IN ITS OWN RIGHT, even when the new
        // registration belongs to a different owner — handles stay globally
        // unique per campaign+epoch and never silently differ by owner.
        if (
          ownerRecord !== undefined
          && isLiveScope(ownerRecord, ownerRecord.scope).ok
        ) {
          return true;
        }
      }
      return false;
    };
    const claimBase = (baseCandidate: string): boolean => {
      if (liveOwnerConflicts(baseCandidate)) return false;
      baseOwners.set(
        `${epochCampaign}\u0000${turnComponent}\u0000${baseCandidate}`,
        { recordKey, lifetime, campaign: scope.campaign },
      );
      return true;
    };
    let handle = `${prefix}${base}`;
    if (!claimBase(base)) {
      let ordinal = 2;
      while (!claimBase(`${base}-${ordinal}`)) {
        ordinal += 1;
      }
      handle = `${prefix}${base}-${ordinal}`;
    }
    byDomain.set(recordKey, {
      domain,
      canonicalId,
      handle,
      scope: { ...scope },
      lifetime,
      state: "active",
    });
    return { ok: true, handle, created: true };
  };

  const applyPartyAuthority = (
    scope: SemanticIdentityScope,
    authority: RegistryPartyAuthority,
  ): void => {
    party = {
      scope: { ...scope },
      state: authority.kind,
      investigatorId: authority.kind === "single" ? authority.investigatorId : null,
      pcSubjectRefs: authority.kind === "single"
        ? [...authority.pcSubjectRefs]
        : [],
    };
  };

  const currentParty = (
    scope: SemanticIdentityScope,
  ):
    | { live: false }
    | {
      live: true;
      state: "single";
      investigatorId: string;
      pcSubjectRefs: readonly string[];
    }
    | { live: true; state: "empty" | "ambiguous" } => {
    if (party === null) return { live: false };
    const probe: IdentityRecord = {
      domain: "investigator",
      canonicalId: party.investigatorId ?? "",
      handle: "current-investigator",
      scope: party.scope,
      lifetime: "party",
      state: "active",
    };
    const liveness = isLiveScope(probe, scope);
    if (!liveness.ok) return { live: false };
    if (party.state !== "single") return { live: true, state: party.state };
    return {
      live: true,
      state: "single",
      investigatorId: party.investigatorId as string,
      pcSubjectRefs: [...party.pcSubjectRefs],
    };
  };

  const applySnapshot = (
    domain: Extract<
      MappableSemanticIdentityDomain,
      "item" | "weapon" | "route" | "affordance"
    >,
    scope: SemanticIdentityScope,
    entries: ReadonlyArray<{ canonicalId: string; facts: readonly unknown[] }>,
  ): void => {
    if (!scope.ownerKey || !scope.ownerKey.trim()) return;
    const byDomain = domainRecords(domain);
    const seen = new Set<string>();
    for (const entry of entries) {
      const registered = register({
        domain,
        canonicalId: entry.canonicalId,
        facts: entry.facts,
        scope,
        lifetime: "snapshot",
      });
      if (registered.ok) seen.add(entry.canonicalId.trim());
    }
    // Replacement, not append — scoped to THIS authoritative owner: one
    // owner's snapshot never retires another owner's mappings.
    for (const record of byDomain.values()) {
      if (
        !seen.has(record.canonicalId)
        && record.state === "active"
        && record.scope.sessionEpoch === scope.sessionEpoch
        && record.scope.campaign === scope.campaign
        && record.scope.ownerKey === scope.ownerKey
      ) {
        record.state = "invalidated";
      }
    }
  };

  const retire = (
    domain: MappableSemanticIdentityDomain,
    canonicalId: string,
    scope: SemanticIdentityScope,
  ): void => {
    for (const record of records.get(domain)?.values() ?? []) {
      if (record.canonicalId !== canonicalId) continue;
      // Owner-scoped retirement: a loss reported by one owner/container must
      // never retire the same canonical entity held by another owner.
      // Owner-less records (party-level) retire only from owner-less scopes.
      const recordOwner = record.scope.ownerKey ?? "*";
      const scopeOwner = scope.ownerKey ?? "*";
      if (recordOwner !== scopeOwner) continue;
      if (isLiveScope(record, scope).ok) record.state = "retired";
    }
  };

  const resolveHandle = (
    domain: MappableSemanticIdentityDomain,
    handle: string,
    scope: SemanticIdentityScope,
  ): SemanticIdentityResolution => {
    if (typeof handle !== "string" || !handle) {
      return { ok: false, reason: "unknown_handle" };
    }
    const prefix = DOMAIN_HANDLE_PREFIX.get(domain) ?? `${domain}:`;
    const bare = handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
    // A live record for this handle wins; only when none is live does the
    // most specific staleness reason surface (later scopes shadow older
    // same-name records, e.g. the same roll handle re-observed next turn).
    // Snapshot records resolve within their exact owner scope; without a
    // judged owner they resolve only when unambiguous across owners, and
    // `inventory:party` fallback records never compete with real owners.
    let firstFailure: SemanticIdentityResolution | null = null;
    const liveSnapshotOwners = new Set<string>();
    const livePartyRecords: IdentityRecord[] = [];
    let liveSnapshotRecord: IdentityRecord | null = null;
    for (const record of records.get(domain)?.values() ?? []) {
      const recordBare = record.handle.startsWith(prefix)
        ? record.handle.slice(prefix.length)
        : record.handle;
      if (recordBare !== bare) continue;
      const liveness = isLiveScope(record, scope);
      if (liveness.ok) {
        if (record.lifetime === "snapshot") {
          if (record.scope.ownerKey === "inventory:party") {
            livePartyRecords.push(record);
          } else {
            liveSnapshotOwners.add(record.scope.ownerKey ?? "*");
            liveSnapshotRecord = record;
          }
        } else {
          return liveness;
        }
        continue;
      }
      if (
        firstFailure === null
        || rankResolutionFailure(liveness) < rankResolutionFailure(firstFailure)
      ) {
        firstFailure = liveness;
      }
    }
    if (liveSnapshotOwners.size > 1) {
      return { ok: false, reason: "ambiguous_owner" };
    }
    if (liveSnapshotRecord !== null) {
      return { ok: true, canonicalId: liveSnapshotRecord.canonicalId };
    }
    if (livePartyRecords.length === 1) {
      return { ok: true, canonicalId: livePartyRecords[0].canonicalId };
    }
    if (livePartyRecords.length > 1) {
      return { ok: false, reason: "ambiguous_owner" };
    }
    return firstFailure ?? { ok: false, reason: "unknown_handle" };
  };

  const projectAll = (scope: SemanticIdentityScope): SemanticProjectionView => {
    const view: {
      rolls: Map<string, string>;
      effects: Map<string, string>;
      items: Map<string, string>;
      weapons: Map<string, string>;
      routes: Map<string, string>;
      affordances: Map<string, string>;
      lost: {
        items: Map<string, string>;
        weapons: Map<string, string>;
      };
    } = {
      rolls: new Map(),
      effects: new Map(),
      items: new Map(),
      weapons: new Map(),
      routes: new Map(),
      affordances: new Map(),
      lost: { items: new Map(), weapons: new Map() },
    };
    const viewProperty: ReadonlyMap<
      string,
      "rolls" | "effects" | "items" | "weapons" | "routes" | "affordances"
    > = new Map([
      ["roll", "rolls"],
      ["effect", "effects"],
      ["item", "items"],
      ["weapon", "weapons"],
      ["route", "routes"],
      ["affordance", "affordances"],
    ]);
    for (const [domain, byDomain] of records) {
      const property = viewProperty.get(domain);
      if (property === undefined) continue;
      // Owner/container-scoped projection: a canonical id held by TWO owners
      // never collapses to whichever record iterated last. With a judged
      // owner (inventory holder or scene container) only that owner's live
      // records project; without one, a canonical id is projectable only
      // while a SINGLE owner holds it live — ambiguous ids are dropped
      // (fail closed), never resolved through an arbitrary owner.
      const liveByCanonical = new Map<
        string,
        { handle: string; owners: Set<string>; hasRealOwner: boolean }
      >();
      for (const record of byDomain.values()) {
        if (!isLiveScope(record, scope).ok) continue;
        if (record.lifetime === "snapshot") {
          const entry = liveByCanonical.get(record.canonicalId) ?? {
            handle: record.handle,
            owners: new Set<string>(),
            hasRealOwner: false,
          };
          const isPartyFallback = record.scope.ownerKey === "inventory:party";
          if (isPartyFallback && entry.hasRealOwner) {
            // `inventory:party` is the FALLBACK container: a real owner's
            // record wins and the party record never creates ambiguity.
            continue;
          }
          if (!isPartyFallback) {
            // A real owner arriving after party records retires them: keep
            // only real owners in the ambiguity set.
            entry.hasRealOwner = true;
            if (entry.owners.has("inventory:party")) {
              entry.owners.delete("inventory:party");
            }
          }
          entry.owners.add(record.scope.ownerKey ?? "*");
          entry.handle = record.handle;
          liveByCanonical.set(record.canonicalId, entry);
        } else {
          view[property].set(record.canonicalId, record.handle);
        }
      }
      for (const [canonicalId, entry] of liveByCanonical) {
        if (entry.owners.size <= 1) view[property].set(canonicalId, entry.handle);
      }
      // Lost/retired snapshot entities keep their LAST-KNOWN semantic
      // handle for content that must NAME them (lost-id arrays), while
      // resolution stays dead so they can never be used again. The same
      // owner discipline applies: other owners' records never appear, and
      // an ambiguous canonical id is dropped.
      if (domain === "item" || domain === "weapon") {
        const lostByCanonical = new Map<string, { handle: string; owners: Set<string> }>();
        for (const record of byDomain.values()) {
          if (
            record.lifetime !== "snapshot"
            || isLiveScope(record, scope).ok
            || record.scope.sessionEpoch !== scope.sessionEpoch
            || record.scope.campaign !== scope.campaign
          ) continue;
          const judgedOwner = scope.ownerKey;
          if (
            judgedOwner !== undefined
              && record.scope.ownerKey !== judgedOwner
          ) continue;
          const entry = lostByCanonical.get(record.canonicalId) ?? {
            handle: record.handle,
            owners: new Set<string>(),
          };
          entry.owners.add(record.scope.ownerKey ?? "*");
          lostByCanonical.set(record.canonicalId, entry);
        }
        for (const [canonicalId, entry] of lostByCanonical) {
          if (entry.owners.size <= 1) {
            view.lost[domain === "weapon" ? "weapons" : "items"]
              .set(canonicalId, entry.handle);
          }
        }
      }
    }
    return view;
  };

  const clearSession = (sessionEpoch: number): void => {
    for (const byDomain of records.values()) {
      for (const [canonicalId, record] of byDomain) {
        if (record.scope.sessionEpoch === sessionEpoch) byDomain.delete(canonicalId);
      }
    }
    if (party !== null && party.scope.sessionEpoch === sessionEpoch) party = null;
  };

  const clearAll = (): void => {
    records.clear();
    baseOwners.clear();
    party = null;
  };

  return {
    register,
    applyPartyAuthority,
    currentParty,
    applySnapshot,
    retire,
    resolveHandle,
    projectAll,
    clearSession,
    clearAll,
  };
}
