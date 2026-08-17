// Featured editor cards are keyed by provider id, but xAI appears twice
// (subscription + API Key). Visibility therefore uses row keys
// `oauth-<id>` / `api-<id>` for those duplicates, and still writes the
// bare provider id when every card for it is hidden so the model menu
// (which only knows provider ids) can hide it. A legacy `hidden: ["xai"]`
// means both cards are off.

export function featuredRowKey(kind, id) {
  if (kind === "oauth") return `oauth-${id}`;
  if (kind === "api_key") return `api-${id}`;
  return id;
}

export function duplicatedFeaturedIds(oauthIds, presetIds) {
  const presets = new Set(presetIds);
  const out = new Set();
  for (const id of oauthIds) {
    if (presets.has(id)) out.add(id);
  }
  return out;
}

function asSet(hidden) {
  return hidden instanceof Set ? hidden : new Set(hidden || []);
}

function hasRowKeys(hidden, id) {
  return hidden.has(featuredRowKey("oauth", id)) || hidden.has(featuredRowKey("api_key", id));
}

export function isFeaturedRowShown(kind, id, hidden, duplicated) {
  const set = asSet(hidden);
  if (!duplicated.has(id)) return !set.has(id);
  if (set.has(featuredRowKey(kind, id))) return false;
  if (set.has(id) && !hasRowKeys(set, id)) return false;
  return true;
}

export function toggleFeaturedRow(kind, id, hidden, duplicated) {
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

export function normalizeHiddenProviderIds(hidden, oauthIds, presetIds) {
  const duplicated = duplicatedFeaturedIds(oauthIds, presetIds);
  const next = new Set(hidden || []);
  for (const id of duplicated) {
    const oauthKey = featuredRowKey("oauth", id);
    const apiKey = featuredRowKey("api_key", id);
    if (next.has(oauthKey) && next.has(apiKey)) next.add(id);
    else if (next.has(oauthKey) || next.has(apiKey)) next.delete(id);
  }
  return [...next];
}

export function menuHiddenProviderIds(hidden, duplicated) {
  const set = asSet(hidden);
  const out = [];
  const seen = new Set();
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
