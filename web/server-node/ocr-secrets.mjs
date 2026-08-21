import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Host-local Baidu PaddleOCR credential. Canonical store is the dotenv at
 * `COC_KEEPER_ENV_FILE` (default `~/.config/coc-keeper/secrets.env`), field
 * `BAIDUOCR_TOKEN`. Never write this into PI_AGENT_DIR, web-search.json,
 * prefs, or localStorage.
 *
 * HTTP contract (do not echo the secret):
 *
 * GET  /api/ocr-token → {@link OcrTokenView}
 * PUT  /api/ocr-token ← {@link OcrTokenPatch}
 * PUT  /api/ocr-token → {@link OcrTokenView}
 *
 * @typedef {object} OcrTokenView
 * @property {boolean} configured
 *
 * @typedef {object} OcrTokenPatch
 * @property {string} token  // empty string deletes BAIDUOCR_TOKEN; other lines kept
 */

export const OCR_TOKEN_KEY = "BAIDUOCR_TOKEN";
export const DEFAULT_OCR_SECRETS_RELATIVE = path.join(".config", "coc-keeper", "secrets.env");

const MAX_TOKEN_LEN = 8192;
const TOKEN_ASSIGN_RE = /^BAIDUOCR_TOKEN=(.*)$/;

function secretsError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function defaultOcrSecretsPath(home = os.homedir()) {
  return path.join(home, ".config", "coc-keeper", "secrets.env");
}

/**
 * Absolute secrets path. `COC_KEEPER_ENV_FILE` wins when set; otherwise
 * `~/.config/coc-keeper/secrets.env`. Relative overrides are rejected.
 */
export function resolveOcrSecretsPath(opts = {}) {
  const raw = opts.envFile !== undefined ? opts.envFile : process.env.COC_KEEPER_ENV_FILE;
  if (typeof raw === "string" && raw.trim() !== "") {
    if (!path.isAbsolute(raw)) {
      throw secretsError("COC_KEEPER_ENV_FILE must be absolute");
    }
    return raw;
  }
  const home = opts.home !== undefined ? opts.home : os.homedir();
  return defaultOcrSecretsPath(home);
}

function publicView(configured) {
  return { configured: configured === true };
}

function assertNoNewline(token) {
  if (token.includes("\n") || token.includes("\r") || token.includes("\0")) {
    throw secretsError("token must not contain newlines");
  }
}

export function parseOcrTokenPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw secretsError("request body must be a JSON object");
  }
  if (!Object.prototype.hasOwnProperty.call(body, "token")) {
    throw secretsError("token is required");
  }
  if (typeof body.token !== "string") {
    throw secretsError("token must be a string");
  }
  if (body.token.length > MAX_TOKEN_LEN) {
    throw secretsError("token is too long");
  }
  assertNoNewline(body.token);
  return body.token;
}

function decodeTokenValue(raw) {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function tokenFromAssignmentLine(line) {
  const trimmed = line.trim();
  const match = TOKEN_ASSIGN_RE.exec(trimmed);
  if (!match) return null;
  return decodeTokenValue(match[1]);
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function assertSafeSecretsPath(filePath) {
  if (!path.isAbsolute(filePath)) {
    throw secretsError("COC_KEEPER_ENV_FILE must be absolute");
  }
  const directory = path.dirname(filePath);
  const dirInfo = lstatOrNull(directory);
  if (dirInfo) {
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
      throw secretsError("OCR secret directory must be a non-symlink directory");
    }
  }
  const fileInfo = lstatOrNull(filePath);
  if (fileInfo && (fileInfo.isSymbolicLink() || !fileInfo.isFile())) {
    throw secretsError("OCR env file must be a regular non-symlink file");
  }
  return { directory, dirInfo, fileInfo };
}

function splitEnvLines(content) {
  if (content === "") return [];
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function joinEnvLines(lines) {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

function applyTokenToLines(lines, token) {
  const next = [];
  let replaced = false;
  for (const line of lines) {
    if (TOKEN_ASSIGN_RE.test(line.trim())) {
      if (token !== null && !replaced) {
        next.push(`${OCR_TOKEN_KEY}=${token}`);
        replaced = true;
      }
      continue;
    }
    next.push(line);
  }
  if (token !== null && !replaced) next.push(`${OCR_TOKEN_KEY}=${token}`);
  return next;
}

function atomicWriteText(file, content, { dirMode = 0o700, fileMode = 0o600 } = {}) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(directory, dirMode);
    } catch {
      // Some FS ignore mode; still refuse world-readable files below.
    }
  }
  const dirInfo = fs.lstatSync(directory);
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
    throw secretsError("OCR secret directory must be a non-symlink directory");
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: fileMode, flag: "wx" });
    fs.renameSync(tmp, file);
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(file, fileMode);
      } catch {
        // Windows and some FS ignore mode.
      }
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp may not exist if write failed before create
    }
    throw err;
  }
}

export function loadOcrTokenView(filePath = resolveOcrSecretsPath()) {
  assertSafeSecretsPath(filePath);
  const fileInfo = lstatOrNull(filePath);
  if (!fileInfo) return publicView(false);
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of splitEnvLines(content)) {
    const value = tokenFromAssignmentLine(line);
    if (value) return publicView(true);
  }
  return publicView(false);
}

/**
 * Update or delete `BAIDUOCR_TOKEN` while preserving every other line.
 * Empty / whitespace-only token deletes the assignment. Directory 0700,
 * file 0600, atomic replace. Newlines in the token are rejected.
 */
export function saveOcrToken(body, filePath = resolveOcrSecretsPath()) {
  const raw = parseOcrTokenPatch(body);
  const token = raw.trim() === "" ? null : raw.trim();
  if (token !== null) assertNoNewline(token);

  const { fileInfo } = assertSafeSecretsPath(filePath);
  const existing = fileInfo ? fs.readFileSync(filePath, "utf8") : "";
  const nextLines = applyTokenToLines(splitEnvLines(existing), token);
  const nextContent = joinEnvLines(nextLines);

  if (!nextContent) {
    if (fileInfo) fs.unlinkSync(filePath);
    return publicView(false);
  }
  atomicWriteText(filePath, nextContent);
  return publicView(token !== null);
}
