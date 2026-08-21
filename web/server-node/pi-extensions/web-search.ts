/**
 * Host-owned Pi extension for the live KP: `web_search` and `web_fetch`.
 *
 * Mounted by web/server-node via `pi-coc --extension <abs>` (not the shared
 * COC package). pi-web-access is not bundled here and vendors a PDF extractor,
 * so this file is a thin Exa HTTP client. Keys come from child env
 * (`EXA_API_KEY`) injected from `{PI_AGENT_DIR}/web-search.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 8;
const MAX_SNIPPET = 800;
const MAX_FETCH_CHARS = 20_000;
const HOST_TOOL_NAMES = ["web_search", "web_fetch"];

function textResult(text: string, details: Record<string, unknown> = {}, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details,
    ...(isError ? { isError: true } : {}),
  };
}

function trimKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readExaKeyFromWebSearchJson(): string {
  const dir = trimKey(process.env.PI_CODING_AGENT_DIR) || trimKey(process.env.PI_AGENT_DIR);
  if (!dir) return "";
  const file = join(dir, "web-search.json");
  if (!existsSync(file)) return "";
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    return trimKey((parsed as { exaApiKey?: unknown }).exaApiKey);
  } catch {
    return "";
  }
}

function resolveExaApiKey(): string {
  return trimKey(process.env.EXA_API_KEY) || readExaKeyFromWebSearchJson();
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function exaPost(url: string, apiKey: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  });
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { error: raw.slice(0, 300) };
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error || raw).slice(0, 300)
        : raw.slice(0, 300);
    throw new Error(`Exa HTTP ${response.status}: ${message}`);
  }
  return parsed;
}

function formatSearchResults(query: string, results: Array<{ title: string; url: string; snippet: string }>): string {
  const lines = [`Search: ${query}`, `Source: Exa`, `Results: ${results.length}`, ""];
  results.forEach((result, index) => {
    lines.push(`[${index + 1}] ${result.title}`);
    lines.push(`    ${result.url}`);
    if (result.snippet) lines.push(`    ${result.snippet}`);
  });
  return lines.join("\n");
}

function snippetFromResult(item: Record<string, unknown>): string {
  const highlights = Array.isArray(item.highlights)
    ? item.highlights.filter((part): part is string => typeof part === "string")
    : [];
  const text = typeof item.text === "string" ? item.text : "";
  const raw = (highlights.join(" ") || text).replace(/\s+/g, " ").trim();
  return raw.length > MAX_SNIPPET ? `${raw.slice(0, MAX_SNIPPET)}…` : raw;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function keepHostSearchTools(pi: {
  getAllTools?: () => Array<{ name?: string }>;
  getActiveTools?: () => string[];
  setActiveTools?: (names: string[]) => void;
}) {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return;
  const registered = new Set(
    (typeof pi.getAllTools === "function" ? pi.getAllTools() : [])
      .map((tool) => tool && tool.name)
      .filter((name): name is string => typeof name === "string"),
  );
  const active = new Set(pi.getActiveTools());
  let changed = false;
  for (const name of HOST_TOOL_NAMES) {
    if (registered.has(name) && !active.has(name)) {
      active.add(name);
      changed = true;
    }
  }
  if (changed) pi.setActiveTools([...active]);
}

const missingKeyText =
  "web_search 需要 Exa API key。在设置 → 通用中填写 Exa，然后开一局新会话。不要用 bash/curl 搜网。";

export default function webSearchExtension(pi: {
  registerTool: (tool: unknown) => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  getAllTools?: () => Array<{ name?: string }>;
  getActiveTools?: () => string[];
  setActiveTools?: (names: string[]) => void;
}) {
  const bindKeepAlive = (event: string) => {
    if (typeof pi.on !== "function") return;
    pi.on(event, () => keepHostSearchTools(pi));
  };
  bindKeepAlive("session_start");
  bindKeepAlive("agent_start");

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the public web via Exa for setting, era, or factual background. Prefer this over bash/curl. " +
      "When the model offers a native hosted web_search, use that instead.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "integer",
          minimum: 1,
          maximum: MAX_RESULTS,
          description: "Max results (default 5)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const query = String(params?.query ?? "").trim();
      if (!query) return textResult("web_search requires a non-empty query.", {}, true);
      const apiKey = resolveExaApiKey();
      if (!apiKey) return textResult(missingKeyText, { configured: false }, true);
      const numResults = Math.max(
        1,
        Math.min(MAX_RESULTS, Math.trunc(Number(params?.numResults ?? 5)) || 5),
      );
      try {
        const payload = await exaPost(
          EXA_SEARCH_URL,
          apiKey,
          {
            query,
            type: "auto",
            numResults,
            contents: { text: { maxCharacters: MAX_SNIPPET } },
          },
          signal,
        );
        const rows = Array.isArray((payload as { results?: unknown }).results)
          ? (payload as { results: Array<Record<string, unknown>> }).results
          : [];
        const results = [];
        for (const item of rows) {
          const url = typeof item.url === "string" ? item.url.trim() : "";
          if (!url) continue;
          results.push({
            title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url,
            url,
            snippet: snippetFromResult(item),
          });
        }
        if (results.length === 0) {
          return textResult(`Search: ${query}\nSource: Exa\nResults: 0`, { query, count: 0 });
        }
        return textResult(formatSearchResults(query, results), { query, count: results.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`web_search failed: ${message}`, { query }, true);
      }
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch one public http(s) URL via Exa contents and return extracted text. Prefer this over bash/curl.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http(s) URL to fetch" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const url = String(params?.url ?? "").trim();
      if (!url || !isHttpUrl(url)) {
        return textResult("web_fetch requires a public http(s) URL.", {}, true);
      }
      const apiKey = resolveExaApiKey();
      if (!apiKey) return textResult(missingKeyText, { configured: false }, true);
      try {
        const payload = await exaPost(
          EXA_CONTENTS_URL,
          apiKey,
          { urls: [url], text: { maxCharacters: MAX_FETCH_CHARS } },
          signal,
        );
        const rows = Array.isArray((payload as { results?: unknown }).results)
          ? (payload as { results: Array<Record<string, unknown>> }).results
          : [];
        const first = rows[0] || {};
        const title = typeof first.title === "string" ? first.title.trim() : "";
        const body = typeof first.text === "string" ? first.text.trim() : "";
        if (!body) {
          return textResult(`Fetch: ${url}\n(empty)`, { url }, true);
        }
        const clipped = body.length > MAX_FETCH_CHARS ? `${body.slice(0, MAX_FETCH_CHARS)}…` : body;
        const header = title ? `Fetch: ${title}\nURL: ${url}\n\n` : `Fetch: ${url}\n\n`;
        return textResult(header + clipped, { url, chars: clipped.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`web_fetch failed: ${message}`, { url }, true);
      }
    },
  });
}
