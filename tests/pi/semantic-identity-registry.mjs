#!/usr/bin/env node
// Semantic identity registry regressions (Pi-only).
//
// ONE typed registry owns the canonical↔semantic identity mappings for
// investigator, roll, effect, item/weapon, route, and provenance domains.
// These probes pin the identifier-law semantics that earlier ad-hoc maps
// got wrong: collision-safe meaning-bearing handles, one-to-one registration,
// authoritative lifetimes (player-turn, party, persistent effects, snapshots),
// exact session-epoch/campaign/turn scoping, fail-closed projection, and
// registry-backed restoration of every mapped argument family.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const {
  createSemanticIdentityRegistry,
  emptySemanticProjectionView,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts")
);
const {
  restoreSemanticEntityHandles,
  stripOpaqueModelIdentity,
} = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/tool-contract-projection.ts")
);

const scopeAt = (overrides = {}) => ({
  sessionEpoch: 7,
  campaign: "regression-campaign",
  playerTurnEpoch: 3,
  ownerKey: "inventory:investigator:test-owner",
  ...overrides,
});

// ── 1) Duplicate same-skill rolls: collision-safe stable ordinal handles ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  const first = registry.register({
    domain: "roll",
    canonicalId: "toolbox-rolls-000003",
    facts: ["spot-hidden-attempt", "Spot Hidden"],
    scope,
    lifetime: "player_turn",
  });
  const second = registry.register({
    domain: "roll",
    canonicalId: "toolbox-rolls-000004",
    facts: ["spot-hidden-attempt", "Spot Hidden"],
    scope,
    lifetime: "player_turn",
  });
  assert.ok(first.ok && second.ok);
  assert.equal(first.handle, "roll:spot-hidden-attempt");
  assert.equal(second.handle, "roll:spot-hidden-attempt-2",
    "same semantic base on a different canonical id gets a stable ordinal");
  assert.notEqual(first.handle, second.handle,
    "duplicate same-skill rolls must stay distinguishable");
  // Retries of the same canonical id reuse the exact handle (one-to-one).
  const retry = registry.register({
    domain: "roll",
    canonicalId: "toolbox-rolls-000003",
    facts: ["spot-hidden-attempt"],
    scope,
    lifetime: "player_turn",
  });
  assert.ok(retry.ok && retry.handle === first.handle && !retry.created);
  // The ordinal is stable: re-registering the second roll keeps -2.
  const retrySecond = registry.register({
    domain: "roll",
    canonicalId: "toolbox-rolls-000004",
    facts: ["spot-hidden-attempt"],
    scope,
    lifetime: "player_turn",
  });
  assert.ok(retrySecond.ok && retrySecond.handle === second.handle);
}

// ── 2) Two rolls in one turn stay distinct in projection and restore ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "roll", canonicalId: "roll-a", facts: ["inspect-exterior"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "roll", canonicalId: "roll-b", facts: ["listen-door"],
    scope, lifetime: "player_turn",
  });
  const projection = registry.projectAll(scope);
  assert.deepEqual(projection.rolls.get("roll-a"), "roll:inspect-exterior");
  assert.deepEqual(projection.rolls.get("roll-b"), "roll:listen-door");
}

// ── 3) Stale next-turn roll rejection: turn-scoped handles die with the turn ──
{
  const registry = createSemanticIdentityRegistry();
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003",
    facts: ["spot-hidden-attempt"],
    scope: scopeAt(), lifetime: "player_turn",
  });
  const nextTurn = registry.resolveHandle("roll", "roll:spot-hidden-attempt", scopeAt({ playerTurnEpoch: 4 }));
  assert.equal(nextTurn.ok, false);
  assert.equal(nextTurn.reason, "stale_turn",
    "a previous turn's roll handle must not resolve in the next turn");
  // Re-observation in the new turn re-arms the handle for the new scope.
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003",
    facts: ["spot-hidden-attempt"],
    scope: scopeAt({ playerTurnEpoch: 4 }), lifetime: "player_turn",
  });
  assert.ok(registry.resolveHandle("roll", "roll:spot-hidden-attempt", scopeAt({ playerTurnEpoch: 4 })).ok);
}

// ── 4) Two same-kind effects stay distinguishable ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "effect", canonicalId: "effect-aaa", facts: ["failed-push-consequence"],
    scope, lifetime: "authoritative",
  });
  registry.register({
    domain: "effect", canonicalId: "effect-bbb", facts: ["failed-push-consequence"],
    scope, lifetime: "authoritative",
  });
  const projection = registry.projectAll(scope);
  assert.equal(projection.effects.get("effect-aaa"), "effect:failed-push-consequence");
  assert.equal(projection.effects.get("effect-bbb"), "effect:failed-push-consequence-2");
  assert.notEqual(projection.effects.get("effect-aaa"), projection.effects.get("effect-bbb"));
}

