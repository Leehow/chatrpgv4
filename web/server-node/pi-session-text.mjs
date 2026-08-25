/**
 * Read player-visible turns out of a Pi session JSONL. Character-setup
 * openings never finalize into table-transcript, so the UI has to hydrate
 * from this file when the host comes back idle.
 */
import fs from "node:fs";
import path from "node:path";

import { resolveHostedSessionAgentDirs } from "./agent-dir.mjs";

/** Prefix of the server-owned character-setup opener (see pi-coc-rpc.mjs). */
export const SETUP_CHARACTER_OPENING_MARKER =
  "Host continuation: character-setup opening.";
export const TURN_RECOVERY_MARKER =
  "Host continuation: interrupted-turn recovery.";
/** Exact first sentence of PLAY_TABLE_OPENING_PROMPT in pi-coc-rpc.mjs.
 *  Host-owned user-role continuation: hidden like the others, but NEVER
 *  treated as a setup/play boundary — boundaries are structural only. */
export const PLAY_TABLE_OPENING_MARKER =
  "Host continuation for a newly spawned selected play campaign.";
/** Persisted Pi custom_message written at setup→play handoff. */
export const SETUP_HANDOFF_CUSTOM_TYPE = "coc_setup_handoff";

export function isHiddenSetupOpeningPrompt(text) {
  const body = String(text || "").trim();
  return Boolean(body) && body.includes(SETUP_CHARACTER_OPENING_MARKER);
}

export function isHiddenHostPrompt(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  return (
    isHiddenSetupOpeningPrompt(body)
    || body.includes(TURN_RECOVERY_MARKER)
    || body.includes(PLAY_TABLE_OPENING_MARKER)
  );
}

/** Payload of a persisted setup→play handoff row, or null when the row is
 *  not one of the two real JSONL envelopes pi actually writes:
 *  - `{type:"custom_message", customType:"coc_setup_handoff", details|content}`
 *    (pi.sendMessage), and
 *  - `{type:"custom", customType:"coc_setup_handoff", data}` (pi.appendEntry).
 *  Any other shape — bare top-level type, details.type without the envelope,
 *  player prose mentioning the type — is rejected. */
function handoffPayloadFromRow(row) {
  if (!row || typeof row !== "object") return null;
  let payload = null;
  if (row.type === "custom_message" && row.customType === SETUP_HANDOFF_CUSTOM_TYPE) {
    if (row.details && typeof row.details === "object") {
      payload = row.details;
    } else if (typeof row.content === "string" && row.content.trim().startsWith("{")) {
      try {
        payload = JSON.parse(row.content);
      } catch {
        payload = null;
      }
    }
  } else if (row.type === "custom" && row.customType === SETUP_HANDOFF_CUSTOM_TYPE) {
    if (row.data && typeof row.data === "object") payload = row.data;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.type !== SETUP_HANDOFF_CUSTOM_TYPE) return null;
  if (typeof payload.campaign_id !== "string" || !payload.campaign_id) return null;
  return payload;
}

/** Structural handoff boundary. When `expectedCampaignId` is provided the
 *  payload campaign must match, so a same-shaped event belonging to another
 *  campaign never cuts this session's history. */
export function isSetupHandoffRow(row, expectedCampaignId) {
  const payload = handoffPayloadFromRow(row);
  if (!payload) return false;
  if (typeof expectedCampaignId === "string" && expectedCampaignId) {
    return payload.campaign_id === expectedCampaignId;
  }
  return true;
}

export function assistantTextFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      parts.push(part.text.trim());
    }
  }
  return parts.join("\n");
}

export function visibleMessagesFromSessionFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!row || row.type !== "message" || !row.message || typeof row.message !== "object") {
      continue;
    }
    const role = row.message.role;
    if (role !== "assistant" && role !== "user") continue;
    const body = assistantTextFromContent(row.message.content);
    if (!body) continue;
    if (role === "user" && isHiddenHostPrompt(body)) continue;
    const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN;
    const entry = {
      role: role === "user" ? "player" : "keeper",
      text: body,
    };
    if (Number.isFinite(at)) entry.at = at;
    out.push(entry);
  }
  return out;
}

export function findLatestSessionFile(agentDir, sessionId) {
  const root = path.join(String(agentDir || ""), "sessions");
  const id = String(sessionId || "");
  if (!id || !fs.existsSync(root)) return null;
  const needle = `_${id}.jsonl`;
  let latest = null;
  let latestMtime = -1;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(needle)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (mtime >= latestMtime) {
        latestMtime = mtime;
        latest = full;
      }
    }
  }
  return latest;
}

function sessionAgentDirs({ agentDir, agentDirs, workspace }) {
  if (Array.isArray(agentDirs) && agentDirs.length) return agentDirs;
  if (workspace) return resolveHostedSessionAgentDirs({ workspace, agentDir });
  if (agentDir) return [agentDir];
  return resolveHostedSessionAgentDirs({ agentDir });
}

export function pickHostedSessionAgentDir({
  workspace,
  agentDir,
  sessionId,
} = {}) {
  const dirs = sessionAgentDirs({ agentDir, workspace });
  if (sessionId) {
    for (const dir of dirs) {
      if (findLatestSessionFile(dir, sessionId)) return dir;
    }
  }
  const ws = String(workspace || "").trim();
  if (ws) {
    const local = path.join(path.resolve(ws), ".pi", "agent");
    if (fs.existsSync(local)) return local;
  }
  return dirs[0] || "";
}

