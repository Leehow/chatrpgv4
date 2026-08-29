/**
 * Management/retrieval layer over already-extracted source-bundle assets.
 * Caller: coc_source_assets / steward-scene / setup+play hosts.
 * Consumer: existing state.deliver_handout and coc_map_supply.present.
 * Never parses PDFs, never classifies by filename/title keywords, never
 * lets a model supply asset_id / association_id / decision_id.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isCanonicalCampaignId } from "./campaign-id.mjs";

export const SOURCE_ASSET_TOOL_NAME = "coc_source_assets";
export const CATALOG_KIND = "coc-source-asset-catalog";
export const CATALOG_SCHEMA_VERSION = 1;
export const CATALOG_RELATIVE_DIR = ["index"] as const;
export const CATALOG_FILENAME = "source-asset-catalog.json";

export type JsonObject = Record<string, unknown>;
export type SourceAssetKind = "map" | "briefing" | "document" | "read_aloud" | "unclassified";
export type SourceAssetVisibility = "kp_only" | "undiscovered" | "player_visible" | "delivered";
export type AssociationTargetKind = "location" | "scene" | "clue" | "npc";
export type AssociationSource = "semantic_worker" | "semantic_router";
export type DeliveryPath = "state.deliver_handout" | "coc_map_supply.present" | "none";

export type SourceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourceAssetSource = {
  bundle_sha256: string;
  pdf_index: number | null;
  page_ref: string | null;
  region: SourceRegion | null;
  asset_ref: string | null;
  original_hash: string;
};

export type SourceAssetEntry = {
  asset_id: string;
  kind: SourceAssetKind;
  path: string;
  sha256: string;
  image_ref: string;
  source: SourceAssetSource;
  declared_player_visible: boolean | null;
};

export type SemanticAssociation = {
  association_id: string;
  asset_id: string;
  target_kind: AssociationTargetKind;
  target_id: string;
  reason: string;
  source: AssociationSource;
};

export type SourceAssetCatalog = {
  schema_version: typeof CATALOG_SCHEMA_VERSION;
  kind: typeof CATALOG_KIND;
  bundle_sha256: string;
  asset_root_id: string;
  source_bundle_path: string;
  assets: SourceAssetEntry[];
  associations: SemanticAssociation[];
};

export type HandoutVisibilityCard = {
  asset_id: string;
  player_visible?: boolean;
  kind?: string;
  image_ref?: string;
  source_refs?: readonly string[];
};

export type QueriedSourceAsset = SourceAssetEntry & {
  visibility: SourceAssetVisibility;
  associations: SemanticAssociation[];
};

export type AssetDeliveryPlan =
  | { path: "state.deliver_handout"; handout_id: string }
  | { path: "coc_map_supply.present"; image_ref: string }
  | { path: "none"; reason: string };

const SHA256_HEX = /^(?:sha256:)?([0-9a-f]{64})$/iu;
const TARGET_KINDS = new Set<AssociationTargetKind>(["location", "scene", "clue", "npc"]);
const ASSOCIATION_SOURCES = new Set<AssociationSource>(["semantic_worker", "semantic_router"]);
const FORBIDDEN_ASSOCIATION_SOURCES = new Set([
  "keyword", "regex", "phrase", "phrase_list", "title", "filename",
]);
const KIND_BY_PRODUCER: Record<string, SourceAssetKind> = {
  map: "map",
  briefing: "briefing",
  document: "document",
  read_aloud: "read_aloud",
  readaloud: "read_aloud",
};
const VISIBILITY_KIND_HINT: Record<string, boolean> = {
  "player-facing": true,
  player_facing: true,
  player_visible: true,
  "kp-only": false,
  kp_only: false,
  keeper_only: false,
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function fail(message: string): never {
  throw new Error(message);
}

function isBelow(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function normalizeRelPath(raw: string): string {
  const trimmed = raw.trim().replaceAll("\\", "/");
  if (!trimmed) fail("asset path must be a non-empty relative path");
  if (trimmed.startsWith("/") || trimmed.includes("://")) {
    fail("asset path must stay relative to the source bundle");
  }
  const parts = trimmed.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) fail("asset path escapes the source bundle");
  return parts.join("/");
}

export function normalizeSha256(raw: string): string {
  const match = SHA256_HEX.exec(raw.trim());
  if (!match) fail("sha256 must be a 64-hex digest, optionally prefixed with sha256:");
  return `sha256:${match[1].toLowerCase()}`;
}

function digestHex(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

export function deriveSourceAssetId(input: {
  bundle_sha256: string;
  path: string;
  sha256: string;
}): string {
  const bundle = normalizeSha256(input.bundle_sha256);
  const path = normalizeRelPath(input.path);
  const sha256 = normalizeSha256(input.sha256);
  return `srcasset-${digestHex(["source-asset", "\0", bundle, "\0", path, "\0", sha256]).slice(0, 32)}`;
}

export function deriveAssociationId(input: {
  asset_id: string;
  target_kind: AssociationTargetKind;
  target_id: string;
}): string {
  return `assoc-${digestHex([
    "source-assoc", "\0", input.asset_id, "\0", input.target_kind, "\0", input.target_id.trim(),
  ]).slice(0, 32)}`;
}

function parseRegion(value: unknown): SourceRegion | null {
  const row = object(value);
  if (row === null) return null;
  if (
    Number.isFinite(row.x) && Number.isFinite(row.y)
    && Number.isFinite(row.width) && Number.isFinite(row.height)
  ) {
    return {
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
    };
  }
  if (
    Number.isFinite(row.x0) && Number.isFinite(row.y0)
    && Number.isFinite(row.x1) && Number.isFinite(row.y1)
  ) {
    const x0 = Number(row.x0);
    const y0 = Number(row.y0);
    return {
      x: x0,
      y: y0,
      width: Number(row.x1) - x0,
      height: Number(row.y1) - y0,
    };
  }
  return null;
}

function parsePdfIndex(value: unknown): number | null {
  if (!Number.isInteger(value) || (value as number) < 0) return null;
  return value as number;
}

function classifyProducerKind(raw: unknown): {
  kind: SourceAssetKind;
  declared_player_visible: boolean | null;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { kind: "unclassified", declared_player_visible: null };
  }
  const key = raw.trim().toLowerCase().replaceAll(" ", "_");
  if (key in KIND_BY_PRODUCER) {
    return { kind: KIND_BY_PRODUCER[key], declared_player_visible: null };
  }
  if (key in VISIBILITY_KIND_HINT) {
    return { kind: "unclassified", declared_player_visible: VISIBILITY_KIND_HINT[key] };
  }
  return { kind: "unclassified", declared_player_visible: null };
}

function declaredPlayerVisible(record: JsonObject, kindHint: boolean | null): boolean | null {
  if (record.player_visible === true) return true;
  if (record.player_visible === false) return false;
  if (record.secrecy === "keeper_only") return false;
  return kindHint;
}

function pageRef(pdfIndex: number | null): string | null {
  return pdfIndex === null ? null : `pdf_index-${pdfIndex}`;
}

export function catalogAssetFromProducer(
  bundleSha256: string,
  raw: unknown,
): SourceAssetEntry {
  const record = object(raw);
  if (record === null) fail("bundle asset must be an object");
  const path = typeof record.path === "string" ? normalizeRelPath(record.path) : fail("bundle asset.path is required");
  const sha256 = typeof record.sha256 === "string" ? normalizeSha256(record.sha256) : fail("bundle asset.sha256 is required");
  const classified = classifyProducerKind(record.kind);
  const pdfIndex = parsePdfIndex(record.pdf_index);
  const assetRef = typeof record.asset_ref === "string" && record.asset_ref.trim()
    ? record.asset_ref.trim()
    : null;
  return {
    asset_id: deriveSourceAssetId({ bundle_sha256: bundleSha256, path, sha256 }),
    kind: classified.kind,
    path,
    sha256,
    image_ref: path,
    source: {
      bundle_sha256: normalizeSha256(bundleSha256),
      pdf_index: pdfIndex,
      page_ref: pageRef(pdfIndex),
      region: parseRegion(record.region ?? record.bbox),
      asset_ref: assetRef,
      original_hash: sha256,
    },
    declared_player_visible: declaredPlayerVisible(record, classified.declared_player_visible),
  };
}

export function buildSourceAssetCatalog(input: {
  bundle_sha256: string;
  asset_root_id: string;
  source_bundle_path: string;
  assets: readonly unknown[];
  associations?: readonly SemanticAssociation[];
}): SourceAssetCatalog {
  const bundleSha256 = normalizeSha256(input.bundle_sha256);
  const assetRootId = input.asset_root_id.trim();
  if (!assetRootId || assetRootId.includes("..") || assetRootId.includes("/") || assetRootId.includes("\\")) {
    fail("asset_root_id must be a single path segment");
  }
  const sourceBundlePath = input.source_bundle_path.trim();
  if (!sourceBundlePath) fail("source_bundle_path is required");
  const seen = new Set<string>();
  const assets: SourceAssetEntry[] = [];
  for (const raw of input.assets) {
    const entry = catalogAssetFromProducer(bundleSha256, raw);
    if (seen.has(entry.path)) fail(`duplicate asset path: ${entry.path}`);
    seen.add(entry.path);
    assets.push(entry);
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  const known = new Set(assets.map((entry) => entry.asset_id));
  const associations = [...(input.associations ?? [])]
    .filter((row) => known.has(row.asset_id))
    .sort((left, right) => left.association_id.localeCompare(right.association_id));
  return {
    schema_version: CATALOG_SCHEMA_VERSION,
    kind: CATALOG_KIND,
    bundle_sha256: bundleSha256,
    asset_root_id: assetRootId,
    source_bundle_path: sourceBundlePath,
    assets,
    associations,
  };
}

export function recordSemanticAssociation(
  catalog: SourceAssetCatalog,
  input: {
    asset_id: string;
    target_kind: string;
    target_id: string;
    reason: string;
    source: string;
  },
): { catalog: SourceAssetCatalog; association: SemanticAssociation } {
  const assetId = input.asset_id.trim();
  if (!catalog.assets.some((entry) => entry.asset_id === assetId)) {
    fail("association asset_id is not in the catalog");
  }
  if (!TARGET_KINDS.has(input.target_kind as AssociationTargetKind)) {
    fail("association target_kind must be location|scene|clue|npc");
  }
  const targetId = input.target_id.trim();
  if (!targetId) fail("association target_id is required");
  const reason = input.reason.trim();
  if (!reason) fail("association reason must be a non-empty semantic justification");
  const sourceKey = input.source.trim().toLowerCase();
  if (FORBIDDEN_ASSOCIATION_SOURCES.has(sourceKey)) {
    fail("association source must be a recorded semantic result, not a keyword/regex/phrase map");
  }
  if (!ASSOCIATION_SOURCES.has(sourceKey as AssociationSource)) {
    fail("association source must be semantic_worker or semantic_router");
  }
  const association: SemanticAssociation = {
    association_id: deriveAssociationId({
      asset_id: assetId,
      target_kind: input.target_kind as AssociationTargetKind,
      target_id: targetId,
    }),
    asset_id: assetId,
    target_kind: input.target_kind as AssociationTargetKind,
    target_id: targetId,
    reason,
    source: sourceKey as AssociationSource,
  };
  const next = catalog.associations.filter((row) => row.association_id !== association.association_id);
  next.push(association);
  next.sort((left, right) => left.association_id.localeCompare(right.association_id));
  return { catalog: { ...catalog, associations: next }, association };
}

function matchingHandout(
  entry: SourceAssetEntry,
  handouts: readonly HandoutVisibilityCard[] = [],
): HandoutVisibilityCard | null {
  return handouts.find((card) => {
    if (card.asset_id === entry.asset_id) return true;
    if (card.image_ref && card.image_ref === entry.image_ref) return true;
    if (entry.source.page_ref && (card.source_refs ?? []).includes(entry.source.page_ref)) return true;
    return false;
  }) ?? null;
}

export function projectAssetVisibility(input: {
  entry: SourceAssetEntry;
  handout?: HandoutVisibilityCard | null;
  delivered_handout_ids?: readonly string[];
}): SourceAssetVisibility {
  const delivered = new Set(input.delivered_handout_ids ?? []);
  const handout = input.handout ?? null;
  if (handout) {
    if (handout.player_visible === false) return "kp_only";
    if (delivered.has(handout.asset_id) || delivered.has(input.entry.asset_id)) return "delivered";
    return "undiscovered";
  }
  if (input.entry.declared_player_visible === false) return "kp_only";
  if (delivered.has(input.entry.asset_id)) return "delivered";
  return "undiscovered";
}

function visibilityMatches(
  actual: SourceAssetVisibility,
  wanted: SourceAssetVisibility | undefined,
): boolean {
  if (!wanted) return true;
  if (wanted === "player_visible") return actual === "undiscovered" || actual === "delivered";
  return actual === wanted;
}

export function querySourceAssets(input: {
  catalog: SourceAssetCatalog;
  target?: { kind: AssociationTargetKind; id: string };
  kind?: SourceAssetKind;
  visibility?: SourceAssetVisibility;
  audience: "keeper" | "player";
  handouts?: readonly HandoutVisibilityCard[];
  delivered_handout_ids?: readonly string[];
}): QueriedSourceAsset[] {
  const rows: QueriedSourceAsset[] = [];
  for (const entry of input.catalog.assets) {
    const associations = input.catalog.associations.filter((row) => row.asset_id === entry.asset_id);
    if (input.target) {
      const hit = associations.some((row) => (
        row.target_kind === input.target?.kind && row.target_id === input.target.id
      ));
      if (!hit) continue;
    }
    if (input.kind && entry.kind !== input.kind) continue;
    const handout = matchingHandout(entry, input.handouts);
    const visibility = projectAssetVisibility({
      entry,
      handout,
      delivered_handout_ids: input.delivered_handout_ids,
    });
    if (!visibilityMatches(visibility, input.visibility)) continue;
    if (input.audience === "player" && visibility !== "delivered") continue;
    rows.push({ ...entry, visibility, associations });
  }
  return rows;
}

export function planAssetDelivery(input: {
  entry: SourceAssetEntry;
  visibility: SourceAssetVisibility;
  handout?: HandoutVisibilityCard | null;
}): AssetDeliveryPlan {
  if (input.visibility === "delivered") {
    return { path: "none", reason: "already_delivered" };
  }
  if (input.visibility === "kp_only") {
    if (input.entry.image_ref) {
      return { path: "coc_map_supply.present", image_ref: input.entry.image_ref };
    }
    return { path: "none", reason: "kp_only_without_image" };
  }
  if (input.handout && input.handout.player_visible !== false) {
    return { path: "state.deliver_handout", handout_id: input.handout.asset_id };
  }
  return { path: "none", reason: "no_player_handout_card" };
}

export function handoutPackFromCatalogEntry(input: {
  entry: SourceAssetEntry;
  player_visible: boolean;
  associations?: readonly SemanticAssociation[];
  title?: string;
}): JsonObject {
  const sceneRefs = (input.associations ?? [])
    .filter((row) => row.target_kind === "scene" || row.target_kind === "location")
    .map((row) => row.target_id);
  const clueRefs = (input.associations ?? [])
    .filter((row) => row.target_kind === "clue")
    .map((row) => row.target_id);
  const kind = input.entry.kind === "map" || input.entry.kind === "read_aloud" || input.entry.kind === "document"
    ? input.entry.kind
    : input.entry.kind === "briefing" ? "document" : "document";
  const pack: JsonObject = {
    asset_id: input.entry.asset_id,
    kind,
    player_visible: input.player_visible,
    image_ref: input.entry.image_ref,
    source_refs: input.entry.source.page_ref ? [input.entry.source.page_ref] : [],
    scene_refs: [...new Set(sceneRefs)],
    clue_refs: [...new Set(clueRefs)],
  };
  if (input.title?.trim()) pack.title = input.title.trim();
  return pack;
}

export function catalogRelativePath(assetRootId: string): string {
  return [".coc", "module-assets", assetRootId, ...CATALOG_RELATIVE_DIR, CATALOG_FILENAME].join("/");
}

export function catalogAbsolutePath(workspaceRoot: string, assetRootId: string): string {
  const workspace = resolve(workspaceRoot);
  const assetRoot = resolve(workspace, ".coc", "module-assets", assetRootId);
  if (!isBelow(assetRoot, resolve(workspace, ".coc", "module-assets"))) {
    fail("asset_root_id escapes module-assets");
  }
  return resolve(assetRoot, ...CATALOG_RELATIVE_DIR, CATALOG_FILENAME);
}

function parseCatalog(value: unknown): SourceAssetCatalog {
  const row = object(value);
  if (row === null || row.schema_version !== CATALOG_SCHEMA_VERSION || row.kind !== CATALOG_KIND) {
    fail("source asset catalog contract drift");
  }
  if (!Array.isArray(row.assets) || !Array.isArray(row.associations)) {
    fail("source asset catalog is missing assets or associations");
  }
  return buildSourceAssetCatalog({
    bundle_sha256: String(row.bundle_sha256 ?? ""),
    asset_root_id: String(row.asset_root_id ?? ""),
    source_bundle_path: String(row.source_bundle_path ?? ""),
    assets: row.assets.map((asset) => {
      const entry = object(asset);
      if (entry === null) fail("catalog asset row is invalid");
      return {
        path: String(entry.path ?? ""),
        sha256: String(entry.sha256 ?? ""),
        pdf_index: entry.source && object(entry.source)?.pdf_index,
        region: object(entry.source)?.region,
        asset_ref: object(entry.source)?.asset_ref,
        kind: entry.kind,
        player_visible: entry.declared_player_visible,
      };
    }),
    associations: row.associations as SemanticAssociation[],
  });
}

export async function loadSourceAssetCatalog(
  workspaceRoot: string,
  assetRootId: string,
): Promise<SourceAssetCatalog> {
  const path = catalogAbsolutePath(workspaceRoot, assetRootId);
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseCatalog(raw);
}

export async function saveSourceAssetCatalog(
  workspaceRoot: string,
  catalog: SourceAssetCatalog,
): Promise<string> {
  const path = catalogAbsolutePath(workspaceRoot, catalog.asset_root_id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return relative(resolve(workspaceRoot), path);
}

async function verifyAssetHash(bundleRoot: string, entry: SourceAssetEntry): Promise<void> {
  const path = resolve(bundleRoot, entry.path);
  if (!isBelow(path, bundleRoot)) fail("asset path escapes the source bundle");
  try {
    const info = await stat(path);
    if (!info.isFile()) return;
  } catch {
    return;
  }
  const bytes = await readFile(path);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== entry.sha256) fail(`asset ${entry.path} SHA-256 does not match catalog`);
}

const MAX_CAMPAIGN_BINDING_BYTES = 64 * 1024;

export type SourceAssetCampaignBinding = {
  campaign_id: string;
  asset_root_id: string;
  source_bundle_path: string;
  bundle_sha256?: string;
};

async function readBoundedJsonObject(path: string): Promise<JsonObject | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CAMPAIGN_BINDING_BYTES) return null;
    const raw = await readFile(path, "utf8");
    if (!raw || Buffer.byteLength(raw, "utf8") > MAX_CAMPAIGN_BINDING_BYTES) return null;
    return object(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Resolve either the source-cache binding written by scenario.bind_pdf or the
 * module graph's versioned asset root. Caller: the Pi host's
 * coc_source_assets wrapper. The campaign record is authoritative; the model
 * never selects this root or source path.
 */
