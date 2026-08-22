/**
 * Node HTTP + SSE bridge: the web/Electron UI of the pi-coc host.
 *
 * Product turns go through one `pi-coc --mode rpc` child per campaign
 * (web/server-node/pi-coc-rpc.mjs). The sidecar remains for campaign admin
 * and read-only disk projections only — it is not the turn channel.
 *
 * Run from the repository root:
 *
 *     node web/server-node/server.mjs [--workspace .] [--port 8765]
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Sidecar, SidecarError } from "./sidecar.mjs";
import {
  PiCocRpcError,
  PiCocRpcHost,
  sessionOpeningFlags,
  tableIntentFromOpeningPhase,
  webSessionId,
} from "./pi-coc-rpc.mjs";
import {
  CampaignHostOrchestrator,
  defaultResolveSessionRole,
  isStaleModelCatalogError,
  SESSION_TRANSITIONING_CODE,
} from "./session-handoff.mjs";
import { resolveRequestedModelSettings } from "./model-thinking.mjs";
import { hostedSessionMessages } from "./pi-session-text.mjs";
import { finishPromptTurn } from "./turn-flow.mjs";
import {
  campaignDir,
  campaignDisplayTitle,
  characterSetupPendingFromOpeningPhase,
  combatInitiativeDisplay,
  cocRoot,
  discoveredCluesDisplay,
  enrichTranscriptFromEvents,
  findBundleByPdfSha256,
  formatPlayerTime,
  campaignListExtras,
  investigatorIdFromParty,
  listSourceBundles,
  modelsPayload,
  readJsonFile,
  resolvePlaySceneId,
  sceneDisplayLabel,
  sha256Bytes,
  sha256File,
  tableTranscriptMessages,
  tensionDisplayLabel,
  timeExtras,
  attachPortraitToDisplayCharacter,
} from "./projections.mjs";
import { getModelEditorState, saveApiKeyProvider, saveModelEditorList } from "./model-editor.mjs";
import { armProductAgentEnv, resolveProductAgentDir } from "./agent-dir.mjs";
import { loadUserPrefs, resolveUserPrefsPath, saveUserPrefs } from "./user-prefs.mjs";
import { loadWebSearchKeysView, saveWebSearchApiKeys } from "./web-search-keys.mjs";
import { loadOcrTokenView, saveOcrToken } from "./ocr-secrets.mjs";
import { cancelLogin, loginSnapshot, respondLoginPrompt, startProviderLogin } from "./provider-login.mjs";
import { generateCampaignPortrait, parseGeneratePortraitBody } from "./xai-image.mjs";
import {
  generateInvestigatorPortrait,
  parseInvestigatorPortraitBody,
  resolvePortraitStaticFile,
} from "./portrait-generate.mjs";
import { deleteSourceBundle } from "./source-bundles.mjs";
import { decodeRequestPath, serveStatic } from "./static-files.mjs";
import {
  OPENING_READY_WINDOW_COUNT,
  pdfWindowBundleId,
  pdfWindowIndices,
} from "./ingest-status.mjs";

/**
 * Arm the canonical Pi source-lifecycle lanes for the pi-coc RPC child this
 * bridge spawns. The pi-coc CLI launcher exports the same defaults; values
 * already exported by the operator always win.
 */
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const piBin = path.join(repoRoot, "plugins", "coc-keeper", "pi", "bin");
  const defaults = {
    COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND: path.join(piBin, "coc-pdf-skill-adapter"),
    COC_PROGRESSIVE_OCR_COMMAND: path.join(piBin, "coc-ocr-adapter.py"),
  };
  const routerDefault = path.join(
    os.homedir(),
    ".pi",
    "coc-tools",
    "pdf-inspector",
    "coc-pi-pdf-inspector-router",
  );
  if (fs.existsSync(routerDefault)) {
    defaults.COC_PI_PDF_INSPECTOR_COMMAND = routerDefault;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (!(process.env[key] || "").trim()) {
      process.env[key] = value;
    }
  }
  armProductAgentEnv();
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DIR = path.join(REPO_ROOT, "web", "frontend", "dist");

let WORKSPACE = REPO_ROOT;
let sidecar = null;

/** sid -> {session_id, campaign_id, investigator_id} */
const SESSIONS = new Map();
/** campaign_id -> PiCocRpcHost (owned by the setup/play orchestrator) */
const orchestrator = new CampaignHostOrchestrator({
  createHost: (opts) => new PiCocRpcHost(opts),
});
const HOSTS = orchestrator.hosts;

// One turn at a time: concurrent keeper turns against shared campaign state
// are never safe.
let turnInFlight = false;

// Historical web-only placeholder. Never create or link it again; ignore it
// when resolving a real investigator left over from the deprecated path.
const SETUP_DRAFT_INVESTIGATOR_ID = "web-char-setup-draft";

// ---------------------------------------------------------------------------
// Small helpers

const slugify = (name, fallback) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;