export function hostedSessionMessages({ agentDir, agentDirs, workspace, sessionId }) {
  const dirs = sessionAgentDirs({ agentDir, agentDirs, workspace });
  for (const dir of dirs) {
    const file = findLatestSessionFile(dir, sessionId);
    if (file) return visibleMessagesFromSessionFile(file);
  }
  return [];
}

/** First JSONL row of a file when it is a Pi `session` header, else null.
 *  Only reads the leading bytes — the header is always the first line. */
function sessionHeaderRow(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString("utf8", 0, bytesRead);
    const nl = text.indexOf("\n");
    const first = (nl === -1 ? text : text.slice(0, nl)).trim();
    if (!first) return null;
    const row = JSON.parse(first);
    if (row && typeof row === "object" && row.type === "session") return row;
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** `_${sessionId}.jsonl` files under the agent sessions tree that PROVE they
 *  belong to this session: the first row is the Pi `session` header carrying
 *  the same id. Ordered by recorded session-start time (header timestamp,
 *  mtime fallback) then file name. Files without provable ownership are
 *  excluded rather than guessed into the merge. */
export function listSessionFiles(agentDir, sessionId) {
  const root = path.join(String(agentDir || ""), "sessions");
  const id = String(sessionId || "");
  if (!id || !fs.existsSync(root)) return [];
  const needle = `_${id}.jsonl`;
  const found = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(needle)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      found.push({ file: full, name: entry.name, mtime });
    }
  }
  const verified = [];
  for (const item of found) {
    const header = sessionHeaderRow(item.file);
    if (!header || header.id !== id) continue;
    const startAt = typeof header.timestamp === "string"
      ? Date.parse(header.timestamp)
      : Number.NaN;
    verified.push({
      file: item.file,
      name: item.name,
      mtime: item.mtime,
      startAt: Number.isFinite(startAt) ? startAt : item.mtime,
    });
  }
  verified.sort((left, right) => (
    left.startAt - right.startAt
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      || left.mtime - right.mtime
  ));
  return verified.map((item) => item.file);
}

function visibleEntryFromMessageRow(row) {
  if (!row || row.type !== "message" || !row.message || typeof row.message !== "object") {
    return null;
  }
  const role = row.message.role;
  if (role !== "assistant" && role !== "user") return null;
  const body = assistantTextFromContent(row.message.content);
  if (!body) return null;
  if (role === "user" && isHiddenHostPrompt(body)) return { kind: "hidden", body };
  const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN;
  const entry = {
    kind: "visible",
    role: role === "user" ? "player" : "keeper",
    text: body,
  };
  if (Number.isFinite(at)) entry.at = at;
  return entry;
}

/** Read visible host-session turns until the structural setup/play boundary:
 *  only a persisted `coc_setup_handoff` envelope (optionally campaign-bound).
 *  No prose cut: the play-opening host prompt is merely hidden, and a player
 *  typing boundary-ish prose never truncates anything. Missing boundary →
 *  honest join scope. Attribution is by recorded message role only.
 *  Conservative dedup: same message row id, or same role+time+text, is kept
 *  once across the merged files. */
export function setupHistoryFromSessionFiles(files, { campaignId } = {}) {
  const expected = typeof campaignId === "string" && campaignId ? campaignId : null;
  const messages = [];
  const seenRowIds = new Set();
  const seenContent = new Set();
  const paths = Array.isArray(files) ? files : [];
  for (const file of paths) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (isSetupHandoffRow(row, expected)) {
        return { messages, scope: "setup", boundary: "handoff" };
      }
      const parsed = visibleEntryFromMessageRow(row);
      if (!parsed) continue;
      if (parsed.kind === "hidden") continue;
      const rowId = typeof row.id === "string" && row.id ? row.id : null;
      const contentKey = Number.isFinite(parsed.at)
        ? `${parsed.role}|${parsed.at}|${parsed.text}`
        : null;
      if (rowId && seenRowIds.has(rowId)) continue;
      if (contentKey && seenContent.has(contentKey)) continue;
      if (rowId) seenRowIds.add(rowId);
      if (contentKey) seenContent.add(contentKey);
      const entry = { role: parsed.role, text: parsed.text };
      if (Number.isFinite(parsed.at)) entry.at = parsed.at;
      messages.push(entry);
    }
  }
  return {
    messages,
    scope: "setup_and_table_join",
    boundary: null,
  };
}

export function hostedSetupHistory({ agentDir, agentDirs, workspace, sessionId, campaignId }) {
  const id = String(sessionId || "");
  const dirs = sessionAgentDirs({ agentDir, agentDirs, workspace });
  for (const dir of dirs) {
    const files = listSessionFiles(dir, id);
    if (!files.length) continue;
    const extracted = setupHistoryFromSessionFiles(files, { campaignId });
    return {
      messages: extracted.messages,
      source: "pi-host-session",
      session_id: id,
      scope: extracted.scope,
      boundary: extracted.boundary,
      attribution: "message-role",
    };
  }
  return {
    messages: [],
    source: "pi-host-session",
    session_id: id,
    scope: "setup",
    boundary: null,
    attribution: "message-role",
  };
}

export function lastVisibleAssistantText({ agentDir, agentDirs, workspace, sessionId }) {
  const messages = hostedSessionMessages({ agentDir, agentDirs, workspace, sessionId });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "keeper" && messages[i].text) return messages[i].text;
  }
  return "";
}