// ── 5) Persistent effect retirement: consume/resolve ends the handle ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "effect", canonicalId: "effect-persistent", facts: ["crucial-clue-insight"],
    scope, lifetime: "authoritative",
  });
  // A persistent effect survives the turn boundary (unlike player_turn).
  assert.ok(registry.resolveHandle(
    "effect", "effect:crucial-clue-insight", scopeAt({ playerTurnEpoch: 9 }),
  ).ok, "persistent effects survive into later turns while authoritative");
  // Authoritative consume retires it; projection drops it immediately.
  registry.retire("effect", "effect-persistent", scopeAt({ playerTurnEpoch: 9 }));
  const retired = registry.resolveHandle(
    "effect", "effect:crucial-clue-insight", scopeAt({ playerTurnEpoch: 9 }),
  );
  assert.equal(retired.ok, false);
  assert.equal(retired.reason, "invalidated");
  assert.equal(
    registry.projectAll(scopeAt({ playerTurnEpoch: 9 })).effects.get("effect-persistent"),
    undefined, "retired effects leave the model-visible projection");
  // Retiring an unknown id is a harmless no-op.
  registry.retire("effect", "effect-unknown", scope);
}

// ── 6) Duplicate item labels + authoritative inventory replacement ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  // Two items sharing one label get stable ordinal handles, never overwrite.
  registry.applySnapshot("item", scope, [
    { canonicalId: "item-motte-sword-1", facts: ["莫特长剑"] },
    { canonicalId: "item-motte-sword-2", facts: ["莫特长剑"] },
  ]);
  let projection = registry.projectAll(scope);
  assert.equal(projection.items.get("item-motte-sword-1"), "item:莫特长剑");
  assert.equal(projection.items.get("item-motte-sword-2"), "item:莫特长剑-2");
  // Removal: the authoritative snapshot without the first item invalidates it.
  registry.applySnapshot("item", scope, [
    { canonicalId: "item-motte-sword-2", facts: ["莫特长剑"] },
  ]);
  projection = registry.projectAll(scope);
  assert.equal(projection.items.get("item-motte-sword-1"), undefined,
    "removed inventory entities must stop projecting");
  assert.equal(registry.resolveHandle("item", "item:莫特长剑", scope).ok, false,
    "removed inventory handles must stop resolving");
  assert.equal(registry.resolveHandle("item", "item:莫特长剑-2", scope).ok, true);
  // Re-adding an item registers a fresh live record.
  registry.applySnapshot("item", scope, [
    { canonicalId: "item-motte-sword-1", facts: ["莫特长剑"] },
    { canonicalId: "item-motte-sword-2", facts: ["莫特长剑"] },
  ]);
  assert.ok(registry.resolveHandle("item", "item:莫特长剑", scope).ok);
}

// ── 7) Route replacement/removal tracks the authoritative scene snapshot ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.applySnapshot("route", scope, [
    { canonicalId: "route:old-mill-path", facts: ["old-mill-path"] },
    { canonicalId: "route:north-door", facts: ["north-door"] },
  ]);
  assert.ok(registry.resolveHandle("route", "route:old-mill-path", scope).ok);
  // The scene changes: the authoritative route snapshot replaces, not appends.
  registry.applySnapshot("route", scope, [
    { canonicalId: "route:north-door", facts: ["north-door"] },
    { canonicalId: "route:courtyard-alley", facts: ["courtyard-alley"] },
  ]);
  assert.equal(registry.resolveHandle("route", "route:old-mill-path", scope).ok, false,
    "routes removed from the authoritative scene snapshot must stop resolving");
  assert.ok(registry.resolveHandle("route", "route:courtyard-alley", scope).ok);
  assert.ok(registry.projectAll(scope).routes.has("route:north-door"));
}

// ── 8) No semantic facts → registration fails closed; no `roll-N` fallback ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  const noFacts = registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000009",
    facts: ["", 12, null, true, {}, "---"],
    scope, lifetime: "player_turn",
  });
  assert.equal(noFacts.ok, false);
  assert.equal(noFacts.reason, "no_semantic_facts");
  const invalid = registry.register({
    domain: "roll", canonicalId: "   ", facts: ["anything"],
    scope, lifetime: "player_turn",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_canonical_id");
  const noTurn = registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000010", facts: ["attempt"],
    scope: { sessionEpoch: 7, campaign: "regression-campaign" },
    lifetime: "player_turn",
  });
  assert.equal(noTurn.ok, false);
  assert.equal(noTurn.reason, "invalid_scope",
    "player-turn lifetime requires an explicit player-turn epoch");
  // Nothing leaked into the projection.
  {
    const view = registry.projectAll(scope);
    for (const domainMap of [
      view.rolls, view.effects, view.items, view.weapons, view.routes,
    ]) {
      assert.equal(domainMap.size, 0);
    }
  }
}

