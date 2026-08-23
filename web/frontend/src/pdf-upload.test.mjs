import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildPdfIngestRequest,
  continueRegisteredPdfUpload,
  pdfOcrHintForError,
} from "./lib/pdf-upload-policy.ts";

const CANONICAL_BUNDLE = ".coc/source-bundles/coc-an-amaranthine-desire";
const FILE_SHA =
  "b0b3b1772fadddf168e8f4d32497b045e40a33744838fef221167b3385516c4e";
const HASH_BUNDLE =
  ".coc/source-bundles/b0b3b1772fadddf1-coc-an-amaranthine-desire";

function spyIngest() {
  const calls = [];
  return {
    calls,
    ingestPdf: async (req) => {
      calls.push(req);
      return {
        ok: true,
        result: {
          status: "matched_bundle",
          file_sha256: FILE_SHA,
          matched_bundle: {
            path: HASH_BUNDLE,
            title: "hash overwrite",
            bundle_id: "b0b3b1772fadddf1-coc-an-amaranthine-desire",
          },
        },
      };
    },
  };
}

test("matched_bundle reuses canonical path/title/hash and does not ingest", async () => {
  const { calls, ingestPdf } = spyIngest();
  const continued = await continueRegisteredPdfUpload(
    {
      status: "matched_bundle",
      file_sha256: FILE_SHA,
      stored_path:
        ".coc/uploads/pdfs/b0b3b1772fadddf1_COC_-An_Amaranthine_Desire.pdf",
      matched_bundle: {
        path: CANONICAL_BUNDLE,
        title: "An Amaranthine Desire",
        bundle_id: "coc-an-amaranthine-desire",
      },
    },
    ingestPdf,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(continued, {
    action: "reuse",
    bundlePath: CANONICAL_BUNDLE,
    titleHint: "An Amaranthine Desire",
    fileSha256: FILE_SHA,
  });

  const applySource = fs.readFileSync(
    new URL("./lib/pdfUpload.ts", import.meta.url),
    "utf8",
  );
  assert.match(applySource, /continueRegisteredPdfUpload\(result, api\.ingestPdf\)/);
  assert.doesNotMatch(
    applySource,
    /stored_pending_ingest" \|\| result\.status === "matched_bundle"/,
  );
});

test("stored_pending_ingest still calls ingest", async () => {
  const { calls, ingestPdf } = spyIngest();
  const stored_path = ".coc/uploads/pdfs/abc_Masks.pdf";
  const continued = await continueRegisteredPdfUpload(
    { status: "stored_pending_ingest", stored_path, file_sha256: FILE_SHA },
    ingestPdf,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { stored_path, file_sha256: FILE_SHA });
  assert.equal(continued.action, "ingest");
  assert.equal(continued.ingest.result.matched_bundle.path, HASH_BUNDLE);
});

test("matched_bundle without path fails closed and does not ingest or open",
  async () => {
    for (const result of [
      { status: "matched_bundle", file_sha256: FILE_SHA },
      { status: "matched_bundle", matched_bundle: null },
      { status: "matched_bundle", matched_bundle: { path: "   " } },
    ]) {
      const { calls, ingestPdf } = spyIngest();
      const continued = await continueRegisteredPdfUpload(result, ingestPdf);
      assert.equal(calls.length, 0);
      assert.equal(continued.action, "reject");
      assert.equal("bundlePath" in continued, false);
      assert.equal(continued.bundlePath, undefined);
      assert.match(continued.message, /缺少有效路径/);
    }
  },
);

test("PDF ingest continues from the exact stored path returned by upload", () => {
  assert.deepEqual(
    buildPdfIngestRequest({
      stored_path: "/workspace/.coc/uploads/pdfs/abc_Masks.pdf",
      file_sha256: "a".repeat(64),
    }),
    {
      stored_path: "/workspace/.coc/uploads/pdfs/abc_Masks.pdf",
      file_sha256: "a".repeat(64),
    },
  );
});

test("generic parser failures are not mislabeled as scanned PDFs", () => {
  assert.equal(
    pdfOcrHintForError(
      "外部解析路由器无法完成本 PDF（status=error, reason=invalid_request_or_runtime_error）",
    ),
    "",
  );
  assert.match(
    pdfOcrHintForError(
      "外部解析路由器无法完成本 PDF：请求窗口内全部页面都需要 OCR。",
    ),
    /扫描版或图片页/,
  );
});

test("PDF campaign setup exposes absolute-path import through the shared ingest flow", () => {
  const source = fs.readFileSync(
    new URL("./components/NewCampaignFlow.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /PDF 绝对路径/);
  assert.match(source, /uploadAndIngestPdfFromPath\(pdfPath\.trim\(\), setUploadMsg\)/);
  assert.match(source, /onSubmit=\{[^}]*handlePdfPath/s);
});

test("guided welcome owns PDF upload; campaign flow keeps picker + absolute path", () => {
  const guided = fs.readFileSync(
    new URL("./components/GuidedStart.tsx", import.meta.url),
    "utf8",
  );
  const flow = fs.readFileSync(
    new URL("./components/NewCampaignFlow.tsx", import.meta.url),
    "utf8",
  );

  // Welcome page: button + whole-page drop through the shared PDF gate.
  assert.match(guided, /上传 PDF 模组/);
  assert.match(guided, /isWaitingPdfFile/);
  assert.match(guided, /松开以导入模组 PDF/);
  // Campaign flow: standalone dropzone removed, picker and path kept.
  assert.doesNotMatch(flow, /拖拽 PDF 到此处/);
  assert.doesNotMatch(flow, /setDragOver/);
  assert.match(flow, /选择文件/);
  assert.match(flow, /PDF 绝对路径/);
});
