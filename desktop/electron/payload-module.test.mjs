import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePayloadModule, resolvePayloadRoot } from "./payload-module.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalogRel = path.join("web", "server-node", "pi-catalog.mjs");

describe("resolvePayloadRoot", () => {
  it("uses the repo when Electron resources have no payload", () => {
    assert.equal(resolvePayloadRoot({ resourcesPath: undefined }), repoRoot);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pk-res-"));
    assert.equal(resolvePayloadRoot({ resourcesPath: empty }), repoRoot);
  });

  it("prefers Resources/payload over a sibling Resources/web", () => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "pk-pack-"));
    const payload = path.join(resources, "payload", "web", "server-node");
    const sibling = path.join(resources, "web", "server-node");
    fs.mkdirSync(payload, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(payload, "pi-catalog.mjs"), "export const mark = 'payload';\n");
    fs.writeFileSync(path.join(sibling, "pi-catalog.mjs"), "export const mark = 'wrong';\n");
    assert.equal(resolvePayloadRoot({ resourcesPath: resources }), path.join(resources, "payload"));
    const href = resolvePayloadModule("web/server-node/pi-catalog.mjs", { resourcesPath: resources });
    assert.match(href, /\/payload\/web\/server-node\/pi-catalog\.mjs$/);
    assert.doesNotMatch(href, /\/Resources\/web\/server-node\//);
  });
});

describe("resolvePayloadModule", () => {
  it("loads the repo catalog in unpackaged / node tests", async () => {
    const href = resolvePayloadModule("web/server-node/pi-catalog.mjs");
    assert.equal(fileURLToPath(href), path.join(repoRoot, catalogRel));
    const mod = await import(href);
    assert.equal(typeof mod.listPiCatalogProviders, "function");
  });
});
