/** Readiness of a Jev-bound first attack; names and availability come from the kernel. */
import type {Candidate, Json} from './step-policy.ts';
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export function attackPreparationNeeds(row: unknown, action: Record<string, Json>): string[] {
  const preparation = record(record(row).preparation), needs: string[] = [];
  // §180.6 (CK-F2 review follow-up): the kernel's row says which completion the target takes; a creature never takes a
  // person tier, and the call names no number -- the kernel builds the block.
  if (Array.isArray(preparation.targets) && preparation.targets.includes(action.target))
    needs.push(record(preparation.completions)[String(action.target)] === 'creature'
      ? `Prepare ${String(action.target)}'s combat profile through apply npc {name: ${JSON.stringify(String(action.target))}, creature: <a rules-catalog creature from lookup kind=catalog kinds=["creature"]>}; the catalog completes only what its stat block lacks.`
      : `Prepare ${String(action.target)}'s combat profile through apply npc with a source-supported archetype.`);
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
