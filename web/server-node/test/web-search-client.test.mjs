import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SEARCH_PROVIDERS,
  EXA_SEARCH_URL,
  MISSING_SEARCH_KEY_TEXT,
  PERPLEXITY_CHAT_URL,
  PERPLEXITY_SEARCH_MODEL,
  TAVILY_SEARCH_URL,
  executeWebSearch,
  mapPerplexitySearchPayload,
  mapTavilySearchPayload,
  redactSecrets,
  resolveSearchRouting,
} from "../pi-extensions/web-search-client.mjs";
import { DEFAULT_SEARCH_ROUTING } from "../web-search-keys.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("default routing stays Exa-first and matches catalog defaults", () => {
  assert.deepEqual(DEFAULT_SEARCH_PROVIDERS, [...DEFAULT_SEARCH_ROUTING.providers]);
  assert.equal(DEFAULT_SEARCH_PROVIDERS[0], "exa");
  assert.deepEqual(resolveSearchRouting({}), [...DEFAULT_SEARCH_PROVIDERS]);
});

test("searchRouting and WEB_SEARCH_ROUTING pin provider order", () => {
  assert.deepEqual(
    resolveSearchRouting({ searchRouting: { providers: ["tavily", "exa"] } }),
    ["tavily", "exa"],
  );
  assert.deepEqual(
    resolveSearchRouting(
      { searchRouting: { providers: ["exa"] } },
      { WEB_SEARCH_ROUTING: "perplexity,tavily" },
    ),
    ["perplexity", "tavily"],
  );
  assert.equal(resolveSearchRouting({ provider: "searxng" })[0], "searxng");
});

test("Tavily official Search API maps to existing result shape", async () => {
  const secret = "tvly-test-secret-value";
  const calls = [];
  const result = await executeWebSearch({
    query: "1920s Arkham weather",
    numResults: 3,
    env: { TAVILY_API_KEY: secret, WEB_SEARCH_ROUTING: "tavily" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        results: [
          {
            title: "Arkham Gazette",
            url: "https://example.test/arkham",
            content: "Fog over the Miskatonic.",
          },
        ],
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TAVILY_SEARCH_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.query, "1920s Arkham weather");
  assert.equal(body.max_results, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "api_key"), false);
  assert.equal(result.isError, false);
  assert.match(result.text, /Source: Tavily/);
  assert.match(result.text, /Arkham Gazette/);
  assert.match(result.text, /https:\/\/example.test\/arkham/);
  assert.equal(result.text.includes(secret), false);
  assert.equal(result.details.provider, "tavily");
});

test("Perplexity chat completions search API maps citations to results", async () => {
  const secret = "pplx-test-secret-value";
  const calls = [];
  const result = await executeWebSearch({
    query: "Innsmouth tide tables",
    env: { PERPLEXITY_API_KEY: secret, WEB_SEARCH_ROUTING: "perplexity" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        model: PERPLEXITY_SEARCH_MODEL,
        citations: ["https://example.test/tides"],
        search_results: [
          {
            title: "Harbor notes",
            url: "https://example.test/tides",
            snippet: "High tide at dusk.",
          },
        ],
        choices: [{ message: { content: "Tides run high at dusk." } }],
      });
    },
  });
  assert.equal(calls[0].url, PERPLEXITY_CHAT_URL);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, PERPLEXITY_SEARCH_MODEL);
  assert.deepEqual(body.messages, [{ role: "user", content: "Innsmouth tide tables" }]);
  assert.equal(result.isError, false);
  assert.match(result.text, /Source: Perplexity/);
  assert.match(result.text, /Harbor notes/);
  assert.equal(result.text.includes(secret), false);
  assert.equal(result.details.provider, "perplexity");
});

test("no key skips to next routing provider; HTTP failure falls back", async () => {
  const tavilySecret = "tvly-fallback-secret";
  const pplxSecret = "pplx-fallback-secret";
  const urls = [];
  const result = await executeWebSearch({
    query: "Kingsport lights",
    env: {
      TAVILY_API_KEY: tavilySecret,
      PERPLEXITY_API_KEY: pplxSecret,
      WEB_SEARCH_ROUTING: "exa,tavily,perplexity",
    },
    fetchImpl: async (url, init) => {
      urls.push(url);
      if (url === TAVILY_SEARCH_URL) {
        return jsonResponse(500, { error: `upstream boom ${tavilySecret}` });
      }
      if (url === PERPLEXITY_CHAT_URL) {
        return jsonResponse(200, {
          search_results: [
            { title: "Lights", url: "https://example.test/lights", snippet: "Pale glow." },
          ],
        });
      }
      throw new Error(`unexpected url ${url} ${init?.headers?.Authorization || ""}`);
    },
  });
  assert.deepEqual(urls, [TAVILY_SEARCH_URL, PERPLEXITY_CHAT_URL]);
  assert.equal(result.isError, false);
  assert.equal(result.details.provider, "perplexity");
  assert.match(result.text, /Source: Perplexity/);
  assert.equal(result.text.includes(tavilySecret), false);
  assert.equal(result.text.includes(pplxSecret), false);
});

test("HTTP failures across routing never leak keys", async () => {
  const secret = "exa-fail-secret-value";
  const result = await executeWebSearch({
    query: "fail",
    env: { EXA_API_KEY: secret, WEB_SEARCH_ROUTING: "exa" },
    fetchImpl: async () => jsonResponse(401, { error: `bad key ${secret}` }),
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /web_search failed:/);
  assert.equal(result.text.includes(secret), false);
  assert.match(result.text, /\[redacted\]/);
});

test("missing implemented keys returns configured-false without secrets", async () => {
  const result = await executeWebSearch({
    query: "no keys",
    env: { WEB_SEARCH_ROUTING: "tavily,perplexity" },
    config: { openaiApiKey: "sk-not-used-here" },
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  assert.equal(result.isError, true);
  assert.equal(result.text, MISSING_SEARCH_KEY_TEXT);
  assert.equal(result.details.configured, false);
  assert.equal(result.text.includes("sk-not-used-here"), false);
});

test("result mappers keep title/url/snippet", () => {
  assert.deepEqual(
    mapTavilySearchPayload({
      results: [{ title: "A", url: "https://a.test", content: "snip" }],
    }),
    [{ title: "A", url: "https://a.test", snippet: "snip" }],
  );
  assert.deepEqual(
    mapPerplexitySearchPayload({
      citations: ["https://b.test"],
      choices: [{ message: { content: "answer" } }],
    }),
    [{ title: "https://b.test", url: "https://b.test", snippet: "answer" }],
  );
});

test("redactSecrets never emits the token", () => {
  const secret = "super-secret-token";
  assert.equal(redactSecrets(`Authorization: Bearer ${secret}`, [secret]).includes(secret), false);
  assert.equal(EXA_SEARCH_URL.startsWith("https://api.exa.ai"), true);
});
