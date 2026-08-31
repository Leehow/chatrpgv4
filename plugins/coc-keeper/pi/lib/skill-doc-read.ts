/**
 * Path-restricted `read` for canonical COC skill/reference documentation.
 * Caller: extensions/index.ts session_start registration (ordered before the
 * KP active-tools apply). Consumer: live KP model in a pi-coc session.
 *
 * Pi's native skill progressive disclosure tells the model to "use the read
 * tool to load a skill's file" and to resolve routed references against the
 * skill directory. Canonical pi-coc launches with `--no-builtin-tools`, so
 * without this registration that instruction names a tool the session does
 * not have and the KP never loads SKILL.md bodies or routed references.
 *
 * The tool keeps Pi's native name/parameters so skill instructions work
 * unchanged, but only regular text documentation is readable, and only under
 * the active role's skill directories from session-roles.json plus the
 * canonical plugin reference roots those skills require
 * (plugins/coc-keeper/references and rulesets/<id>/references). Campaign
 * state, `.coc`, `.tmp`, module assets, PDFs, source bundles, scripts, and
 * arbitrary repository files are denied, as is any symlink escape; denied or
 * ambiguous paths fail closed with a clear non-secret message. The legacy
 * unset role uses the union of the setup/play manifests.
 */
import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionRoleFromEnv } from "./domain-tools.ts";
import type { SessionRole } from "./operation-policy.ts";

export const SKILL_DOC_READ_TOOL_NAME = "read";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PI_DIR = dirname(MODULE_DIR); // <repo>/plugins/coc-keeper/pi
const PLUGIN_ROOT = dirname(PI_DIR); // <repo>/plugins/coc-keeper
const REPO_ROOT = dirname(dirname(PLUGIN_ROOT)); // <repo>
const MANIFEST_PATH = join(PI_DIR, "session-roles.json");

/** Documentation-only extensions; scripts/PDFs/binaries stay unreadable. */
const DOC_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md", ".markdown", ".json", ".yaml", ".yml", ".txt",
]);

/** Same bounded output contract as the built-in read. */
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

type RoleManifestEntry = { skills?: unknown };
type ProfileManifestEntry = RoleManifestEntry & { role?: unknown };
type RoleManifest = {
  setup?: RoleManifestEntry;
  play?: RoleManifestEntry;
  profiles?: Record<string, ProfileManifestEntry>;
};

const RULES_DIRECTOR_SINGLE_DRAFT_PROFILE = "rules-director-single-draft";

function readRoleManifest(): RoleManifest | null {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as RoleManifest;
  } catch {
    return null;
  }
}

/**
 * Absolute documentation roots readable by this session's restricted read.
 * Canonical caller: skillDocReadToolDefinition/executeSkillDocRead.
 */
export function skillDocAllowedRoots(role: SessionRole | null = sessionRoleFromEnv()): string[] {
  const manifest = readRoleManifest();
  if (manifest === null) {
    // Fail closed but stay useful: the plugin reference root is role-free.
    return [join(PLUGIN_ROOT, "references")];
  }
  const profile = process.env.COC_PI_ACCEPTANCE_PROFILE;
  const profileEntry = (
    role === "play"
    && profile === RULES_DIRECTOR_SINGLE_DRAFT_PROFILE
    && manifest.profiles?.[profile]?.role === "play"
  ) ? manifest.profiles[profile] : null;
  const entries = role === "setup"
    ? [manifest.setup]
    : role === "play"
      ? [profileEntry ?? manifest.play]
      : [manifest.setup, manifest.play];
  const skillDirs: string[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry?.skills)) continue;
    for (const skill of entry.skills) {
      if (typeof skill !== "string" || !skill.trim()) continue;
      skillDirs.push(isAbsolute(skill) ? skill : join(REPO_ROOT, skill));
    }
  }
  const roots = new Set<string>(skillDirs);
  roots.add(join(PLUGIN_ROOT, "references"));
  for (const dir of skillDirs) {
    const match = /^rulesets[/\\]([^/\\]+)[/\\]skills(?:[/\\]|$)/.exec(
      relative(PLUGIN_ROOT, dir),
    );
    if (match) roots.add(join(PLUGIN_ROOT, "rulesets", match[1], "references"));
  }
  return [...roots];
}

