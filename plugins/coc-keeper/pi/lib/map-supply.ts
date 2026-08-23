import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";

export type JsonObject = Record<string, unknown>;
export type MapImageRef = {
  id: string;
  page_ref: string;
  image_ref: string;
  media_type: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MEDIA_BY_EXTENSION: Record<string, MapImageRef["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function isBelow(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

export function detectMapSupplyPages(
  pages: ReadonlyArray<{ pdf_index: number }>,
  candidatePdfIndices: readonly number[] = [],
  needsOcr: readonly number[] = [],
): { needs_image: number[]; needs_ocr_or_image: number[]; reasons: Record<number, string[]> } {
  const available = new Set(
    pages
      .map((page) => page.pdf_index)
      .filter((pdfIndex) => Number.isInteger(pdfIndex) && pdfIndex >= 0),
  );
  const image = new Set<number>();
  const reasons: Record<number, string[]> = {};
  for (const pdfIndex of candidatePdfIndices) {
    if (!Number.isInteger(pdfIndex) || pdfIndex < 0) {
      throw new Error("candidate_pdf_indices must contain non-negative integers");
    }
    if (!available.has(pdfIndex)) {
      throw new Error(`candidate_pdf_indices references unavailable cached page ${pdfIndex}`);
    }
    image.add(pdfIndex);
    reasons[pdfIndex] = ["structured_candidate_ref"];
  }
  return {
    needs_image: [...image].sort((left, right) => left - right),
    needs_ocr_or_image: [...new Set([...needsOcr, ...image])].sort((left, right) => left - right),
    reasons,
  };
}

export async function detectMapSupplyPageDirectory(
  pagesDir: string,
  candidatePdfIndices: readonly number[] = [],
  needsOcr: readonly number[] = [],
): Promise<{ needs_image: number[]; needs_ocr_or_image: number[]; reasons: Record<number, string[]> }> {
  const root = resolve(pagesDir);
  const entries = await readdir(root, { withFileTypes: true });
  const pages = entries
    .filter((entry) => entry.isFile() && /^\d+\.md$/u.test(entry.name))
    .map((entry) => ({
      pdf_index: Number.parseInt(entry.name.slice(0, -3), 10),
    }));
  return detectMapSupplyPages(pages, candidatePdfIndices, needsOcr);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function mediaType(path: string): MapImageRef["media_type"] | null {
  return MEDIA_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

async function runRenderer(command: string, request: JsonObject): Promise<JsonObject> {
  if (!isAbsolute(command)) throw new Error("COC_MAP_RENDER_COMMAND must be an absolute executable path");
  await access(command, constants.X_OK);
  const child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(request));
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  if (code !== 0) throw new Error(`map renderer failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim().slice(-400)}`);
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
  catch { throw new Error("map renderer returned invalid JSON"); }
  const response = object(value);
  if (response?.schema_version !== 1 || response.status !== "ok" || !Array.isArray(response.images)) {
    throw new Error("map renderer returned an invalid render_pages receipt");
  }
  return response;
}

/**
 * The repository never parses/renders PDFs itself. A configured external command
 * writes images into the supplied module-assets directory; this validates and
 * indexes its immutable outputs for keeper-only visual delivery.
 */
export async function renderMapSupplyPages(input: {
  workspace_root: string;
  asset_root_id: string;
  source_pdf_path: string;
  pdf_indices: readonly number[];
  command?: string;
}): Promise<{ assets: MapImageRef[]; manifest_path: string }> {
  const workspace = resolve(input.workspace_root);
  const assetRoot = resolve(workspace, ".coc", "module-assets", input.asset_root_id);
  if (!isBelow(assetRoot, resolve(workspace, ".coc", "module-assets"))) throw new Error("asset_root_id escapes module-assets");
  const outputDir = resolve(assetRoot, "images", "map-supply");
  await mkdir(outputDir, { recursive: true });
  const indices = [...new Set(input.pdf_indices)].filter((index) => Number.isInteger(index) && index >= 0).sort((a, b) => a - b);
  if (!indices.length) throw new Error("pdf_indices must contain at least one non-negative page index");
  const sourcePdf = resolve(input.source_pdf_path);
  const response = await runRenderer(input.command ?? process.env.COC_MAP_RENDER_COMMAND ?? "", {
    schema_version: 1,
    operation: "render_pages",
    source_pdf_path: sourcePdf,
    pdf_indices: indices,
    output_dir: outputDir,
  });
  const assets: MapImageRef[] = [];
  const seen = new Set<number>();
  for (const row of response.images as unknown[]) {
    const image = object(row);
    const pdfIndex = image?.pdf_index;
    const rawPath = typeof image?.path === "string" ? image.path : "";
    if (!Number.isInteger(pdfIndex) || !indices.includes(pdfIndex as number) || !rawPath) throw new Error("map renderer image row is invalid");
    const path = resolve(rawPath);
    if (!isBelow(path, outputDir)) throw new Error("map renderer image path escapes output_dir");
    const info = await stat(path);
    const type = mediaType(path);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES || type === null) throw new Error("map renderer produced an invalid image asset");
    const bytes = await readFile(path);
    const page = pdfIndex as number;
    if (seen.has(page)) throw new Error("map renderer returned duplicate pdf_index");
    seen.add(page);
    assets.push({
      id: `map-page-${String(page).padStart(4, "0")}`,
      page_ref: `pdf_index-${page}`,
      image_ref: relative(workspace, path),
      media_type: type,
      sha256: sha256(bytes),
    });
  }
  if (assets.length !== indices.length) throw new Error("map renderer did not return every requested page");
  const manifestPath = resolve(outputDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ schema_version: 1, kind: "coc-map-supply", assets }, null, 2) + "\n", "utf8");
  return { assets, manifest_path: relative(workspace, manifestPath) };
}

/** Build the hidden multimodal message accepted by Pi's custom-message channel. */
export async function mapVisualMessage(workspaceRoot: string, imageRef: string, caption?: string): Promise<JsonObject> {
  const workspace = resolve(workspaceRoot);
  const assetRoot = resolve(workspace, ".coc", "module-assets");
  const path = resolve(workspace, imageRef);
  if (!isBelow(path, assetRoot)) throw new Error("image_ref must remain below .coc/module-assets");
  const type = mediaType(path);
  const info = await stat(path);
  if (type === null || !info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error("image_ref is not a supported bounded image asset");
  const bytes = await readFile(path);
  return {
    customType: "coc-map-supply-visual",
    content: [
      { type: "text", text: caption?.trim() || `Keeper-only source image: ${basename(path)}` },
      { type: "image", source: { type: "base64", mediaType: type, data: bytes.toString("base64") } },
    ],
    display: false,
    details: { schema_version: 1, audience: "keeper_only", image_ref: imageRef, sha256: sha256(bytes) },
  };
}
