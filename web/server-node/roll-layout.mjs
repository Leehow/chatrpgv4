/**
 * Server-side roll_group layout projection.
 *
 * Pairs public checks to named layouts from stable IDs only:
 * combat.json turn/damage ids, toolbox-ledger roll ids, finalization
 * source_ids, and exceptional-effect source/consumed roll ids.
 * Missing or ambiguous links fall back to layout "check".
 */
const COMBAT_MODIFIER_FIELDS = [
  "point_blank", "cover", "outnumbered_penalty", "aimed", "multi_shot",
  "load_and_fire", "vs_prone_melee", "vs_prone_ranged", "bonus", "penalty",
];

const DAMAGE_INTEGER_FIELDS = [
  "raw_damage", "armor_absorbed", "hp_before", "hp_delta", "hp_after",
  "armor_before", "armor_after",
];

const LEDGER_ROLL_ID_KEYS = [
  "check_roll_id", "loss_roll_id", "int_roll_id",
  "investigator_roll_id", "opponent_roll_id",
  "roll_id", "damage_roll_id",
];

const LAYOUTS = new Set(["check", "sanity", "opposed", "combat", "damage"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isExactInt(value) {
  return Number.isInteger(value);
}

function firstValue(record, field) {
  const payload = record?.payload;
  if (payload && typeof payload === "object" && field in payload) return payload[field];
  if (record && typeof record === "object" && field in record) return record[field];
  const nested = record?.check;
  if (nested && typeof nested === "object" && field in nested) return nested[field];
  return undefined;
}

function recordKind(record) {
  const kind = firstValue(record, "kind");
  return isNonEmptyString(kind) ? kind : "";
}

function pickModifiers(raw) {
  const attackModifiers = {};
  if (!raw || typeof raw !== "object") return attackModifiers;
  for (const field of COMBAT_MODIFIER_FIELDS) {
    const candidate = raw[field];
    if (typeof candidate === "boolean" || isExactInt(candidate)) {
      attackModifiers[field] = candidate;
    }
  }
  return attackModifiers;
}

function pickDamageFields(damage) {
  const safe = {};
  if (!damage || typeof damage !== "object") return safe;
  for (const field of DAMAGE_INTEGER_FIELDS) {
    if (isExactInt(damage[field])) safe[field] = damage[field];
  }
  if (isNonEmptyString(damage.die)) safe.damage_expression = damage.die;
  return safe;
}

function collectLedgerRollIds(data) {
  const ids = [];
  if (!data || typeof data !== "object") return ids;
  for (const key of LEDGER_ROLL_ID_KEYS) {
    if (isNonEmptyString(data[key])) ids.push(data[key]);
  }
  if (Array.isArray(data.session_roll_ids)) {
    for (const id of data.session_roll_ids) {
      if (isNonEmptyString(id)) ids.push(id);
    }
  }
  return ids;
}

export function buildCombatIndex(combat) {
  const turns = [];
  const byRollId = new Map();
  const damageByRoll = new Map();
  if (!combat || typeof combat !== "object") {
    return { turns, byRollId, damageByRoll };
  }

  for (const round of Array.isArray(combat.rounds) ? combat.rounds : []) {
    for (const turn of Array.isArray(round?.turns) ? round.turns : []) {
      if (!turn || typeof turn !== "object") continue;
      const roles = new Map();
      const add = (rollId, role) => {
        if (!isNonEmptyString(rollId)) return;
        roles.set(rollId, role);
      };
      add(turn.roll_id, "attack");
      add(turn.opposed_roll_id, "defense");
      add(turn.cover_reroll_roll_id, "attack_reroll");
      add(turn.damage_roll_id, "damage");
      add(turn.fight_back_damage_roll_id, "fight_back_damage");
      for (const shot of Array.isArray(turn.shots) ? turn.shots : []) {
        add(shot?.roll_id, "attack");
        add(shot?.damage_roll_id, "damage");
      }
      const shots = [];
      for (const shot of Array.isArray(turn.shots) ? turn.shots : []) {
        if (!shot || typeof shot !== "object") continue;
        if (!isNonEmptyString(shot.roll_id)) continue;
        shots.push({
          shot: isExactInt(shot.shot) ? shot.shot : null,
          roll_id: shot.roll_id,
          damage_roll_id: isNonEmptyString(shot.damage_roll_id) ? shot.damage_roll_id : null,
          outcome: isNonEmptyString(shot.outcome) ? shot.outcome : null,
          attack_modifiers: pickModifiers(shot.attack_modifiers),
        });
      }
      const volleys = [];
      for (const volley of Array.isArray(turn.volleys) ? turn.volleys : []) {
        add(volley?.roll_id, "attack");
        const damageIds = Array.isArray(volley?.damage_roll_ids)
          ? volley.damage_roll_ids.filter((id) => isNonEmptyString(id))
          : [];
        for (const rollId of damageIds) add(rollId, "damage");
        if (!isNonEmptyString(volley?.roll_id)) continue;
        volleys.push({
          volley: isExactInt(volley.volley) ? volley.volley : null,
          roll_id: volley.roll_id,
          damage_roll_ids: damageIds,
          outcome: isNonEmptyString(volley.outcome) ? volley.outcome : null,
          hits: isExactInt(volley.hits) ? volley.hits : null,
          attack_modifiers: pickModifiers(volley.attack_modifiers),
        });
      }
      const row = {
        turn_id: isNonEmptyString(turn.turn_id) ? turn.turn_id : null,
        action: isNonEmptyString(turn.action) ? turn.action : null,
        defense_kind: isNonEmptyString(turn.defense_kind) ? turn.defense_kind : null,
        opposed_outcome: isNonEmptyString(turn.opposed_outcome) ? turn.opposed_outcome : null,
        combat_outcome: isNonEmptyString(turn.outcome) ? turn.outcome : null,
        attack_modifiers: pickModifiers(turn.attack_modifiers),
        roles,
        shots,
        volleys,
        attack_id: isNonEmptyString(turn.roll_id) ? turn.roll_id : null,
        defense_id: isNonEmptyString(turn.opposed_roll_id) ? turn.opposed_roll_id : null,
        attack_reroll_id: isNonEmptyString(turn.cover_reroll_roll_id) ? turn.cover_reroll_roll_id : null,
        damage_id: isNonEmptyString(turn.damage_roll_id) ? turn.damage_roll_id : null,
        fight_back_damage_id: isNonEmptyString(turn.fight_back_damage_roll_id)
          ? turn.fight_back_damage_roll_id
          : null,
      };
      turns.push(row);
      for (const [rollId, role] of roles) {
        const prior = byRollId.get(rollId);
        if (prior && prior.turn !== row) {
          prior.turn.duplicate_roll = true;
          row.duplicate_roll = true;
        }
        byRollId.set(rollId, { turn: row, role });
      }
    }
  }

  for (const damage of Array.isArray(combat.damage_chain) ? combat.damage_chain : []) {
    const rollId = damage?.damage_roll_id;
    if (!isNonEmptyString(rollId)) continue;
    damageByRoll.set(rollId, pickDamageFields(damage));
  }
  return { turns, byRollId, damageByRoll };
}

export function buildLedgerIndex(ledger) {
  const sanityByCheckId = new Map();
  const opposedByRollId = new Map();
  const decisionByRollId = new Map();
  const rollsByDecisionId = new Map();
  const entries = ledger?.entries && typeof ledger.entries === "object" ? ledger.entries : {};

  const remember = (rollId, decisionId) => {
    if (!isNonEmptyString(rollId) || !isNonEmptyString(decisionId)) return;
    decisionByRollId.set(rollId, decisionId);
    if (!rollsByDecisionId.has(decisionId)) rollsByDecisionId.set(decisionId, new Set());
    rollsByDecisionId.get(decisionId).add(rollId);
  };

  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.invalidation && typeof entry.invalidation === "object") continue;
    const tool = isNonEmptyString(entry.tool) ? entry.tool : "";
    const decisionId = isNonEmptyString(entry.decision_id) ? entry.decision_id : "";
    const data = entry.data && typeof entry.data === "object" ? entry.data : {};
    for (const rollId of collectLedgerRollIds(data)) remember(rollId, decisionId);

    if (tool === "rules.sanity_check" || tool === "sanity.execute") {
      const checkId = isNonEmptyString(data.check_roll_id) ? data.check_roll_id : null;
      if (checkId) {
        sanityByCheckId.set(checkId, {
          loss_roll_id: isNonEmptyString(data.loss_roll_id) ? data.loss_roll_id : null,
          decision_id: decisionId,
          san_before: isExactInt(data.san_before)
            ? data.san_before
            : (isExactInt(data.check?.san_before) ? data.check.san_before : null),
          san_after: isExactInt(data.san_after)
            ? data.san_after
            : (isExactInt(data.check?.san_after) ? data.check.san_after : null),
          san_loss: isExactInt(data.san_loss)
            ? data.san_loss
            : (isExactInt(data.check?.san_loss) ? data.check.san_loss : null),
          san_loss_expression: isNonEmptyString(data.san_loss_expression)
            ? data.san_loss_expression
            : (isNonEmptyString(data.loss_detail?.expression) ? data.loss_detail.expression : null),
          san_loss_resolution: isNonEmptyString(data.san_loss_resolution)
            ? data.san_loss_resolution
            : (isNonEmptyString(data.loss_detail?.resolution) ? data.loss_detail.resolution : null),
          source: isNonEmptyString(data.source) ? data.source : null,
        });
      }
    }

    if (tool === "rules.opposed") {
      const left = data.investigator_roll_id;
      const right = data.opponent_roll_id;
      if (isNonEmptyString(left) && isNonEmptyString(right)) {
        const pair = {
          left,
          right,
          winner: isNonEmptyString(data.winner) ? data.winner : null,
          decision_id: decisionId,
        };
        opposedByRollId.set(left, pair);
        opposedByRollId.set(right, pair);
      }
    }
  }

  return { sanityByCheckId, opposedByRollId, decisionByRollId, rollsByDecisionId };
}

