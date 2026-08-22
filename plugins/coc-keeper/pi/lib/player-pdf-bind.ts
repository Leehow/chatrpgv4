/**
 * Raw-PDF first-bind instruction lifecycle for the Pi-Coc host.
 *
 * Caller: the extension composition root registers this module once.
 * Consumer: player `message_start` events steer one hidden instruction into
 * the live KP before its first model call.
 *
 * Invariants: only user text containing a structurally detected local `.pdf`
 * file is eligible; each normalized path is injected once per live session
 * epoch; a failed delivery releases the reservation for retry. Labels and
 * prose meaning never select a source path.
 */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE =
  "coc-player-pdf-bind-instruction";

/** One-shot hidden instruction: bind the player-provided raw PDF first. */
export function playerPdfBindInstruction(pdfPath: string): string {
  return (
    `玩家提供了 PDF：${pdfPath}。第一步必须调 \`scenario.bind_pdf\`（参数 `
    + `source_bundle_path=${pdfPath}）。若返回 bundle-must-be-directory 错误，`
    + "这是正确触发，系统会自动产包；等 hidden "
    + "`coc-raw-pdf-bind-first-bundle-terminal` 通知（含真实 bundle 路径）后"
    + "再 bind。不要调 setup.invoke 其他操作，不要宣称系统在后台工作直到收到"
    + "通知。"
  );
}

export type PlayerPdfBindDetection =
  | { status: "inject"; pdfPath: string }
  | { status: "skip"; reason: string };

/**
 * Extract user-authored text while ignoring assistant, custom, and tool-result
 * messages. This remains available to the composition root's other player-turn
 * routing without exposing the PDF parser's internal helpers.
 */
export function userMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "user" || !Array.isArray(value.content)) return null;
  const texts: string[] = [];
  for (const part of value.content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      texts.push(candidate.text);
    }
  }
  const text = texts.join("\n").trim();
  return text.length > 0 ? text : null;
}

function normalizePlayerPdfPath(
  raw: string,
  workspaceRoot: string,
): string | null {
  const stripped = raw.trim().replace(
    /^[`"'“”『「]+|[`"'“”『」]+$/g,
    "",
  );
  if (!stripped) return null;
  // A URL is a link, not a local source path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(stripped)) return null;
  const expanded = stripped.startsWith("~/")
    ? join(homedir(), stripped.slice(2))
    : stripped;
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(workspaceRoot, expanded);
}

function extractPdfPathToken(text: string): string | null {
  const quoted = text.match(
    /(?:[`"'“”『「])([^`"'“”『」]*?\.pdf)(?:[`"'“”『」])/i,
  );
  if (quoted) return quoted[1];
  for (const token of text.split(/\s+/)) {
    if (!/\.pdf$/i.test(token) || token.includes("://")) continue;
    const candidate = token.startsWith("~/")
      ? token
      : (() => {
          const index = token.search(/[/\\]/);
          return index >= 0 ? token.slice(index) : token;
        })();
    const cleaned = candidate.replace(/[\])},.，。、；：]+$/g, "");
    if (/\.pdf$/i.test(cleaned)) return cleaned;
  }
  return null;
}

/** Detect one normalized local `.pdf` path without classifying prose. */
export function detectPlayerPdfBindRequest(
  message: unknown,
  workspaceRoot: string,
): PlayerPdfBindDetection {
  const text = userMessageText(message);
  if (text === null) {
    return { status: "skip", reason: "not_a_user_text_message" };
  }
  const rawCandidate = extractPdfPathToken(text);
  if (rawCandidate === null) {
    return { status: "skip", reason: "no_pdf_path_token" };
  }
  const pdfPath = normalizePlayerPdfPath(rawCandidate, workspaceRoot);
  if (pdfPath === null) {
    return { status: "skip", reason: "pdf_path_url_or_empty" };
  }
  return { status: "inject", pdfPath };
}

/**
 * Register the complete first-bind lifecycle. Session state is owned here and
 * rolls forward when the composition root advances its epoch.
 */
export function registerPlayerPdfBindInstruction(
  pi: ExtensionAPI,
  options: {
    workspaceRoot: (ctx: ExtensionContext) => string;
    isCurrent: (epoch: number) => boolean;
    epoch: () => number;
    /** Backward-compatible test seam; production lets this module own the set. */
    injectedPaths?: Set<string>;
  },
): void {
  const injectedPaths = options.injectedPaths ?? new Set<string>();
  let stateEpoch = options.epoch();

  pi.on("message_start", async (event, ctx) => {
    const epoch = options.epoch();
    if (epoch !== stateEpoch) {
      injectedPaths.clear();
      stateEpoch = epoch;
    }
    const detection = detectPlayerPdfBindRequest(
      event.message,
      options.workspaceRoot(ctx),
    );
    if (detection.status !== "inject" || !options.isCurrent(epoch)) return;
    if (injectedPaths.has(detection.pdfPath)) return;

    let fileStat;
    try {
      fileStat = await stat(detection.pdfPath);
    } catch {
      return;
    }
    if (!fileStat.isFile()) return;

    injectedPaths.add(detection.pdfPath);
    try {
      pi.sendMessage({
        customType: PLAYER_PDF_BIND_INSTRUCTION_CUSTOM_TYPE,
        content: playerPdfBindInstruction(detection.pdfPath),
        display: false,
        details: {
          schema_version: 1,
          pdf_path: detection.pdfPath,
          instruction_ref: "pi.player-pdf-bind.first-instruction.v1",
        },
      }, { deliverAs: "steer" });
    } catch {
      injectedPaths.delete(detection.pdfPath);
    }
  });
}
