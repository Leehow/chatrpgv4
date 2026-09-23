/** Only a live investigator attack grants the host a standing-defense operation. */
import type {DefensePreference} from '../Electron/packages/pi-backend/src/coc-defense.ts';
export {readDefensePreference, writeDefensePreference, isDefenseChoice} from '../Electron/packages/pi-backend/src/coc-defense.ts';
export function automaticDefense(session: any, preference: DefensePreference): {action: Record<string, unknown>; expected: Record<string, unknown>} | undefined {
  const pending = session?.pending_defense;
  if (session?.kind !== 'combat' || session.status !== 'active' || pending?.for !== 'player') return;
  if (typeof pending.actor !== 'string' || !pending.actor || typeof pending.attack_command_id !== 'string'
    || !pending.attack_command_id || !Number.isSafeInteger(pending.revision) || !Array.isArray(pending.options))
    throw new Error('The live investigator attack lacks a verifiable defense identity; nothing was settled');
  const defense = pending.options.includes(preference) ? preference : pending.options.includes('dodge') ? 'dodge' : undefined;
  if (!defense) throw new Error('The pending investigator attack has no legal standing defense');
  return {action: {intent: 'combat', actor: pending.actor, defense, decision: 'combat:defend',
    goal: 'Respond to the pending attack', method: 'Use the player standing defense preference'},
    expected: {attack_command_id: pending.attack_command_id, actor: pending.actor, revision: pending.revision}};
}