export async function sourceAssetCampaignBinding(input: {
  workspace_root: string;
  campaign_id: string;
}): Promise<SourceAssetCampaignBinding> {
  const campaignId = input.campaign_id.trim();
  if (!isCanonicalCampaignId(campaignId)) {
    fail("source asset campaign_id is invalid");
  }
  const workspace = resolve(input.workspace_root);
  const campaignsRoot = resolve(workspace, ".coc", "campaigns");
  const scenarioRoot = resolve(campaignsRoot, campaignId, "scenario");
  if (!isBelow(scenarioRoot, campaignsRoot)) {
    fail("source asset campaign path escapes campaigns");
  }
  const scenario = await readBoundedJsonObject(resolve(scenarioRoot, "scenario.json"));
  const moduleMeta = await readBoundedJsonObject(
    resolve(scenarioRoot, "module-meta.json"),
  );
  const source = object(scenario?.source);
  const assetRootId = typeof scenario?.source_cache_asset_root_id === "string"
    ? scenario.source_cache_asset_root_id.trim()
    : typeof scenario?.progressive_asset_root_id === "string"
      ? scenario.progressive_asset_root_id.trim()
      : typeof moduleMeta?.module_graph_asset_root_id === "string"
        ? moduleMeta.module_graph_asset_root_id.trim()
        : "";
  const graphAssetRoot = (
    typeof moduleMeta?.module_graph_asset_root_id === "string"
    && moduleMeta.module_graph_asset_root_id.trim() === assetRootId
  );
  const sourceBundlePath = typeof source?.source_bundle_path === "string"
    ? source.source_bundle_path.trim()
    : graphAssetRoot && assetRootId
      ? resolve(workspace, ".coc", "module-assets", assetRootId)
      : "";
  if (!assetRootId || !sourceBundlePath) {
    fail("campaign source asset binding is unavailable");
  }
  // Reuse the catalog's single-segment validation before returning a path that
  // will select its on-disk index.
  if (assetRootId.includes("..") || assetRootId.includes("/") || assetRootId.includes("\\")) {
    fail("campaign source asset_root_id is invalid");
  }
  return {
    campaign_id: campaignId,
    asset_root_id: assetRootId,
    source_bundle_path: resolve(workspace, sourceBundlePath),
    ...(typeof source?.bundle_sha256 === "string" && source.bundle_sha256.trim()
      ? { bundle_sha256: source.bundle_sha256.trim() }
      : {}),
  };
}

