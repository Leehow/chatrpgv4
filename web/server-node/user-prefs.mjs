import fs from "node:fs";
import path from "node:path";

import { resolveProductSettingsPath } from "./agent-dir.mjs";

/** Keys the UI may read/write. Never includes onboarded / provider-list fields. */
export const UI_PREF_KEYS = ["provider", "model", "thinking", "appearance", "layout"];

const APPEARANCE = new Set(["light", "dark", "system"]);
const MAX_LEN = 200;

export const LAYOUT_DEFAULTS = Object.freeze({
  leftSidebarWidth: 256,
  rightSidebarWidth: 320,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
});

const LAYOUT_WIDTH = Object.freeze({
  leftSidebarWidth: Object.freeze({ min: 192, max: 480 }),
  rightSidebarWidth: Object.freeze({ min: 256, max: 560 }),
});

const LAYOUT_BOOL_KEYS = Object.freeze(["leftSidebarCollapsed", "rightSidebarCollapsed"]);
const LAYOUT_WIDTH_KEYS = Object.freeze(["leftSidebarWidth", "rightSidebarWidth"]);
const LAYOUT_KEYS = Object.freeze([...LAYOUT_WIDTH_KEYS, ...LAYOUT_BOOL_KEYS]);

function emptyPrefs() {
  return {
    provider: "",
    model: "",
    thinking: "",
    appearance: "",
    layout: { ...LAYOUT_DEFAULTS },
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function prefError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function sanitizeUiPref(key, value, { strict = false } = {}) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    if (strict) throw prefError(`${key} must be a string`);
    return "";
  }
  const s = value.trim();
  if (!s) return "";
  if (s.length > MAX_LEN) {
    if (strict) throw prefError(`${key} is too long`);
    return "";
  }
  if (key === "appearance") {
    if (!APPEARANCE.has(s)) {
      if (strict) throw prefError("appearance must be light, dark, or system");
      return "";
    }
    return s;
  }
  return s;
}

function clampWidth(key, value) {
  const range = LAYOUT_WIDTH[key];
  const n = Math.round(Number(value));
  return Math.min(range.max, Math.max(range.min, n));
}

export function sanitizeLayout(raw, { strict = false, base = LAYOUT_DEFAULTS } = {}) {
  const out = { ...LAYOUT_DEFAULTS, ...(base && typeof base === "object" ? base : {}) };
  if (raw == null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    if (strict) throw prefError("layout must be an object");
    return out;
  }
  for (const key of Object.keys(raw)) {
    if (!LAYOUT_KEYS.includes(key)) {
      if (strict) throw prefError(`unknown layout field: ${key}`);
      continue;
    }
  }
  for (const key of LAYOUT_WIDTH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (strict) throw prefError(`${key} must be a number`);
      continue;
    }
    out[key] = clampWidth(key, value);
  }
  for (const key of LAYOUT_BOOL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (typeof value !== "boolean") {
      if (strict) throw prefError(`${key} must be a boolean`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function pickUiPrefs(raw, { strict = false } = {}) {
  const out = emptyPrefs();
  if (!raw || typeof raw !== "object") return out;
  for (const key of UI_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (key === "layout") {
      out.layout = sanitizeLayout(raw.layout, { strict, base: out.layout });
      continue;
    }
    out[key] = sanitizeUiPref(key, raw[key], { strict });
  }
  return out;
}

export function resolveUserPrefsPath(opts) {
  return resolveProductSettingsPath(opts);
}

export function loadUserPrefs(settingsPath) {
  if (!settingsPath) return emptyPrefs();
  const raw = readJson(settingsPath);
  return pickUiPrefs(raw, { strict: false });
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp may not exist if write failed before create
    }
    throw err;
  }
}

/**
 * Merge only UI-pref keys into coc-desktop-settings.json.
 * Never clobbers onboarded / hiddenProviderIds / extras / customProviders.
 */
export function saveUserPrefs(settingsPath, patch) {
  if (!settingsPath) {
    throw prefError("desktop settings path is not writable");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw prefError("request body must be a JSON object");
  }
  const current = loadUserPrefs(settingsPath);
  const next = { ...current, layout: { ...current.layout } };
  for (const key of UI_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (key === "layout") {
      next.layout = sanitizeLayout(patch.layout, { strict: true, base: next.layout });
      continue;
    }
    next[key] = sanitizeUiPref(key, patch[key], { strict: true });
  }
  const existing = readJson(settingsPath);
  const merged = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing, ...next }
    : { ...next };
  delete merged.pdfOpeningModel;
  delete merged.pdfVisionModel;
  atomicWriteJson(settingsPath, merged);
  return next;
}