function timestampCompact() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function timestampIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function campaignIdConflicts(campaignId) {
  const root = cocRoot(WORKSPACE);
  if (fs.existsSync(path.join(root, "campaigns", campaignId))) return true;
  if (fs.existsSync(path.join(root, "trash", "campaigns", campaignId))) return true;
  const metaDir = path.join(root, "trash", "meta");
  if (!fs.existsSync(metaDir)) return false;
  try {
    for (const name of fs.readdirSync(metaDir)) {
      if (!name.endsWith(".json")) continue;
      const doc = JSON.parse(fs.readFileSync(path.join(metaDir, name), "utf8"));
      if (doc && doc.campaign_id === campaignId) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function readBody(req, { limit = 256 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req, { limit: 4 * 1024 * 1024 });
  if (!raw.length) return {};
  const data = JSON.parse(raw.toString("utf-8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("request body must be a JSON object");
  }
  return data;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Pick which investigator id to project (sheet display, item use). This is
 * id-selection only — it must never decide lifecycle, intent, or setup
 * progress; that authority is the `opening_phase` projection.
 */
function resolveInvestigator(campaignId) {
  const dir = campaignDir(WORKSPACE, campaignId);
  const fromParty = investigatorIdFromParty(readJsonFile(path.join(dir, "party.json")), {
    draftId: SETUP_DRAFT_INVESTIGATOR_ID,
  });
  if (fromParty) return fromParty;
  const stateDir = path.join(dir, "save", "investigator-state");
  let names;
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const stem = name.slice(0, -".json".length);
    if (stem !== SETUP_DRAFT_INVESTIGATOR_ID) return stem;
  }
  return null;
}

/**
 * Player-safe opening lifecycle projection for one campaign, from the same
 * sidecar `project_campaign_state` payload the state endpoint serves.
 * Returns null when the projection is unavailable.
 */
async function campaignOpeningPhase(campaignId) {
  try {
    const state = await sidecar.request("project_campaign_state", {
      campaign_id: campaignId,
    });
    const phase = state?.opening_phase;
    return phase && typeof phase === "object" ? phase : null;
  } catch {
    return null;
  }
}

/**
 * Single lifecycle source for session intent: the `opening_phase` projection,
 * else coc_session_role.py (same judge session-handoff respawns consult).
 * Never investigator-file scanning.
 */
async function resolveTableIntent(campaignId, openingPhase) {
  const fromPhase = tableIntentFromOpeningPhase(openingPhase);
  if (fromPhase) return fromPhase;
  const role = await defaultResolveSessionRole({
    workspace: WORKSPACE,
    campaignId,
    repoRoot: REPO_ROOT,
  });
  return role === "play" ? "continue" : "character-setup";
}

// ---------------------------------------------------------------------------
// State / transcript payloads

async function statePayload(info) {
  const liveInvestigator = resolveInvestigator(info.campaign_id);
  const state = await sidecar.request("project_campaign_state", {
    campaign_id: info.campaign_id,
    ...(liveInvestigator ? { investigator_id: liveInvestigator } : {}),
  });
  const lang =
    typeof state.play_language === "string" && state.play_language
      ? state.play_language
      : "zh-Hans";
  if (liveInvestigator) {
    try {
      const extras = await sidecar.request("display_character", {
        investigator_id: liveInvestigator,
        play_language: lang,
        campaign_id: info.campaign_id,
      });
      state.character = attachPortraitToDisplayCharacter(extras?.character ?? null, {
        workspace: WORKSPACE,
        investigatorId: liveInvestigator,
      });
    } catch {
      state.character = null;
    }
  } else {
    state.character = null;
  }
  state.character_setup_pending = characterSetupPendingFromOpeningPhase(
    state.opening_phase,
    {
      sessionRole: state.session_role,
      hasCharacter: Boolean(state.character),
    },
  );
  state.time = timeExtras(WORKSPACE, info.campaign_id, lang);
  const sceneId =
    resolvePlaySceneId(WORKSPACE, info.campaign_id) || state.active_scene_id;
  if (typeof sceneId === "string" && sceneId) {
    state.active_scene_id = sceneId;
    state.active_scene_label =
      sceneDisplayLabel(WORKSPACE, info.campaign_id, sceneId, lang);
  } else {
    state.active_scene_label = null;
  }
  state.display_title = campaignDisplayTitle(WORKSPACE, info.campaign_id, {
    openingPhase: state.opening_phase,
    activeSceneLabel: state.active_scene_label,
    investigatorName: state.character?.name ?? null,
  });
  const tension = state.tension_level;
  state.tension_label =
    typeof tension === "string" && tension
      ? tensionDisplayLabel(tension, lang) || tension
      : null;
  state.discovered_clues = discoveredCluesDisplay(
    WORKSPACE,
    info.campaign_id,
    state.discovered_clue_ids,
    lang,
  );
  state.combat = combatInitiativeDisplay(WORKSPACE, info.campaign_id, {
    investigatorId: liveInvestigator,
    investigatorName: state.character?.name ?? null,
  });
  const handoff = orchestrator.statusOf(info.campaign_id);
  state.session_role = handoff.session_role;
  state.transitioning = handoff.transitioning;
  return state;
}

/** Last settled turn's keeper token usage from runtime telemetry (or null). */
function lastTelemetryUsage(campaignId) {
  const telemetryPath = path.join(
    campaignDir(WORKSPACE, campaignId),
    "logs",
    "runtime-telemetry.jsonl",
  );
  let last = null;
  try {
    const lines = fs.readFileSync(telemetryPath, "utf8").split("\n").filter(Boolean);
    if (lines.length) last = JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
  const usage = last?.telemetry;
  if (!usage || typeof usage !== "object") return null;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  if (!Number.isInteger(input) && !Number.isInteger(output)) return null;
  return {
    input_tokens: Number.isInteger(input) ? input : null,
    output_tokens: Number.isInteger(output) ? output : null,
  };
}

async function transcriptPayload(info) {
  const timed = tableTranscriptMessages(WORKSPACE, info.campaign_id);
  if (timed !== null) return timed;
  const hosted = hostedSessionMessages({
    workspace: WORKSPACE,
    agentDir: resolveProductAgentDir(),
    sessionId: info.session_id || webSessionId(info.campaign_id),
  });
  if (hosted.length) return hosted;
  const base = await sidecar.request("public_transcript_base", {
    campaign_id: info.campaign_id,
    limit: 10000,
  });
  const messages = Array.isArray(base?.messages) ? base.messages : [];
  return enrichTranscriptFromEvents(WORKSPACE, info.campaign_id, messages);
}

function playerVisibleTurnError(err) {
  const kind = err instanceof PiCocRpcError
    ? err.kind
    : err instanceof SidecarError
      ? err.kind
      : null;
  const name = err instanceof SidecarError ? err.errorClass : err?.constructor?.name || "";
  const text = err?.message || "";
  if (kind === "pi_coc_rpc_handoff") {
    return "战役正在从建卡会话切换到开桌会话，请稍候。";
  }
  if (kind === "pi_coc_rpc_exited" || kind === "pi_coc_rpc_failed") {
    return `pi-coc 宿主异常：${text || name}`;
  }
  if (kind === "pi_coc_rpc_timeout") {
    return "pi-coc 本回合超时。请刷新后确认对话是否已落盘，再重试同一行动。";
  }
  if (kind === "pi_coc_rpc_rejected") {
    return `pi-coc 未接受该输入：${text || name}`;
  }
  if (kind === "pi_coc_rpc_aborted") {
    return "已停止本回合。";
  }
  if (text && text !== name) return `${name}: ${text}`;
  return text || name || "未知错误";
}

// ---------------------------------------------------------------------------
// Investigator payloads (shared by /api/investigators and attach)

function buildInvestigatorCreateOperation(body, { investigatorId } = {}) {
  const name = String(body.name || "").trim();
  const occupation = String(body.occupation || "").trim() || "调查员";
  const era = String(body.era || "1920s").trim() || "1920s";
  const age = Number.parseInt(body.age ?? 28, 10);
  if (Number.isNaN(age)) throw httpError(400, "age must be an integer");
  if (age < 15 || age > 90) throw httpError(400, "age must be between 15 and 90");
  if (!name) throw httpError(400, "name is required");
  const luckTotal = Number.parseInt(body.luck_roll_total ?? 12, 10);
  if (Number.isNaN(luckTotal)) throw httpError(400, "luck_roll_total must be an integer");
  if (luckTotal < 3 || luckTotal > 18) {
    throw httpError(400, "luck_roll_total must be 3–18 (3D6 total)");
  }
  const id =
    investigatorId ||
    String(body.investigator_id || "").trim() ||
    `${slugify(name, "investigator").slice(0, 40)}-${timestampCompact()}`;
  return {
    id,
    operation: {
      schema_version: 1,
      kind: "investigator.create",
      payload: {
        investigator_id: id,
        sheet: {
          id,
          name,
          occupation,
          era,
          age,
          skills: {
            "Credit Rating": 20,
            "Spot Hidden": 40,
            Listen: 30,
            "Library Use": 30,
          },
        },
        creation: {
          method: "quick_fire_array",
          characteristic_assignment_order: [
            "INT",
            "POW",
            "DEX",
            "EDU",
            "CON",
            "APP",
            "SIZ",
            "STR",
          ],
          luck_roll_total: luckTotal,
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// API handlers

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    workspace: WORKSPACE,
    sessions: SESSIONS.size,
    hosts: HOSTS.size,
    dist_built: fs.existsSync(DIST_DIR),
    bridge: "node",
    turn_channel: "pi-coc-rpc",
  });
}

async function handleModels(_req, res) {
  sendJson(res, 200, modelsPayload());
}

async function handleModelEditor(_req, res) {
  sendJson(res, 200, await getModelEditorState({ payloadRoot: REPO_ROOT }));
}

async function handleSaveModelEditor(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, await saveModelEditorList(body, { payloadRoot: REPO_ROOT }));
}

async function handleSaveModelEditorProvider(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, await saveApiKeyProvider(resolveProductAgentDir(), body));
}

function handleUserPrefs(_req, res) {
  sendJson(res, 200, loadUserPrefs(resolveUserPrefsPath()));
}

async function handleSaveUserPrefs(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, saveUserPrefs(resolveUserPrefsPath(), body));
}

function handleWebSearchKeys(_req, res) {
  sendJson(res, 200, loadWebSearchKeysView(resolveProductAgentDir()));
}

async function handleSaveWebSearchKeys(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, saveWebSearchApiKeys(resolveProductAgentDir(), body));
}

function handleOcrToken(_req, res) {
  sendJson(res, 200, loadOcrTokenView());
}

async function handleSaveOcrToken(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, saveOcrToken(body));
}

async function handleGeneratePortrait(req, res) {
  const body = await readJsonBody(req);
  const ac = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  if (body && typeof body.investigator_id === "string" && body.investigator_id.trim()) {
    parseInvestigatorPortraitBody(body);
    const result = await generateInvestigatorPortrait({
      workspace: WORKSPACE,
      repoRoot: REPO_ROOT,
      campaignId: body.campaign_id,
      investigatorId: body.investigator_id,
      signal: ac.signal,
      prefs: loadUserPrefs(resolveUserPrefsPath()),
      clientBody: body,
      agentDir: resolveProductAgentDir(),
    });
    sendJson(res, 200, result);
    return;
  }
  const parsed = parseGeneratePortraitBody(body);
  const result = await generateCampaignPortrait({
    workspace: WORKSPACE,
    ...parsed,
    signal: ac.signal,
  });
  sendJson(res, 200, result);
}

function handleInvestigatorPortrait(req, res, investigatorId, filename) {
  const resolved = resolvePortraitStaticFile(WORKSPACE, investigatorId, filename);
  if (!resolved) {
    sendJson(res, 404, { error: "portrait not found" });
    return;
  }
  const body = fs.readFileSync(resolved.file);
  res.writeHead(200, {
    "Content-Type": resolved.mime,
    "Content-Length": body.length,
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

async function handleStartModelLogin(req, res) {
  const body = await readJsonBody(req);
  sendJson(
    res,
    200,
    await startProviderLogin({
      payloadRoot: REPO_ROOT,
      agentDir: resolveProductAgentDir(),
      providerId: body.providerId,
      method: body.method,
    }),
  );
}

function handleModelLoginSnapshot(_req, res) {
  sendJson(res, 200, loginSnapshot());
}

async function handleModelLoginRespond(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, 200, respondLoginPrompt(body));
}

function handleModelLoginCancel(_req, res) {
  sendJson(res, 200, cancelLogin());
}

async function handleBootstrap(_req, res) {
  const result = await sidecar.request("setup_workspace", {
    operation: { schema_version: 1, kind: "onboarding.inspect", payload: {} },
  });
  const campaigns = result?.result?.campaigns;
  if (Array.isArray(campaigns)) {
    await Promise.all(
      campaigns.map(async (summary) => {
        if (summary && typeof summary === "object" && summary.campaign_id) {
          const compat = await sidecar.request("campaign_compat", {
            campaign_id: summary.campaign_id,
          });
          const extras = campaignListExtras(WORKSPACE, summary.campaign_id);
          Object.assign(summary, compat, extras);
          const sceneId = resolvePlaySceneId(WORKSPACE, summary.campaign_id);
          const sceneLabel = sceneDisplayLabel(
            WORKSPACE,
            summary.campaign_id,
            sceneId,
            "zh-Hans",
          );
          const openingPhase = await campaignOpeningPhase(summary.campaign_id);
          summary.title = campaignDisplayTitle(WORKSPACE, summary.campaign_id, {
            openingPhase,
            activeSceneLabel: sceneLabel,
            investigatorName: extras.investigator_name,
          });
        }
      }),
    );
  }
  if (result?.result && typeof result.result === "object") {
    result.result.source_bundles = listSourceBundles(WORKSPACE);
    const lib = await sidecar.request("list_library_modules", {});
    result.result.library_modules = Array.isArray(lib?.modules) ? lib.modules : [];
  }
  sendJson(res, 200, result);
}

async function handleDeleteSourceBundle(_req, res, bundleId) {
  const result = deleteSourceBundle(WORKSPACE, bundleId);
  sendJson(res, 200, result);
}

async function handleCreateInvestigator(req, res) {
  const body = await readJsonBody(req);
  const { operation } = buildInvestigatorCreateOperation(body);
  const receipt = await sidecar.request("setup_workspace", { operation });
  sendJson(res, 200, receipt);
}

async function handleCreateCampaign(req, res) {
  const body = await readJsonBody(req);
  const mode = String(body.mode || "starter").trim() || "starter";
  if (mode === "pdf") return handleCreateCampaignFromPdf(res, body);
  if (mode === "library") return handleCreateCampaignFromLibrary(res, body);

  const payload = {
    scenario_id: String(body.scenario_id || "").trim(),
    // pregen_id optional: without it the campaign ships scenario-ready but
    // investigator-less (needs_investigator), like the pdf/library paths, so
    // character creation can run through play (coc-character).
    pregen_id: String(body.pregen_id || "").trim() || null,
  };
  if (!payload.scenario_id) {
    throw httpError(400, "scenario_id is required");
  }
  for (const key of ["campaign_id", "title"]) {
    const value = String(body[key] || "").trim();
    if (value) payload[key] = value;
  }
  // Always suffix a unique token. The starter default ("{scenario}-qs") is
  // reused after trash because live-dir checks miss .coc/trash/campaigns/,
  // and pi sessions are keyed by campaign id.
  if (!payload.campaign_id) {
    payload.campaign_id = `${payload.scenario_id}-qs-${Date.now().toString(36)}`;
  } else if (campaignIdConflicts(payload.campaign_id)) {
    throw httpError(
      409,
      `campaign ${payload.campaign_id} already exists (live or trash)`,
    );
  }
  const result = await sidecar.request("setup_workspace", {
    operation: { schema_version: 1, kind: "campaign.quick_start", payload },
  });
  sendJson(res, 200, result);
}

async function handleCreateCampaignFromLibrary(res, body) {
  const moduleId = String(body.canonical_module_id || "").trim();
  const investigatorId = String(body.investigator_id || "").trim();
  if (!moduleId) {
    throw httpError(400, "canonical_module_id is required for 已解析剧本开局");
  }
  const entryDir = path.join(cocRoot(WORKSPACE), "module-library", moduleId);
  if (!fs.existsSync(entryDir)) throw httpError(400, `未知剧本库条目：${moduleId}`);
  let title = String(body.title || "").trim();
  if (!title) {
    title = moduleId;
    const identity = readJsonFile(path.join(entryDir, "identity.json"));
    if (identity && typeof identity === "object") {
      for (const key of ["canonical_title", "title"]) {
        if (typeof identity[key] === "string" && identity[key].trim()) {
          title = identity[key].trim();
          break;
        }
      }
    }
  }
  const slug = slugify(moduleId, "library");
  const campaignId =
    String(body.campaign_id || "").trim() ||
    `lib-${slug.slice(0, 40)}-${timestampIso()}`;
  try {
    const created = await sidecar.request("setup_workspace", {
      operation: {
        schema_version: 1,
        kind: "campaign.create",
        payload: { campaign_id: campaignId, title, play_language: "zh-Hans" },
      },
    });
    const installed = await sidecar.request("install_module", {
      module_id: moduleId,
      campaign_id: campaignId,
    });
    let linked = null;
    if (investigatorId) {
      linked = await sidecar.request("setup_workspace", {
        operation: {
          schema_version: 1,
          kind: "campaign.link_investigator",
          payload: { campaign_id: campaignId, investigator_ids: [investigatorId] },
        },
      });
    }
    sendJson(res, 200, {
      schema_version: 1,
      status: "PASS",
      kind: "campaign.library_start",
      result: {
        campaign_id: campaignId,
        canonical_module_id: moduleId,
        investigator_id: investigatorId || null,
        needs_investigator: !investigatorId,
        create: created?.result ?? created,
        install: installed,
        link: linked?.result ?? linked,
      },
    });
  } catch (err) {
    throw httpError(400, err?.message || String(err));
  }
}

async function handleCreateCampaignFromPdf(res, body) {
  const sourceBundlePath = String(body.source_bundle_path || "").trim();
  const investigatorId = String(body.investigator_id || "").trim();
  if (!sourceBundlePath) {
    throw httpError(400, "source_bundle_path is required for PDF 开局");
  }
  const bundle = path.resolve(sourceBundlePath.replace(/^~/, process.env.HOME || "~"));
  if (!fs.existsSync(bundle) || !fs.existsSync(path.join(bundle, "manifest.json"))) {
    throw httpError(
      400,
      "PDF 开局需要已解析的源包目录（含 manifest.json）。" +
        "仓库不直接解析 PDF；请先用外部 PDF skill / mineru 等产出 source bundle。",
    );
  }
  const title = String(body.title || "").trim() || path.basename(bundle);
  // Player-declared era for raw-PDF 开局; omitted → stays unestablished and
  // character creation is blocked by the kernel's era gate.
  const era = String(body.era || "").trim();
  const slug = slugify(path.basename(bundle), "pdf-module");
  const stamp = timestampIso();
  const campaignId =
    String(body.campaign_id || "").trim() || `pdf-${slug.slice(0, 40)}-${stamp}`;
  // Unique scenario identity per campaign so source-cache pages never collide
  // with an earlier bind of the same bundle name.
  const scenarioId = String(body.scenario_id || "").trim() || `${slug.slice(0, 40)}-${stamp}`;
  try {
    const created = await sidecar.request("setup_workspace", {
      operation: {
        schema_version: 1,
        kind: "campaign.create",
        payload: {
          campaign_id: campaignId,
          title,
          play_language: "zh-Hans",
          ...(era ? { era } : {}),
        },
      },
    });
    const bound = await sidecar.request("setup_workspace", {
      operation: {
        schema_version: 1,
        kind: "scenario.bind_pdf",
        payload: {
          campaign_id: campaignId,
          scenario_id: scenarioId,
          title,
          source_bundle_path: bundle,
          // Progressive binding: no cold compiler required.
          compile_now: false,
        },
      },
    });
    let linked = null;
    if (investigatorId) {
      linked = await sidecar.request("setup_workspace", {
        operation: {
          schema_version: 1,
          kind: "campaign.link_investigator",
          payload: { campaign_id: campaignId, investigator_ids: [investigatorId] },
        },
      });
    }
    sendJson(res, 200, {
      schema_version: 1,
      status: "PASS",
      kind: "campaign.pdf_start",
      result: {
        campaign_id: campaignId,
        scenario_id: scenarioId,
        investigator_id: investigatorId || null,
        needs_investigator: !investigatorId,
        source_bundle_path: bundle,
        create: created?.result ?? created,
        bind: bound?.result ?? bound,
        link: linked?.result ?? linked,
      },
    });
  } catch (err) {
    const message = err?.message || String(err);
    if (message.toLowerCase().includes("content drift")) {
      throw httpError(
        400,
        "该 PDF 已在本工作区以不同页面内容写入模块缓存，" +
          "不能用这份源包覆盖旧证据。" +
          "请换用与缓存一致的源包，或在干净工作区开局；" +
          `技术细节：${message}`,
      );
    }
    throw httpError(400, message);
  }
}

async function handleAttachInvestigator(req, res) {
  const body = await readJsonBody(req);
  const campaignId = String(body.campaign_id || "").trim();
  if (!campaignId) throw httpError(400, "campaign_id is required");
  const compat = await sidecar.request("campaign_compat", { campaign_id: campaignId });
  if (compat.exists !== true) throw httpError(400, `未知战役：${campaignId}`);
  if (compat.compatible !== true) {
    throw httpError(400, `战役 ${campaignId} 是旧版存档，无法挂接调查员。`);
  }
  let investigatorId = String(body.investigator_id || "").trim();
  let createdReceipt = null;
  if (!investigatorId) {
    const built = buildInvestigatorCreateOperation(body);
    investigatorId = built.id;
    createdReceipt = await sidecar.request("setup_workspace", {
      operation: built.operation,
    });
  }
  const linked = await sidecar.request("setup_workspace", {
    operation: {
      schema_version: 1,
      kind: "campaign.link_investigator",
      payload: { campaign_id: campaignId, investigator_ids: [investigatorId] },
    },
  });
  sendJson(res, 200, {
    schema_version: 1,
    status: "PASS",
    kind: "campaign.attach_investigator",
    result: {
      campaign_id: campaignId,
      investigator_id: investigatorId,
      created: createdReceipt?.result ?? createdReceipt,
      link: linked?.result ?? linked,
    },
  });
}

// ---------------------------------------------------------------------------
// Campaign admin (rename / trash / restore — semantics live in the sidecar's
// campaign_admin module; this layer only closes live sessions around a trash)

async function handleRenameCampaign(req, res) {
  const body = await readJsonBody(req);
  const campaignId = String(body.campaign_id || "").trim();
  if (!campaignId) throw httpError(400, "campaign_id is required");
  if (body.title == null) throw httpError(400, "title is required");
  const result = await sidecar.request("campaign_rename", {
    campaign_id: campaignId,
    title: body.title,
  });
  sendJson(res, 200, { ok: true, result });
}

async function handleTrashCampaign(req, res) {
  const body = await readJsonBody(req);
  const campaignId = String(body.campaign_id || "").trim();
  if (!campaignId) throw httpError(400, "campaign_id is required");
  // Close this campaign's host first so a hung or user-stopped turn cannot
  // block trash. A failed trash just means the player reopens the campaign.
  for (const [sid, info] of [...SESSIONS]) {
    if (info.campaign_id !== campaignId) continue;
    SESSIONS.delete(sid);
  }
  const host = HOSTS.get(campaignId);
  if (host) {
    HOSTS.delete(campaignId);
    try {
      await host.close();
    } catch {
      /* the campaign moves anyway */
    }
  }
  const result = await sidecar.request("campaign_trash", {
    campaign_id: campaignId,
  });
  sendJson(res, 200, { ok: true, result });
}

async function handleListTrash(_req, res) {
  // The sidecar purges expired entries lazily while listing.
  const result = await sidecar.request("campaign_trash_list", {});
  sendJson(res, 200, { ok: true, entries: Array.isArray(result?.entries) ? result.entries : [] });
}

async function handleRestoreTrash(req, res) {
  const body = await readJsonBody(req);
  const trashKey = String(body.trash_key || "").trim();
  if (!trashKey) throw httpError(400, "trash_key is required");
  const result = await sidecar.request("campaign_trash_restore", {
    trash_key: trashKey,
  });
  sendJson(res, 200, { ok: true, result });
}

async function handleCreateSession(req, res) {
  const body = await readJsonBody(req);
  const campaignId = String(body.campaign_id || "").trim();
  if (!campaignId) throw httpError(400, "campaign_id is required");
  const compat = await sidecar.request("campaign_compat", { campaign_id: campaignId });
  if (compat.exists !== true) throw httpError(400, `未知战役：${campaignId}`);
  if (compat.compatible !== true) {
    throw httpError(
      400,
      `战役 ${campaignId} 是旧版存档（schema v${compat.schema_version}）。` +
        "当前运行时按清洁重开策略只接受 v2 战役，不做迁移；" +
        "请从左侧「＋ 新战役」开局。",
    );
  }
  // id-selection only (which sheet to project); lifecycle comes from the phase.
  const investigatorId = String(body.investigator_id || "").trim()
    || resolveInvestigator(campaignId)
    || "";
  const sessionId = webSessionId(campaignId);
  const selectedModel = resolveRequestedModelSettings(modelsPayload(), body);
  const openingPhase = await campaignOpeningPhase(campaignId);
  const tableIntent = await resolveTableIntent(campaignId, openingPhase);
  let host = HOSTS.get(campaignId);
  let spawned = false;
  if (!host || host.closed) {
    const acquired = await orchestrator.acquire(campaignId, {
      repoRoot: REPO_ROOT,
      workspace: WORKSPACE,
      sessionId,
      tableIntent,
      ...selectedModel,
    });
    host = acquired.host;
    spawned = acquired.spawned;
  }
  const info = {
    session_id: sessionId,
    campaign_id: campaignId,
    investigator_id: investigatorId,
  };
  SESSIONS.set(sessionId, info);
  const opening = sessionOpeningFlags({
    spawned,
    phase: openingPhase?.phase ?? null,
    tableIntent,
  });
  sendJson(res, 200, {
    session_id: sessionId,
    character_setup: opening.character_setup,
    host: "pi-coc",
    host_opening: opening.host_opening,
    campaign_id: campaignId,
    investigator_id: investigatorId,
    state: await statePayload(info),
  });
}

async function handleState(req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) throw httpError(404, "unknown session");
  sendJson(res, 200, await statePayload(info));
}

async function handleUseItem(req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) throw httpError(404, "unknown session");
  if (turnInFlight) throw httpError(409, "回合进行中，请等待 KP 结算后再使用物品。");
  const body = await readJsonBody(req);
  const itemId = String(body.item_id || "").trim();
  if (!itemId) throw httpError(400, "item_id is required");
  const investigatorId = resolveInvestigator(info.campaign_id);
  if (!investigatorId) throw httpError(400, "调查员尚未创建。");
  try {
    await sidecar.request("item_use", {
      campaign_id: info.campaign_id,
      investigator_id: investigatorId,
      item_id: itemId,
    });
  } catch (err) {
    throw httpError(400, err?.message || "使用物品失败。");
  }
  sendJson(res, 200, await statePayload(info));
}

async function handleTranscript(req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) throw httpError(404, "unknown session");
  sendJson(res, 200, { messages: await transcriptPayload(info) });
}

// ---------------------------------------------------------------------------
// Turn SSE

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleTurn(req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) {
    sendJson(res, 404, { error: "unknown session" });
    return;
  }
  const body = await readJsonBody(req);
  const attach = body.attach === true;
  const playerInput = String(body.input || "").trim();
  if (!attach && !playerInput) throw httpError(400, "input is required");
  if (!attach && orchestrator.isTransitioning(info.campaign_id)) {
    sendJson(res, 409, {
      error: "战役正在从建卡会话切换到开桌会话，请稍候。",
      code: SESSION_TRANSITIONING_CODE,
    });
    return;
  }
  const selectedModel = resolveRequestedModelSettings(modelsPayload(), body);
  const { provider, model, thinking } = selectedModel;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  if (turnInFlight) {
    sseWrite(res, "error", { message: "另一个回合仍在进行，请等待它结束。" });
    res.end();
    return;
  }
  turnInFlight = true;

  let clientGone = false;
  let finished = false;
  res.on("close", () => {
    clientGone = true;
    if (finished) return;
    const host = HOSTS.get(info.campaign_id);
    if (host && !host.closed) {
      host.abort().catch(() => {});
    }
  });
  const heartbeat = setInterval(() => {
    if (!clientGone) res.write(": ping\n\n");
  }, 15000);

  const safeWrite = (event, data) => {
    if (clientGone) return false;
    sseWrite(res, event, data);
    return true;
  };
  const onSse = (frame) => safeWrite(frame.event, frame.data);
  const finalize = async (activeHost) => {
    let state;
    try {
      state = await statePayload(info);
    } catch (err) {
      state = { error: `${err?.constructor?.name || "Error"}: ${err?.message || err}` };
    }
    const usage = activeHost.lastUsage;
    safeWrite("turn", {
      events: [],
      state,
      usage: usage
        ? {
            input_tokens: Number.isInteger(usage.input) ? usage.input : null,
            output_tokens: Number.isInteger(usage.output) ? usage.output : null,
          }
        : lastTelemetryUsage(info.campaign_id),
    });
    safeWrite("end", {});
  };

  try {
    let host = HOSTS.get(info.campaign_id);
    let handoffOpeningCompleted = false;
    if (
      host?.isHandoffShutdown?.()
      || orchestrator.isTransitioning(info.campaign_id)
    ) {
      host = await orchestrator.completeHandoffOpening(info.campaign_id, {
        reason: "turn_wait",
        onSse,
      });
      handoffOpeningCompleted = true;
    }
    if (!host || host.closed) {
      throw new PiCocRpcError("pi-coc 宿主未启动；请刷新后重开战役。");
    }
    safeWrite("status", { phase: "accepted" });
    if (provider && model) {
      try {
        await host.setModel(provider, model);
      } catch (err) {
        if (!isStaleModelCatalogError(err)) {
          safeWrite("error", { message: `无法切换模型：${err?.message || err}` });
          return;
        }
        try {
          host = await orchestrator.restartForModel(info.campaign_id, {
            provider,
            model,
            thinking,
          });
        } catch (restartError) {
          safeWrite("error", {
            message: `刷新模型目录失败：${restartError?.message || restartError}`,
          });
          return;
        }
      }
    }
    if (thinking) await host.setThinking(thinking);
    let promptResult = {};
    if (attach) {
      if (!handoffOpeningCompleted) await host.attachOpening({ onSse });
    } else {
      promptResult = (await host.prompt(playerInput, { onSse })) || {};
    }
    const delivery = host.takeStreamedDelivery();
    if (delivery !== null) {
      safeWrite("delivery_ack_required", {
        finalization_id: delivery.finalizationId,
        rendered_sha256: delivery.renderedSha256,
      });
    }
    host = await finishPromptTurn({
      host,
      promptResult,
      campaignId: info.campaign_id,
      orchestrator,
      onSse,
      finalize,
    });
  } catch (err) {
    if (err?.kind === "pi_coc_rpc_aborted") {
      safeWrite("end", { aborted: true });
    } else if (err?.kind === "pi_coc_rpc_handoff") {
      try {
        await finishPromptTurn({
          host: HOSTS.get(info.campaign_id),
          promptResult: { handoff: true },
          campaignId: info.campaign_id,
          orchestrator,
          onSse,
          finalize,
        });
      } catch (handoffErr) {
        safeWrite("error", { message: handoffErr?.message || String(handoffErr) });
      }
    } else if (err?.code === "session_handoff_failed") {
      safeWrite("error", { message: err.message });
    } else {
      safeWrite("error", { message: playerVisibleTurnError(err) });
    }
  } finally {
    finished = true;
    clearInterval(heartbeat);
    turnInFlight = false;
    res.end();
  }
}

