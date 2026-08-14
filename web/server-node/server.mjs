/**
 * Node HTTP + SSE bridge between the React web UI and the canonical runtime.
 *
 * Successor to web/server/app.py (stdlib Python bridge). This server is a
 * thin transport: all game semantics live in the canonical runtime SDK and
 * keeper runner, reached through the stdio JSON-RPC sidecar
 * (runtime/sdk/rpc_server.py). It adds no rules, state, or narration
 * behavior of its own. SSE wraps one sidecar ``send`` per player turn; live
 * ``delta`` events are the keeper runner's own post-finalize token stream.
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
  campaignDir,
  cocRoot,
  discoveredCluesDisplay,
  enrichTranscriptFromEvents,
  findBundleByPdfSha256,
  formatPlayerTime,
  listSourceBundles,
  modelsPayload,
  readJsonFile,
  sceneDisplayLabel,
  sha256Bytes,
  sha256File,
  tableTranscriptMessages,
  tensionDisplayLabel,
  timeExtras,
} from "./projections.mjs";

/**
 * Arm the canonical Pi source-lifecycle lanes for the keeper agent this
 * bridge spawns. The pi-coc CLI launcher exports the same defaults; the
 * web keeper session is launched directly (run_keeper_turn.mjs) and would
 * otherwise silently skip the opening-source-review auto-dispatch
 * (COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND unset => retryable "command
 * unavailable") and progressive OCR. Values already exported by the
 * operator always win.
 */
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const piBin = path.join(repoRoot, "plugins", "coc-keeper", "pi", "bin");
  const defaults = {
    COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND: path.join(piBin, "coc-pdf-skill-adapter"),
    COC_PROGRESSIVE_OCR_COMMAND: path.join(piBin, "coc-ocr-adapter.py"),
    // Text model for the opening facts + module-init L0 extraction child.
    // The adapter's deepseek default needs an API key the extension's child
    // env allowlist never carries; the web keeper's relay catalog does.
    // Must be a strong model: the strict coc.opening-fast-facts.v1 contract
    // (exact key set incl. schema_version/contract_id) is systematically
    // dropped by gpt-5.4-mini (campaign 163241: 3/3 producer failures).
    COC_PI_OPENING_MODEL: "coding-relay/gpt-5.6-luna",
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
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DIR = path.join(REPO_ROOT, "web", "frontend", "dist");

let WORKSPACE = REPO_ROOT;
let sidecar = null;

/** sid -> {session_id, campaign_id, investigator_id} */
const SESSIONS = new Map();

// One turn at a time: concurrent keeper turns against shared campaign state
// are never safe, and model env vars are process-global in the sidecar.
let turnInFlight = false;

// Reusable workspace-level shell so a campaign can open a Keeper session and
// run the canonical coc-character skill before a real investigator exists.
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

// ---------------------------------------------------------------------------
// Setup-draft investigator (character-creation-in-chat flow)

async function ensureSetupDraftInvestigator() {
  const invPath = path.join(
    cocRoot(WORKSPACE),
    "investigators",
    SETUP_DRAFT_INVESTIGATOR_ID,
    "character.json",
  );
  if (fs.existsSync(invPath)) return SETUP_DRAFT_INVESTIGATOR_ID;
  await sidecar.request("setup_workspace", {
    operation: {
      schema_version: 1,
      kind: "investigator.create",
      payload: {
        investigator_id: SETUP_DRAFT_INVESTIGATOR_ID,
        // Import a complete shell sheet: the deterministic validator rejects
        // Quick Fire inputs unless creation.input_mode=guided_quick_fire, and
        // that guided branch requires a campaign context plus an authoritative
        // dice receipt — unavailable for this workspace-level placeholder.
        // Numbers are the package's Quick Fire array (characteristic-dice.json)
        // with Luck 12*5 and age 28, exactly as derive_values computes them.
        sheet: {
          id: SETUP_DRAFT_INVESTIGATOR_ID,
          name: "（建卡引导中）",
          occupation: "调查员",
          era: "1920s",
          age: 28,
          characteristics: {
            INT: 80,
            POW: 70,
            DEX: 60,
            EDU: 60,
            CON: 50,
            APP: 50,
            SIZ: 50,
            STR: 40,
          },
          derived: {
            HP: 10,
            MP: 14,
            SAN: 70,
            Luck: 60,
            DB: "none",
            Build: 0,
            MOV: 8,
          },
          skills: {
            "Credit Rating": 20,
            "Spot Hidden": 25,
            Listen: 20,
            "Library Use": 20,
          },
        },
        creation: {
          input_mode: "import_complete_sheet",
          method: "complete_sheet_placeholder",
        },
      },
    },
  });
  return SETUP_DRAFT_INVESTIGATOR_ID;
}

function resolveInvestigator(campaignId) {
  const stateDir = path.join(campaignDir(WORKSPACE, campaignId), "save", "investigator-state");
  let names;
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const stem = name.slice(0, -".json".length);
    // Prefer a real investigator over the setup draft slot.
    if (stem !== SETUP_DRAFT_INVESTIGATOR_ID) return stem;
  }
  if (names.includes(`${SETUP_DRAFT_INVESTIGATOR_ID}.json`)) {
    return SETUP_DRAFT_INVESTIGATOR_ID;
  }
  return null;
}

