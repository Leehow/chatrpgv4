/** Campaign-bound host policy, shared by the sidebar and the live extension. */
import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export type DefensePreference = 'dodge' | 'fight_back';
function file(home: string, campaign: string): string {
  if (!campaign || campaign === '.' || campaign === '..' || /[/\\\0]/.test(campaign)) throw new Error('Invalid campaign binding');
  return join(home, '.coc', 'campaigns', campaign, 'defense-preference.json');
}
export async function readDefensePreference(home: string, campaign: string): Promise<DefensePreference> {
  let saved: unknown;
  try { saved = JSON.parse(await readFile(file(home, campaign), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'dodge'; throw error; }
  const value = (saved as {defense?: unknown})?.defense;
  if (value !== 'dodge' && value !== 'fight_back') throw new Error('Invalid stored defense preference');
  return value;
}
export async function writeDefensePreference(home: string, campaign: string, defense: unknown): Promise<DefensePreference> {
  if (defense !== 'dodge' && defense !== 'fight_back') throw new Error('Invalid defense preference');
  const target = file(home, campaign), temporary = `${target}.${randomUUID()}.tmp`;
  try {
    // The bound campaign must already exist. Never create a campaign from a UI request.
    await writeFile(temporary, JSON.stringify({defense}) + '\n', {mode: 0o600});
    await rename(temporary, target);
  } finally { await rm(temporary, {force: true}); }
  return defense;
}
export function isDefenseChoice(choice: any): boolean {
  return (typeof choice?.binds === 'string' && choice.binds.startsWith('defense:'))
    || (typeof choice?.name === 'string' && choice.name.startsWith('defense:'))
    || (choice?.kind === 'mechanics' && Array.isArray(choice.options)
      && choice.options.some((option: unknown) => option === 'dodge' || option === 'fight_back'));
}
