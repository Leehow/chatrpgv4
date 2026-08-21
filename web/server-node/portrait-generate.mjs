/**
 * Host orchestration for investigator portrait generation.
 *
 * Builds the prompt (p3), calls official xAI Imagine (p2), writes bytes under
 * `.coc/investigators/<id>/portraits/`, then records metadata through the
 * canonical `coc_character.py` CLI. Node never edits character.json.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PORTRAIT_ASPECT_RATIO,
  buildPortraitPrompt,
  portraitPromptMetadata,
} from "./portrait-prompt.mjs";
import {
  INVESTIGATOR_ID_RE,
  campaignDir,
  investigatorCharacterPath,
  investigatorPortraitDir,
  playerFacingPortraitProjection,
  portraitImageUrl,
  readJsonFile,
  resolveInvestigatorPortraitFile,
} from "./projections.mjs";
import {
  generatePortraitBytes,
  resolvePortraitImageRoute,
} from "./portrait-image-route.mjs";
import {
  CAMPAIGN_ID_RE,
  XaiImageError,
  writePortraitFile,
} from "./xai-image.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHARACTER_SCRIPT = path.join(
  REPO_ROOT,
  "plugins/coc-keeper/scripts/coc_character.py",
);
const PROVENANCE_WRITE_KEYS = Object.freeze([
  "concept",
  "age",
  "occupation",
  "era",
  "region",
  "background",
  "appearance",
  "appearance_field",
]);
const BACKGROUND_WRITE_KEYS = Object.freeze([
  "personal_description",
  "injuries_scars",
  "traits",
  "treasured_possessions",
]);

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function imageError(status, message, code) {
  return new XaiImageError(message, { status, code });
}

export function parseInvestigatorPortraitBody(body) {
  const obj = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!obj) throw imageError(400, "request body must be a JSON object");
  const campaignId = trimStr(obj.campaign_id);
  const investigatorId = trimStr(obj.investigator_id);
  if (!campaignId) throw imageError(400, "campaign_id is required");
  if (!CAMPAIGN_ID_RE.test(campaignId)) throw imageError(400, "campaign_id is invalid");
  if (!investigatorId) throw imageError(400, "investigator_id is required");
  if (!INVESTIGATOR_ID_RE.test(investigatorId)) {
    throw imageError(400, "investigator_id is invalid");
  }
  return { campaignId, investigatorId };
}

function portraitStamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

function provenanceForCli(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of PROVENANCE_WRITE_KEYS) {
    if (!(key in src) || src[key] == null) continue;
    if (key === "background") {
      const background = {};
      const bg = src.background && typeof src.background === "object" ? src.background : {};
      for (const bgKey of BACKGROUND_WRITE_KEYS) {
        const text = trimStr(bg[bgKey]);
        if (text) background[bgKey] = text;
      }
      if (Object.keys(background).length) out.background = background;
      continue;
    }
    if (key === "age") {
      if (Number.isInteger(src.age) && !Number.isNaN(src.age)) out.age = src.age;
      continue;
    }
    const text = trimStr(src[key]);
    if (text) out[key] = text;
  }
  return out;
}

export function publicPortraitResponse(projected, investigatorId) {
  const portrait = playerFacingPortraitProjection({
    portrait: {
      asset_path: projected?.portrait_path || projected?.asset_path,
      source: projected?.portrait_source || projected?.source,
      status: projected?.portrait_status || projected?.status,
      generated_at: projected?.portrait_generated_at || projected?.generated_at,
    },
  });
  const imageUrl = portraitImageUrl(investigatorId, portrait.portrait_path);
  if (imageUrl) portrait.image_url = imageUrl;
  return portrait;
}

function runCharacterCli({
  repoRoot = REPO_ROOT,
  root,
  investigatorId,
  payload,
  spawnFn = spawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(
      "uv",
      [
        "run",
        "--project",
        repoRoot,
        "--frozen",
        "python",
        CHARACTER_SCRIPT,
        "record-generated-portrait",
        "--root",
        root,
        "--investigator",
        investigatorId,
        "--json",
        JSON.stringify(payload),
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      reject(imageError(500, `portrait metadata helper failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").pop() || "null");
      } catch {
        parsed = null;
      }
      if (code !== 0 || !parsed?.ok) {
        const detail =
          (parsed && parsed.error) ||
          String(stderr || stdout || `exit ${code}`).slice(0, 400);
        reject(imageError(500, `portrait metadata write failed: ${detail}`));
        return;
      }
      resolve(parsed.portrait || {});
    });
  });
}

/**
 * Generate a vertical investigator portrait and persist via the canonical CLI.
 * On image-API failure, the previous portrait file and character.json stay.
 */
