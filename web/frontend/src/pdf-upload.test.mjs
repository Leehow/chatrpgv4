import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildPdfIngestRequest,
  pdfOcrHintForError,
} from "./lib/pdf-upload-policy.ts";

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