async function handleAbortTurn(_req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) throw httpError(404, "unknown session");
  const host = HOSTS.get(info.campaign_id);
  if (host && !host.closed) {
    try {
      await host.abort();
    } catch {
      /* best effort */
    }
  }
  sendJson(res, 200, { ok: true, aborted: true });
}

async function handleDeliveryAck(req, res, sid) {
  const info = SESSIONS.get(sid);
  if (!info) throw httpError(404, "unknown session");
  const host = HOSTS.get(info.campaign_id);
  if (!host || host.closed) throw httpError(409, "pi-coc host is unavailable");
  const body = await readJsonBody(req);
  const finalizationId = String(body.finalization_id || "");
  const renderedSha256 = String(body.rendered_sha256 || "");
  if (!finalizationId || !renderedSha256) {
    throw httpError(400, "finalization_id and rendered_sha256 are required");
  }
  const result = await host.acknowledgeDisplayedDelivery({
    finalizationId,
    renderedSha256,
  }, `web-ui:${sid}`);
  sendJson(res, 200, { ok: true, delivery: result?.data ?? null });
}

// ---------------------------------------------------------------------------
// PDF upload (hash + dedupe only; repository never parses PDFs)

const PDF_MAX_BYTES = 200 * 1024 * 1024;

/** Minimal multipart/form-data extraction for a single `file` field. */
function parseMultipartFile(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw httpError(400, "PDF 上传需要 multipart/form-data");
  const boundary = Buffer.from(`--${match[1] || match[2]}`, "latin1");
  const headerEnd = Buffer.from("\r\n\r\n", "latin1");
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    let partStart = cursor + boundary.length;
    if (body.subarray(partStart, partStart + 2).toString("latin1") === "--") break;
    if (body.subarray(partStart, partStart + 2).toString("latin1") === "\r\n") {
      partStart += 2;
    }
    const headersEnd = body.indexOf(headerEnd, partStart);
    if (headersEnd === -1) break;
    const headers = body.subarray(partStart, headersEnd).toString("latin1");
    const nextBoundary = body.indexOf(boundary, headersEnd + headerEnd.length);
    if (nextBoundary === -1) break;
    // Strip the CRLF immediately preceding the next boundary marker.
    let contentEnd = nextBoundary;
    if (contentEnd >= headersEnd + headerEnd.length + 2) contentEnd -= 2;
    const content = body.subarray(headersEnd + headerEnd.length, contentEnd);
    const disposition = /content-disposition:[^\n]*/i.exec(headers)?.[0] || "";
    if (/name="file"/i.test(disposition) || /filename=/i.test(disposition)) {
      const filenameMatch = /filename\*?=(?:UTF-8'')?"([^"]*)"|filename\*?=(?:UTF-8'')?([^;\s]*)/i.exec(
        disposition,
      );
      let filename = "upload.pdf";
      if (filenameMatch) {
        const raw = filenameMatch[1] ?? filenameMatch[2] ?? "";
        try {
          const percentDecoded = decodeURIComponent(raw);
          const utf8Decoded = Buffer.from(percentDecoded, "latin1").toString("utf8");
          filename = (
            utf8Decoded && !utf8Decoded.includes("\uFFFD")
              ? utf8Decoded
              : percentDecoded
          ) || filename;
        } catch {
          filename = raw || filename;
        }
      }
      if (content.length) return { filename, data: Buffer.from(content) };
    }
    cursor = nextBoundary === -1 ? -1 : nextBoundary;
  }
  throw httpError(400, "缺少 file 字段或文件为空");
}