/** Fill only omitted catalog coordinates from the selected campaign binding. */
export async function bindSourceAssetToolParams(input: {
  workspace_root: string;
  campaign_id?: string;
  params: JsonObject;
}): Promise<JsonObject> {
  const operation = String(input.params.operation ?? "");
  const missingAssetRoot = typeof input.params.asset_root_id !== "string"
    || !input.params.asset_root_id.trim();
  const missingSourceBundle = operation === "catalog" && (
    typeof input.params.source_bundle_path !== "string"
    || !input.params.source_bundle_path.trim()
  );
  if (!input.campaign_id || (!missingAssetRoot && !missingSourceBundle)) {
    return input.params;
  }
  const binding = await sourceAssetCampaignBinding({
    workspace_root: input.workspace_root,
    campaign_id: input.campaign_id,
  });
  return {
    ...input.params,
    ...(missingAssetRoot ? { asset_root_id: binding.asset_root_id } : {}),
    ...(missingSourceBundle ? { source_bundle_path: binding.source_bundle_path } : {}),
    ...(operation === "catalog"
      && input.params.bundle_sha256 === undefined
      && binding.bundle_sha256 !== undefined
      ? { bundle_sha256: binding.bundle_sha256 }
      : {}),
  };
}

export async function catalogFromBundleManifest(input: {
  workspace_root: string;
  asset_root_id: string;
  source_bundle_path: string;
  bundle_sha256?: string;
}): Promise<{ catalog: SourceAssetCatalog; catalog_path: string }> {
  const workspace = resolve(input.workspace_root);
  const bundleRoot = resolve(input.source_bundle_path);
  if (!isBelow(bundleRoot, workspace) && bundleRoot !== workspace) {
    fail("source_bundle_path must remain inside the workspace");
  }
  let declared: string | undefined;
  let assets: unknown[];
  try {
    const manifest = object(JSON.parse(
      await readFile(resolve(bundleRoot, "manifest.json"), "utf8"),
    ));
    if (manifest === null) fail("source bundle manifest.json must be an object");
    declared = typeof manifest.bundle_sha256 === "string"
      ? manifest.bundle_sha256
      : typeof object(manifest.source)?.bundle_sha256 === "string"
        ? String(object(manifest.source)?.bundle_sha256)
        : input.bundle_sha256;
    assets = Array.isArray(manifest.assets)
      ? manifest.assets
      : fail("manifest.assets must be a list");
  } catch (error) {
    const code = object(error)?.code;
    if (code !== "ENOENT") throw error;
    const graphAssets = object(JSON.parse(
      await readFile(resolve(bundleRoot, "source-assets.json"), "utf8"),
    ));
    const rows = Array.isArray(graphAssets?.assets)
      ? graphAssets.assets
      : fail("module graph source-assets.json must contain assets");
    const bundleHashes = new Set<string>();
    assets = rows.map((raw) => {
      const row = object(raw);
      if (row === null) fail("module graph source asset row must be an object");
      for (const hash of Array.isArray(row.bundle_sha256s)
        ? row.bundle_sha256s
        : []) {
        if (typeof hash === "string" && hash.trim()) bundleHashes.add(hash.trim());
      }
      const path = typeof row.source_bundle_path === "string"
        ? row.source_bundle_path.trim()
        : "";
      const segments = path.split("/");
      const playerVisible = segments.length >= 3
        && segments[0] === "assets"
        && segments[1] === "player";
      return {
        path,
        sha256: row.sha256,
        pdf_index: row.pdf_index,
        asset_ref: row.image_ref,
        kind: playerVisible ? "player_visible" : "unclassified",
        player_visible: playerVisible,
      };
    });
    if (bundleHashes.size !== 1) {
      fail("module graph source assets must bind exactly one bundle_sha256");
    }
    declared = [...bundleHashes][0];
  }
  if (!declared) fail("bundle_sha256 is required when the manifest does not declare one");
  let prior: SemanticAssociation[] = [];
  try {
    prior = (await loadSourceAssetCatalog(workspace, input.asset_root_id)).associations;
  } catch {
    prior = [];
  }
  const catalog = buildSourceAssetCatalog({
    bundle_sha256: declared,
    asset_root_id: input.asset_root_id,
    source_bundle_path: relative(workspace, bundleRoot) || ".",
    assets,
    associations: prior,
  });
  for (const entry of catalog.assets) await verifyAssetHash(bundleRoot, entry);
  const catalogPath = await saveSourceAssetCatalog(workspace, catalog);
  return { catalog, catalog_path: catalogPath };
}