export function buildEffectIndex(finalization, exceptionalDocument) {
  const bundle = finalization?.bundle && typeof finalization.bundle === "object"
    ? finalization.bundle
    : {};
  const stateDeltasById = new Map();
  for (const effect of Array.isArray(bundle.state_delta) ? bundle.state_delta : []) {
    if (isNonEmptyString(effect?.effect_id)) stateDeltasById.set(effect.effect_id, effect);
  }
  const exceptionalByEventId = new Map();
  const exceptionalByEffectId = new Map();
  for (const event of Array.isArray(bundle.exceptional_effect) ? bundle.exceptional_effect : []) {
    if (isNonEmptyString(event?.event_id)) exceptionalByEventId.set(event.event_id, event);
    if (isNonEmptyString(event?.effect_id)) exceptionalByEffectId.set(event.effect_id, event);
  }
  const sourceRollByEffectId = new Map();
  const effects = exceptionalDocument?.effects && typeof exceptionalDocument.effects === "object"
    ? exceptionalDocument.effects
    : {};
  for (const effect of Object.values(effects)) {
    const effectId = effect?.effect_id;
    const rollId = effect?.source_roll?.roll_id;
    if (isNonEmptyString(effectId) && isNonEmptyString(rollId)) {
      sourceRollByEffectId.set(effectId, rollId);
    }
  }
  return {
    stateDeltasById,
    exceptionalByEventId,
    exceptionalByEffectId,
    sourceRollByEffectId,
  };
}