/**
 * Shared registration tail for both PDF import transports (browser multipart
 * upload and the desktop shell's local-path import): hash, dedupe into
 * .coc/uploads/pdfs/, and match against existing source bundles. The
 * repository never parses the PDF — existence/suffix/hash only.
 */
function registerPdfUpload({ filename, data }) {
  if (!filename.toLowerCase().endsWith(".pdf")) {
    throw httpError(400, "仅支持 .pdf 文件");
  }
  if (data.length > PDF_MAX_BYTES) throw httpError(400, "PDF 超过 200MB 上限");
  if (data.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw httpError(400, "文件不是有效的 PDF（缺少 %PDF 头）");
  }
  const fileSha256 = sha256Bytes(data);
  const matched = findBundleByPdfSha256(WORKSPACE, fileSha256);
  const originalBase = path.basename(filename);
  const safeStem = originalBase
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 76) || "upload";
  const safeName = `${safeStem}.pdf`;
  const uploadsDir = path.join(cocRoot(WORKSPACE), "uploads", "pdfs");
  fs.mkdirSync(uploadsDir, { recursive: true });
  let stored = path.join(uploadsDir, `${fileSha256.slice(0, 16)}_${safeName}`);
  if (!fs.existsSync(stored)) {
    fs.writeFileSync(stored, data);
  } else if (sha256File(stored) !== fileSha256) {
    stored = path.join(uploadsDir, `${fileSha256}_${safeName}`);
    fs.writeFileSync(stored, data);
  }
  const payload = {
    filename,
    file_sha256: fileSha256,
    stored_path: path.resolve(stored),
    size_bytes: data.length,
    location_hint: `.coc/uploads/pdfs/${path.basename(stored)}`,
  };
  if (matched) {
    payload.status = "matched_bundle";
    payload.matched_bundle = matched;
    payload.message = "已找到相同哈希的 PDF 源包，可直接用该源包开局。";
  } else {
    payload.status = "stored_pending_ingest";
    payload.matched_bundle = null;
    payload.message =
      "PDF 已按哈希登记到 .coc/uploads/pdfs/；工作区尚无匹配源包。" +
      "仓库不解析 PDF，请用 mineru / 外部 PDF skill 生成 " +
      ".coc/source-bundles/<id>/ 后再开局。";
    payload.source_bundles_dir = path.resolve(path.join(cocRoot(WORKSPACE), "source-bundles"));
  }
  return payload;
}