// ── 9) Campaign/epoch scoping: no cross-campaign or cross-session reuse ──
{
  const registry = createSemanticIdentityRegistry();
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003", facts: ["spot-hidden"],
    scope: scopeAt(), lifetime: "player_turn",
  });
  const otherCampaign = registry.resolveHandle(
    "roll", "roll:spot-hidden", scopeAt({ campaign: "another-campaign" }),
  );
  assert.equal(otherCampaign.ok, false);
  assert.equal(otherCampaign.reason, "campaign_mismatch",
    "campaign switches must never replay another campaign's mappings");
  const otherSession = registry.resolveHandle(
    "roll", "roll:spot-hidden", scopeAt({ sessionEpoch: 8 }),
  );
  assert.equal(otherSession.ok, false);
  assert.equal(otherSession.reason, "stale_session");
  registry.clearSession(7);
  assert.equal(
    registry.resolveHandle("roll", "roll:spot-hidden", scopeAt()).ok, false,
    "clearSession drops every record of the prior epoch",
  );
}

// ── 10) Investigator party authority: single/empty/ambiguous/switch ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.applyPartyAuthority(scope, {
    kind: "single", investigatorId: "inv-alpha-01", pcSubjectRefs: ["pc:inv-alpha-01"],
  });
  assert.deepEqual(registry.currentParty(scope), {
    live: true, state: "single",
    investigatorId: "inv-alpha-01", pcSubjectRefs: ["pc:inv-alpha-01"],
  });
  // Authoritative empty party invalidates.
  registry.applyPartyAuthority(scope, { kind: "empty" });
  const empty = registry.currentParty(scope);
  assert.equal(empty.live, true);
  assert.equal(empty.state, "empty");
  // Ambiguous party invalidates.
  registry.applyPartyAuthority(scope, {
    kind: "ambiguous", investigatorIds: ["inv-a", "inv-b"],
  });
  assert.equal(registry.currentParty(scope).state, "ambiguous");
  // Campaign switch without re-binding leaves nothing live.
  assert.equal(registry.currentParty(scopeAt({ campaign: "other" })).live, false);
  // Session reset leaves nothing live.
  assert.equal(registry.currentParty(scopeAt({ sessionEpoch: 8 })).live, false);
}

// ── 11) Restoration covers every mapped field family through the registry ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003", facts: ["spot-hidden"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000004", facts: ["listen"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "effect", canonicalId: "effect-push-1", facts: ["failed-push-consequence"],
    scope, lifetime: "authoritative",
  });
  registry.applySnapshot("weapon", scope, [
    { canonicalId: "weapon-iron-1", facts: ["iron-knife"] },
  ]);
  registry.applySnapshot("route", scope, [
    { canonicalId: "route:old-mill-path", facts: ["old-mill-path"] },
  ]);
  const resolve = (domain, handle) => {
    const result = registry.resolveHandle(domain, handle, scope);
    return result.ok ? result.canonicalId : null;
  };
  const resolver = {
    resolveRoll: (handle) => resolve("roll", handle),
    resolveEffect: (handle) => resolve("effect", handle),
    resolveItem: (handle) => resolve("item", handle),
    resolveWeapon: (handle) => resolve("weapon", handle),
    resolveRoute: (handle) => resolve("route", handle),
  };
  const restored = restoreSemanticEntityHandles("turn.finalize", {
    coverage: [{
      obligation_id: "roll:spot-hidden",
      realization: "fictional_beat",
    }],
    mechanics_placements: [{
      placement: "public_check",
      source_ids: ["roll:spot-hidden", "roll:listen"],
      presented_roll_ids: ["roll:listen"],
    }],
    state_authority_review: {
      disposition: "state_change_claimed",
      claims: [{
        source_effect_id: "effect:failed-push-consequence",
      }],
    },
    weapon_effect_ids: ["effect:failed-push-consequence"],
    substantive_effect_ids: ["effect:failed-push-consequence"],
    weapon_id: "weapon:iron-knife",
    route_id: "route:old-mill-path",
  }, null, resolver);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.equal(restored.value.coverage[0].obligation_id, "roll:toolbox-rolls-000003");
  assert.deepEqual(restored.value.mechanics_placements[0].source_ids,
    ["toolbox-rolls-000003", "toolbox-rolls-000004"]);
  assert.deepEqual(restored.value.mechanics_placements[0].presented_roll_ids,
    ["toolbox-rolls-000004"]);
  assert.equal(
    restored.value.state_authority_review.claims[0].source_effect_id,
    "effect-push-1",
    "exceptional-effect linkage restores the exact canonical effect id",
  );
  assert.deepEqual(restored.value.weapon_effect_ids, ["effect-push-1"]);
  assert.deepEqual(restored.value.substantive_effect_ids, ["effect-push-1"]);
  assert.equal(restored.value.weapon_id, "weapon-iron-1");
  // Bare canonical weapon ids pass through untouched (canonical-validated).
  const bareWeapon = restoreSemanticEntityHandles("combat.resolve", {
    weapon_id: "weapon-bare-colt",
  }, null, resolver);
  assert.ok(bareWeapon.ok, JSON.stringify(bareWeapon));
  assert.equal(bareWeapon.value.weapon_id, "weapon-bare-colt");
  assert.equal(restored.value.route_id, "route:old-mill-path");
  // Non-registry structured refs pass through untouched.
  const hybrid = restoreSemanticEntityHandles("narration.review", {
    state_authority_review: {
      claims: [{ source_effect_id: "narration_contract:involuntary_physiology" }],
    },
  }, null, resolver);
  assert.ok(hybrid.ok);
  assert.equal(
    hybrid.value.state_authority_review.claims[0].source_effect_id,
    "narration_contract:involuntary_physiology",
  );
}

