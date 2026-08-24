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
/** Exact first sentence of PLAY_TABLE_OPENING_PROMPT in pi-coc-rpc.mjs. */
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
  return isHiddenSetupOpeningPrompt(body) || body.includes(TURN_RECOVERY_MARKER);
}

export function isPlayOpeningPrompt(text) {
  const body = String(text || "").trim();
  return Boolean(body) && body.includes(PLAY_TABLE_OPENING_MARKER);
}

export function isSetupHandoffRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.customType === SETUP_HANDOFF_CUSTOM_TYPE) return true;
  if (row.type === SETUP_HANDOFF_CUSTOM_TYPE) return true;
  const details = row.details;
  return Boolean(
    details
    && typeof details === "object"
    && details.type === SETUP_HANDOFF_CUSTOM_TYPE,
  );
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

/** Every `_${sessionId}.jsonl` under the agent sessions tree, oldest first.
 *  setup→play re-exec keeps the web session id but may start a new file. */
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
  found.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return left.mtime - right.mtime;
  });
  return found.map((item) => item.file);
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
  if (role === "user" && isPlayOpeningPrompt(body)) return { kind: "play_opening", body };
  const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN;
  const entry = {
    kind: "visible",
    role: role === "user" ? "player" : "keeper",
    text: body,
  };
  if (Number.isFinite(at)) entry.at = at;
  return entry;
}

/** Read visible host-session turns until a machine setup/play boundary.
 *  Boundaries are only persisted handoff custom_message or the exact play
 *  opening host prompt. No prose keyword cut. Missing boundary → join scope. */
export function setupHistoryFromSessionFiles(files) {
  const messages = [];
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
      if (isSetupHandoffRow(row)) {
        return { messages, scope: "setup", boundary: "handoff" };
      }
      const parsed = visibleEntryFromMessageRow(row);
      if (!parsed) continue;
      if (parsed.kind === "play_opening") {
        return { messages, scope: "setup", boundary: "play_opening" };
      }
      if (parsed.kind === "hidden") continue;
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

export function hostedSetupHistory({ agentDir, agentDirs, workspace, sessionId }) {
  const id = String(sessionId || "");
  const dirs = sessionAgentDirs({ agentDir, agentDirs, workspace });
  for (const dir of dirs) {
    const files = listSessionFiles(dir, id);
    if (!files.length) continue;
    const extracted = setupHistoryFromSessionFiles(files);
    return {
      messages: extracted.messages,
      source: "pi-host-session",
      session_id: id,
      scope: extracted.scope,
      boundary: extracted.boundary,
    };
  }
  return {
    messages: [],
    source: "pi-host-session",
    session_id: id,
    scope: "setup",
    boundary: null,
  };
}

export function lastVisibleAssistantText({ agentDir, agentDirs, workspace, sessionId }) {
  const messages = hostedSessionMessages({ agentDir, agentDirs, workspace, sessionId });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "keeper" && messages[i].text) return messages[i].text;
  }
  return "";
}