async function handleUploadPdf(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw httpError(400, "PDF 上传需要 multipart/form-data");
  }
  const rawBody = await readBody(req, { limit: PDF_MAX_BYTES + 64 * 1024 });
  const { filename, data } = parseMultipartFile(rawBody, contentType);
  sendJson(res, 200, { ok: true, result: registerPdfUpload({ filename, data }) });
}

/**
 * Desktop-shell import transport: the Electron menu / onboarding wizard can
 * only hand over a local filesystem path (no browser File object), so the
 * bridge copies the file into the same .coc/uploads/pdfs/ registration the
 * multipart endpoint produces. From here the chain is identical:
 * /api/uploads/pdf/ingest -> external router -> coc_pdf_bundle.py validation.
 */
async function handleUploadPdfFromPath(req, res) {
  const body = await readJsonBody(req);
  const raw = typeof body?.path === "string" ? body.path.trim() : "";
  if (!raw) throw httpError(400, "缺少 path 字段（本地 PDF 文件路径）");
  const resolved = path.resolve(raw);
  let stat = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    throw httpError(404, `找不到文件：${resolved}`);
  }
  if (stat.size > PDF_MAX_BYTES) throw httpError(400, "PDF 超过 200MB 上限");
  const data = fs.readFileSync(resolved);
  sendJson(res, 200, {
    ok: true,
    result: registerPdfUpload({ filename: path.basename(resolved), data }),
  });
}

