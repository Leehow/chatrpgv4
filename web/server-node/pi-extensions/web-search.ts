/**
 * Host-owned Pi extension for the live KP: `web_search` and `web_fetch`.
 *
 * Mounted by web/server-node via `pi-coc --extension <abs>` (not the shared
 * COC package). pi-web-access is not bundled here and vendors a PDF extractor,
 * so this file is a thin HTTP client. Keys come from child env
 * (`EXA_API_KEY`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`) injected from
 * `{PI_AGENT_DIR}/web-search.json`. `web_search` follows `searchRouting`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  executeWebFetch,
  executeWebSearch,
} from "./web-search-client.mjs";

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

function readWebSearchConfig(): Record<string, unknown> {
  const dir = trimKey(process.env.PI_CODING_AGENT_DIR) || trimKey(process.env.PI_AGENT_DIR);
  if (!dir) return {};
  const file = join(dir, "web-search.json");
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
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
      "Search the public web via Exa, Tavily, or Perplexity for setting, era, or factual background. Prefer this over bash/curl. " +
      "When the model offers a native hosted web_search, use that instead.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          description: "Max results (default 5)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
      const result = await executeWebSearch({
        query: String(params?.query ?? ""),
        numResults: params?.numResults as number | undefined,
        env: process.env,
        config: readWebSearchConfig(),
        signal,
      });
      return textResult(result.text, result.details || {}, result.isError);
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
      const result = await executeWebFetch({
        url,
        env: process.env,
        config: readWebSearchConfig(),
        signal,
      });
      return textResult(result.text, result.details || {}, result.isError);
    },
  });
}
