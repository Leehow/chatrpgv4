/**
 * Discrete PDF ingest phases for GET /api/uploads/pdf/ingest-status.
 * No progress percentages — only lock + first-window + w2-manifest facts.
 */

export const INGEST_WINDOW_MAX = 32;

export const INGEST_STATUS_PHASES = [
  "window1_in_progress",
  "ready",
  "background_in_progress",
  "background_complete",
  "unknown",
];

function indicesFromManifest(manifest) {
  const pages = manifest?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const out = [];
  for (const page of pages) {
    const idx = page?.pdf_index;
    if (Number.isInteger(idx) && idx >= 0) out.push(idx);
  }
  return out.length ? [...new Set(out)].sort((a, b) => a - b) : null;
}

function expectedBackgroundIndices(pageCount) {
  if (typeof pageCount !== "number" || pageCount <= INGEST_WINDOW_MAX) return null;
  const end = Math.min(pageCount, INGEST_WINDOW_MAX * 2);
  return Array.from({ length: end - INGEST_WINDOW_MAX }, (_, i) => INGEST_WINDOW_MAX + i);
}

/**
 * Pure phase derivation. Callers supply already-read facts so tests never
 * spawn the inspector or uv validation.
 *
 * @param {{
 *   locked?: boolean,
 *   firstWindow?: {
 *     bundle_id?: string | null,
 *     page_count?: number | null,
 *     rendered_pdf_indices?: number[] | null,
 *     valid?: boolean,
 *   } | null,
 *   w2?: {
 *     dir_exists?: boolean,
 *     manifest_valid?: boolean,
 *     pdf_indices?: number[] | null,
 *     bundle_id?: string | null,
 *   } | null,
 * }} facts
 */
export function derivePdfIngestStatus(facts = {}) {
  const locked = Boolean(facts.locked);
  const first = facts.firstWindow && typeof facts.firstWindow === "object" ? facts.firstWindow : null;
  const w2 = facts.w2 && typeof facts.w2 === "object" ? facts.w2 : null;
  const firstValid = Boolean(first?.valid);
  const pageCount =
    typeof first?.page_count === "number" && first.page_count > 0 ? first.page_count : null;
  const needsBackground = pageCount !== null && pageCount > INGEST_WINDOW_MAX;
  const w2Valid = Boolean(w2?.manifest_valid);
  const w2Dir = Boolean(w2?.dir_exists);

  let phase = "unknown";
  if (locked) {
    phase = "window1_in_progress";
  } else if (w2Valid) {
    phase = "background_complete";
  } else if (w2Dir || (firstValid && needsBackground && !w2Valid)) {
    phase = "background_in_progress";
  } else if (firstValid && !needsBackground) {
    phase = "ready";
  }

  const rendered =
    Array.isArray(first?.rendered_pdf_indices) && first.rendered_pdf_indices.length
      ? first.rendered_pdf_indices
      : null;
  let backgroundIndices = null;
  if (Array.isArray(w2?.pdf_indices) && w2.pdf_indices.length) {
    backgroundIndices = w2.pdf_indices;
  } else if (phase === "background_in_progress" || phase === "background_complete") {
    backgroundIndices = expectedBackgroundIndices(pageCount);
  }

  const bundleId =
    (phase === "background_complete" || phase === "background_in_progress"
      ? w2?.bundle_id || (first?.bundle_id ? `${first.bundle_id}-w2` : null)
      : first?.bundle_id) || first?.bundle_id || w2?.bundle_id || null;

  return {
    phase,
    bundle_id: bundleId,
    page_count: pageCount,
    rendered_pdf_indices: rendered,
    background_pdf_indices: backgroundIndices,
  };
}

export function readManifestFacts(bundleDir, fsApi, readJson) {
  const manifestPath = `${bundleDir.replace(/[/\\]+$/, "")}/manifest.json`;
  let dirExists = false;
  try {
    dirExists = fsApi.existsSync(bundleDir) && fsApi.statSync(bundleDir).isDirectory();
  } catch {
    dirExists = false;
  }
  if (!dirExists) {
    return { dir_exists: false, manifest_valid: false, pdf_indices: null, page_count: null };
  }
  const manifest = readJson(manifestPath);
  const pageCount = manifest?.source?.page_count;
  const valid =
    Boolean(manifest) &&
    typeof pageCount === "number" &&
    pageCount > 0;
  return {
    dir_exists: true,
    manifest_valid: valid,
    pdf_indices: indicesFromManifest(manifest),
    page_count: typeof pageCount === "number" && pageCount > 0 ? pageCount : null,
  };
}
