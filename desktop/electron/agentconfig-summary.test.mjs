import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { providerSummary } from "./agentconfig.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-agent-summary-"));
}

describe("providerSummary", () => {
  it("lists models.json providers even without auth", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "models.json"),
      JSON.stringify({
        providers: {
          "coding-relay": {
            name: "Local Coding Relay",
            models: [{ id: "gpt-5.6", name: "gpt-5.6" }],
          },
        },
      }),
    );
    fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({}));
    const list = providerSummary(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "coding-relay");
    assert.equal(list[0].hasAuth, false);
    assert.deepEqual(list[0].models.map((m) => m.id), ["gpt-5.6"]);
    assert.ok(!JSON.stringify(list).includes("key"));
  });

  it("includes oauth-only auth.json providers missing from models.json", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "models.json"),
      JSON.stringify({
        providers: {
          "coding-relay": {
            name: "Local Coding Relay",
            models: [{ id: "gpt-5.6", name: "gpt-5.6" }],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "auth.json"),
      JSON.stringify({
        xai: { type: "oauth", access: "SECRET-MUST-NOT-LEAK" },
      }),
    );
    const list = providerSummary(dir);
    const ids = list.map((p) => p.id);
    assert.ok(ids.includes("coding-relay"));
    assert.ok(ids.includes("xai"));
    const xai = list.find((p) => p.id === "xai");
    assert.equal(xai.hasAuth, true);
    assert.equal(xai.name, "xAI Grok");
    assert.deepEqual(xai.models, []);
    const dumped = JSON.stringify(list);
    assert.ok(!dumped.includes("SECRET"));
    assert.ok(!dumped.includes("access"));
  });
});
