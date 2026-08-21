import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile } from "../projections.mjs";
import {
  derivePdfIngestStatus,
  pdfWindowBundleId,
  pdfWindowIndices,
  readManifestFacts,
} from "../ingest-status.mjs";

test("long PDF windows cover every page without overlap", () => {
  assert.deepEqual(pdfWindowIndices(669, 1), Array.from({ length: 32 }, (_, i) => i));
  assert.deepEqual(pdfWindowIndices(669, 2), Array.from({ length: 32 }, (_, i) => 32 + i));
  assert.deepEqual(pdfWindowIndices(669, 3), Array.from({ length: 32 }, (_, i) => 64 + i));
  assert.deepEqual(pdfWindowIndices(669, 21), Array.from({ length: 29 }, (_, i) => 640 + i));
  assert.deepEqual(pdfWindowIndices(669, 22), []);
  assert.equal(pdfWindowBundleId("masks", 2), "masks-w2");
  assert.equal(pdfWindowBundleId("masks", 21), "masks-w21");
});

const SHA = "a".repeat(64);

function first(over = {}) {
  return {
    bundle_id: "my-module",
    page_count: 20,
    rendered_pdf_indices: [0, 1, 2],
    valid: true,
    ...over,
  };
}

test("window1_in_progress when ingest lock is held", () => {
  const status = derivePdfIngestStatus({
    locked: true,
    firstWindow: first({ valid: false, page_count: null }),
    w2: { dir_exists: false, manifest_valid: false },
  });
  assert.equal(status.phase, "window1_in_progress");
  assert.equal(status.bundle_id, "my-module");
});

test("ready when first window is valid and page_count <= 32", () => {
  const status = derivePdfIngestStatus({
    locked: false,
    firstWindow: first(),
    w2: { dir_exists: false, manifest_valid: false },
  });
  assert.equal(status.phase, "ready");
  assert.equal(status.page_count, 20);
  assert.deepEqual(status.rendered_pdf_indices, [0, 1, 2]);
  assert.equal(status.background_pdf_indices, null);
});

test("background_in_progress when page_count > 32 and w2 manifest missing", () => {
  const status = derivePdfIngestStatus({
    locked: false,
    firstWindow: first({ page_count: 50, rendered_pdf_indices: Array.from({ length: 32 }, (_, i) => i) }),
    w2: { dir_exists: false, manifest_valid: false, bundle_id: "my-module-w2" },
  });
  assert.equal(status.phase, "background_in_progress");
  assert.equal(status.bundle_id, "my-module-w2");
  assert.deepEqual(
    status.background_pdf_indices,
    Array.from({ length: 18 }, (_, i) => 32 + i),
  );
});

test("background_in_progress when w2 dir exists without a valid manifest", () => {
  const status = derivePdfIngestStatus({
    locked: false,
    firstWindow: first({ page_count: 40 }),
    w2: { dir_exists: true, manifest_valid: false, bundle_id: "my-module-w2" },
  });
  assert.equal(status.phase, "background_in_progress");
});

test("background_complete when w2 manifest is valid", () => {
  const bg = Array.from({ length: 8 }, (_, i) => 32 + i);
  const status = derivePdfIngestStatus({
    locked: false,
    firstWindow: first({ page_count: 40 }),
    w2: {
      dir_exists: true,
      manifest_valid: true,
      pdf_indices: bg,
      bundle_id: "my-module-w2",
    },
  });
  assert.equal(status.phase, "background_complete");
  assert.deepEqual(status.background_pdf_indices, bg);
  assert.equal(status.bundle_id, "my-module-w2");
});

test("unknown when nothing is locked or validated", () => {
  const status = derivePdfIngestStatus({
    locked: false,
    firstWindow: { bundle_id: null, valid: false, page_count: null },
    w2: { dir_exists: false, manifest_valid: false },
  });
  assert.equal(status.phase, "unknown");
  assert.equal(status.page_count, null);
  assert.equal(status.rendered_pdf_indices, null);
  assert.equal(status.background_pdf_indices, null);
});

test("lock wins over an existing complete w2", () => {
  const status = derivePdfIngestStatus({
    locked: true,
    firstWindow: first({ page_count: 40 }),
    w2: { dir_exists: true, manifest_valid: true, bundle_id: "my-module-w2" },
  });
  assert.equal(status.phase, "window1_in_progress");
});

test("readManifestFacts: temp dir without manifest is invalid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-ingest-w2-"));
  const facts = readManifestFacts(dir, fs, readJsonFile);
  assert.equal(facts.dir_exists, true);
  assert.equal(facts.manifest_valid, false);
  assert.equal(facts.pdf_indices, null);
});

test("readManifestFacts: temp dir with page_count manifest is valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-ingest-w2-ok-"));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      source: { page_count: 40, file_sha256: SHA },
      pages: [{ pdf_index: 32 }, { pdf_index: 33 }],
    }),
  );
  const facts = readManifestFacts(dir, fs, readJsonFile);
  assert.equal(facts.manifest_valid, true);
  assert.equal(facts.page_count, 40);
  assert.deepEqual(facts.pdf_indices, [32, 33]);
  const derived = derivePdfIngestStatus({
    locked: false,
    firstWindow: first({ page_count: 40, valid: true }),
    w2: {
      dir_exists: facts.dir_exists,
      manifest_valid: facts.manifest_valid,
      pdf_indices: facts.pdf_indices,
      bundle_id: "tmp-w2",
    },
  });
  assert.equal(derived.phase, "background_complete");
});
