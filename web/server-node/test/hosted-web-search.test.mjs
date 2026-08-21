import test from "node:test";
import assert from "node:assert/strict";

import {
  HOSTED_WEB_SEARCH_TIP_HEADING,
  OPENAI_HOSTED_SEARCH_FAMILIES,
  XAI_HOSTED_SEARCH_FAMILIES,
  applyHostedWebSearch,
  applyHostedWebSearchSystemTip,
  hostedWebSearchFamily,
} from "../pi-extensions/hosted-web-search.mjs";

function clientTools() {
  return [
    { type: "function", name: "bash", parameters: { type: "object" } },
    { type: "function", name: "web_search", parameters: { type: "object" } },
    { type: "function", name: "read", parameters: { type: "object" } },
  ];
}

function responsesPayload(overrides = {}) {
  return {
    model: "test-model",
    input: [{ role: "user", content: "1920s Arkham newspapers" }],
    tools: clientTools(),
    ...overrides,
  };
}

function toolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return "";
    if (typeof tool.name === "string") return tool.name;
    if (tool.function && typeof tool.function === "object" && typeof tool.function.name === "string") {
      return tool.function.name;
    }
    return typeof tool.type === "string" ? tool.type : "";
  });
}

test("openai-codex responses injects hosted web_search and drops the client tool", () => {
  const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" };
  assert.equal(hostedWebSearchFamily(model), "openai-codex");
  const payload = responsesPayload();
  const result = applyHostedWebSearch(model, payload);
  assert.ok(result);
  assert.notEqual(result, payload);
  assert.deepEqual(toolNames(result.tools), ["bash", "read", "web_search"]);
  assert.deepEqual(
    result.tools.filter((tool) => tool && tool.type === "web_search"),
    [{ type: "web_search" }],
  );
  assert.equal(
    result.tools.some((tool) => tool && tool.type === "function" && tool.name === "web_search"),
    false,
  );
  assert.equal(
    payload.tools.some((tool) => tool.name === "web_search"),
    true,
  );
});

test("openai responses injects hosted web_search", () => {
  const result = applyHostedWebSearch(
    { provider: "OpenAI", api: "openai-responses", id: "gpt-4.1" },
    responsesPayload(),
  );
  assert.ok(result);
  assert.deepEqual(toolNames(result.tools), ["bash", "read", "web_search"]);
  assert.equal(result.tools.at(-1).type, "web_search");
});

test("xai responses injects hosted web_search and drops the client tool", () => {
  const model = { provider: "xai", api: "openai-responses", id: "grok-4.6" };
  assert.equal(hostedWebSearchFamily(model), "xai");
  const result = applyHostedWebSearch(model, responsesPayload({
    tools: [
      { type: "function", name: "bash" },
      { type: "function", function: { name: "web_search" } },
      { type: "web_search" },
    ],
  }));
  assert.ok(result);
  assert.deepEqual(toolNames(result.tools), ["bash", "web_search"]);
  assert.deepEqual(
    result.tools.filter((tool) => tool && tool.type === "web_search"),
    [{ type: "web_search" }],
  );
});

test("xai completions drops client web_search without injecting hosted tools", () => {
  const result = applyHostedWebSearch(
    { provider: "xai", api: "openai-completions", id: "grok-4.6" },
    {
      model: "grok-4.6",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "bash" } },
        { type: "function", function: { name: "web_search" } },
      ],
    },
  );
  assert.ok(result);
  assert.deepEqual(toolNames(result.tools), ["bash"]);
  assert.equal(result.tools.some((tool) => tool && tool.type === "web_search"), false);
});

test("deepseek and custom OpenAI-compatible providers do not inject", () => {
  const payload = responsesPayload();
  const cases = [
    { provider: "deepseek", api: "openai-completions", id: "deepseek-chat" },
    { provider: "openai-compatible", api: "openai-responses", id: "gpt-4o" },
    { provider: "my-openai-codex-proxy", api: "openai-codex-responses", id: "gpt-5.4" },
    { provider: "openai-codex-compatible", api: "openai-codex-responses", id: "codex" },
    { provider: "openai", api: "openai-completions", id: "gpt-4.1" },
    { provider: "custom", api: "openai-completions", id: "local-model" },
  ];
  for (const model of cases) {
    assert.equal(hostedWebSearchFamily(model), null, JSON.stringify(model));
    assert.equal(applyHostedWebSearch(model, payload), null, JSON.stringify(model));
    assert.equal(
      applyHostedWebSearchSystemTip(model, "You are the Keeper."),
      null,
      JSON.stringify(model),
    );
  }
  assert.equal(payload.tools.length, 3);
});

test("openai family filter does not apply xai payloads", () => {
  const result = applyHostedWebSearch(
    { provider: "xai", api: "openai-responses", id: "grok-4.6" },
    responsesPayload(),
    OPENAI_HOSTED_SEARCH_FAMILIES,
  );
  assert.equal(result, null);
});

test("xai family filter does not apply openai-codex payloads", () => {
  const result = applyHostedWebSearch(
    { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" },
    responsesPayload(),
    XAI_HOSTED_SEARCH_FAMILIES,
  );
  assert.equal(result, null);
});

test("system tip prefers native search and is idempotent", () => {
  const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" };
  const first = applyHostedWebSearchSystemTip(model, "You are the Keeper.");
  assert.ok(first?.systemPrompt.includes(HOSTED_WEB_SEARCH_TIP_HEADING));
  assert.match(first.systemPrompt, /优先使用模型原生搜索/);
  assert.match(first.systemPrompt, /其次才用客户端 web_search/);
  assert.match(first.systemPrompt, /禁止用 bash\/curl 搜网/);
  const second = applyHostedWebSearchSystemTip(model, first.systemPrompt);
  assert.equal(second, null);
});