export async function generateInvestigatorPortrait({
  workspace,
  campaignId,
  investigatorId,
  repoRoot = REPO_ROOT,
  signal,
  env = process.env,
  agentDir,
  fetchImpl,
  now,
  spawnFn,
  log,
  prefs,
  clientBody,
} = {}) {
  const ws = path.resolve(workspace);
  const parsed = parseInvestigatorPortraitBody({
    campaign_id: campaignId,
    investigator_id: investigatorId,
  });
  const campaignRoot = campaignDir(ws, parsed.campaignId);
  if (!fs.existsSync(campaignRoot)) {
    throw imageError(404, `campaign ${parsed.campaignId} not found`);
  }
  const sheetPath = investigatorCharacterPath(ws, parsed.investigatorId);
  const character = sheetPath ? readJsonFile(sheetPath) : null;
  if (!character || typeof character !== "object") {
    throw imageError(404, "investigator character.json not found");
  }
  const built = buildPortraitPrompt(character);
  const meta = portraitPromptMetadata(built);
  const route = resolvePortraitImageRoute({
    prefs,
    clientBody,
    env,
    agentDir,
    now,
  });
  log?.("investigator_portrait_generate", {
    campaign_id: parsed.campaignId,
    investigator_id: parsed.investigatorId,
    family: route.family,
    provider: route.provider,
    appearance_locked: built.appearance_locked === true,
  });

  const image = await generatePortraitBytes({
    route,
    prompt: built.prompt,
    aspectRatio: built.aspect_ratio || DEFAULT_PORTRAIT_ASPECT_RATIO,
    signal,
    fetchImpl,
    env,
    agentDir,
    repoRoot,
    now,
    log,
  });

  const filename = `portrait-${portraitStamp(now)}.png`;
  const dest = resolveInvestigatorPortraitFile(ws, parsed.investigatorId, filename);
  if (!dest) throw imageError(400, "portrait output path is invalid");
  const portraitsDir = investigatorPortraitDir(ws, parsed.investigatorId);
  fs.mkdirSync(portraitsDir, { recursive: true });
  writePortraitFile(dest, image.bytes);

  const relative = `.coc/investigators/${parsed.investigatorId}/portraits/${filename}`;
  const projected = await runCharacterCli({
    repoRoot,
    root: ws,
    investigatorId: parsed.investigatorId,
    spawnFn,
    payload: {
      asset_path: relative,
      source: meta.source,
      prompt: built.prompt,
      provenance: provenanceForCli(meta.provenance),
      generated_at: new Date(now ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z"),
      tool: image.model,
      host: "pi-coc",
    },
  });

  const portrait = publicPortraitResponse(projected, parsed.investigatorId);
  return {
    ok: true,
    portrait,
  };
}

export function mimeForPortraitFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

/**
 * Resolve a GET portrait file inside the current workspace only.
 * @returns {{ file: string, mime: string } | null}
 */
export function resolvePortraitStaticFile(workspace, investigatorId, filename) {
  const dest = resolveInvestigatorPortraitFile(workspace, investigatorId, filename);
  if (!dest) return null;
  let realFile;
  let realDir;
  try {
    if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) return null;
    realFile = fs.realpathSync(dest);
    realDir = fs.realpathSync(investigatorPortraitDir(workspace, investigatorId));
  } catch {
    return null;
  }
  const base = path.resolve(realDir);
  if (realFile !== base && !realFile.startsWith(base + path.sep)) return null;
  return { file: realFile, mime: mimeForPortraitFile(realFile) };
}