function isInside(child: string, root: string): boolean {
  return child === root || child.startsWith(root + sep);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type Truncation = {
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  outputLines: number;
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
};

/** Built-in read's truncateHead contract: whole lines, lines or bytes first. */
function truncateHead(content: string): { content: string; truncation: Truncation } {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;
  const truncation: Truncation = {
    truncated: false, truncatedBy: null, totalLines, outputLines: totalLines,
    firstLineExceedsLimit: false, maxLines: MAX_LINES, maxBytes: MAX_BYTES,
  };
  if (totalLines <= MAX_LINES && totalBytes <= MAX_BYTES) {
    return { content, truncation };
  }
  truncation.truncated = true;
  const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
  if (firstLineBytes > MAX_BYTES) {
    truncation.truncatedBy = "bytes";
    truncation.firstLineExceedsLimit = true;
    truncation.outputLines = 0;
    return { content: "", truncation };
  }
  const output: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  for (let i = 0; i < lines.length && i < MAX_LINES; i++) {
    const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0);
    if (outputBytes + lineBytes > MAX_BYTES) {
      truncatedBy = "bytes";
      break;
    }
    output.push(lines[i]);
    outputBytes += lineBytes;
  }
  if (output.length >= MAX_LINES && outputBytes <= MAX_BYTES) truncatedBy = "lines";
  truncation.truncatedBy = truncatedBy;
  truncation.outputLines = output.length;
  return { content: output.join("\n"), truncation };
}

const DENIED_SCOPE_MESSAGE =
  "read: access denied: this read only serves canonical COC skill/reference "
  + "documentation (regular Markdown/JSON/YAML/TXT files under this session's "
  + "loaded skill directories, the plugin references root, and ruleset "
  + "reference directories). Campaign state, module assets, PDFs, source "
  + "bundles, scripts, and arbitrary repository files are outside it; use the "
  + "closed COC tools for that material.";

type ReadParams = { path?: unknown; offset?: unknown; limit?: unknown };

/**
 * Gate + bounded read. Canonical caller: the restricted `read` tool execute.
 * Consumer: KP model + tests/pi/skill-doc-read-gate.mjs. Throws on denial
 * with a clear non-secret message; never lists campaign or secret paths.
 */
export async function executeSkillDocRead(
  params: ReadParams,
  options: { allowedRoots: readonly string[]; cwd: string },
): Promise<{ content: Array<{ type: "text"; text: string }>; details?: { truncation: Truncation } }> {
  const rawPath = params.path;
  if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.includes("\0")) {
    throw new Error("read: path must be a non-empty string");
  }
  const offset = params.offset;
  const limit = params.limit;
  if (offset !== undefined && (!Number.isInteger(offset) || (offset as number) < 1)) {
    throw new Error("read: offset must be a positive 1-indexed line number");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1)) {
    throw new Error("read: limit must be a positive line count");
  }
  const realRoots: string[] = [];
  for (const root of options.allowedRoots) {
    try {
      realRoots.push(await realpath(root));
    } catch {
      // A missing root (e.g. a ruleset without references/) is simply not allowed.
    }
  }
  const candidates = isAbsolute(rawPath)
    ? [resolve(rawPath)]
    : [resolve(options.cwd, rawPath), ...options.allowedRoots.map((root) => resolve(root, rawPath))];
  const seenCandidates = new Set<string>();
  const seenReal = new Set<string>();
  const valid: string[] = [];
  let denial: string | null = null;
  for (const candidate of candidates) {
    if (seenCandidates.has(candidate)) continue;
    seenCandidates.add(candidate);
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      continue;
    }
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    const root = realRoots.find((allowed) => isInside(real, allowed));
    if (root === undefined) {
      denial ??= DENIED_SCOPE_MESSAGE;
      continue;
    }
    const info = await stat(real);
    if (!info.isFile()) {
      denial ??= `read: access denied: ${rawPath} is not a regular file.`;
      continue;
    }
    if (!DOC_EXTENSIONS.has(extname(real).toLowerCase())) {
      denial ??= `read: access denied: ${rawPath} is not regular text documentation `
        + `(allowed extensions: ${[...DOC_EXTENSIONS].join(" ")}).`;
      continue;
    }
    valid.push(real);
  }
  if (valid.length === 0) {
    throw new Error(denial ?? `read: ${rawPath} not found within the allowed canonical skill/reference documentation roots.`);
  }
  if (valid.length > 1) {
    throw new Error(
      `read: ambiguous relative path ${rawPath}; it matches multiple allowed roots `
      + `(${valid.join(", ")}). Pass the absolute path of the intended document.`,
    );
  }
  const text = await readFile(valid[0], "utf-8");
  const allLines = text.split("\n");
  const totalFileLines = allLines.length;
  const startLine = offset ? Math.max(0, (offset as number) - 1) : 0;
  const startLineDisplay = startLine + 1;
  if (startLine >= allLines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
  }
  let selected: string;
  let userLimitedLines: number | undefined;
  if (limit !== undefined) {
    const endLine = Math.min(startLine + (limit as number), allLines.length);
    selected = allLines.slice(startLine, endLine).join("\n");
    userLimitedLines = endLine - startLine;
  } else {
    selected = allLines.slice(startLine).join("\n");
  }
  const head = truncateHead(selected);
  let outputText: string;
  const endLineDisplay = startLineDisplay + head.truncation.outputLines - 1;
  const nextOffset = endLineDisplay + 1;
  if (head.truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
    outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(MAX_BYTES)} limit. This read cannot serve a single line beyond the byte limit.]`;
  } else if (head.truncation.truncated) {
    outputText = head.content;
    if (head.truncation.truncatedBy === "lines") {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
    } else {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
    }
  } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines);
    outputText = `${head.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  } else {
    outputText = head.content;
  }
  const details = head.truncation.truncated || userLimitedLines !== undefined
    ? { truncation: head.truncation }
    : undefined;
  return { content: [{ type: "text", text: outputText }], details };
}