// ── 11b) First-impression + roll coverage restore to kind-prefixed Python ids ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "roll",
    canonicalId: "npc-first-impression-roll-v2:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    facts: ["档案员", "first-impression"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "roll",
    canonicalId: "first-impression:npc-first-impression-v2:cafecafecafecafecafecafecafecafecafecafe",
    facts: ["first_impression", "档案员"],
    scope, lifetime: "player_turn",
  });
  const resolve = (domain, handle) => {
    const result = registry.resolveHandle(domain, handle, scope);
    return result.ok ? result.canonicalId : null;
  };
  const resolver = {
    resolveRoll: (handle) => resolve("roll", handle),
    resolveEffect: (handle) => resolve("effect", handle),
    resolveItem: (handle) => resolve("item", handle),
    resolveWeapon: (handle) => resolve("weapon", handle),
    resolveRoute: (handle) => resolve("route", handle),
  };
  const restored = restoreSemanticEntityHandles("turn.finalize", {
    coverage: [
      { obligation_id: "roll:档案员", realization: "fictional_beat" },
      { obligation_id: "roll:first-impression", realization: "fictional_beat" },
    ],
  }, null, resolver);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.equal(
    restored.value.coverage[0].obligation_id,
    "roll:npc-first-impression-roll-v2:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  );
  assert.equal(
    restored.value.coverage[1].obligation_id,
    "first-impression:npc-first-impression-v2:cafecafecafecafecafecafecafecafecafecafe",
  );
}

// ── 12) Unknown/stale handles fail closed without echo, with zero loss ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  const resolve = (domain, handle) => {
    const result = registry.resolveHandle(domain, handle, scope);
    return result.ok ? result.canonicalId : null;
  };
  const resolver = {
    resolveRoll: (handle) => resolve("roll", handle),
    resolveEffect: (handle) => resolve("effect", handle),
    resolveItem: (handle) => resolve("item", handle),
    resolveRoute: (handle) => resolve("route", handle),
  };
  const unknown = restoreSemanticEntityHandles("turn.finalize", {
    coverage: [{ obligation_id: "roll:made-up-handle", realization: "fictional_beat" }],
  }, null, resolver);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "unknown_semantic_handle");
  assert.ok(!JSON.stringify(unknown).includes("made-up-handle"),
    "unknown handles are never echoed back to the model");
  // A route handle removed by a newer snapshot fails closed the same way.
  registry.applySnapshot("route", scope, [
    { canonicalId: "route:alive", facts: ["alive"] },
  ]);
  const staleRoute = restoreSemanticEntityHandles("state.record_route_completion", {
    route_id: "route:removed-path",
  }, null, resolver);
  assert.equal(staleRoute.ok, false);
  assert.equal(staleRoute.code, "unknown_semantic_handle");
}

// ── 13) Projection of nested arrays: mapped handles, dropped opaque members ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003", facts: ["spot-hidden"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "effect", canonicalId: "effect-push-1", facts: ["failed-push-consequence"],
    scope, lifetime: "authoritative",
  });
  const projection = registry.projectAll(scope);
  const diagnostics = { unmapped: [] };
  const projected = stripOpaqueModelIdentity({
    source_roll_ids: ["toolbox-rolls-000003", "toolbox-rolls-000099"],
    weapon_effect_ids: ["effect-push-1", "state:bonus-active"],
    source_effect_id: "effect:failed-push-consequence",
    route_refs: ["route:never-mapped"],
  }, null, projection, diagnostics);
  assert.deepEqual(projected.source_roll_ids, ["roll:spot-hidden"],
    "mapped members project; unmapped members drop");
  assert.deepEqual(projected.weapon_effect_ids,
    ["effect:failed-push-consequence", "state:bonus-active"],
    "structured non-registry effect refs keep their semantic form");
  assert.equal(projected.source_effect_id, "effect:failed-push-consequence");
  assert.deepEqual(projected.route_refs, [],
    "unmapped route refs fail closed (emptied + diagnosed, never echoed)");
  assert.deepEqual(
    diagnostics.unmapped.map((entry) => [entry.field, entry.domain]).sort(),
    [["route_refs", "route"], ["source_roll_ids", "roll"]],
    "every dropped member is bounded-diagnosed by domain (never by value)",
  );
}

