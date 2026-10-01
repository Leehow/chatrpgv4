/** Readiness of a Jev-bound first attack; names and availability come from the kernel. */
import type {Candidate, Json} from './step-policy.ts';
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export function attackPreparationNeeds(row: unknown, action: Record<string, Json>): string[] {
  const preparation = record(record(row).preparation), needs: string[] = [];
  if (Array.isArray(preparation.targets) && preparation.targets.includes(action.target))
    needs.push(`Prepare ${String(action.target)}'s combat profile through apply npc with a source-supported archetype.`);
  if (Array.isArray(preparation.weapons) && preparation.weapons.includes(action.weapon))
    needs.push(`Prepare the actually chosen attack usage for ${String(action.weapon)} through apply usage. Place or adopt its existing physical identity if needed; do not duplicate it. Apply usage joins a pending base definition.`);
  return needs;
}
export function preparedAttackReady(candidate: Candidate, prepared: Candidate): boolean {
  const row = record(record(candidate.basis).row), action = prepared.bound;
  return Array.isArray(row.targets) && row.targets.includes(action.target)
    && Array.isArray(row.weapons) && row.weapons.includes(action.weapon)
    && attackPreparationNeeds(row, action).length === 0;
}