function integerField(record, field) {
  const value = firstValue(record, field);
  return isExactInt(value) ? value : null;
}

function stringField(record, field) {
  const value = firstValue(record, field);
  return isNonEmptyString(value) ? value : null;
}

function sanityNumbersFrom(record, fallback = {}) {
  const before = integerField(record, "san_before") ?? fallback.san_before ?? null;
  const after = integerField(record, "san_after") ?? fallback.san_after ?? null;
  let delta = integerField(record, "san_delta");
  if (delta == null && before != null && after != null) delta = after - before;
  const loss = integerField(record, "san_loss") ?? fallback.san_loss ?? null;
  return {
    san_before: before,
    san_after: after,
    san_delta: delta,
    san_loss: loss,
    san_loss_expression: stringField(record, "san_loss_expression")
      ?? fallback.san_loss_expression
      ?? null,
    san_loss_resolution: stringField(record, "san_loss_resolution")
      ?? fallback.san_loss_resolution
      ?? null,
    source: stringField(record, "source") ?? fallback.source ?? null,
  };
}

function compactDefined(value) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) continue;
    out[key] = item;
  }
  return out;
}

function damagePayload(rollId, display, combatIndex, extra = {}) {
  const fields = combatIndex.damageByRoll.get(rollId) || {};
  return compactDefined({
    damage_roll_id: rollId,
    roll: display,
    source: extra.source || null,
    ...fields,
  });
}

function uniqueItems(items, keyFn) {
  const seen = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key == null) continue;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function groupsContaining(rollId, groups) {
  return groups.filter((group) => group.source_ids.includes(rollId));
}

function resolveSanLossId(checkId, groupIds, ledgerIndex) {
  const linked = ledgerIndex.sanityByCheckId.get(checkId);
  if (linked?.loss_roll_id && groupIds.includes(linked.loss_roll_id)) {
    return linked.loss_roll_id;
  }
  return null;
}

function turnLinkedIds(turn) {
  const ids = [
    turn.attack_id,
    turn.defense_id,
    turn.attack_reroll_id,
    turn.damage_id,
    turn.fight_back_damage_id,
  ];
  for (const shot of turn.shots || []) {
    ids.push(shot.roll_id, shot.damage_roll_id);
  }
  for (const volley of turn.volleys || []) {
    ids.push(volley.roll_id, ...(volley.damage_roll_ids || []));
  }
  return ids.filter((id) => isNonEmptyString(id));
}

function chooseLayout(sourceIds, checksById, combatIndex, ledgerIndex) {
  const present = sourceIds.filter((id) => Boolean(id));
  const combatTurns = uniqueItems(
    present
      .map((id) => combatIndex.byRollId.get(id)?.turn)
      .filter(Boolean),
    (turn) => turn.turn_id || turn.attack_id || turn.defense_id,
  );
  if (combatTurns.length === 1 && !combatTurns[0].duplicate_roll) {
    return { layout: "combat", turn: combatTurns[0] };
  }
  if (combatTurns.length > 1 || combatTurns.some((turn) => turn.duplicate_roll)) {
    return { layout: "check" };
  }

  const opposedPairs = uniqueItems(
    present
      .map((id) => ledgerIndex.opposedByRollId.get(id))
      .filter((pair) => pair && present.includes(pair.left) && present.includes(pair.right)),
    (pair) => `${pair.left}:${pair.right}`,
  );
  if (opposedPairs.length === 1) {
    return { layout: "opposed", pair: opposedPairs[0] };
  }
  if (opposedPairs.length > 1) {
    return { layout: "check" };
  }

  const sanChecks = present.filter((id) => recordKind(checksById.get(id)) === "sanity_check");
  const sanLosses = present.filter((id) => recordKind(checksById.get(id)) === "san_loss");
  if (sanChecks.length === 1) {
    const lossId = resolveSanLossId(sanChecks[0], present, ledgerIndex);
    if (sanLosses.length && (!lossId || sanLosses.some((id) => id !== lossId))) {
      return { layout: "check" };
    }
    return {
      layout: "sanity",
      checkId: sanChecks[0],
      lossId,
    };
  }
  if (sanChecks.length > 1) {
    return { layout: "check" };
  }

  const damageIds = present.filter((id) => combatIndex.damageByRoll.has(id));
  const displayable = present.filter((id) => checksById.has(id));
  if (damageIds.length === 1 && displayable.length === 1 && displayable[0] === damageIds[0]) {
    return { layout: "damage", damageId: damageIds[0] };
  }
  return { layout: "check" };
}

