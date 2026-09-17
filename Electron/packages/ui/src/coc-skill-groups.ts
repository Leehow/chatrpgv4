type Row = Record<string, any>

/** The three groups a card's skills fall into, in the order the card and the dialog draw them. */
export type SkillGroupKey = 'occupation' | 'interest' | 'other'
export type SkillGroup = { key: SkillGroupKey; names: string[] }

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && !!name) : []

/**
 * Which pool each skill was taken from (§98), read off the ledger the kernel already writes.
 *
 * The occupation list is what the occupation resolved to after the required entries were filled
 * in, and the interest list is the pool the interest points were spent from; everything else on
 * the sheet is the rest of the investigator -- the base ratings nobody bought. A name in both
 * lists belongs to the occupation, which is where it was paid for first, so no skill is drawn
 * twice.
 *
 * A card with neither list has no grouping to draw and answers `null`: it is a revision from
 * before the ledger carried them, and three headings invented over one flat table would be a
 * claim about where its numbers came from that nothing on the card supports.
 */
export function groupSkills(names: readonly string[], sheet: Row | undefined): SkillGroup[] | null {
  const ledger = sheet?.creation?.skills
  const resolved = list(ledger?.occupation?.resolved), pooled = list(ledger?.interest?.pool)
  if (!resolved.length && !pooled.length) return null
  const present = new Set(names), taken = new Set<string>()
  const claim = (from: string[]) => from.filter(name => {
    if (!present.has(name) || taken.has(name)) return false
    taken.add(name)
    return true
  })
  const occupation = claim(resolved), interest = claim(pooled)
  return [
    { key: 'occupation', names: occupation },
    { key: 'interest', names: interest },
    { key: 'other', names: names.filter(name => !taken.has(name)) },
  ]
}
