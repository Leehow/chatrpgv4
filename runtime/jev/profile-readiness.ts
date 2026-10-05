/** Role-specific preparation descriptors are kernel facts, never model-generated statistics. */
export type ProfileRequirement = {actor: string; role: 'foot' | 'driver' | 'passenger' | 'combat'; missing: string[]; completion: 'creature' | 'archetype'};
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export function profilePreparationNeeds(requirements: ProfileRequirement[]): string[] {
  return requirements.map(entry => `Prepare ${entry.actor}'s ${entry.role} profile through apply npc {name: ${JSON.stringify(entry.actor)}, ${entry.completion}: <a source-supported ${entry.completion === 'creature' ? 'rules-catalog creature from lookup kind=catalog kinds=["creature"]' : 'archetype'}>}; missing: ${entry.missing.join(', ')}. Keep every stated number and the already chosen action.`);
}
export function roleReady(actor: unknown, role: string): boolean {
  const capability = record(record(record(actor).readiness)[role]);
  return capability.ready === true && Array.isArray(capability.missing) && capability.missing.length === 0;
}
export function rosterReady(actors: unknown[], roster: Array<{actor: string; role: string}>): boolean {
  return roster.every(entry => actors.some(actor => record(actor).name === entry.actor && roleReady(actor, entry.role)
    && (entry.role !== 'driver' || record(actor).driving_available === true)));
}
