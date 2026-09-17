/** The catalog is the kernel's job (contract §98): a name the model or the player wrote is
 *  resolved here against the rules tables — by its catalog name, by any localized label the
 *  table prints, or by a specialization the table declares — and a name that resolves to nothing
 *  comes back with a few candidates instead of the whole table. */
import { compareUnicode } from '../json.js';
import { array, row, entries, normalize, string, truth, type Row } from '../read/values.js';
import { specializationIdentity } from '../rules/skills.js';
import type { RuleTables } from '../rules/tables.js';
import type { Chargen } from './chargen.js';

export interface Unresolved { given: string; candidates: string[] }
export interface OccupationCandidate { id: string; label: string; skills: string[] }
const CANDIDATES = 3;
/** Words of a normalized name, for the overlap a candidate is ranked by. */
function tokens(text: string): string[] { return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
/** `Language (Other: X)` is legal for any X the player names (§23.4). */
export const isOtherLanguage = (name: string): boolean => name.startsWith('Language (Other: ') && name.endsWith(')') && Array.from(name).length > 19;

export class SetupCatalog {
  private readonly skillLabels = new Map<string, string>();
  private readonly occupationLabels = new Map<string, string>();
  constructor(readonly chargen: Chargen, readonly tables: RuleTables, private readonly weapons: Row) {
    for (const [name, spec] of entries(chargen.skillTable)) this.index(this.skillLabels, name, row(spec));
    for (const [id, spec] of entries(chargen.occupationTable)) this.index(this.occupationLabels, id, row(spec));
  }
  static async create(chargen: Chargen, tables: RuleTables): Promise<SetupCatalog> { return new SetupCatalog(chargen, tables, await tables.weaponsTable()); }
  private index(into: Map<string, string>, name: string, spec: Row): void {
    into.set(normalize(name), name);
    for (const [, label] of entries(row(spec.localized_labels))) if (typeof label === 'string' && label.trim()) into.set(normalize(label), name);
  }
  /** The label the play language prints for a catalog name, or the name itself. */
  label(spec: Row, name: string, language: string): string {
    const labels = row(spec.localized_labels), exact = labels[language];
    if (typeof exact === 'string' && exact.trim()) return exact;
    const base = language.split('-')[0], loose = entries(labels).find(([tag]) => tag.split('-')[0] === base);
    return loose && typeof loose[1] === 'string' && loose[1].trim() ? loose[1] : name;
  }
  skillLabel(name: string, language: string): string { return Object.hasOwn(this.chargen.skillTable, name) ? this.label(row(this.chargen.skillTable[name]), name, language) : name; }
  occupationLabel(id: string, language: string): string { return this.label(row(this.chargen.occupationTable[id]), id, language); }
  /** A skill name → its catalog name, or null. */
  resolveSkill(text: unknown): string | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    const given = text.trim();
    if (isOtherLanguage(given)) return given;
    const byName = this.skillLabels.get(normalize(given));
    if (byName) return byName;
    return specializationIdentity(this.chargen.groups, this.chargen.skillTable, given)?.canonical ?? null;
  }
  /** The closest catalog names to a name that resolved to nothing: names sharing the text or a word. */
  skillCandidates(given: string, limit = CANDIDATES): string[] {
    const key = normalize(given), words = new Set(tokens(given)), scored: Array<[number, string]> = [];
    for (const [label, name] of this.skillLabels) {
      let score = 0;
      if (label === key) score = 100;
      else if (label.includes(key) || key.includes(label)) score = 50;
      else { const shared = tokens(label).filter(word => words.has(word)).length; if (shared) score = shared * 10; }
      if (score > 0) scored.push([score + (label === normalize(name) ? 1 : 0), name]);
    }
    const best = new Map<string, number>();
    for (const [score, name] of scored) if ((best.get(name) ?? 0) < score) best.set(name, score);
    return [...best.entries()].sort((a, b) => b[1] - a[1] || compareUnicode(a[0], b[0])).slice(0, limit).map(([name]) => name);
  }
  resolveOccupation(text: unknown): string | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    return this.occupationLabels.get(normalize(text.trim())) ?? null;
  }
  /** The concrete catalog names an occupation's printed list resolves to. */
  requiredSkills(id: string): string[] {
    const names: string[] = [];
    for (const phrase of array(row(this.chargen.occupationTable[id]).occupational_skills)) {
      const found = this.chargen.catalogName(string(phrase));
      if (found && !names.includes(found)) names.push(found);
    }
    return names;
  }
  /** The entries closest to a trade the table does not print, ranked by how many of the skills the
   *  model named are on each entry's own list — a structured overlap, never a reading of prose. */
  occupationCandidates(skills: string[], language: string, limit = CANDIDATES): OccupationCandidate[] {
    const named = new Set(skills);
    const ranked = Object.keys(this.chargen.occupationTable).map((id, index) => {
      const required = this.requiredSkills(id), overlap = required.filter(name => named.has(name)).length;
      return {id, index, overlap, required};
    }).filter(item => item.overlap > 0).sort((a, b) => b.overlap - a.overlap || a.index - b.index);
    return ranked.slice(0, limit).map(item => ({id: item.id, label: this.occupationLabel(item.id, language), skills: item.required}));
  }
  /** Every occupation, for a refusal that found no overlap at all. */
  occupationOptions(language: string): Array<{id: string; label: string}> {
    return Object.keys(this.chargen.occupationTable).map(id => ({id, label: this.occupationLabel(id, language)}));
  }
  /** The eight occupation skills: the model's own picks first, then the trade's printed list — a
   *  concrete entry is taken as printed, a choice ("one interpersonal skill (Charm, Fast Talk…)",
   *  "plus four specialisms from: …") is answered from the picks when one of them qualifies and from
   *  the printed options otherwise, and an open entry ("any one other skill") from the interest list
   *  and then the era's standard sheet. Returns the list and what was filled in. */
  fillOccupationSkills(id: string, picks: string[], interests: string[], standard: string[]): [string[], string[]] {
    const list: string[] = [], filled: string[] = [];
    const take = (name: string, fill: boolean): void => { if (name !== 'Credit Rating' && name !== 'Cthulhu Mythos' && !list.includes(name)) { list.push(name); if (fill) filled.push(name); } };
    for (const name of picks) take(name, false);
    for (const phrase of array(row(this.chargen.occupationTable[id]).occupational_skills).map(string)) {
      if (list.length >= 8) break;
      const concrete = this.chargen.catalogName(phrase);
      if (concrete) { take(concrete, true); continue; }
      const options = this.choiceOptions(phrase);
      if (!options.length) continue;
      const count = this.choiceCount(phrase);
      const satisfied = picks.filter(name => options.includes(name)).length;
      for (const name of options) { if (list.length >= 8 || satisfied + filled.filter(f => options.includes(f)).length >= count) break; take(name, true); }
    }
    for (const name of interests) { if (list.length >= 8) break; if (!list.includes(name)) take(name, true); }
    for (const name of standard) { if (list.length >= 8) break; take(name, true); }
    return [list.slice(0, 8), filled.filter(name => list.slice(0, 8).includes(name))];
  }
  /** The concrete names a printed choice offers, from the parenthesis or the colon it prints. */
  private choiceOptions(phrase: string): string[] {
    const inner = /\(([^)]*)\)/.exec(phrase)?.[1] ?? (phrase.includes(':') ? phrase.slice(phrase.indexOf(':') + 1) : '');
    const names: string[] = [];
    for (const part of inner.split(/,|\bor\b/)) {
      const text = part.trim();
      if (!text) continue;
      const found = this.chargen.catalogName(text);
      if (found) { if (!names.includes(found)) names.push(found); continue; }
      // A group name ("Fighting", "Firearms") offers its own specializations.
      const group = row(this.chargen.groups)[text];
      if (group) for (const member of Array.isArray(group.specializations) ? group.specializations : Object.keys(row(group.specializations)))
        { const canonical = this.chargen.catalogName(`${text} (${member})`); if (canonical && !names.includes(canonical)) names.push(canonical); }
    }
    return names;
  }
  private choiceCount(phrase: string): number {
    const words: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5};
    const match = /\b(one|two|three|four|five)\b/i.exec(phrase);
    return match ? words[match[1].toLowerCase()] : 1;
  }
  /** Weapon profiles the rules print, reachable by id or printable name (contract §19). */
  weaponProfiles(): Map<string, [Row, string]> {
    const profiles = new Map<string, [Row, string]>();
    for (const [id, value] of entries(this.weapons)) {
      const entry = row(value), printable = truth(entry.display_name) ? string(entry.display_name) : id;
      for (const name of [id, printable]) profiles.set(normalize(name), [entry, printable]);
    }
    return profiles;
  }
  /** What the setup prompt is given once: every entry, every skill, every printed weapon, with the
   *  play language's labels — so the model never has to guess a name (§98). */
  compact(language: string): Row {
    return {
      occupations: Object.keys(this.chargen.occupationTable).map(id => ({id, label: this.occupationLabel(id, language),
        skills: array(row(this.chargen.occupationTable[id]).occupational_skills).map(string),
        credit_rating_range: array(row(this.chargen.occupationTable[id]).credit_rating_range).map(Number),
        formula: string(row(this.chargen.occupationTable[id]).skill_point_formula ?? '')})),
      skills: Object.keys(this.chargen.skillTable).map(name => ({name, label: this.skillLabel(name, language)})),
      weapons: [...new Set([...this.weaponProfiles().values()].map(([, printable]) => printable))].sort(compareUnicode),
      language_specialty: 'Language (Other: English)',
    };
  }
}
