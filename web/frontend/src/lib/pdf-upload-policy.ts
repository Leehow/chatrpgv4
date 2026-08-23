export type PdfUploadLocator = {
  stored_path?: string;
  file_sha256?: string;
};

export type PdfUploadApplyResult = {
  status?: string;
  file_sha256?: string | null;
  matched_bundle?: {
    path?: string | null;
    title?: string | null;
    bundle_id?: string | null;
  } | null;
};

export type MatchedBundleReuse =
  | {
      action: "reuse";
      bundlePath: string;
      titleHint: string | null;
      fileSha256: string | null;
    }
  | { action: "reject"; message: string };

const MATCHED_BUNDLE_MISSING_PATH =
  "已匹配到源包但缺少有效路径，已停止以免重新解析产生新身份。";

/** A verified matched bundle must be reused as-is. Missing path is fail-closed:
 *  never fall back to ingest, which would mint a new source identity. */
export function describeMatchedBundleReuse(
  result: PdfUploadApplyResult,
): MatchedBundleReuse | null {
  if (result.status !== "matched_bundle") return null;
  const bundlePath = String(result.matched_bundle?.path ?? "").trim();
  if (!bundlePath) {
    return { action: "reject", message: MATCHED_BUNDLE_MISSING_PATH };
  }
  const title =
    result.matched_bundle?.title || result.matched_bundle?.bundle_id || null;
  return {
    action: "reuse",
    bundlePath,
    titleHint: title ? String(title) : null,
    fileSha256: result.file_sha256 || null,
  };
}

/** Only a newly stored PDF continues into ingest. matched_bundle never does. */
export function shouldIngestUploadedPdf(status: string | undefined): boolean {
  return status === "stored_pending_ingest";
}

export type PdfUploadContinuation<TIngest = unknown> =
  | MatchedBundleReuse
  | { action: "ingest"; ingest: TIngest }
  | { action: "passthrough" };

/** Gate used by applyPdfUploadResult: reuse/reject a matched bundle without
 *  calling ingestPdf; only stored_pending_ingest invokes the injected ingest. */
export async function continueRegisteredPdfUpload<TIngest>(
  result: PdfUploadApplyResult & PdfUploadLocator,
  ingestPdf: (req: PdfUploadLocator) => Promise<TIngest>,
): Promise<PdfUploadContinuation<TIngest>> {
  const reuse = describeMatchedBundleReuse(result);
  if (reuse) return reuse;
  if (shouldIngestUploadedPdf(result.status)) {
    return { action: "ingest", ingest: await ingestPdf(buildPdfIngestRequest(result)) };
  }
  return { action: "passthrough" };
}

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