// ── 14) Cross-domain isolation: identical canonical strings per domain ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.register({
    domain: "roll", canonicalId: "shared-id", facts: ["spot-hidden"],
    scope, lifetime: "player_turn",
  });
  registry.register({
    domain: "item", canonicalId: "shared-id", facts: ["brass-key"],
    scope, lifetime: "snapshot",
  });
  const projection = registry.projectAll(scope);
  assert.equal(projection.rolls.get("shared-id"), "roll:spot-hidden");
  assert.equal(projection.items.get("shared-id"), "item:brass-key",
    "identical canonical strings in different domains project independently");
  assert.notEqual(projection.rolls.get("shared-id"), projection.items.get("shared-id"));
}

// ── 15) Cross-lifetime collision: persistent vs turn-local same base ──
{
  const registry = createSemanticIdentityRegistry();
  const laterTurn = scopeAt({ playerTurnEpoch: 9 });
  // Persistent (authoritative) effect owns the base first.
  registry.register({
    domain: "effect", canonicalId: "effect-persistent", facts: ["crucial-insight"],
    scope: scopeAt(), lifetime: "authoritative",
  });
  // A turn-local effect with the same semantic base in a LATER turn must
  // take an ordinal — the persistent handle stays unique and stable.
  const turnLocal = registry.register({
    domain: "effect", canonicalId: "effect-turn-local", facts: ["crucial-insight"],
    scope: laterTurn, lifetime: "player_turn",
  });
  assert.equal(turnLocal.ok, true);
  assert.notEqual(turnLocal.handle, "effect:crucial-insight",
    "a turn-local record must not collide with a live persistent handle");
  assert.equal(turnLocal.handle, "effect:crucial-insight-2");
  const view = registry.projectAll(laterTurn);
  assert.equal(view.effects.get("effect-persistent"), "effect:crucial-insight");
  assert.equal(view.effects.get("effect-turn-local"), "effect:crucial-insight-2");
}

// ── 16) Cross-turn snapshot: existing entity plus NEW duplicate label ──
{
  const registry = createSemanticIdentityRegistry();
  const turnThree = scopeAt({ playerTurnEpoch: 3 });
  const turnFour = scopeAt({ playerTurnEpoch: 4 });
  registry.applySnapshot("item", turnThree, [
    { canonicalId: "item-key-1", facts: ["黄铜钥匙"] },
  ]);
  assert.equal(
    registry.projectAll(turnFour).items.get("item-key-1"), "item:黄铜钥匙",
    "snapshot entities persist across turns");
  // A NEW entity with the SAME label joins without stealing the handle.
  registry.applySnapshot("item", turnFour, [
    { canonicalId: "item-key-1", facts: ["黄铜钥匙"] },
    { canonicalId: "item-key-2", facts: ["黄铜钥匙"] },
  ]);
  const view = registry.projectAll(turnFour);
  assert.equal(view.items.get("item-key-1"), "item:黄铜钥匙");
  assert.equal(view.items.get("item-key-2"), "item:黄铜钥匙-2",
    "the new duplicate takes the ordinal; the existing entity stays reachable");
  assert.ok(registry.resolveHandle("item", "item:黄铜钥匙", turnFour).ok);
  assert.ok(registry.resolveHandle("item", "item:黄铜钥匙-2", turnFour).ok);
}

// ── 17) Weapon snapshot replacement and removal ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.applySnapshot("weapon", scope, [
    { canonicalId: "weapon-colt", facts: ["柯尔特左轮"] },
    { canonicalId: "weapon-knife", facts: ["猎刀"] },
  ]);
  let view = registry.projectAll(scope);
  assert.equal(view.weapons.get("weapon-colt"), "weapon:柯尔特左轮");
  assert.equal(view.weapons.get("weapon-knife"), "weapon:猎刀");
  // The authoritative loadout replaces: the knife is gone.
  registry.applySnapshot("weapon", scope, [
    { canonicalId: "weapon-colt", facts: ["柯尔特左轮"] },
  ]);
  view = registry.projectAll(scope);
  assert.equal(view.weapons.get("weapon-knife"), undefined,
    "weapons removed from the authoritative snapshot stop projecting");
  assert.equal(registry.resolveHandle("weapon", "weapon:猎刀", scope).ok, false);
}