async function linkSetupDraft(campaignId) {
  const draftId = await ensureSetupDraftInvestigator();
  try {
    await sidecar.request("setup_workspace", {
      operation: {
        schema_version: 1,
        kind: "campaign.link_investigator",
        payload: { campaign_id: campaignId, investigator_ids: [draftId] },
      },
    });
  } catch (err) {
    // Era-gate deadlock: a source-bound campaign whose era is not yet
    // established fail-closes party linking (character creation) until
    // setup.adopt_source_facts answers the fast-facts era question — but
    // that adoption can only be driven from inside a live session. Open the
    // session with the unlinked draft anyway; the kernel still blocks every
    // creation operation until adoption, and the link is re-attempted by the
    // normal character-creation flow once the era is established.
    if (
      err instanceof SidecarError &&
      /era is not source-established/.test(err.message)
    ) {
      // The kernel seeds draft runtime state inside link_party; while the
      // gate defers the link, seed the identical placeholder state so the
      // session's state snapshot can load. The file is never touched again
      // once the real link runs (link_party keeps existing state).
      seedDraftInvestigatorState(campaignId, draftId);
      return draftId;
    }
    throw err;
  }
  return draftId;
}

function seedDraftInvestigatorState(campaignId, draftId) {
  const statePath = path.join(
    campaignDir(WORKSPACE, campaignId),
    "save",
    "investigator-state",
    `${draftId}.json`,
  );
  if (fs.existsSync(statePath)) return;
  let sheet = {};
  try {
    sheet = readJsonFile(
      path.join(cocRoot(WORKSPACE), "investigators", draftId, "character.json"),
    );
  } catch {
    sheet = {};
  }
  const derived = sheet?.derived && typeof sheet.derived === "object" ? sheet.derived : {};
  const chars =
    sheet?.characteristics && typeof sheet.characteristics === "object"
      ? sheet.characteristics
      : {};
  const state = {
    schema_version: 1,
    campaign_id: campaignId,
    investigator_id: draftId,
    current_hp: Number(derived.HP || 10),
    current_san: Number(derived.SAN || chars.POW || 50),
    current_mp: Number(derived.MP || Math.max(1, Math.floor(Number(chars.POW || 50) / 5))),
    current_luck: Number(derived.Luck || chars.LUCK || 50),
    conditions: [],
    skill_checks_earned: [],
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// State / transcript payloads

async function statePayload(info) {
  const state = await sidecar.request("get_state", { session_id: info.session_id });
  const lang =
    typeof state.play_language === "string" && state.play_language
      ? state.play_language
      : "zh-Hans";
  const extras = await sidecar.request("display_character", {
    investigator_id: info.investigator_id,
    play_language: lang,
  });
  state.character = extras?.character ?? null;
  state.time = timeExtras(WORKSPACE, info.campaign_id, lang);
  const sceneId = state.active_scene_id;
  if (typeof sceneId === "string" && sceneId) {
    state.active_scene_label =
      sceneDisplayLabel(WORKSPACE, info.campaign_id, sceneId, lang) || sceneId;
  } else {
    state.active_scene_label = null;
  }
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
  return state;
}

async function transcriptPayload(info) {
  const timed = tableTranscriptMessages(WORKSPACE, info.campaign_id);
  if (timed !== null) return timed;
  const base = await sidecar.request("public_transcript_base", {
    campaign_id: info.campaign_id,
    limit: 10000,
  });
  const messages = Array.isArray(base?.messages) ? base.messages : [];
  return enrichTranscriptFromEvents(WORKSPACE, info.campaign_id, messages);
}

function playerVisibleTurnError(err) {
  const kind = err instanceof SidecarError ? err.kind : null;
  const name = err instanceof SidecarError ? err.errorClass : err?.constructor?.name || "";
  const text = err?.message || "";
  if (kind === "keeper_finalization_blocked" || name === "KeeperFinalizationBlockedError") {
    return (
      "本回合未能完成结算（KP 没有成功写出可对玩家发布的最终叙述）。" +
      "世界状态可能已有部分写入，也可能完全未写；" +
      "请重发同一行动，或换一种表述再试。" +
      "若连续失败，用顶栏「⟳ 刷新」核对状态后再继续。"
    );
  }
  if (kind === "telemetry_persistence_failed" || name === "TelemetryPersistenceError") {
    return (
      "本回合叙述可能已生成，但遥测回执写入失败。" +
      "请刷新后确认对话是否已落盘；若缺失可重试该行动。"
    );
  }
  if (kind === "keeper_adapter_failed" || name.includes("KeeperAdapter")) {
    return `Keeper 进程/连接异常：${text || name}`;
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
    dist_built: fs.existsSync(DIST_DIR),
    bridge: "node",
  });
}

async function handleModels(_req, res) {
  sendJson(res, 200, modelsPayload());
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
          Object.assign(summary, compat);
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
    pregen_id: String(body.pregen_id || "").trim(),
  };
  if (!payload.scenario_id || !payload.pregen_id) {
    throw httpError(400, "scenario_id and pregen_id are required");
  }
  for (const key of ["campaign_id", "title"]) {
    const value = String(body[key] || "").trim();
    if (value) payload[key] = value;
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
  let investigatorId = String(body.investigator_id || "").trim();
  let characterSetup = false;
  if (!investigatorId) {
    const resolved = resolveInvestigator(campaignId);
    if (!resolved) {
      // No party yet (「新建调查员」开局): open with setup shell so the live
      // Keeper can run the canonical coc-character skill in chat.
      investigatorId = await linkSetupDraft(campaignId);
      characterSetup = true;
    } else {
      investigatorId = resolved;
      characterSetup = investigatorId === SETUP_DRAFT_INVESTIGATOR_ID;
    }
  }
  const created = await sidecar.request("create_session", {
    campaign_id: campaignId,
    investigator_id: investigatorId,
  });
  const sessionId = created.session_id;
  const info = {
    session_id: sessionId,
    campaign_id: campaignId,
    investigator_id: investigatorId,
  };
  SESSIONS.set(sessionId, info);
  sendJson(res, 200, {
    session_id: sessionId,
    character_setup: characterSetup,
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
  const playerInput = String(body.input || "").trim();
  if (!playerInput) throw httpError(400, "input is required");
  const provider = String(body.provider || "").trim();
  const model = String(body.model || "").trim();

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
  res.on("close", () => {
    clientGone = true; // the turn still settles canonically server-side
  });
  const heartbeat = setInterval(() => {
    if (!clientGone) res.write(": ping\n\n");
  }, 15000);

  const safeWrite = (event, data) => {
    if (clientGone) return false;
    sseWrite(res, event, data);
    return true;
  };

  try {
    safeWrite("status", { phase: "accepted" });
    const result = await sidecar.request(
      "send",
      { session_id: info.session_id, input: playerInput, provider, model },
      {
        onNotify: (name, data) => {
          if (name !== "keeper_stream" || !data || typeof data !== "object") return;
          const streamType = data.$stream;
          if (streamType === "delta") {
            safeWrite("delta", { text: String(data.text || "") });
          } else if (streamType === "delta_reset") {
            safeWrite("delta_reset", {});
          } else if (streamType === "tool") {
            safeWrite("tool", {
              phase: String(data.phase || ""),
              tool: String(data.tool || ""),
            });
          }
        },
      },
    );
    let state;
    try {
      state = await statePayload(info);
    } catch (err) {
      state = { error: `${err?.constructor?.name || "Error"}: ${err?.message || err}` };
    }
    safeWrite("turn", { events: result?.events ?? [], state });
    safeWrite("end", {});
  } catch (err) {
    safeWrite("error", { message: playerVisibleTurnError(err) });
  } finally {
    clearInterval(heartbeat);
    turnInFlight = false;
    res.end();
  }
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
          filename = decodeURIComponent(raw) || filename;
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

async function handleUploadPdf(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw httpError(400, "PDF 上传需要 multipart/form-data");
  }
  const rawBody = await readBody(req, { limit: PDF_MAX_BYTES + 64 * 1024 });
  const { filename, data } = parseMultipartFile(rawBody, contentType);
  if (!filename.toLowerCase().endsWith(".pdf")) {
    throw httpError(400, "仅支持 .pdf 文件");
  }
  if (data.length > PDF_MAX_BYTES) throw httpError(400, "PDF 超过 200MB 上限");
  if (data.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw httpError(400, "文件不是有效的 PDF（缺少 %PDF 头）");
  }
  const fileSha256 = sha256Bytes(data);
  const matched = findBundleByPdfSha256(WORKSPACE, fileSha256);
  const safeName = path
    .basename(filename)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
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
  sendJson(res, 200, { ok: true, result: payload });
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
    // Prefer the cheap name-prefix candidates before hashing every file.
    const hit = (name) =>
      name.toLowerCase().startsWith(`${digest.slice(0, 16)}_`) ||
      name.toLowerCase().startsWith(`${digest}_`);
    return Number(hit(b)) - Number(hit(a));
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

/** Fire-and-forget second window for the remaining pages (detached self). */
function startBackgroundWindow(storedPath, fileSha256, slug, title, indices) {
  const bundleId = `${slug}-w2`;
  const payload = JSON.stringify({
    workspace: WORKSPACE,
    stored_path: storedPath,
    file_sha256: fileSha256,
    bundle_id: bundleId,
    title,
    pdf_indices: indices,
  });
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--ingest-window", payload],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return { bundle_id: bundleId, pdf_indices: indices, status: "started" };
  } catch {
    return { bundle_id: bundleId, pdf_indices: indices, status: "failed" };
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
  // Idempotent: an existing validated bundle wins without re-parsing.
  if (fs.existsSync(path.join(bundleDir, "manifest.json"))) {
    const existing = await validateBundleDir(bundleDir);
    if (existing.ok) return 0;
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
  return check.ok ? 0 : 1;
}

async function ingestSuccessPayload(fileSha256, bundleDir, rendered, backgroundWindow, message, skippedOcr) {
  const matched = findBundleByPdfSha256(WORKSPACE, fileSha256);
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
      return ingestSuccessPayload(
        fileSha256,
        bundleDir,
        indices,
        null,
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
    const ocrSet = new Set(routerResult.pages_needing_ocr_0indexed);
    const reduced = indices.filter((index) => !ocrSet.has(index));
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
        `${ocrPages ? `，需 OCR 页: ${ocrPages}` : ""}）。仓库不做 OCR，` +
        "请改用文字层完整的 PDF。",
    );
  }

  const check = await validateBundleDir(bundleDir);
  if (!check.ok) {
    throw httpError(
      502,
      `路由器产物未通过仓库 coc_pdf_bundle 校验：${check.error}`,
    );
  }

  // Remaining pages beyond the default first window: background second window.
  let backgroundWindow = null;
  if (isDefaultWindow) {
    const pageCount = readBundlePageCount(bundleDir);
    if (pageCount !== null && pageCount > INGEST_WINDOW_MAX) {
      const rest = Array.from(
        { length: Math.min(pageCount, INGEST_WINDOW_MAX * 2) - INGEST_WINDOW_MAX },
        (_, i) => INGEST_WINDOW_MAX + i,
      );
      backgroundWindow = startBackgroundWindow(storedPath, fileSha256, slug, title, rest);
    }
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
  if (/^[0-9a-f]{64}$/.test(sha)) {
    fileSha256 = sha;
    storedPath = findRegisteredPdf(fileSha256);
    if (!storedPath) {
      throw httpError(
        404,
        `找不到已登记的 PDF（sha256=${fileSha256.slice(0, 16)}…），请先通过 /api/uploads/pdf 上传登记。`,
      );
    }
  } else if (typeof body.stored_path === "string" && body.stored_path.trim()) {
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

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  if (!fs.existsSync(DIST_DIR)) {
    const body = Buffer.from(
      "<!doctype html><meta charset='utf-8'><title>coc web</title>" +
        "<body style='font-family:monospace;background:#10161a;color:#cfe;'>" +
        "<h2>Frontend not built</h2>" +
        "<pre>cd web/frontend && npm install && npm run build</pre>",
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
    return;
  }
  const rel = urlPath.replace(/^\/+/, "") || "index.html";
  let candidate = path.resolve(DIST_DIR, rel);
  if (!candidate.startsWith(path.resolve(DIST_DIR))) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    candidate = path.join(DIST_DIR, "index.html"); // SPA fallback
  }
  const body = fs.readFileSync(candidate);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(candidate).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Router

async function route(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const method = req.method || "GET";
  const parts = urlPath.split("/").filter(Boolean);

  if (method === "GET") {
    if (urlPath === "/api/health") return handleHealth(req, res);
    if (urlPath === "/api/models") return handleModels(req, res);
    if (urlPath === "/api/bootstrap") return handleBootstrap(req, res);
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
    if (urlPath.startsWith("/api/")) throw httpError(404, "not found");
    return serveStatic(req, res, urlPath);
  }

  if (method === "POST") {
    if (urlPath === "/api/uploads/pdf/ingest") return handleIngestPdf(req, res);
    if (urlPath === "/api/uploads/pdf") return handleUploadPdf(req, res);
    if (urlPath === "/api/campaigns") return handleCreateCampaign(req, res);
    if (urlPath === "/api/campaigns/attach-investigator") return handleAttachInvestigator(req, res);
    if (urlPath === "/api/sessions") return handleCreateSession(req, res);
    if (urlPath === "/api/investigators") return handleCreateInvestigator(req, res);
    if (
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "turns"
    ) {
      return handleTurn(req, res, parts[2]);
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
