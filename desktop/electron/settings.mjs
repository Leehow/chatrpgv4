import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

// Minimal JSON settings under userData. Holds only what the shell itself
// needs before/around the bridge: onboarding and model-list presentation.
// Provider credentials live in the pi agent dir
// (auth.json / models.json), exactly as pi itself stores them.

const DEFAULTS = {
  onboarded: false,
  hiddenProviderIds: [],
  // User-added OpenAI-compatible provider cards for the settings list.
  // Credentials stay in the agent dir (auth.json); this only defines the card.
  customProviders: [],
};

function sanitizeHiddenProviderIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizeCustomProviders(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    const label = String(raw.label || id).trim();
    const baseUrl = String(raw.baseUrl || "").trim().replace(/\/+$/, "");
    const note = String(raw.note || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry = { id, label: label || id, baseUrl };
    if (note) entry.note = note;
    out.push(entry);
  }
  return out;
}

function settingsPath() {
  // Same base-dir rule as env.mjs resolvePaths, so the QA override
  // relocates settings together with everything else.
  const base = process.env.COC_DESKTOP_USER_DATA || app.getPath("userData");
  return path.join(base, "coc-desktop-settings.json");
}

export function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    const next = { ...DEFAULTS, ...raw };
    // Obsolete per-PDF model knobs are intentionally not carried forward.
    // Both child lanes now follow the current main model for each turn.
    delete next.pdfOpeningModel;
    delete next.pdfVisionModel;
    next.hiddenProviderIds = sanitizeHiddenProviderIds(next.hiddenProviderIds);
    next.customProviders = sanitizeCustomProviders(next.customProviders);
    return next;
  } catch {
    return { ...DEFAULTS, hiddenProviderIds: [], customProviders: [] };
  }
}

export function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...patch };
  // Ignore stale callers or hand-edited legacy settings files too: these
  // model choices are derived from the current top-bar selection per turn.
  delete next.pdfOpeningModel;
  delete next.pdfVisionModel;
  next.hiddenProviderIds = sanitizeHiddenProviderIds(
    Object.prototype.hasOwnProperty.call(patch || {}, "hiddenProviderIds")
      ? patch.hiddenProviderIds
      : current.hiddenProviderIds,
  );
  next.customProviders = sanitizeCustomProviders(
    Object.prototype.hasOwnProperty.call(patch || {}, "customProviders")
      ? patch.customProviders
      : current.customProviders,
  );
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