export const SKILL_DOC_READ_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Path to the canonical COC skill/reference documentation file to read (relative or absolute)" },
    offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
    limit: { type: "number", description: "Maximum number of lines to read" },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

/**
 * Register the restricted read unless this session already has a `read` tool
 * active (a generic Pi session keeps its built-in read; pi-coc's
 * `--no-builtin-tools` session gains only this path-restricted one). Must be
 * called from a bound context (session_start), before the KP active set is
 * applied, so the guard observes the session's own initial tools.
 */
export function registerSkillDocRead(
  pi: Pick<ExtensionAPI, "getActiveTools" | "registerTool">,
): boolean {
  let active: string[];
  try {
    active = pi.getActiveTools();
  } catch {
    return false;
  }
  if (active.includes(SKILL_DOC_READ_TOOL_NAME)) return false;
  pi.registerTool(skillDocReadToolDefinition());
  return true;
}

export function skillDocReadToolDefinition() {
  return {
    name: SKILL_DOC_READ_TOOL_NAME,
    label: "read (canonical COC skill docs)",
    description:
      `Read the contents of a canonical COC skill/reference documentation file `
      + `(regular Markdown/JSON/YAML/TXT under this session's loaded skill `
      + `directories, the plugin references root, or ruleset reference `
      + `directories). For text files, output is truncated to ${MAX_LINES} lines `
      + `or ${MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for `
      + `large files. Paths outside canonical skill/reference documentation are `
      + `denied; use the closed COC tools for campaign state and module material.`,
    promptSnippet: "Read canonical COC skill/reference documentation",
    promptGuidelines: [
      "At session start, use read to load the full SKILL.md of each active role skill before you follow it; the skill list only carries name and description.",
      "When a skill routes a relative reference (for example `references/style-scene-craft.md`), resolve it against that skill's directory and read it with this tool before applying it.",
      "This read only serves canonical COC skill/reference documentation. Campaign state, module assets, PDFs, source bundles, scripts, and arbitrary repository files are denied; use the closed COC tools instead.",
    ],
    parameters: SKILL_DOC_READ_SCHEMA,
    async execute(
      _toolCallId: string,
      params: ReadParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd?: string } | undefined,
    ) {
      return executeSkillDocRead(params, {
        allowedRoots: skillDocAllowedRoots(),
        cwd: ctx?.cwd ?? process.cwd(),
      });
    },
  };
}