function parseHandouts(value: unknown): HandoutVisibilityCard[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("handouts must be an array of existing handout cards");
  return value.map((row) => {
    const card = object(row);
    if (card === null || typeof card.asset_id !== "string" || !card.asset_id.trim()) {
      fail("handout card must include an existing asset_id");
    }
    return {
      asset_id: card.asset_id.trim(),
      player_visible: typeof card.player_visible === "boolean" ? card.player_visible : undefined,
      kind: typeof card.kind === "string" ? card.kind : undefined,
      image_ref: typeof card.image_ref === "string" ? card.image_ref : undefined,
      source_refs: Array.isArray(card.source_refs)
        ? card.source_refs.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  });
}

function parseDelivered(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("delivered_handout_ids must be an array of existing handout ids");
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export const SOURCE_ASSET_TOOL_SCHEMA = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["catalog", "associate", "query", "plan_delivery"] },
    asset_root_id: { type: "string" },
    source_bundle_path: { type: "string" },
    bundle_sha256: { type: "string" },
    asset_id: { type: "string" },
    target_kind: { type: "string", enum: ["location", "scene", "clue", "npc"] },
    target_id: { type: "string" },
    reason: { type: "string" },
    source: { type: "string", enum: ["semantic_worker", "semantic_router"] },
    audience: { type: "string", enum: ["keeper", "player"] },
    visibility: { type: "string", enum: ["kp_only", "undiscovered", "player_visible", "delivered"] },
    kind: { type: "string", enum: ["map", "briefing", "document", "read_aloud", "unclassified"] },
    handouts: { type: "array", items: { type: "object" } },
    delivered_handout_ids: { type: "array", items: { type: "string" } },
  },
  required: ["operation"],
  additionalProperties: false,
} as const;

