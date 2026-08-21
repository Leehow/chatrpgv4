export type PdfUploadLocator = {
  stored_path?: string;
  file_sha256?: string;
};

/** Continue ingest from the exact file registered by this upload. The hash is
 * retained as identity evidence, but must not be used to rediscover a stale
 * duplicate path when the upload already returned its canonical path. */
export function buildPdfIngestRequest(result: PdfUploadLocator): PdfUploadLocator {
  const storedPath = String(result.stored_path ?? "").trim();
  const fileSha256 = String(result.file_sha256 ?? "").trim();
  return {
    ...(storedPath ? { stored_path: storedPath } : {}),
    ...(fileSha256 ? { file_sha256: fileSha256 } : {}),
  };
}

/** OCR guidance is appropriate only for an explicit OCR classification, not
 * for generic router/runtime failures whose surrounding prose mentions OCR. */
export function pdfOcrHintForError(raw: string): string {
  return /reason=needs_ocr|全部页面都需要\s*OCR|需\s*OCR\s*页/i.test(raw)
    ? "扫描版或图片页需要外部 OCR 能力，当前窗口无法直接解析。"
    : "";
}