function attachCombatPayload(choice, displayById, combatIndex) {
  const turn = choice.turn;
  const attack = turn.attack_id ? displayById.get(turn.attack_id) : null;
  const defense = turn.defense_id ? displayById.get(turn.defense_id) : null;
  const attackReroll = turn.attack_reroll_id ? displayById.get(turn.attack_reroll_id) : null;
  const damageId = turn.damage_id;
  const fightBackId = turn.fight_back_damage_id;
  const damage = damageId && displayById.has(damageId)
    ? damagePayload(damageId, displayById.get(damageId), combatIndex)
    : null;
  const fightBackDamage = fightBackId && displayById.has(fightBackId)
    ? damagePayload(fightBackId, displayById.get(fightBackId), combatIndex, { source: "fight_back" })
    : null;
  const shots = (turn.shots || []).map((shot) => compactDefined({
    shot: shot.shot,
    attack_roll_id: shot.roll_id,
    damage_roll_id: shot.damage_roll_id,
    outcome: shot.outcome,
    attack: displayById.get(shot.roll_id) || null,
    damage: shot.damage_roll_id && displayById.has(shot.damage_roll_id)
      ? damagePayload(shot.damage_roll_id, displayById.get(shot.damage_roll_id), combatIndex)
      : null,
  }));
  const volleys = (turn.volleys || []).map((volley) => compactDefined({
    volley: volley.volley,
    attack_roll_id: volley.roll_id,
    damage_roll_ids: volley.damage_roll_ids,
    outcome: volley.outcome,
    hits: volley.hits,
    attack: displayById.get(volley.roll_id) || null,
    damages: (volley.damage_roll_ids || [])
      .map((id) => (displayById.has(id) ? damagePayload(id, displayById.get(id), combatIndex) : null))
      .filter(Boolean),
  }));
  return compactDefined({
    turn_id: turn.turn_id,
    action: turn.action,
    defense_kind: turn.defense_kind,
    opposed_outcome: turn.opposed_outcome,
    combat_outcome: turn.combat_outcome,
    attack_modifiers: turn.attack_modifiers,
    attack_roll_id: turn.attack_id,
    defense_roll_id: turn.defense_id,
    attack: attack || null,
    defense: defense || null,
    attack_reroll: attackReroll || null,
    damage,
    fight_back_damage: fightBackDamage,
    shots,
    volleys,
  });
}

function attachSanityPayload(choice, displayById, checksById, ledgerIndex) {
  const check = displayById.get(choice.checkId);
  if (!check) return null;
  const raw = checksById.get(choice.checkId);
  const linked = ledgerIndex.sanityByCheckId.get(choice.checkId) || {};
  const numbers = sanityNumbersFrom(raw, linked);
  const loss = choice.lossId && displayById.has(choice.lossId)
    ? displayById.get(choice.lossId)
    : null;
  if (loss) {
    const lossNumbers = sanityNumbersFrom(checksById.get(choice.lossId), numbers);
    if (!numbers.san_loss_expression) {
      numbers.san_loss_expression = loss.die_expression || loss.die || lossNumbers.san_loss_expression;
    }
    if (numbers.san_loss == null && isExactInt(loss.roll)) numbers.san_loss = loss.roll;
    if (numbers.san_before == null) numbers.san_before = lossNumbers.san_before;
    if (numbers.san_after == null) numbers.san_after = lossNumbers.san_after;
  }
  const stamped = {
    ...check,
    san_before: numbers.san_before ?? check.san_before,
    san_after: numbers.san_after ?? check.san_after,
    san_delta: numbers.san_delta ?? check.san_delta,
    san_loss: numbers.san_loss ?? check.san_loss,
    san_loss_expression: numbers.san_loss_expression ?? check.san_loss_expression,
    san_loss_resolution: numbers.san_loss_resolution ?? check.san_loss_resolution,
  };
  return compactDefined({
    check_roll_id: choice.checkId,
    loss_roll_id: choice.lossId || null,
    check: stamped,
    loss,
    ...numbers,
  });
}

function attachOpposedPayload(choice, displayById) {
  const left = displayById.get(choice.pair.left);
  const right = displayById.get(choice.pair.right);
  if (!left || !right) return null;
  return compactDefined({
    left,
    right,
    winner: choice.pair.winner,
    decision_id: choice.pair.decision_id,
  });
}

function firstNonemptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Canonical cash amount: two-decimal string such as "1.50", or a finite number. */
function firstCashAmount(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (/^(?:0|[1-9]\d*)\.\d{2}$/.test(text) || /^(?:0|[1-9]\d*)$/.test(text)) {
        return text;
      }
    } else if (typeof value === "number" && Number.isFinite(value) && value !== true) {
      return value;
    }
  }
  return null;
}

function cashDirection(effect, amount) {
  const hint = firstNonemptyString(effect.direction, effect.action, effect.op);
  if (hint === "spend" || hint === "expense" || hint === "lost" || hint === "debit") {
    return "spend";
  }
  if (hint === "gain" || hint === "grant" || hint === "income" || hint === "credit") {
    return "gain";
  }
  // state.purchase effects carry payment_mode instead of direction/action/op:
  // "cash"/"aggregate_cash" move cash out (spent); "spending_level" leaves
  // cash untouched (the gained item is the visible outcome).
  const paymentMode = firstNonemptyString(effect.payment_mode);
  if (paymentMode === "cash" || paymentMode === "aggregate_cash") {
    return "spend";
  }
  if (paymentMode === "spending_level") {
    return "gain";
  }
  if (typeof amount === "number" && amount < 0) return "spend";
  return amount == null ? null : "gain";
}

function projectCashGameTime(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (typeof raw.elapsed_minutes === "number" && Number.isFinite(raw.elapsed_minutes)) {
    out.elapsed_minutes = raw.elapsed_minutes;
  }
  if (typeof raw.display === "string") out.display = raw.display;
  if (typeof raw.day_phase === "string" && raw.day_phase) out.day_phase = raw.day_phase;
  const playerTime = projectCashPlayerTime(raw.player_time);
  if (playerTime) out.player_time = playerTime;
  return Object.keys(out).length ? out : null;
}

