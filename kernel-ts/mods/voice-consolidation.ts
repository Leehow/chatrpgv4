/** Narrow built-in compatibility policy; not an arbitrary cross-Mod migration facility. */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {array, row, clone, equal, number, truth, type Row} from '../read/values.js';
import {KEYS, UNIFIED_MOD, isVoicePresentationField} from '../voice/fields.js';

export const EXPRESSION_MOD = UNIFIED_MOD;
export const LEGACY_VOICE_MOD = 'npc-voice';
export const VOICE_CONSOLIDATION_CAPABILITY = 'npc.voice.consolidation.v1';
export const isUnifiedExpression = (mod: Row | undefined): boolean => mod?.id === EXPRESSION_MOD
  && array(mod.requires).includes(VOICE_CONSOLIDATION_CAPABILITY);

function unifiedDefaultOn(defaults: Row, latest: ReadonlyMap<string, Row>): boolean {
  const expression = latest.get(EXPRESSION_MOD);
  return isUnifiedExpression(expression) && truth(Object.hasOwn(defaults, EXPRESSION_MOD) ? defaults[EXPRESSION_MOD] : expression?.default_enabled);
}
/** Only fresh-world defaults change; an existing world's locks remain authoritative. */
export function newModDefault(mod: Row, defaults: Row, latest: ReadonlyMap<string, Row>): any {
  const value = Object.hasOwn(defaults, mod.id) ? defaults[mod.id] : mod.default_enabled;
  return mod.id === LEGACY_VOICE_MOD && unifiedDefaultOn(defaults, latest) ? false : value;
}

export function inheritedVoiceSettings(world: Row, mod: Row, old: Row, requested: Row, explicit: Row): Row {
  if (!isUnifiedExpression(mod) || Object.hasOwn(explicit, 'coarse_language') || Object.hasOwn(row(old.settings), 'coarse_language')) return requested;
  const legacy = row(row(world.mods).active)[LEGACY_VOICE_MOD];
  const pending = row(row(world.mods).pending)[LEGACY_VOICE_MOD];
  const preference = row(row(pending).settings).coarse_language ?? row(row(legacy).settings).coarse_language;
  return typeof preference === 'boolean' ? {...requested, coarse_language: preference} : requested;
}

/** Disable in the proposed view before conflict validation, never in the live world while busy. */
export function stageVoiceOwner(staged: Row, mod: Row): void {
  if (!isUnifiedExpression(mod) || !truth(row(row(staged.mods).active)[EXPRESSION_MOD]?.enabled)) return;
  const legacy = row(row(staged.mods).active)[LEGACY_VOICE_MOD];
  if (legacy) legacy.enabled = false;
}

/** Copy whole current v2 NPC cards. Originals and archived v1 cards are never deleted or revived. */
export function handoverVoiceState(staged: Row, previous: Row, mod: Row): void {
  if (!isUnifiedExpression(mod) || !truth(row(row(staged.mods).active)[EXPRESSION_MOD]?.enabled)) return;
  const oldLock = row(row(row(previous.mods).active)[LEGACY_VOICE_MOD]);
  if (!truth(oldLock.enabled)) return;
  const oldState = row(row(row(previous.mods).state)[LEGACY_VOICE_MOD]);
  const target = row(row(row(staged.mods).state)[EXPRESSION_MOD]);
  const v2 = number(oldLock.state_version) === 2;
  if (v2 && Object.hasOwn(oldState, 'dossier') && !isJsonObject(oldState.dossier))
    throw new RpcError('invalid_params', 'Legacy voice dossier is malformed; no handover was applied');
  if (Object.hasOwn(target, 'dossier') && !isJsonObject(target.dossier))
    throw new RpcError('invalid_params', 'Target voice dossier is malformed; no handover was applied');
  const dossier = clone(row(target.dossier));
  let copied = 0, conflicts = 0, skipped = 0;
  for (const [npc, record] of Object.entries(v2 ? row(oldState.dossier) : {})) {
    if (!isJsonObject(record)) throw new RpcError('invalid_params', 'Legacy NPC voice card is malformed; no handover was applied');
    const card = Object.fromEntries(KEYS.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]));
    if (!Object.keys(card).length) { skipped++; continue; }
    if (Object.entries(card).some(([key, value]) => !isVoicePresentationField(key, value)))
      throw new RpcError('invalid_params', 'Legacy v2 voice fields are malformed; no handover was applied');
    if (Object.hasOwn(dossier, npc)) { if (!equal(dossier[npc], card)) conflicts++; }
    else { Object.defineProperty(dossier, npc, {value: clone(card), enumerable: true, configurable: true, writable: true}); copied++; }
  }
  staged.mods.state[EXPRESSION_MOD] = {...target, dossier, voice_handover: {
    schema_version: 1, from: LEGACY_VOICE_MOD, from_version: oldLock.version, from_digest: oldLock.digest,
    to_version: mod.version, copied_count: copied, conflict_count: conflicts, skipped_count: skipped, legacy_v1_retained: !v2,
  }};
}

/** Public catalog diagnostics contain no NPC names or voice text. */
export function compatibilityView(mod: Row, latest: ReadonlyMap<string, Row>, locks: Row, catalog: ReadonlyMap<string, Row>, defaults: Row): Row {
  const result: Row = {};
  const handover = row(row(row(locks.state)[EXPRESSION_MOD]).voice_handover);
  if (mod.id === EXPRESSION_MOD && handover.schema_version === 1 && handover.from === LEGACY_VOICE_MOD)
    result.voice_handover = Object.fromEntries(['schema_version', 'from', 'from_version', 'to_version',
      'copied_count', 'conflict_count', 'skipped_count', 'legacy_v1_retained'].filter(key => Object.hasOwn(handover, key))
      .map(key => [key, clone(handover[key])]));
  const replacement = latest.get(mod.id)?.superseded_by;
  if (typeof replacement !== 'string') return result;
  const active = row(row(locks.active)[mod.id]), target = row(row(locks.active)[replacement]);
  const state = row(row(locks.state)[mod.id]);
  const unifiedActive = truth(target.enabled) && isUnifiedExpression(catalog.get(`${replacement}\0${target.version}`));
  const pending = row(row(locks.pending)[mod.id]);
  const visible = truth(active.enabled) || Object.keys(pending).length > 0 || !unifiedActive && (
    typeof active.version === 'string' && active.version !== latest.get(mod.id)?.version || Object.keys(state).length > 0);
  return {...result, superseded_by: replacement, compatibility_visible: Boolean(visible),
    ...(unifiedDefaultOn(defaults, latest) ? {default_suppressed_by: replacement} : {})};
}
