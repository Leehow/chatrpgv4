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