// ---------------------------------------------------------------------------
// PDF ingest (external firecrawl router -> schema-v1 bundle -> repo validation)
//
// The repository still never parses PDFs itself: this endpoint shells out to
// the external coc-pi-pdf-inspector-router (COC_PI_PDF_INSPECTOR_COMMAND, or
// the default ~/.pi/coc-tools/pdf-inspector install) and then validates the
// produced bundle through plugins/coc-keeper/scripts/coc_pdf_bundle.py. Both
// steps are fail-closed with player-readable Chinese errors.

const INGEST_WINDOW_MAX = 32; // router MAX_PAGES per batch
const INGEST_ROUTER_TIMEOUT_MS = 300_000;
const INGEST_REQUEST_CONTRACT = "coc.pi-pdf-inspector-request.v1";
const INGEST_RESULT_CONTRACT = "coc.pi-pdf-inspector-result.v1";
const INGEST_PRODUCER_LITERAL = "codex-pdf-skill";

/** sha256 -> true while an ingest for that PDF is running (memory lock). */
const INGEST_LOCKS = new Map();

function resolvePdfInspectorCommand() {
  const candidates = [];
  const configured = (process.env.COC_PI_PDF_INSPECTOR_COMMAND || "").trim();
  if (configured) candidates.push(path.resolve(configured));
  candidates.push(
    path.join(
      os.homedir(),
      ".pi",
      "coc-tools",
      "pdf-inspector",
      "coc-pi-pdf-inspector-router",
    ),
  );
  for (const candidate of candidates) {
    try {
      if (
        path.isAbsolute(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Run one router envelope round-trip; resolves with the parsed result. */
function runPdfInspector(request) {
  return new Promise((resolve, reject) => {
    const command = resolvePdfInspectorCommand();
    if (!command) {
      reject(
        httpError(
          503,
          "外部 PDF 解析路由器不可用：请安装 coc-pi-pdf-inspector-router，" +
            "或导出 COC_PI_PDF_INSPECTOR_COMMAND 指向其可执行文件" +
            "（缺省查找 ~/.pi/coc-tools/pdf-inspector/coc-pi-pdf-inspector-router）。" +
            "仓库本身不解析 PDF。",
        ),
      );
      return;
    }
    const child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(httpError(504, "PDF 解析超时（300 秒），请稍后重试。"));
    }, INGEST_ROUTER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(httpError(502, `解析路由器启动失败：${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result = null;
      try {
        result = JSON.parse(stdout.trim().split("\n").pop());
      } catch {
        result = null;
      }
      if (!result || result.contract_id !== INGEST_RESULT_CONTRACT) {
        reject(
          httpError(
            502,
            `解析路由器输出无效（exit=${code}）：${String(stderr || stdout).slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(result);
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

/** Canonical repository validation of one bundle directory. */
function validateBundleDir(bundleDir) {
  return new Promise((resolve) => {
    const output = path.join(
      cocRoot(WORKSPACE),
      "pdf-cache",
      "bundle-validation",
      `${path.basename(bundleDir)}.json`,
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const child = spawn(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "plugins/coc-keeper/scripts/coc_pdf_bundle.py",
        bundleDir,
        "--output",
        output,
      ],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => resolve({ ok: false, error: `uv 启动失败：${err.message}` }));
    child.on("close", (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.trim().slice(-800) }),
    );
  });
}

function findRegisteredPdf(fileSha256) {
  const dir = path.join(cocRoot(WORKSPACE), "uploads", "pdfs");
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const digest = String(fileSha256).toLowerCase();
  const ordered = [...entries].sort((a, b) => {
    // Prefer a valid PDF suffix, then cheap name-prefix candidates, before
    // hashing. Older builds could truncate long names after stripping .pdf;
    // such stale duplicates must never win over a valid registered PDF.
    const pdf = (name) => Number(name.toLowerCase().endsWith(".pdf"));
    const hit = (name) =>
      name.toLowerCase().startsWith(`${digest.slice(0, 16)}_`) ||
      name.toLowerCase().startsWith(`${digest}_`);
    return pdf(b) - pdf(a)
      || Number(hit(b)) - Number(hit(a))
      || a.localeCompare(b);
  });
  for (const name of ordered) {
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isFile() && sha256File(full) === digest) return full;
    } catch {
      /* unreadable entry */
    }
  }
  return null;
}

function ingestIdentity(storedPath) {
  const base = path
    .basename(storedPath)
    .replace(/^[0-9a-f]{16}_/i, "")
    .replace(/\.pdf$/i, "");
  const slug = slugify(base, "pdf-source");
  const title = base.replace(/_+/g, " ").trim() || slug;
  return { slug, title };
}

function parseIngestIndices(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > INGEST_WINDOW_MAX) {
    throw httpError(400, `pdf_indices 必须是 1..${INGEST_WINDOW_MAX} 个页码`);
  }
  if (raw.some((value) => !Number.isInteger(value) || value < 0)) {
    throw httpError(400, "pdf_indices 必须是非负整数页码");
  }
  return [...new Set(raw)].sort((a, b) => a - b);
}

function readBundlePageCount(bundleDir) {
  const manifest = readJsonFile(path.join(bundleDir, "manifest.json"));
  const pageCount = manifest?.source?.page_count;
  return typeof pageCount === "number" && pageCount > 0 ? pageCount : null;
}

function buildInspectorRequest(storedPath, fileSha256, bundleDir, bundleId, title, indices) {
  return {
    schema_version: 1,
    contract_id: INGEST_REQUEST_CONTRACT,
    mode: "full_parse_batch",
    source: {
      path: storedPath,
      source_id: `pdf:${bundleId}`,
      title,
      file_sha256: fileSha256,
    },
    source_bundle_path: bundleDir,
    manifest_producer_literal: INGEST_PRODUCER_LITERAL,
    missing_pdf_indices: indices,
  };
}

function backgroundWindowPayload(
  storedPath,
  fileSha256,
  slug,
  title,
  pageCount,
  windowNumber,
  continueBackground,
) {
  return {
    workspace: WORKSPACE,
    stored_path: storedPath,
    file_sha256: fileSha256,
    slug,
    bundle_id: pdfWindowBundleId(slug, windowNumber),
    title,
    page_count: pageCount,
    window_number: windowNumber,
    pdf_indices: pdfWindowIndices(pageCount, windowNumber),
    continue_background: continueBackground,
  };
}

/** Fire-and-forget one window; a successful worker continues with the next. */
function startBackgroundWindow(
  storedPath,
  fileSha256,
  slug,
  title,
  pageCount,
  windowNumber,
) {
  const body = backgroundWindowPayload(
    storedPath,
    fileSha256,
    slug,
    title,
    pageCount,
    windowNumber,
    true,
  );
  if (body.pdf_indices.length === 0) return null;
  const payload = JSON.stringify(body);
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--ingest-window", payload],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return { bundle_id: body.bundle_id, pdf_indices: body.pdf_indices, status: "started" };
  } catch {
    return { bundle_id: body.bundle_id, pdf_indices: body.pdf_indices, status: "failed" };
  }
}

/** Detached worker entry: parse + validate one background window bundle. */
async function ingestWindowWorker(payload) {
  if (payload && typeof payload.workspace === "string" && payload.workspace) {
    WORKSPACE = path.resolve(payload.workspace);
  }
  const bundleDir = path.join(
    cocRoot(WORKSPACE),
    "source-bundles",
    String(payload.bundle_id),
  );
  const continueAfterSuccess = () => {
    if (payload.continue_background !== true) return true;
    const next = startBackgroundWindow(
      payload.stored_path,
      payload.file_sha256,
      payload.slug,
      payload.title,
      payload.page_count,
      payload.window_number + 1,
    );
    return next === null || next.status === "started";
  };

  // Idempotent: an existing validated bundle wins without re-parsing, but a
  // resumed worker must still continue the remaining document windows.
  if (fs.existsSync(path.join(bundleDir, "manifest.json"))) {
    const existing = await validateBundleDir(bundleDir);
    if (existing.ok) return continueAfterSuccess() ? 0 : 1;
  }
  const result = await runPdfInspector(
    buildInspectorRequest(
      payload.stored_path,
      payload.file_sha256,
      bundleDir,
      payload.bundle_id,
      payload.title,
      payload.pdf_indices,
    ),
  );
  // Same OCR-skip degradation as the foreground window.
  let finalResult = result;
  if (
    result.status === "fallback" &&
    result.reason === "needs_ocr" &&
    Array.isArray(result.pages_needing_ocr_0indexed) &&
    result.pages_needing_ocr_0indexed.length > 0
  ) {
    const ocrSet = new Set(result.pages_needing_ocr_0indexed);
    const reduced = payload.pdf_indices.filter((index) => !ocrSet.has(index));
    if (reduced.length === 0) return 1;
    if (fs.existsSync(bundleDir)) {
      fs.rmSync(bundleDir, { recursive: true, force: true });
    }
    finalResult = await runPdfInspector(
      buildInspectorRequest(
        payload.stored_path,
        payload.file_sha256,
        bundleDir,
        payload.bundle_id,
        payload.title,
        reduced,
      ),
    );
  }
  if (finalResult.status !== "ok") return 1;
  const check = await validateBundleDir(bundleDir);
  if (!check.ok) return 1;
  return continueAfterSuccess() ? 0 : 1;
}

async function prepareLongPdfWindows(
  storedPath,
  fileSha256,
  slug,
  title,
  pageCount,
) {
  if (pageCount === null || pageCount <= INGEST_WINDOW_MAX) return null;
  const lastReadyWindow = Math.min(
    OPENING_READY_WINDOW_COUNT,
    Math.ceil(pageCount / INGEST_WINDOW_MAX),
  );
  for (let windowNumber = 2; windowNumber <= lastReadyWindow; windowNumber += 1) {
    const code = await ingestWindowWorker(backgroundWindowPayload(
      storedPath,
      fileSha256,
      slug,
      title,
      pageCount,
      windowNumber,
      false,
    ));
    if (code !== 0) {
      throw httpError(
        502,
        `外部解析路由器未能准备开场检索窗口 ${windowNumber}。`,
      );
    }
  }
  return startBackgroundWindow(
    storedPath,
    fileSha256,
    slug,
    title,
    pageCount,
    lastReadyWindow + 1,
  );
}

async function ingestSuccessPayload(fileSha256, bundleDir, rendered, backgroundWindow, message, skippedOcr) {
  // A digest can legitimately have several source-bundle generations (for
  // example an older two-window ingest and a newly completed long-document
  // ingest). Bind the exact bundle just validated here; choosing the first
  // hash match would reconnect the campaign to the stale generation.
  const resolvedBundleDir = path.resolve(bundleDir);
  const matched = listSourceBundles(WORKSPACE).find(
    (bundle) => path.resolve(bundle.path) === resolvedBundleDir,
  ) ?? findBundleByPdfSha256(WORKSPACE, fileSha256);
  return {
    status: "matched_bundle",
    file_sha256: fileSha256,
    message,
    matched_bundle: matched,
    source_bundle_path: path.resolve(bundleDir),
    bundle_id: path.basename(bundleDir),
    page_count: readBundlePageCount(bundleDir),
    rendered_pdf_indices: rendered,
    skipped_ocr_pdf_indices: skippedOcr ?? [],
    validation: "passed",
    background_window: backgroundWindow,
  };
}

async function runIngest(storedPath, fileSha256, requestedIndices) {
  const { slug, title } = ingestIdentity(storedPath);
  const bundlesRoot = path.join(cocRoot(WORKSPACE), "source-bundles");
  const isDefaultWindow = requestedIndices === null;
  const indices = requestedIndices ?? Array.from({ length: INGEST_WINDOW_MAX }, (_, i) => i);
  // Default first window owns <slug>; explicit windows get their own suffix so
  // multiple windows never overwrite each other.
  const bundleId = isDefaultWindow ? slug : `${slug}-p${indices[0]}`;
  const bundleDir = path.join(bundlesRoot, bundleId);

  // Idempotent: an existing validated bundle is reused without re-parsing.
  if (fs.existsSync(path.join(bundleDir, "manifest.json"))) {
    const existing = await validateBundleDir(bundleDir);
    if (existing.ok) {
      const pageCount = readBundlePageCount(bundleDir);
      const backgroundWindow = isDefaultWindow
        ? await prepareLongPdfWindows(
            storedPath,
            fileSha256,
            slug,
            title,
            pageCount,
          )
        : null;
      return ingestSuccessPayload(
        fileSha256,
        bundleDir,
        indices,
        backgroundWindow,
        "已存在校验通过的源包，直接复用，可以开局。",
      );
    }
  }

  let routerResult = await runPdfInspector(
    buildInspectorRequest(storedPath, fileSha256, bundleDir, bundleId, title, indices),
  );
  // Graceful degradation: image pages (cover/art) that need OCR are skipped
  // and the text-layer pages are re-parsed. The repository still never OCRs.
  let skippedOcr = [];
  if (
    routerResult.status === "fallback" &&
    routerResult.reason === "needs_ocr" &&
    Array.isArray(routerResult.pages_needing_ocr_0indexed) &&
    routerResult.pages_needing_ocr_0indexed.length > 0
  ) {
    const pageCount = Number.isInteger(routerResult.page_count)
      && routerResult.page_count > 0
      ? routerResult.page_count
      : null;
    const inRange = pageCount === null
      ? indices
      : indices.filter((index) => index < pageCount);
    const ocrSet = new Set(
      routerResult.pages_needing_ocr_0indexed.filter((index) => (
        pageCount === null || index < pageCount
      )),
    );
    const reduced = inRange.filter((index) => !ocrSet.has(index));
    if (reduced.length === 0) {
      throw httpError(
        502,
        "外部解析路由器无法完成本 PDF：请求窗口内全部页面都需要 OCR。"
          + "仓库不做 OCR，请改用文字层完整的 PDF。",
      );
    }
    if (fs.existsSync(bundleDir)) {
      fs.rmSync(bundleDir, { recursive: true, force: true });
    }
    skippedOcr = [...ocrSet].sort((a, b) => a - b);
    routerResult = await runPdfInspector(
      buildInspectorRequest(storedPath, fileSha256, bundleDir, bundleId, title, reduced),
    );
  }
  if (routerResult.status !== "ok") {
    const reason = routerResult.reason || "unknown";
    const ocrPages = Array.isArray(routerResult.pages_needing_ocr_0indexed)
      ? routerResult.pages_needing_ocr_0indexed.join(",")
      : "";
    throw httpError(
      502,
      `外部解析路由器无法完成本 PDF（status=${routerResult.status}, reason=${reason}` +
        `${ocrPages ? `，需 OCR 页: ${ocrPages}` : ""}）。` +
        (ocrPages || reason === "needs_ocr"
          ? "仓库不做 OCR，请改用文字层完整的 PDF。"
          : "请检查外部解析器状态后重试。"),
    );
  }

  const check = await validateBundleDir(bundleDir);
  if (!check.ok) {
    throw httpError(
      502,
      `路由器产物未通过仓库 coc_pdf_bundle 校验：${check.error}`,
    );
  }

  // Opening review needs enough real source to reach the first playable scene
  // in long campaign books. Materialize windows 2 and 3 before declaring the
  // upload ready; then continue the rest of the book in detached sequential
  // workers so upload latency stays bounded.
  let backgroundWindow = null;
  if (isDefaultWindow) {
    const pageCount = readBundlePageCount(bundleDir);
    backgroundWindow = await prepareLongPdfWindows(
      storedPath,
      fileSha256,
      slug,
      title,
      pageCount,
    );
  }
  return ingestSuccessPayload(
    fileSha256,
    bundleDir,
    routerResult.rendered_pdf_indices ?? indices,
    backgroundWindow,
    skippedOcr.length > 0
      ? `解析完成，已生成合法源包，可以开局（图片页 ${skippedOcr.map((p) => p + 1).join("、")} 需 OCR，已跳过）。`
      : "解析完成，已生成合法源包，可以开局。",
    skippedOcr,
  );
}

async function handleIngestPdf(req, res) {
  const body = await readJsonBody(req);
  const requestedIndices = parseIngestIndices(body.pdf_indices);
  let storedPath = null;
  let fileSha256 = null;
  const sha = typeof body.file_sha256 === "string" ? body.file_sha256.trim().toLowerCase() : "";
  if (typeof body.stored_path === "string" && body.stored_path.trim()) {
    const candidate = path.resolve(body.stored_path.trim());
    const uploadsDir = path.resolve(path.join(cocRoot(WORKSPACE), "uploads", "pdfs"));
    if (
      !candidate.startsWith(uploadsDir + path.sep) ||
      !fs.existsSync(candidate) ||
      !fs.statSync(candidate).isFile()
    ) {
      throw httpError(404, "stored_path 必须是 .coc/uploads/pdfs/ 下已登记的 PDF 文件");
    }
    storedPath = candidate;
    fileSha256 = sha256File(candidate);
    if (/^[0-9a-f]{64}$/.test(sha) && sha !== fileSha256) {
      throw httpError(400, "stored_path 与 file_sha256 不匹配");
    }
  } else if (/^[0-9a-f]{64}$/.test(sha)) {
    fileSha256 = sha;
    storedPath = findRegisteredPdf(fileSha256);
    if (!storedPath) {
      throw httpError(
        404,
        `找不到已登记的 PDF（sha256=${fileSha256.slice(0, 16)}…），请先通过 /api/uploads/pdf 上传登记。`,
      );
    }
  } else {
    throw httpError(400, "需要 file_sha256 或 stored_path");
  }

  if (INGEST_LOCKS.get(fileSha256)) {
    sendJson(res, 200, {
      ok: true,
      result: {
        status: "in_progress",
        file_sha256: fileSha256,
        message: "同一 PDF 的解析正在进行中，请稍候再查询。",
      },
    });
    return;
  }
  INGEST_LOCKS.set(fileSha256, true);
  try {
    const result = await runIngest(storedPath, fileSha256, requestedIndices);
    sendJson(res, 200, { ok: true, result });
  } finally {
    INGEST_LOCKS.delete(fileSha256);
  }
}

// ---------------------------------------------------------------------------
// Static files

// ---------------------------------------------------------------------------
// Router

async function route(req, res) {
  const urlPath = decodeRequestPath(req.url);
  const method = req.method || "GET";
  const parts = urlPath.split("/").filter(Boolean);

  if (method === "GET") {
    if (urlPath === "/api/health") return handleHealth(req, res);
    if (urlPath === "/api/models") return handleModels(req, res);
    if (urlPath === "/api/model-editor") return handleModelEditor(req, res);
    if (urlPath === "/api/model-editor/login") return handleModelLoginSnapshot(req, res);
    if (urlPath === "/api/bootstrap") return handleBootstrap(req, res);
    if (urlPath === "/api/user-prefs") return handleUserPrefs(req, res);
    if (urlPath === "/api/web-search-keys") return handleWebSearchKeys(req, res);
    if (urlPath === "/api/ocr-token") return handleOcrToken(req, res);
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "state"
    ) {
      return handleState(req, res, parts[2]);
    }
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "transcript"
    ) {
      return handleTranscript(req, res, parts[2]);
    }
    if (urlPath === "/api/trash") return handleListTrash(req, res);
    if (
      parts.length === 5 &&
      parts[0] === "api" &&
      parts[1] === "investigators" &&
      parts[3] === "portraits"
    ) {
      return handleInvestigatorPortrait(req, res, parts[2], parts[4]);
    }
    if (urlPath.startsWith("/api/")) throw httpError(404, "not found");
    return serveStatic(req, res, urlPath, { distDir: DIST_DIR });
  }

  if (method === "POST") {
    if (urlPath === "/api/uploads/pdf/ingest") return handleIngestPdf(req, res);
    if (urlPath === "/api/uploads/pdf/from-path") return handleUploadPdfFromPath(req, res);
    if (urlPath === "/api/uploads/pdf") return handleUploadPdf(req, res);
    if (urlPath === "/api/campaigns") return handleCreateCampaign(req, res);
    if (urlPath === "/api/campaigns/rename") return handleRenameCampaign(req, res);
    if (urlPath === "/api/campaigns/trash") return handleTrashCampaign(req, res);
    if (urlPath === "/api/trash/restore") return handleRestoreTrash(req, res);
    if (urlPath === "/api/campaigns/attach-investigator") return handleAttachInvestigator(req, res);
    if (urlPath === "/api/sessions") return handleCreateSession(req, res);
    if (urlPath === "/api/investigators") return handleCreateInvestigator(req, res);
    if (urlPath === "/api/portraits/generate") return handleGeneratePortrait(req, res);
    if (urlPath === "/api/model-editor/provider") return handleSaveModelEditorProvider(req, res);
    if (urlPath === "/api/model-editor/login") return handleStartModelLogin(req, res);
    if (urlPath === "/api/model-editor/login/respond") return handleModelLoginRespond(req, res);
    if (urlPath === "/api/model-editor/login/cancel") return handleModelLoginCancel(req, res);
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "turns"
    ) {
      return handleTurn(req, res, parts[2]);
    }
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "abort"
    ) {
      return handleAbortTurn(req, res, parts[2]);
    }
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "delivery-ack"
    ) {
      return handleDeliveryAck(req, res, parts[2]);
    }
    if (
      parts.length === 5 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "items" &&
      parts[4] === "use"
    ) {
      return handleUseItem(req, res, parts[2]);
    }
    throw httpError(404, "not found");
  }

  if (method === "PUT") {
    if (urlPath === "/api/model-editor") return handleSaveModelEditor(req, res);
    if (urlPath === "/api/user-prefs") return handleSaveUserPrefs(req, res);
    if (urlPath === "/api/web-search-keys") return handleSaveWebSearchKeys(req, res);
    if (urlPath === "/api/ocr-token") return handleSaveOcrToken(req, res);
    throw httpError(404, "not found");
  }

  if (method === "DELETE") {
    if (
      parts.length === 3
      && parts[0] === "api"
      && parts[1] === "source-bundles"
    ) {
      return handleDeleteSourceBundle(req, res, parts[2]);
    }
    throw httpError(404, "not found");
  }

  throw httpError(405, "method not allowed");
}