function projectCashPlayerTime(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (typeof raw.phase === "string") out.phase = raw.phase;
  if (typeof raw.appearance_mode === "string") out.appearance_mode = raw.appearance_mode;
  if (raw.display_label === null || typeof raw.display_label === "string") {
    out.display_label = raw.display_label;
  }
  if (typeof raw.display === "string") out.display = raw.display;
  return Object.keys(out).length ? out : null;
}

/** Structured cash only: never infer amounts from Keeper prose. */
export function isStructuredCashEffect(effect) {
  if (!effect || typeof effect !== "object") return false;
  const kind = String(effect.effect_kind || effect.kind || "");
  if (
    kind === "cash"
    || kind === "funds"
    || kind === "money"
    || kind === "purchase"
  ) {
    return true;
  }
  if (String(effect.resource_key || "") === "cash") return true;
  const resource = String(effect.resource || "");
  if (resource === "Cash" || resource === "现金") return true;
  const currency = firstNonemptyString(effect.currency, effect.currency_label, effect.currency_code);
  const hasAmount = firstCashAmount(
    effect.amount,
    effect.charged_amount,
    effect.delta,
    effect.cash_delta,
    effect.before,
    effect.cash_before,
    effect.balance_before,
    effect.after,
    effect.cash_after,
    effect.balance_after,
    effect.balance,
  ) != null;
  return Boolean(currency && hasAmount);
}

export function publicCashDisplay(effect) {
  if (!isStructuredCashEffect(effect)) return null;
  const after = firstCashAmount(
    effect.balance_after,
    effect.after,
    effect.cash_after,
    effect.balance,
  );
  const explicitAmount = firstCashAmount(effect.amount, effect.delta, effect.cash_delta);
  const direction = cashDirection(effect, explicitAmount);
  if (explicitAmount == null || direction == null) return null;
  const amount = typeof explicitAmount === "number" ? Math.abs(explicitAmount) : explicitAmount;
  if (amount === 0 || amount === "0" || amount === "0.00") return null;
  const currency = firstNonemptyString(
    effect.currency,
    effect.currency_label,
    effect.currency_code === "USD" ? "美元" : effect.currency_code,
  ) || "现金";
  const value = {
    effect_id: firstNonemptyString(effect.effect_id) || "",
    amount,
    currency,
    direction,
  };
  const decisionId = firstNonemptyString(
    effect.source_decision_id,
    effect.decision_id,
    effect.source_receipt_id,
  );
  if (decisionId) value.source_decision_id = decisionId;
  if (after != null) value.after = after;
  const localized = firstNonemptyString(effect.localized_reason);
  if (localized) value.localized_reason = localized;
  const gameTime = projectCashGameTime(effect.game_time);
  if (gameTime) value.game_time = gameTime;
  const playerTime = projectCashPlayerTime(effect.player_time)
    || gameTime?.player_time
    || null;
  if (playerTime) value.player_time = playerTime;
  return value;
}

function dedupeCashChanges(changes) {
  const seenIds = new Set();
  const seenReceipts = new Set();
  const out = [];
  for (const change of changes) {
    if (!change) continue;
    if (change.effect_id) {
      if (seenIds.has(change.effect_id)) continue;
      seenIds.add(change.effect_id);
    }
    if (change.source_decision_id) {
      const key = `${change.source_decision_id}:${change.direction}:${change.amount}:${change.currency}`;
      if (seenReceipts.has(key)) continue;
      seenReceipts.add(key);
    }
    out.push(change);
  }
  return out;
}

function appendProse(blocks, text) {
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "prose") {
    previous.text += `\n\n${text}`;
  } else {
    blocks.push({ type: "prose", text });
  }
}

export function isStructuredItemEffect(effect) {
  if (!effect || typeof effect !== "object") return false;
  const kind = String(effect.effect_kind || effect.kind || "");
  return kind === "item";
}

export function publicItemDisplay(effect) {
  if (!isStructuredItemEffect(effect)) return null;
  const label = firstNonemptyString(effect.label, effect.item_label);
  const action = firstNonemptyString(effect.action);
  const itemId = firstNonemptyString(effect.item_id);
  if (!label || !action || !itemId) return null;
  const value = {
    effect_id: firstNonemptyString(effect.effect_id) || "",
    item_id: itemId,
    label,
    action,
  };
  const decisionId = firstNonemptyString(
    effect.source_decision_id,
    effect.decision_id,
    effect.source_receipt_id,
  );
  if (decisionId) value.source_decision_id = decisionId;
  const quantity = firstCashAmount(effect.quantity, effect.count);
  if (quantity != null) value.quantity = quantity;
  const delta = firstCashAmount(effect.delta);
  if (delta != null) value.delta = delta;
  if (typeof effect.before === "number" && Number.isFinite(effect.before)) value.before = effect.before;
  if (effect.present_before === true || effect.present_before === false) {
    value.present_before = effect.present_before;
  }
  const remaining = firstCashAmount(effect.remaining, effect.after);
  if (remaining != null) value.after = remaining;
  if (typeof effect.remaining === "number" && Number.isFinite(effect.remaining)) {
    value.remaining = effect.remaining;
  }
  if (effect.present_after === true || effect.present_after === false) {
    value.present_after = effect.present_after;
  }
  const weapon = effect.weapon && typeof effect.weapon === "object" ? effect.weapon : null;
  if (weapon) {
    const snapshot = {};
    for (const field of ["weapon_id", "damage", "skill", "range", "ammo", "label"]) {
      if (weapon[field] != null && weapon[field] !== "") snapshot[field] = weapon[field];
    }
    if (Object.keys(snapshot).length) value.weapon = snapshot;
  }
  const localized = firstNonemptyString(effect.localized_reason);
  if (localized) value.localized_reason = localized;
  const gameTime = projectCashGameTime(effect.game_time);
  if (gameTime) value.game_time = gameTime;
  return value;
}

