/**
 * Host web_search HTTP clients (Exa, Tavily, Perplexity). Built-in fetch only.
 * Secrets stay in env / web-search.json and must never appear in tool output.
 */
export const EXA_SEARCH_URL = "https://api.exa.ai/search";
export const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions";
export const PERPLEXITY_SEARCH_MODEL = "sonar";

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESULTS = 8;
export const MAX_SNIPPET = 800;
export const MAX_FETCH_CHARS = 20_000;

export const DEFAULT_SEARCH_PROVIDERS = Object.freeze([
  "exa",
  "tavily",
  "perplexity",
  "searxng",
  "openai",
]);

export const SEARCH_KEY_ENV = Object.freeze({
  exa: "EXA_API_KEY",
  tavily: "TAVILY_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  openai: "OPENAI_API_KEY",
  searxng: "SEARXNG_API_KEY",
});

export const SEARCH_KEY_FIELDS = Object.freeze({
  exa: "exaApiKey",
  tavily: "tavilyApiKey",
  perplexity: "perplexityApiKey",
  openai: "openaiApiKey",
  searxng: "searxngApiKey",
});

const IMPLEMENTED_SEARCH_PROVIDERS = Object.freeze(["exa", "tavily", "perplexity"]);

export const MISSING_SEARCH_KEY_TEXT =
  "web_search 需要已配置的搜索 API key（Exa / Tavily / Perplexity）。在设置 → 通用中填写，然后开一局新会话。不要用 bash/curl 搜网。";

function trimKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    const token = trimKey(secret);
    if (token.length < 8) continue;
    out = out.split(token).join("[redacted]");
  }
  return out;
}

export function normalizeProviders(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const id = String(item || "").trim().toLowerCase();
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function parseRoutingEnv(value) {
  const raw = trimKey(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return normalizeProviders(parsed);
    } catch {
      return [];
    }
  }
  return normalizeProviders(raw.split(/[,\s]+/));
}

export function resolveSearchRouting(config, env = {}) {
  const fromEnv = parseRoutingEnv(env.WEB_SEARCH_ROUTING);
  if (fromEnv.length) return fromEnv;
  const obj = asObject(config) ?? {};
  const routing = asObject(obj.searchRouting);
  const fromConfig = normalizeProviders(routing?.providers);
  if (fromConfig.length) return fromConfig;
  const pin = trimKey(obj.provider) || trimKey(obj.searchProvider);
  if (pin) return normalizeProviders([pin, ...DEFAULT_SEARCH_PROVIDERS]);
  return [...DEFAULT_SEARCH_PROVIDERS];
}

