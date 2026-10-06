/** Bounded, model-authored reference questions. Scope labels describe the request, never a source fact. */
export interface ReferenceQuery {
  query: string;
  objective?: string;
  scope: 'exact' | 'analogous';
  focus?: 'context' | 'retail_prices' | 'hourly_wages';
}

export function checkReferenceQueries(value: unknown): ReferenceQuery[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 2) return undefined;
  const result: ReferenceQuery[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
    const item = row as Record<string, unknown>;
    if (typeof item.query !== 'string' || !item.query.trim() || item.query.length > 2048
      || !['exact', 'analogous'].includes(String(item.scope))
      || item.objective !== undefined && (typeof item.objective !== 'string' || item.objective.length > 512)
      || item.focus !== undefined && !['context', 'retail_prices', 'hourly_wages'].includes(String(item.focus))) return undefined;
    result.push({query: item.query.trim(), scope: item.scope as ReferenceQuery['scope'],
      ...(typeof item.objective === 'string' ? {objective: item.objective.trim()} : {}),
      ...(item.focus !== undefined ? {focus: item.focus as ReferenceQuery['focus']} : {})});
  }
  return result;
}

/** The existing typed price-policy verdict supplies the category; text is never classified here. */
export function priceBaselineQueries(query: string, objective?: string): ReferenceQuery[] {
  const basis = Array.from(query).slice(0, 1200).join('');
  return [
    {scope: 'exact', focus: 'retail_prices', query: `For this historical reference basis: ${basis}\nWhat were representative retail prices? Find original reports or period advertisements preserving amounts, currency, item quantities and the historical year.`,
      objective: objective ?? 'A reusable historical retail-price scale, with currency, quantities and year intact.'},
    {scope: 'exact', focus: 'hourly_wages', query: `For this historical reference basis: ${basis}\nWhat were hourly wages? Find original government or labor reports preserving amounts, currency, worker category, hourly units and the historical year.`,
      objective: objective ?? 'A reusable historical hourly-wage scale, with worker category, currency, units and year intact.'},
  ];
}

/** Fair, deterministic bounded interleaving; relevance and applicability remain Jev's decisions. */
export function mergeReferenceCandidates<T extends {url: string}>(groups: T[][], limit = 5): T[] {
  const result: T[] = [], seen = new Set<string>();
  for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)); index++) {
    for (const group of groups) {
      const row = group[index];
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url); result.push(row);
      if (result.length >= limit) return result;
    }
  }
  return result;
}