function dedupeItemChanges(changes) {
  const seenIds = new Set();
  const seenReceipts = new Set();
  const out = [];
  for (const change of changes) {
    if (!change) continue;
    if (change.effect_id) {
      if (seenIds.has(change.effect_id)) continue;
      seenIds.add(change.effect_id);
    }
    if (change.source_decision_id) {
      const key = `${change.source_decision_id}:${change.action}:${change.item_id}`;
      if (seenReceipts.has(key)) continue;
      seenReceipts.add(key);
    }
    out.push(change);
  }
  return out;
}

function projectAssetPayload(effects) {
  const cashChanges = dedupeCashChanges(effects.map(publicCashDisplay).filter(Boolean));
  const itemChanges = dedupeItemChanges(effects.map(publicItemDisplay).filter(Boolean));
  const structuredIds = new Set([
    ...cashChanges.map((row) => row.effect_id).filter(Boolean),
    ...itemChanges.map((row) => row.effect_id).filter(Boolean),
  ]);
  const leftover = effects.filter((effect) => {
    const id = firstNonemptyString(effect.effect_id);
    if (id && structuredIds.has(id)) return false;
    return !isStructuredCashEffect(effect) && !isStructuredItemEffect(effect);
  });
  return {
    cash_changes: cashChanges,
    item_changes: itemChanges,
    count: cashChanges.length + itemChanges.length,
    leftover,
  };
}

function mergeAssetBlock(previous, next) {
  const cash_changes = dedupeCashChanges([...(previous.cash_changes || []), ...(next.cash_changes || [])]);
  const item_changes = dedupeItemChanges([...(previous.item_changes || []), ...(next.item_changes || [])]);
  const sourceIds = [...new Set([...(previous.source_ids || []), ...(next.source_ids || [])])];
  return {
    type: "asset_changes",
    source_ids: sourceIds,
    cash_changes,
    item_changes,
    count: cash_changes.length + item_changes.length,
  };
}

function appendAssetBlock(blocks, payload) {
  if (!payload.count) return;
  const next = {
    type: "asset_changes",
    source_ids: [
      ...payload.cash_changes.map((row) => row.effect_id).filter(Boolean),
      ...payload.item_changes.map((row) => row.effect_id).filter(Boolean),
    ],
    cash_changes: payload.cash_changes,
    item_changes: payload.item_changes,
    count: payload.count,
  };
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "asset_changes") {
    blocks[blocks.length - 1] = mergeAssetBlock(previous, next);
    return;
  }
  blocks.push(next);
}

function projectEffect(effect, category) {
  if (!effect || typeof effect !== "object") return null;
  const projected = {
    category,
  };
  if (isNonEmptyString(effect.effect_id)) projected.effect_id = effect.effect_id;
  if (isNonEmptyString(effect.event_id)) projected.event_id = effect.event_id;
  if (isNonEmptyString(effect.effect_kind)) projected.effect_kind = effect.effect_kind;
  if (isNonEmptyString(effect.resource)) projected.resource = effect.resource;
  if (isExactInt(effect.before)) projected.before = effect.before;
  if (isExactInt(effect.after)) projected.after = effect.after;
  if (isExactInt(effect.delta)) projected.delta = effect.delta;
  if (isNonEmptyString(effect.direction)) projected.direction = effect.direction;
  if (isNonEmptyString(effect.player_visible_impact)) {
    projected.player_visible_impact = effect.player_visible_impact;
  }
  if (isNonEmptyString(effect.condition)) projected.condition = effect.condition;
  if (isNonEmptyString(effect.action)) projected.action = effect.action;
  if (isNonEmptyString(effect.consumed_by_roll_id)) {
    projected.source_roll_id = effect.consumed_by_roll_id;
  }
  return projected;
}

function effectRollIds(effect, category, ledgerIndex, effectIndex) {
  const ids = [];
  if (category === "exceptional_effect") {
    if (isNonEmptyString(effect.consumed_by_roll_id)) ids.push(effect.consumed_by_roll_id);
    const source = effectIndex.sourceRollByEffectId.get(effect.effect_id);
    if (isNonEmptyString(source)) ids.push(source);
    return ids;
  }
  if (isNonEmptyString(effect.source_decision_id)) {
    const fromDecision = ledgerIndex.rollsByDecisionId.get(effect.source_decision_id);
    if (fromDecision) ids.push(...fromDecision);
  }
  return ids;
}

function resourceKey(value) {
  return isNonEmptyString(value) ? value.toLowerCase() : "";
}

function uniqueGroupForEffect(effect, rollIds, groups, combatIndex) {
  const hits = groups.filter((group) => group.source_ids.some((id) => rollIds.includes(id)));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return null;
  const resource = resourceKey(effect.resource);
  if (effect.effect_kind === "scalar" && resource === "hp") {
    const damageHits = hits.filter((group) =>
      group.source_ids.some((id) => combatIndex.damageByRoll.has(id) && rollIds.includes(id)),
    );
    if (damageHits.length === 1) return damageHits[0];
  }
  if (effect.effect_kind === "scalar" && resource === "san") {
    const sanHits = hits.filter((group) => group.layout === "sanity");
    if (sanHits.length === 1) return sanHits[0];
  }
  return null;
}

