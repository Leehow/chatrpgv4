import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  campaignsBoundToSourceBundle,
  deleteSourceBundle,
  resolveSourceBundleDir,
} from "../source-bundles.mjs";

const SERVER_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.mjs"),
  "utf8",
);
const API_SRC = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/api.ts"),
  "utf8",
);

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coc-source-bundle-del-"));
}

function writeBundle(workspace, bundleId) {
  const dir = path.join(workspace, ".coc", "source-bundles", bundleId);
  fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      source: {
        path: `/tmp/${bundleId}.pdf`,
        page_count: 3,
        file_sha256: "a".repeat(64),
      },
      pages: [{ pdf_index: 0 }],
    }),
  );
  fs.writeFileSync(path.join(dir, "pages", "0.md"), "# page\n");
  return dir;
}

function writeBoundCampaign(workspace, campaignId, bundleDir) {
  const scenarioDir = path.join(
    workspace,
    ".coc",
    "campaigns",
    campaignId,
    "scenario",
  );
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(
    path.join(scenarioDir, "scenario.json"),
    JSON.stringify({
      scenario_id: campaignId,
      source: { source_bundle_path: bundleDir },
    }),
  );
  return path.join(workspace, ".coc", "campaigns", campaignId);
}

test("server.mjs and api.ts wire DELETE /api/source-bundles/:id", () => {
  assert.match(SERVER_SRC, /from "\.\/source-bundles\.mjs"/);
  assert.match(SERVER_SRC, /method === "DELETE"/);
  assert.match(SERVER_SRC, /parts\[1] === "source-bundles"/);
  assert.match(SERVER_SRC, /handleDeleteSourceBundle/);
  assert.match(API_SRC, /deleteSourceBundle/);
  assert.match(API_SRC, /\/api\/source-bundles\/\$\{encodeURIComponent\(bundleId\)}/);
  assert.match(API_SRC, /method: "DELETE"/);
});

test("deletes only the named bundle dir and leaves siblings", () => {
  const ws = tempWorkspace();
  try {
    const keep = writeBundle(ws, "keep-me");
    const gone = writeBundle(ws, "drop-me");
    const result = deleteSourceBundle(ws, "drop-me");
    assert.deepEqual(result, { ok: true, bundle_id: "drop-me" });
    assert.equal(fs.existsSync(gone), false);
    assert.equal(fs.existsSync(path.join(keep, "manifest.json")), true);
    assert.equal(fs.existsSync(path.join(keep, "pages", "0.md")), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("404 unknown id", () => {
  const ws = tempWorkspace();
  try {
    writeBundle(ws, "keep-me");
    try {
      deleteSourceBundle(ws, "no-such-bundle");
      assert.fail("expected 404");
    } catch (err) {
      assert.equal(err.status, 404);
      assert.match(String(err.message), /找不到该解析结果/);
    }
    assert.equal(
      fs.existsSync(path.join(ws, ".coc", "source-bundles", "keep-me", "manifest.json")),
      true,
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("rejects traversal and absolute paths", () => {
  const ws = tempWorkspace();
  try {
    const keep = writeBundle(ws, "keep-me");
    const outside = path.join(ws, "outside-secret");
    fs.writeFileSync(outside, "do-not-delete");
    const attacks = [
      "../outside-secret",
      "..",
      "keep-me/../keep-me",
      "keep-me/pages",
      "/tmp",
      path.join(ws, ".coc", "source-bundles", "keep-me"),
      "keep-me\\..\\keep-me",
    ];
    for (const id of attacks) {
      try {
        deleteSourceBundle(ws, id);
        assert.fail(`expected reject for ${id}`);
      } catch (err) {
        assert.equal(err.status, 400, String(id));
        assert.match(String(err.message), /非法源包编号/);
      }
      try {
        resolveSourceBundleDir(ws, id);
        assert.fail(`expected resolve reject for ${id}`);
      } catch (err) {
        assert.equal(err.status, 400, String(id));
      }
    }
    assert.equal(fs.existsSync(keep), true);
    assert.equal(fs.readFileSync(outside, "utf8"), "do-not-delete");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("bound campaign fails closed with 409 and is not mutated", () => {
  const ws = tempWorkspace();
  try {
    const bundleDir = writeBundle(ws, "bound-mod");
    const sibling = writeBundle(ws, "free-mod");
    const campaignDir = writeBoundCampaign(ws, "live-campaign-1", bundleDir);
    const before = fs.readFileSync(
      path.join(campaignDir, "scenario", "scenario.json"),
      "utf8",
    );
    assert.deepEqual(campaignsBoundToSourceBundle(ws, "bound-mod"), ["live-campaign-1"]);
    try {
      deleteSourceBundle(ws, "bound-mod");
      assert.fail("expected 409");
    } catch (err) {
      assert.equal(err.status, 409);
      assert.match(String(err.message), /仍被战役「live-campaign-1」绑定/);
    }
    assert.equal(fs.existsSync(path.join(bundleDir, "manifest.json")), true);
    assert.equal(
      fs.readFileSync(path.join(campaignDir, "scenario", "scenario.json"), "utf8"),
      before,
    );
    const freed = deleteSourceBundle(ws, "free-mod");
    assert.equal(freed.ok, true);
    assert.equal(fs.existsSync(sibling), false);
    assert.equal(fs.existsSync(campaignDir), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