// ── 18) Item/item_ids and weapon projection through the shared projector ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.applySnapshot("item", scope, [
    { canonicalId: "item-brass-key", facts: ["黄铜钥匙"] },
  ]);
  registry.applySnapshot("weapon", scope, [
    { canonicalId: "weapon-colt", facts: ["柯尔特左轮"] },
  ]);
  registry.register({
    domain: "roll", canonicalId: "toolbox-rolls-000003", facts: ["spot-hidden"],
    scope, lifetime: "player_turn",
  });
  const resolve = (domain, handle) => {
    const result = registry.resolveHandle(domain, handle, scope);
    return result.ok ? result.canonicalId : null;
  };
  const restorationResolver = {
    resolveRoll: (handle) => resolve("roll", handle),
    resolveEffect: (handle) => resolve("effect", handle),
    resolveItem: (handle) => resolve("item", handle),
    resolveWeapon: (handle) => resolve("weapon", handle),
    resolveRoute: (handle) => resolve("route", handle),
  };
  const itemRestore = restoreSemanticEntityHandles("state.purchase", {
    item_ids: ["item:黄铜钥匙"],
    weapon_id: "weapon:柯尔特左轮",
  }, null, restorationResolver);
  assert.ok(itemRestore.ok, JSON.stringify(itemRestore));
  assert.deepEqual(itemRestore.value.item_ids, ["item-brass-key"]);
  assert.equal(itemRestore.value.weapon_id, "weapon-colt");
  const diagnostics = { unmapped: [] };
  const projected = stripOpaqueModelIdentity({
    item_id: "item-brass-key",
    item_ids: ["item-brass-key"],
    weapon_id: "weapon-colt",
    mechanics_placements: [{
      segment_type: "public_check",
      source_ids: ["toolbox-rolls-000003"],
    }],
  }, null, registry.projectAll(scope), diagnostics);
  assert.equal(projected.item_id, "item:黄铜钥匙");
  assert.deepEqual(projected.item_ids, ["item:黄铜钥匙"]);
  assert.equal(projected.weapon_id, "weapon:柯尔特左轮");
  assert.deepEqual(
    projected.mechanics_placements[0].source_ids,
    ["roll:spot-hidden"],
    "mechanics_placements[].source_ids project to registry handles",
  );
  assert.deepEqual(diagnostics.unmapped, []);
}

// ── 19) Snapshot owner isolation: one owner never retires another, and
// projection is owner-scoped — an owner's view never carries another
// owner's records, and an owner-less scope never collapses two owners.
{
  const registry = createSemanticIdentityRegistry();
  const investigatorScope = scopeAt({
    ownerKey: "inventory:investigator:inv-a",
  });
  const npcScope = scopeAt({ ownerKey: "inventory:npc:npc-b" });
  registry.applySnapshot("weapon", investigatorScope, [
    { canonicalId: "weapon-a-colt", facts: ["A的左轮"] },
  ]);
  registry.applySnapshot("weapon", npcScope, [
    { canonicalId: "weapon-b-knife", facts: ["B的猎刀"] },
  ]);
  // NPC B's new snapshot must not invalidate investigator A's mappings.
  registry.applySnapshot("weapon", npcScope, [
    { canonicalId: "weapon-b-hatchet", facts: ["B的短斧"] },
  ]);
  const aView = registry.projectAll(investigatorScope);
  assert.equal(aView.weapons.get("weapon-a-colt"), "weapon:a的左轮");
  assert.equal(
    aView.weapons.get("weapon-b-hatchet"), undefined,
    "another owner's live mapping never enters this owner's projection",
  );
  const bView = registry.projectAll(npcScope);
  assert.equal(bView.weapons.get("weapon-b-hatchet"), "weapon:b的短斧");
  assert.equal(
    bView.weapons.get("weapon-b-knife"), undefined,
    "weapons absent from B's newest snapshot are retired for B",
  );
  assert.equal(
    bView.weapons.get("weapon-a-colt"), undefined,
    "A's weapon never leaks into B's projection",
  );
  // An owner-less scope never collapses two owners: a canonical id held by
  // one owner still projects, and resolution stays owner-exact.
  const ownerlessView = registry.projectAll(scopeAt({ ownerKey: undefined }));
  assert.equal(ownerlessView.weapons.get("weapon-a-colt"), "weapon:a的左轮");
  assert.ok(
    registry.resolveHandle("weapon", "weapon:a的左轮", investigatorScope).ok,
    "investigator A's mapping survives NPC B's snapshot replacement",
  );
  assert.equal(
    registry.resolveHandle("weapon", "weapon:a的左轮", npcScope).ok,
    false,
    "A's handle never resolves under B's owner scope",
  );
}

// ── 20) Same canonical id under two owners stays reachable per owner ──
{
  const registry = createSemanticIdentityRegistry();
  const aScope = scopeAt({ ownerKey: "inventory:investigator:inv-a" });
  const bScope = scopeAt({ ownerKey: "inventory:investigator:inv-b" });
  const aReg = registry.register({
    domain: "item", canonicalId: "item-shared-key", facts: ["共用钥匙"],
    scope: aScope, lifetime: "snapshot",
  });
  const bReg = registry.register({
    domain: "item", canonicalId: "item-shared-key", facts: ["共用钥匙"],
    scope: bScope, lifetime: "snapshot",
  });
  assert.ok(aReg.ok && bReg.ok);
  // The collision guard keeps the two same-label owner records
  // distinguishable: B's second registration takes the stable ordinal.
  assert.equal(bReg.handle, "item:共用钥匙-2");
  // A's handle NEVER resolves under B's owner scope (and vice versa): the
  // same canonical id under two owners is never globally resolvable.
  assert.equal(
    registry.resolveHandle("item", aReg.handle, bScope).ok, false,
    "A's handle is dead under B's owner scope",
  );
  assert.equal(
    registry.resolveHandle("item", bReg.handle, aScope).ok, false,
    "B's handle is dead under A's owner scope",
  );
  // Removing it from A's inventory retires only A's record…
  registry.applySnapshot("item", aScope, []);
  assert.equal(
    registry.resolveHandle("item", aReg.handle, aScope).ok, false,
    "A's removed mapping no longer resolves",
  );
  // …while B's record remains live under its stable handle, and B's
  // projection still maps the canonical id to B's handle (never A's).
  const resolved = registry.resolveHandle("item", bReg.handle, bScope);
  assert.ok(resolved.ok && resolved.canonicalId === "item-shared-key",
    "the other owner's mapping stays live");
  const bView = registry.projectAll(bScope);
  assert.equal(bView.items.get("item-shared-key"), bReg.handle);
  const aView = registry.projectAll(aScope);
  assert.equal(
    aView.items.get("item-shared-key"), undefined,
    "A's removed mapping leaves A's projection (lost, not live)",
  );
}