function mergeSourceIds(primary, extra) {
  const seen = new Set(primary);
  const merged = [...primary];
  for (const id of extra) {
    if (!isNonEmptyString(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

function groupsTouching(ids, publicGroups) {
  const wanted = new Set(ids.filter((id) => isNonEmptyString(id)));
  return publicGroups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.source_ids.some((id) => wanted.has(id)));
}

function uniqueOwnerIndex(touching, preferIndex) {
  if (touching.length === 0) return null;
  if (touching.length === 1) return touching[0].index;
  if (preferIndex == null) return null;
  const preferred = touching.filter((row) => row.index === preferIndex);
  return preferred.length === 1 && touching.length >= 1 ? preferIndex : null;
}

function buildPairingPlan(publicGroups, combatIndex, ledgerIndex, checksById) {
  const consumed = new Set();
  const ownership = new Map();
  const forcedCheck = new Set();
  const claimedPairs = [];

  const reject = (indexes) => {
    for (const index of indexes) forcedCheck.add(index);
  };

  const claimAll = (ownerIndex, rollIds, involved) => {
    if (ownerIndex == null) {
      reject(involved);
      return false;
    }
    const conflict = rollIds.some((id) => ownership.has(id) && ownership.get(id) !== ownerIndex);
    if (conflict) {
      reject([ownerIndex, ...involved, ...rollIds.map((id) => ownership.get(id)).filter((index) => index != null)]);
      return false;
    }
    for (const rollId of rollIds) {
      if (!isNonEmptyString(rollId)) continue;
      consumed.add(rollId);
      ownership.set(rollId, ownerIndex);
    }
    claimedPairs.push({ ownerIndex, rollIds });
    return true;
  };

  for (const turn of combatIndex.turns) {
    if (turn.duplicate_roll) {
      reject(groupsTouching(turnLinkedIds(turn), publicGroups).map((row) => row.index));
      continue;
    }
    const ids = turnLinkedIds(turn);
    const touching = groupsTouching(ids, publicGroups);
    if (!touching.length) continue;
    let owner = null;
    if (touching.length === 1) {
      owner = touching[0].index;
    } else if (turn.defense_id) {
      const defenseOwners = touching.filter(({ group }) => group.source_ids.includes(turn.defense_id));
      owner = defenseOwners.length === 1 ? defenseOwners[0].index : null;
    }
    claimAll(owner, ids, touching.map((row) => row.index));
  }

  const seenOpposed = new Set();
  for (const pair of ledgerIndex.opposedByRollId.values()) {
    const key = `${pair.left}:${pair.right}`;
    if (seenOpposed.has(key)) continue;
    seenOpposed.add(key);
    const touching = groupsTouching([pair.left, pair.right], publicGroups);
    if (!touching.length) continue;
    let owner = null;
    if (touching.length === 1) owner = touching[0].index;
    else {
      const rightOwners = touching.filter(({ group }) => group.source_ids.includes(pair.right));
      owner = rightOwners.length === 1 ? rightOwners[0].index : null;
    }
    claimAll(owner, [pair.left, pair.right], touching.map((row) => row.index));
  }

  publicGroups.forEach((group, index) => {
    const checkIds = group.source_ids.filter((id) => recordKind(checksById.get(id)) === "sanity_check");
    if (checkIds.length !== 1) return;
    const linked = ledgerIndex.sanityByCheckId.get(checkIds[0]);
    if (!linked?.loss_roll_id) return;
    const touching = groupsTouching([checkIds[0], linked.loss_roll_id], publicGroups);
    const checkOwners = touching.filter(({ group: candidate }) => candidate.source_ids.includes(checkIds[0]));
    const owner = checkOwners.length === 1 ? checkOwners[0].index : uniqueOwnerIndex(touching, index);
    claimAll(owner, [checkIds[0], linked.loss_roll_id], touching.map((row) => row.index));
  });

  return { consumed, ownership, forcedCheck };
}

function decorateGroup(group, choice, displayById, checksById, combatIndex, ledgerIndex) {
  const block = {
    type: "roll_group",
    text: group.text,
    source_ids: [...group.source_ids],
    layout: LAYOUTS.has(choice.layout) ? choice.layout : "check",
    rolls: group.source_ids.map((id) => displayById.get(id)).filter(Boolean),
  };
  if (choice.layout === "combat") {
    const combat = attachCombatPayload(choice, displayById, combatIndex);
    if (combat) {
      block.combat = combat;
      block.source_ids = mergeSourceIds(block.source_ids, turnLinkedIds(choice.turn));
      const known = new Set(block.rolls.map((roll) => roll.roll_id));
      const extraRolls = [
        combat.attack, combat.defense, combat.attack_reroll,
        combat.damage?.roll, combat.fight_back_damage?.roll,
        ...(combat.shots || []).flatMap((shot) => [shot.attack, shot.damage?.roll]),
        ...(combat.volleys || []).flatMap((volley) => [volley.attack, ...(volley.damages || []).map((row) => row.roll)]),
      ];
      for (const roll of extraRolls) {
        if (roll && !known.has(roll.roll_id)) {
          block.rolls.push(roll);
          known.add(roll.roll_id);
        }
      }
    } else {
      block.layout = "check";
    }
  } else if (choice.layout === "sanity") {
    const sanity = attachSanityPayload(choice, displayById, checksById, ledgerIndex);
    if (sanity) {
      block.sanity = sanity;
      if (choice.lossId) block.source_ids = mergeSourceIds(block.source_ids, [choice.lossId]);
      block.rolls = block.rolls.map((roll) => (
        roll.roll_id === sanity.check?.roll_id ? sanity.check : roll
      ));
      if (sanity.loss && !block.rolls.some((roll) => roll.roll_id === sanity.loss.roll_id)) {
        block.rolls.push(sanity.loss);
      }
    } else {
      block.layout = "check";
    }
  } else if (choice.layout === "opposed") {
    const opposed = attachOpposedPayload(choice, displayById);
    if (opposed) {
      block.opposed = opposed;
      block.source_ids = mergeSourceIds(block.source_ids, [choice.pair.left, choice.pair.right]);
    } else {
      block.layout = "check";
    }
  } else if (choice.layout === "damage") {
    const roll = displayById.get(choice.damageId);
    if (roll) {
      block.damage = damagePayload(choice.damageId, roll, combatIndex);
    } else {
      block.layout = "check";
    }
  }
  return block;
}

/**
 * Turn finalization segments + authoritative ID indexes into content_blocks.
 * Public checks become roll_groups with an explicit layout; mechanic segments
 * join a group only when a unique stable roll/decision link exists.
 */
export function projectKeeperContentBlocks({
  segments,
  checksById,
  displayById,
  combatIndex,
  ledgerIndex,
  effectIndex,
}) {
  const publicGroups = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.segment_type !== "public_check") continue;
    const sourceIds = Array.isArray(segment.source_ids)
      ? segment.source_ids.filter((id) => isNonEmptyString(id))
      : [];
    publicGroups.push({
      segmentIndex: index,
      text: segment.text,
      source_ids: sourceIds,
    });
  }

  const { consumed, ownership, forcedCheck } = buildPairingPlan(
    publicGroups,
    combatIndex,
    ledgerIndex,
    checksById,
  );
  const decorated = publicGroups.map((group, index) => {
    if (forcedCheck.has(index)) {
      const block = decorateGroup(
        group,
        { layout: "check" },
        displayById,
        checksById,
        combatIndex,
        ledgerIndex,
      );
      return { ...group, block, remainingIds: group.source_ids, owned: ownership };
    }
    const ownedExtras = [...consumed].filter((id) => ownership.get(id) === index && !group.source_ids.includes(id));
    const effectiveIds = mergeSourceIds(group.source_ids, ownedExtras);
    const remainingIds = effectiveIds.filter((id) => ownership.get(id) === index || !consumed.has(id));
    const working = { ...group, source_ids: remainingIds.length ? remainingIds : effectiveIds };
    const choice = chooseLayout(working.source_ids, checksById, combatIndex, ledgerIndex);
    const block = decorateGroup(working, choice, displayById, checksById, combatIndex, ledgerIndex);
    return { ...group, block, remainingIds, owned: ownership };
  });

  const emittedGroups = [];
  const groupBySegment = new Map();
  const proseFallback = new Set();
  decorated.forEach((row, index) => {
    const allConsumedElsewhere = row.source_ids.length > 0
      && row.source_ids.every((id) => consumed.has(id) && ownership.get(id) !== index);
    if (allConsumedElsewhere) return;
    // Specialized pairing/DTO failure must not drop the public check.
    // Authoritative dice stay on layout "check"; otherwise keep player-visible prose.
    if (!row.block.rolls.length) {
      if (typeof row.text === "string" && row.text.length) {
        proseFallback.add(row.segmentIndex);
      }
      return;
    }
    emittedGroups.push(row.block);
    groupBySegment.set(row.segmentIndex, row.block);
  });

  const absorbedSegments = new Set();
  segments.forEach((segment, index) => {
    if (
      segment.segment_type !== "state_delta"
      && segment.segment_type !== "asset_delta"
      && segment.segment_type !== "exceptional_effect"
    ) {
      return;
    }
    const sourceIds = Array.isArray(segment.source_ids)
      ? segment.source_ids.filter((id) => isNonEmptyString(id))
      : [];
    if (!sourceIds.length) return;
    const category = segment.segment_type === "asset_delta" ? "state_delta" : segment.segment_type;
    const effects = sourceIds
      .map((id) => (
        category === "state_delta"
          ? effectIndex.stateDeltasById.get(id)
          : effectIndex.exceptionalByEventId.get(id)
      ))
      .filter(Boolean);
    if (!effects.length) return;
    const targets = new Set();
    for (const effect of effects) {
      const rollIds = effectRollIds(effect, category, ledgerIndex, effectIndex);
      const group = uniqueGroupForEffect(effect, rollIds, emittedGroups, combatIndex);
      if (!group) {
        targets.clear();
        return;
      }
      targets.add(group);
    }
    if (targets.size !== 1) return;
    const [group] = targets;
    if (!Array.isArray(group.effects)) group.effects = [];
    for (const effect of effects) {
      const projected = projectEffect(effect, category);
      if (projected) group.effects.push(projected);
    }
    absorbedSegments.add(index);
  });

  const blocks = [];
  segments.forEach((segment, index) => {
    if (absorbedSegments.has(index)) return;
    if (segment.segment_type === "public_check") {
      const group = groupBySegment.get(index);
      if (group) blocks.push(group);
      else if (proseFallback.has(index)) appendProse(blocks, segment.text);
      return;
    }
    if (segment.segment_type === "state_delta" || segment.segment_type === "asset_delta") {
      const sourceIds = Array.isArray(segment.source_ids)
        ? segment.source_ids.filter((id) => isNonEmptyString(id))
        : [];
      const effects = sourceIds.map((id) => effectIndex.stateDeltasById.get(id)).filter(Boolean);
      const payload = projectAssetPayload(effects);
      appendAssetBlock(blocks, payload);
      if (payload.leftover.length) {
        appendProse(blocks, segment.text);
      } else if (!payload.count && segment.segment_type === "state_delta") {
        appendProse(blocks, segment.text);
      }
      return;
    }
    appendProse(blocks, segment.text);
  });
  return blocks;
}