export async function executeSourceAssetTool(input: {
  cwd: string;
  campaign_id?: string;
  params: JsonObject;
}): Promise<JsonObject> {
  const params = await bindSourceAssetToolParams({
    workspace_root: input.cwd,
    campaign_id: input.campaign_id,
    params: input.params,
  });
  const operation = String(params.operation ?? "");
  const assetRootId = typeof params.asset_root_id === "string" ? params.asset_root_id : "";
  if (operation === "catalog") {
    if (!assetRootId) fail("catalog requires asset_root_id");
    if (typeof params.source_bundle_path !== "string" || !params.source_bundle_path.trim()) {
      fail("catalog requires source_bundle_path");
    }
    const built = await catalogFromBundleManifest({
      workspace_root: input.cwd,
      asset_root_id: assetRootId,
      source_bundle_path: params.source_bundle_path,
      bundle_sha256: typeof params.bundle_sha256 === "string" ? params.bundle_sha256 : undefined,
    });
    return {
      status: "cataloged",
      catalog_path: built.catalog_path,
      bundle_sha256: built.catalog.bundle_sha256,
      asset_ids: built.catalog.assets.map((entry) => entry.asset_id),
      catalog: built.catalog,
    };
  }
  if (!assetRootId) fail(`${operation} requires asset_root_id`);
  let catalog = await loadSourceAssetCatalog(input.cwd, assetRootId);
  if (operation === "associate") {
    const recorded = recordSemanticAssociation(catalog, {
      asset_id: String(params.asset_id ?? ""),
      target_kind: String(params.target_kind ?? ""),
      target_id: String(params.target_id ?? ""),
      reason: String(params.reason ?? ""),
      source: String(params.source ?? ""),
    });
    const catalogPath = await saveSourceAssetCatalog(input.cwd, recorded.catalog);
    return {
      status: "associated",
      catalog_path: catalogPath,
      association: recorded.association,
    };
  }
  const handouts = parseHandouts(params.handouts);
  const delivered = parseDelivered(params.delivered_handout_ids);
  if (operation === "query") {
    const targetKind = typeof params.target_kind === "string" ? params.target_kind : "";
    const targetId = typeof params.target_id === "string" ? params.target_id : "";
    const rows = querySourceAssets({
      catalog,
      target: targetKind && targetId
        ? { kind: targetKind as AssociationTargetKind, id: targetId }
        : undefined,
      kind: typeof params.kind === "string" ? params.kind as SourceAssetKind : undefined,
      visibility: typeof params.visibility === "string"
        ? params.visibility as SourceAssetVisibility
        : undefined,
      audience: params.audience === "player" ? "player" : "keeper",
      handouts,
      delivered_handout_ids: delivered,
    });
    return { status: "ok", audience: params.audience === "player" ? "player" : "keeper", assets: rows };
  }
  if (operation === "plan_delivery") {
    const assetId = String(params.asset_id ?? "").trim();
    const entry = catalog.assets.find((row) => row.asset_id === assetId);
    if (!entry) fail("plan_delivery asset_id is not in the catalog");
    const handout = matchingHandout(entry, handouts);
    const visibility = projectAssetVisibility({
      entry,
      handout,
      delivered_handout_ids: delivered,
    });
    return {
      status: "ok",
      asset_id: entry.asset_id,
      visibility,
      delivery: planAssetDelivery({ entry, visibility, handout }),
    };
  }
  fail("unsupported coc_source_assets operation");
}