// ── 21) Simultaneous campaigns: same canonical id, independent records ──
{
  const registry = createSemanticIdentityRegistry();
  const campaignA = scopeAt({ campaign: "campaign-alpha" });
  const campaignB = scopeAt({ campaign: "campaign-beta" });
  const first = registry.register({
    domain: "roll", canonicalId: "toolbox-shared-000001",
    facts: ["spot-hidden"], scope: campaignA, lifetime: "player_turn",
  });
  const second = registry.register({
    domain: "roll", canonicalId: "toolbox-shared-000001",
    facts: ["listen"], scope: campaignB, lifetime: "player_turn",
  });
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.handle, second.handle,
    "simultaneous campaigns keep independent records for the same canonical id");
  assert.equal(registry.projectAll(campaignA).rolls.get("toolbox-shared-000001"),
    first.handle);
  assert.equal(registry.projectAll(campaignB).rolls.get("toolbox-shared-000001"),
    second.handle);
  // Retiring in A must not touch B.
  registry.retire("roll", "toolbox-shared-000001", campaignA);
  assert.equal(registry.resolveHandle("roll", first.handle, campaignA).ok, false);
  assert.equal(registry.resolveHandle("roll", second.handle, campaignB).ok, true);
}

// ── 22) Route snapshots key by exact scene identity ──
{
  const registry = createSemanticIdentityRegistry();
  const sceneOne = scopeAt({ ownerKey: "scene:stone-street" });
  const sceneTwo = scopeAt({ ownerKey: "scene:harbor" });
  registry.applySnapshot("route", sceneOne, [
    { canonicalId: "route-street-alley", facts: ["stone-street-alley"] },
  ]);
  // A different scene's route observation must not retire scene one's routes.
  registry.applySnapshot("route", sceneTwo, [
    { canonicalId: "route-harbor-docks", facts: ["harbor-docks"] },
  ]);
  assert.ok(
    registry.resolveHandle("route", "route:stone-street-alley", scopeAt()).ok,
    "another scene's snapshot must not retire this scene's routes",
  );
  assert.ok(registry.resolveHandle("route", "route:harbor-docks", scopeAt()).ok);
  // The exact scene re-observed with empty exits retires its own routes.
  registry.applySnapshot("route", sceneOne, []);
  assert.equal(
    registry.resolveHandle("route", "route:stone-street-alley", scopeAt()).ok,
    false,
  );
  assert.ok(registry.resolveHandle("route", "route:harbor-docks", scopeAt()).ok);
}

// ── 23) Name-only weapons: meaning-bearing name handles, name restore ──
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  registry.applySnapshot("weapon", scope, [
    { canonicalId: "猎刀", facts: ["猎刀"] },
  ]);
  const view = registry.projectAll(scope);
  assert.equal(view.weapons.get("猎刀"), "weapon:猎刀");
  assert.ok(registry.resolveHandle("weapon", "weapon:猎刀", scope).ok);
  assert.equal(
    registry.resolveHandle("weapon", "weapon:猎刀", scope).canonicalId,
    "猎刀",
    "name-only weapons restore the exact canonical name",
  );
}

