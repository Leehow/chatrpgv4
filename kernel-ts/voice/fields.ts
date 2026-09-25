/** The voice owner alone declares these derived presentation fields. */
import {isJsonObject} from '../json.js';
export const MOD = 'npc-voice';
/** The unified expression package (`EXPRESSION_MOD` of `mods/voice-consolidation.ts`), which may own the lane
 *  since 2026-09-25 (contract §40.7 Owner). A lane record carries its owner's id as `mod`. */
export const UNIFIED_MOD = 'narration-craft';
export const OWNERS: readonly string[] = Object.freeze([MOD, UNIFIED_MOD]);
export const MASK_KEY = 'voice_mask';
export const EXCHANGES_KEY = 'exchanges';
export const LEGACY_KEY = 'sample_lines';
export const KEYS = [MASK_KEY, EXCHANGES_KEY] as const;
export const PRESENTATION_KEYS = [...KEYS, LEGACY_KEY] as const;
export const LABELS: Readonly<Record<string, string>> = Object.freeze({[MASK_KEY]: 'mask', [EXCHANGES_KEY]: 'in exchange'});
export const SILENT_REASON = 'does_not_speak';
export function isVoicePresentationField(key: string, value: unknown): boolean {
    if (!PRESENTATION_KEYS.includes(key as typeof PRESENTATION_KEYS[number]) || !isJsonObject(value)
        || Object.keys(value).some(key => !['value', 'label', 'turn', 'mod', 'shape', 'reason'].includes(key))
        || !['value', 'label', 'turn', 'mod', 'shape'].every(key => Object.hasOwn(value, key))
        || !OWNERS.includes(value.mod as string) || value.shape !== 'lines' || !Number.isSafeInteger(value.turn) || Number(value.turn) < 0
        || typeof value.label !== 'string' || !value.label.trim() || key !== LEGACY_KEY && value.label !== LABELS[key]) return false;
    if (value.value === null) return value.reason === SILENT_REASON;
    return value.reason === undefined && Array.isArray(value.value) && value.value.length >= 1 && value.value.length <= 3
        && (key === LEGACY_KEY || value.value.length === (key === MASK_KEY ? 1 : 3))
        && value.value.every(line => typeof line === 'string' && line.trim().length > 0 && [...line].length <= 200);
}