function main() {
  const args = process.argv.slice(2);
  let host = "127.0.0.1";
  let port = 8765;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--workspace") WORKSPACE = path.resolve(args[++i]);
    else if (args[i] === "--host") host = args[++i];
    else if (args[i] === "--port") port = Number.parseInt(args[++i], 10);
  }
  sidecar = new Sidecar(WORKSPACE);
  sidecar.start();

  // Trash retention sweep: expired entries (24h) are removed at startup and
  // on this interval while the server runs, in addition to the lazy purge on
  // every trash listing.
  const sweepTrash = () => {
    sidecar.request("campaign_trash_purge", {}).catch(() => undefined);
  };
  sweepTrash();
  const trashTimer = setInterval(sweepTrash, 15 * 60 * 1000);
  trashTimer.unref?.();

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) {
        // SSE already started; surface the failure as an SSE error event.
        try {
          sseWrite(res, "error", { message: err?.message || String(err) });
        } catch {
          /* client gone */
        }
        res.end();
        return;
      }
      const status = Number.isInteger(err?.status) ? err.status : 500;
      const message =
        err instanceof SyntaxError
          ? `invalid JSON body: ${err.message}`
          : err?.message || String(err);
      sendJson(res, status, { error: message });
    });
  });
  server.listen(port, host, () => {
    process.stdout.write(
      `coc-web (node) listening on http://${host}:${port}  workspace=${WORKSPACE}\n`,
    );
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      server.close();
      for (const host of HOSTS.values()) {
        try {
          await host.close();
        } catch {
          /* shutting down */
        }
      }
      HOSTS.clear();
      await sidecar.stop();
      process.exit(0);
    });
  }
}

if (process.argv.includes("--ingest-window")) {
  // Detached background-window worker (no HTTP server, no sidecar).
  try {
    const payload = JSON.parse(
      process.argv[process.argv.indexOf("--ingest-window") + 1] || "{}",
    );
    ingestWindowWorker(payload)
      .then((code) => process.exit(code))
      .catch(() => process.exit(1));
  } catch {
    process.exit(1);
  }
} else {
  main();
}