// ── 24) The unknown-handle refusal is actionable, and says when the turn
// context is genuinely EMPTY ──
//
// The old refusal told the Keeper to "copy one verbatim from the current turn
// context" and carried no `details`. When nothing is live that instruction
// names an empty place, and the Keeper can only guess. A live lane
// (debug-gate9-depth-10-r65 / c-defend) lost its whole 1800s turn budget to
// exactly that: 29 attempts at `source_roll_id`, none informed.
{
  const registry = createSemanticIdentityRegistry();
  const scope = scopeAt();
  const resolverFor = (activeScope) => {
    const projection = () => registry.projectAll(activeScope);
    return {
      resolveRoll: (handle) => {
        const result = registry.resolveHandle("roll", handle, activeScope);
        return result.ok ? result.canonicalId : null;
      },
      resolveEffect: () => null,
      resolveItem: () => null,
      resolveWeapon: () => null,
      resolveRoute: () => null,
      resolveAffordance: () => null,
      resolveTranscript: () => null,
      describeFailure: (domain, handle) => {
        const result = registry.resolveHandle(domain, handle, activeScope);
        return result.ok || result.reason !== "unknown_handle"
          ? null
          : `no ${domain} handle by that name was ever presented this turn; `
            + "copy one verbatim from the current turn context.";
      },
      liveHandles: (domain, limit) => {
        if (domain !== "roll") return [];
        return [...projection().rolls.values()].slice(0, limit);
      },
      handleForCanonical: (domain, value) => {
        if (domain !== "roll") return null;
        const bare = value.startsWith("roll:") ? value.slice("roll:".length) : value;
        const rolls = projection().rolls;
        return rolls.get(bare) ?? rolls.get(value) ?? null;
      },
    };
  };

  // (a) Nothing live: the refusal says SO, instead of pointing at an empty
  // context, and offers an empty candidate list rather than no list at all.
  const empty = restoreSemanticEntityHandles("state.exceptional_effect", {
    source_roll_id: "roll:combat-corbitt-house-ground-cr2",
  }, null, resolverFor(scope));
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "unknown_semantic_handle");
  assert.equal(empty.details.identity_field, "source_roll_id");
  assert.equal(empty.details.identity_domain, "roll");
  assert.deepEqual(empty.details.live_handles, []);
  assert.equal(empty.details.live_handle_count, 0);
  assert.match(
    empty.message,
    /No roll handle is live in this turn's scope at all/,
    "an empty turn context must be stated, never implied",
  );
  assert.ok(
    !empty.message.includes("combat-corbitt-house-ground-cr2"),
    "the refused value is never echoed",
  );

  // (b) With handles live, the refusal names them as DATA — the host rewrites
  // canonical ids out of error prose, so a message-only reference is lost.
  registry.register({
    domain: "roll",
    canonicalId: "combat-corbitt-house-ground-restart-t21-r4:cr2",
    facts: ["dodge", "combat-round"],
    scope,
    lifetime: "player_turn",
  });
  registry.register({
    domain: "roll",
    canonicalId: "combat-corbitt-house-ground-restart-t21-r4:cr3",
    facts: ["fighting-brawl", "combat-round"],
    scope,
    lifetime: "player_turn",
  });
  const named = restoreSemanticEntityHandles("state.exceptional_effect", {
    source_roll_id: "roll:combat-corbitt-house-ground-cr2",
  }, null, resolverFor(scope));
  assert.equal(named.ok, false);
  assert.equal(named.details.supplied_value_kind, "never_presented");
  assert.deepEqual(
    named.details.live_handles,
    ["roll:dodge", "roll:fighting-brawl"],
    "every live roll handle reaches the Keeper as structured data",
  );
  assert.equal(named.details.live_handle_count, 2);

  // (c) A restart mints new canonical roll ids while the Keeper is still
  // quoting the PRE-restart combat's. Pasting the CURRENT canonical id is a
  // recoverable mistake and is reported as its own kind, with the handle;
  // pasting a dead one is not, and must not be dressed up as recoverable.
  const pasted = restoreSemanticEntityHandles("state.exceptional_effect", {
    source_roll_id: "roll:combat-corbitt-house-ground-restart-t21-r4:cr2",
  }, null, resolverFor(scope));
  assert.equal(pasted.ok, false);
  assert.equal(pasted.details.supplied_value_kind, "canonical_id_of_live_handle");
  assert.equal(pasted.details.handle_for_supplied_value, "roll:dodge");
  assert.ok(
    !pasted.message.includes("restart-t21-r4"),
    "the canonical id stays host-bound even while naming its handle",
  );

  // (d) A stale handle from an earlier player turn keeps the registry's own
  // cause (a refresh is the route out) and still names what is live now.
  const stale = restoreSemanticEntityHandles("state.exceptional_effect", {
    source_roll_id: "roll:dodge",
  }, null, resolverFor(scopeAt({ playerTurnEpoch: 4 })));
  assert.equal(stale.ok, false);
  assert.equal(stale.details.identity_domain, "roll");
  assert.deepEqual(
    stale.details.live_handles,
    [],
    "the NEXT turn's scope has no live roll handles of its own",
  );

  // (e) The list is bounded: a busy turn cannot turn one refusal into a wall.
  for (let index = 0; index < 40; index += 1) {
    registry.register({
      domain: "roll",
      canonicalId: `toolbox-flood-${index}`,
      facts: [`flood-check-${index}`, "combat-round"],
      scope,
      lifetime: "player_turn",
    });
  }
  const flooded = restoreSemanticEntityHandles("state.exceptional_effect", {
    source_roll_id: "roll:combat-corbitt-house-ground-cr2",
  }, null, resolverFor(scope));
  assert.equal(flooded.ok, false);
  assert.equal(flooded.details.live_handles.length, 24);
  assert.equal(flooded.details.live_handles_truncated, true);
  assert.equal(
    flooded.details.live_handle_count,
    undefined,
    "a truncated page never claims to be a total",
  );
}

console.log("semantic-identity-registry: all assertions passed");