export function resolveProviderApiKey(provider, env = {}, config = {}) {
  const envName = SEARCH_KEY_ENV[provider];
  const field = SEARCH_KEY_FIELDS[provider];
  const fromEnv = envName ? trimKey(env[envName]) : "";
  if (fromEnv) return fromEnv;
  const obj = asObject(config) ?? {};
  return field ? trimKey(obj[field]) : "";
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorFromPayload(parsed, raw, status) {
  if (parsed && typeof parsed === "object") {
    if ("error" in parsed) {
      const err = parsed.error;
      if (typeof err === "string") return err.slice(0, 300);
      if (err && typeof err === "object" && typeof err.message === "string") {
        return err.message.slice(0, 300);
      }
    }
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  }
  const text = typeof raw === "string" ? raw : "";
  return text.slice(0, 300) || `HTTP ${status}`;
}

export async function postJson(url, { apiKey, headers, body, signal, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  });
  const raw = await response.text();
  let parsed = raw;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { error: raw.slice(0, 300) };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${errorFromPayload(parsed, raw, response.status)}`);
  }
  return parsed;
}

function clipSnippet(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > MAX_SNIPPET ? `${raw.slice(0, MAX_SNIPPET)}…` : raw;
}

export function snippetFromExaResult(item) {
  const row = asObject(item) ?? {};
  const highlights = Array.isArray(row.highlights)
    ? row.highlights.filter((part) => typeof part === "string")
    : [];
  const text = typeof row.text === "string" ? row.text : "";
  return clipSnippet(highlights.join(" ") || text);
}

export function formatSearchResults(query, source, results) {
  const lines = [`Search: ${query}`, `Source: ${source}`, `Results: ${results.length}`, ""];
  results.forEach((result, index) => {
    lines.push(`[${index + 1}] ${result.title}`);
    lines.push(`    ${result.url}`);
    if (result.snippet) lines.push(`    ${result.snippet}`);
  });
  return lines.join("\n");
}

function pushResult(results, item) {
  const row = asObject(item) ?? {};
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!url) return;
  const title =
    typeof row.title === "string" && row.title.trim()
      ? row.title.trim()
      : url;
  results.push({
    title,
    url,
    snippet: clipSnippet(row.snippet || row.content || row.text || ""),
  });
}

export function mapExaSearchPayload(payload) {
  const results = [];
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  for (const item of rows) {
    const row = asObject(item) ?? {};
    pushResult(results, {
      title: row.title,
      url: row.url,
      snippet: snippetFromExaResult(row),
    });
  }
  return results;
}

export function mapTavilySearchPayload(payload) {
  const results = [];
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  for (const item of rows) pushResult(results, item);
  return results;
}

export function mapPerplexitySearchPayload(payload) {
  const results = [];
  const obj = asObject(payload) ?? {};
  const searchResults = Array.isArray(obj.search_results) ? obj.search_results : [];
  for (const item of searchResults) pushResult(results, item);
  if (results.length) return results;

  const citations = Array.isArray(obj.citations) ? obj.citations : [];
  const content = obj.choices?.[0]?.message?.content;
  const snippet = typeof content === "string" ? content : "";
  citations.forEach((citation, index) => {
    const url = typeof citation === "string" ? citation.trim() : trimKey(citation?.url);
    if (!url) return;
    pushResult(results, {
      title: typeof citation?.title === "string" ? citation.title : url,
      url,
      snippet: index === 0 ? snippet : "",
    });
  });
  if (results.length) return results;

  if (snippet.trim()) {
    results.push({
      title: "Perplexity",
      url: "https://www.perplexity.ai",
      snippet: clipSnippet(snippet),
    });
  }
  return results;
}

function sourceLabel(provider) {
  if (provider === "exa") return "Exa";
  if (provider === "tavily") return "Tavily";
  if (provider === "perplexity") return "Perplexity";
  return provider;
}

export async function searchWithProvider(provider, { query, numResults, apiKey, signal, fetchImpl }) {
  if (provider === "exa") {
    const payload = await postJson(EXA_SEARCH_URL, {
      apiKey,
      headers: { "x-api-key": apiKey },
      body: {
        query,
        type: "auto",
        numResults,
        contents: { text: { maxCharacters: MAX_SNIPPET } },
      },
      signal,
      fetchImpl,
    });
    return mapExaSearchPayload(payload);
  }
  if (provider === "tavily") {
    const payload = await postJson(TAVILY_SEARCH_URL, {
      apiKey,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        query,
        max_results: numResults,
      },
      signal,
      fetchImpl,
    });
    return mapTavilySearchPayload(payload);
  }
  if (provider === "perplexity") {
    const payload = await postJson(PERPLEXITY_CHAT_URL, {
      apiKey,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model: PERPLEXITY_SEARCH_MODEL,
        messages: [{ role: "user", content: query }],
      },
      signal,
      fetchImpl,
    });
    return mapPerplexitySearchPayload(payload);
  }
  throw new Error(`unsupported search provider: ${provider}`);
}

export async function executeWebSearch({
  query,
  numResults = 5,
  env = {},
  config = {},
  signal,
  fetchImpl,
} = {}) {
  const q = String(query ?? "").trim();
  if (!q) {
    return { isError: true, text: "web_search requires a non-empty query.", details: {} };
  }
  const count = Math.max(1, Math.min(MAX_RESULTS, Math.trunc(Number(numResults ?? 5)) || 5));
  const routing = resolveSearchRouting(config, env);
  const secrets = [];
  const failures = [];
  let sawImplemented = false;

  for (const provider of routing) {
    if (!IMPLEMENTED_SEARCH_PROVIDERS.includes(provider)) continue;
    sawImplemented = true;
    const apiKey = resolveProviderApiKey(provider, env, config);
    if (!apiKey) {
      failures.push(`${provider}: no key`);
      continue;
    }
    secrets.push(apiKey);
    try {
      const results = await searchWithProvider(provider, {
        query: q,
        numResults: count,
        apiKey,
        signal,
        fetchImpl,
      });
      const source = sourceLabel(provider);
      const text =
        results.length === 0
          ? `Search: ${q}\nSource: ${source}\nResults: 0`
          : formatSearchResults(q, source, results);
      return {
        isError: false,
        text: redactSecrets(text, secrets),
        details: { query: q, count: results.length, provider },
      };
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
      failures.push(`${provider}: ${message}`);
    }
  }

  if (!sawImplemented || failures.every((item) => item.endsWith(": no key"))) {
    return {
      isError: true,
      text: MISSING_SEARCH_KEY_TEXT,
      details: { configured: false, query: q },
    };
  }

  const summary = redactSecrets(failures.join("; "), secrets);
  return {
    isError: true,
    text: `web_search failed: ${summary}`,
    details: { query: q },
  };
}

export async function executeWebFetch({ url, env = {}, config = {}, signal, fetchImpl } = {}) {
  const apiKey = resolveProviderApiKey("exa", env, config);
  if (!apiKey) {
    return { isError: true, text: MISSING_SEARCH_KEY_TEXT, details: { configured: false } };
  }
  try {
    const payload = await postJson(EXA_CONTENTS_URL, {
      apiKey,
      headers: { "x-api-key": apiKey },
      body: { urls: [url], text: { maxCharacters: MAX_FETCH_CHARS } },
      signal,
      fetchImpl,
    });
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const first = asObject(rows[0]) ?? {};
    const title = typeof first.title === "string" ? first.title.trim() : "";
    const body = typeof first.text === "string" ? first.text.trim() : "";
    if (!body) {
      return { isError: true, text: `Fetch: ${url}\n(empty)`, details: { url } };
    }
    const clipped = body.length > MAX_FETCH_CHARS ? `${body.slice(0, MAX_FETCH_CHARS)}…` : body;
    const header = title ? `Fetch: ${title}\nURL: ${url}\n\n` : `Fetch: ${url}\n\n`;
    return {
      isError: false,
      text: redactSecrets(header + clipped, [apiKey]),
      details: { url, chars: clipped.length },
    };
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), [apiKey]);
    return { isError: true, text: `web_fetch failed: ${message}`, details: { url } };
  }
}
