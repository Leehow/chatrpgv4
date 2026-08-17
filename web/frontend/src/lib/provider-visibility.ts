// Keep aligned with web/server-node/provider-visibility.mjs.
// Featured cards that share a provider id (xAI) hide by row key.

export function featuredRowKey(kind: string, id: string): string {
  if (kind === "oauth") return `oauth-${id}`;
  if (kind === "api_key") return `api-${id}`;
  return id;
}

export function duplicatedFeaturedIds(oauthIds: Iterable<string>, presetIds: Iterable<string>): Set<string> {
  const presets = new Set(presetIds);
  const out = new Set<string>();
  for (const id of oauthIds) {
    if (presets.has(id)) out.add(id);
  }
  return out;
}

function asSet(hidden: Iterable<string> | undefined): Set<string> {
  return hidden instanceof Set ? hidden : new Set(hidden || []);
}

function hasRowKeys(hidden: Set<string>, id: string): boolean {
  return hidden.has(featuredRowKey("oauth", id)) || hidden.has(featuredRowKey("api_key", id));
}

export function isFeaturedRowShown(
  kind: string,
  id: string,
  hidden: Iterable<string>,
  duplicated: Set<string>,
): boolean {
  const set = asSet(hidden);
  if (!duplicated.has(id)) return !set.has(id);
  if (set.has(featuredRowKey(kind, id))) return false;
  if (set.has(id) && !hasRowKeys(set, id)) return false;
  return true;
}

export function toggleFeaturedRow(
  kind: string,
  id: string,
  hidden: Iterable<string>,
  duplicated: Set<string>,
): Set<string> {
  const next = new Set(asSet(hidden));
  if (!duplicated.has(id)) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  const oauthKey = featuredRowKey("oauth", id);
  const apiKey = featuredRowKey("api_key", id);
  if (next.has(id) && !hasRowKeys(next, id)) {
    next.add(oauthKey);
    next.add(apiKey);
    next.delete(id);
  }
  const key = featuredRowKey(kind, id);
  if (isFeaturedRowShown(kind, id, next, duplicated)) next.add(key);
  else next.delete(key);
  if (next.has(oauthKey) && next.has(apiKey)) next.add(id);
  else next.delete(id);
  return next;
}

export function menuHiddenProviderIds(hidden: Iterable<string>, duplicated: Set<string>): string[] {
  const set = asSet(hidden);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of set) {
    if (id.startsWith("oauth-") || id.startsWith("api-")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of duplicated) {
    if (set.has(featuredRowKey("oauth", id)) && set.has(featuredRowKey("api_key", id)) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
