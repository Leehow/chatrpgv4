/** Structural opening bookkeeping shared by the host gate and kernel transaction. */
const MOOD_KEYS = new Set(['kind', 'name', 'mood', 'why']);
const PERSON_KEYS = new Set(['kind', 'who', 'name', 'address', 'why']);

export function openingInformationShape(effect: unknown): boolean {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return false;
  const value = effect as Record<string, unknown>;
  const keys = Object.keys(value).filter(key => !key.startsWith('_'));
  return value.kind === 'clue' || (value.kind === 'npc' && value.mood != null
    && keys.every(key => MOOD_KEYS.has(key)))
    || (value.kind === 'person' && (value.name != null || value.address != null)
      && keys.every(key => PERSON_KEYS.has(key)));
}
