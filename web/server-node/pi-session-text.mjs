/**
 * Read player-visible turns out of a Pi session JSONL. Character-setup
 * openings never finalize into table-transcript, so the UI has to hydrate
 * from this file when the host comes back idle.
 */
import fs from "node:fs";
import path from "node:path";

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

export function hostedSessionMessages({ agentDir, sessionId }) {
  const file = findLatestSessionFile(agentDir, sessionId);
  return file ? visibleMessagesFromSessionFile(file) : [];
}

export function lastVisibleAssistantText({ agentDir, sessionId }) {
  const messages = hostedSessionMessages({ agentDir, sessionId });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "keeper" && messages[i].text) return messages[i].text;
  }
  return "";
}
