import * as api from "../api";
import type { PdfIngestStatus } from "../api";
import type { PdfUploadResult } from "../types";
import {
  continueRegisteredPdfUpload,
  pdfOcrHintForError,
  shouldIngestUploadedPdf,
} from "./pdf-upload-policy";

export type PdfIngestApply = {
  info: PdfUploadResult;
  message: string;
  bundlePath: string | null;
  titleHint: string | null;
  fileSha256: string | null;
  backgroundStarted: boolean;
};

function titleFromResult(result: PdfUploadResult): string | null {
  const bundle = result.matched_bundle;
  if (!bundle) return null;
  return bundle.title || bundle.bundle_id || null;
}

/** Shared upload → optional ingest continuation used by NewCampaignFlow and
 *  the waiting-screen drop zone. Surfaces the same messages as the PDF 开局 step. */
export async function applyPdfUploadResult(
  result: PdfUploadResult,
  onProgress?: (message: string) => void,
): Promise<PdfIngestApply> {
  let message = result.message ?? "上传完成";
  let info = result;
  onProgress?.(message);
  if (shouldIngestUploadedPdf(result.status)) {
    message = "正在快速解析…";
    onProgress?.(message);
  }

  let continued;
  try {
    continued = await continueRegisteredPdfUpload(result, api.ingestPdf);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const ocrHint = pdfOcrHintForError(raw);
    message = `解析失败：${raw}${ocrHint ? `；${ocrHint}` : ""}`;
    onProgress?.(message);
    return {
      info: result,
      message,
      bundlePath: null,
      titleHint: null,
      fileSha256: result.file_sha256 || null,
      backgroundStarted: false,
    };
  }

  if (continued.action === "reject") {
    onProgress?.(continued.message);
    return {
      info: result,
      message: continued.message,
      bundlePath: null,
      titleHint: null,
      fileSha256: result.file_sha256 || null,
      backgroundStarted: false,
    };
  }
  if (continued.action === "reuse") {
    return {
      info,
      message,
      bundlePath: continued.bundlePath,
      titleHint: continued.titleHint,
      fileSha256: continued.fileSha256 || result.file_sha256 || null,
      backgroundStarted: false,
    };
  }

  if (continued.action === "ingest") {
    try {
      const ingestResult = continued.ingest.result;
      message =
        ingestResult.message ??
        (ingestResult.status === "matched_bundle" ? "解析完成，可以开局" : "解析中");
      if (ingestResult.matched_bundle) {
        info = {
          ...result,
          status: ingestResult.status,
          matched_bundle: ingestResult.matched_bundle,
          message,
        };
      }
      onProgress?.(message);
      return {
        info,
        message,
        bundlePath: info.matched_bundle?.path ?? null,
        titleHint: titleFromResult(info),
        fileSha256: ingestResult.file_sha256 || result.file_sha256 || null,
        backgroundStarted: ingestResult.background_window?.status === "started",
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const ocrHint = pdfOcrHintForError(raw);
      message = `解析失败：${raw}${ocrHint ? `；${ocrHint}` : ""}`;
      onProgress?.(message);
      return {
        info: result,
        message,
        bundlePath: null,
        titleHint: null,
        fileSha256: result.file_sha256 || null,
        backgroundStarted: false,
      };
    }
  }

  return {
    info,
    message,
    bundlePath: info.matched_bundle?.path ?? null,
    titleHint: titleFromResult(info),
    fileSha256: info.file_sha256 || result.file_sha256 || null,
    backgroundStarted: false,
  };
}

const POLL_MS = 5_000;
const POLL_MAX_MS = 10 * 60 * 1000;

/** Poll ingest-status while a background window is running. Stops when the
 *  tab is hidden, after maxMs, or on a terminal phase. Failures stay silent. */
export function watchPdfIngestStatus(
  fileSha256: string,
  onStatus: (status: PdfIngestStatus | null) => void,
  opts?: { intervalMs?: number; maxMs?: number },
): () => void {
  const intervalMs = opts?.intervalMs ?? POLL_MS;
  const maxMs = opts?.maxMs ?? POLL_MAX_MS;
  const started = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tick = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.hidden) {
      timer = setTimeout(() => void tick(), intervalMs);
      return;
    }
    if (Date.now() - started > maxMs) {
      stopped = true;
      return;
    }
    const status = await api.fetchPdfIngestStatus(fileSha256);
    if (stopped) return;
    if (status) onStatus(status);
    const done =
      status?.phase === "background_complete" ||
      status?.phase === "ready" ||
      status?.phase === "unknown";
    if (done) {
      stopped = true;
      return;
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };

  const onVis = () => {
    if (stopped) return;
    if (typeof document !== "undefined" && !document.hidden) void tick();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }
  void tick();

  return () => {
    stopped = true;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}

export async function uploadAndIngestPdfFile(
  file: File,
  onProgress?: (message: string) => void,
): Promise<PdfIngestApply> {
  const resp = await api.uploadPdf(file);
  return applyPdfUploadResult(resp.result, onProgress);
}

export async function uploadAndIngestPdfFromPath(
  path: string,
  onProgress?: (message: string) => void,
): Promise<PdfIngestApply> {
  const resp = await api.uploadPdfFromPath(path);
  return applyPdfUploadResult(resp.result, onProgress);
}
