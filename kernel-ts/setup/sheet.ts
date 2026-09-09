/** Shared setup-sheet projections and the current acceptance checks. */
import { isJsonObject } from '../json.js';
import { row, integer, truth, equal, type Row } from '../read/values.js';
export const BACKSTORY = Object.freeze(['personal_description', 'ideology_beliefs', 'significant_people', 'meaningful_locations', 'treasured_possessions', 'traits']);
export const nonempty = (value: any): value is string => typeof value === 'string' && Boolean(value.trim());
export function investigatorRow(sheet: Row): Row {
  return {id: sheet.id ?? null, name: sheet.name ?? null, occupation: sheet.occupation ?? null, occupation_stated: sheet.occupation_stated ?? null, hp: sheet.current_hp ?? null,
    san: sheet.current_san ?? null, mp: sheet.current_mp ?? null, luck: sheet.current_luck ?? null};
}
export function completeness(sheet: Row): string[] {
  const problems: string[] = [], skills = row(row(sheet.creation).skills);
  for (const name of ['occupation', 'interest']) if (!equal(row(skills[name]).unspent, 0)) problems.push(`${name} skills have an incomplete budget`);
  if (truth(row(skills.occupation).choices_pending)) problems.push('occupational choices remain unresolved');
  const story = row(sheet.backstory);
  if (BACKSTORY.filter(key => nonempty(story[key])).length < 3 || !nonempty(story.scenario_bound)) problems.push('structured backstory and scenario involvement are required');
  const connection = row(sheet.key_connection);
  if (!BACKSTORY.includes(connection.backstory_field) || !nonempty(connection.summary)) problems.push('key connection is missing');
  if (!nonempty(sheet.own_language)) problems.push('a concrete native language is required');
  if (!Array.isArray(sheet.equipment)) problems.push('record ordinary kit in equipment, not only prose');
  if (!truth(sheet.finance)) problems.push('era finance is unavailable');
  if (['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU', 'LUCK'].some(key => !integer(row(sheet.characteristics)[key]) && typeof row(sheet.characteristics)[key] !== 'boolean')) problems.push('characteristics are incomplete');
  return problems;
}
