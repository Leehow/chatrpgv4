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
import path from "node:path";
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
        sheet: {
          id: SETUP_DRAFT_INVESTIGATOR_ID,
          name: "（建卡引导中）",
          occupation: "调查员",
          era: "1920s",
          age: 28,
          skills: {
            "Credit Rating": 20,
            "Spot Hidden": 25,
            Listen: 20,
            "Library Use": 20,
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
          luck_roll_total: 12,
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
  await sidecar.request("setup_workspace", {
    operation: {
      schema_version: 1,
      kind: "campaign.link_investigator",
      payload: { campaign_id: campaignId, investigator_ids: [draftId] },
    },
  });
  return draftId;
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
        payload: { campaign_id: campaignId, title, play_language: "zh-Hans" },
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

main();
