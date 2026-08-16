import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchRemoteModels } from "./agentconfig.mjs";

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

describe("fetchRemoteModels", () => {
  it("requests {base}/models with a bearer key and parses data[].id", async () => {
    const calls = [];
    const result = await fetchRemoteModels({
      baseUrl: "https://api.example.com/",
      apiKey: "sk-test",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          object: "list",
          data: [
            { id: "model-a", object: "model" },
            { id: "model-b", object: "model" },
          ],
        });
      },
    });
    assert.deepEqual(result, { ok: true, models: ["model-a", "model-b"] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.com/models");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  });

  it("parses {models: [...]}, string entries, trims and dedupes", async () => {
    const result = await fetchRemoteModels({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ models: [" a ", "a", { id: "b" }, { id: "" }, null] }),
    });
    assert.deepEqual(result, { ok: true, models: ["a", "b"] });
  });

  it("surfaces HTTP status with a key hint and never echoes the key", async () => {
    const result = await fetchRemoteModels({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-secret",
      fetchImpl: async () => jsonResponse({ error: "bad key" }, 401),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /HTTP 401/);
    assert.match(result.error, /API Key/);
    assert.ok(!result.error.includes("sk-secret"));
  });

  it("returns a connection error when fetch rejects", async () => {
    const result = await fetchRemoteModels({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /无法连接到服务/);
  });

  it("rejects invalid input before issuing any request", async () => {
    for (const input of [
      { baseUrl: "ftp://example.com", apiKey: "k" },
      { baseUrl: "https://example.com", apiKey: " " },
    ]) {
      const result = await fetchRemoteModels({
        ...input,
        fetchImpl: async () => {
          throw new Error("must not be called");
        },
      });
      assert.equal(result.ok, false, JSON.stringify(input));
    }
  });

  it("errors on responses without a usable model list", async () => {
    const result = await fetchRemoteModels({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      fetchImpl: async () => jsonResponse({ object: "list", data: [] }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /未返回任何模型/);
  });
});
