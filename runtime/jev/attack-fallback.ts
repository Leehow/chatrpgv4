/**
 * §224.2 (user ruling 2026-10-10, re-rules §163.2/§163.8 per the Keeper Rulebook): a declared attack is settled in the same
 * turn. When Jev's bind leaves the weapon or the target of an investigator's own attack unsettled, the host binds a
 * rulebook-faithful fallback from the closed options it issued -- never from words: the option Jev scored highest (ties to
 * the first listed), and for the weapon, with nothing scored, the weapon table's unarmed row (Fighting (Brawl); Improvised
 * Weapons, p.104). Only an attack with no target score at all stays unbound.
 */
import type {Candidate} from './step-policy.ts';
import {scoreText} from './forced-resolution.ts';

/** The weapons table key of the Fighting (Brawl) unarmed row (`content/rulesets/coc7/rules-json/weapons.json`). */
export const UNARMED_WEAPON = 'unarmed';
/** The bind record's rule name for a weapon the fallback bound. */
export const ATTACK_FALLBACK_RULE = 'attack_fallback';

/** An investigator's own declared attack: the first blow, or their turn's attack in a fight. Read from the issued decision. */
export function declaredAttack(candidate: Pick<Candidate, 'bound' | 'clerk'>): boolean {
  return candidate.bound.decision === 'combat:attack' && (candidate.clerk === 'first_blow' || candidate.clerk === 'session_step');
}

/** The issued option Jev scored highest, above zero; a tie goes to the first listed. */
export function bestIssued(options: readonly string[], distribution: Record<string, number> | null | undefined): {value: string; p: number} | undefined {
  let best: {value: string; p: number} | undefined;
  for (const value of options) {
    const p = distribution?.[value];
    if (typeof p === 'number' && Number.isFinite(p) && p > 0 && (!best || p > best.p)) best = {value, p};
  }
  return best;
}

/**
 * The fallback for one unsettled parameter of a declared attack, with the line the forced record carries; `undefined` when
 * even the fallback cannot bind it (a target nobody scored).
 */
export function attackFallback(name: string, options: readonly string[], distribution: Record<string, number> | null | undefined):
  {value: string; note: string} | undefined {
  const best = bestIssued(options, distribution);
  if (best) return {value: best.value, note: `${name}: ${best.value} ${scoreText(best.p)} (best-scored issued option)`};
  if (name === 'weapon') return {value: UNARMED_WEAPON, note: `weapon: ${UNARMED_WEAPON} (Fighting (Brawl) fallback)`};
  return undefined;
}
