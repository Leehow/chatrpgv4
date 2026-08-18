import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_BYTES,
  piInvocation,
  safeEnv,
  terminateTree,
  type JsonObject,
} from "./runtime.ts";

export const CHARGEN_CLERK_ENV = "COC_PI_CHARGEN_CLERK";
export const CHARGEN_CLERK_TIMEOUT_MS = 600_000;
export const CHARGEN_CLERK_PROMPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../prompts/chargen-clerk.md",
);

const SETUP_SKILLS = [
  "plugins/coc-keeper/skills/coc-main",
  "plugins/coc-keeper/skills/coc-scenario-import",
  "plugins/coc-keeper/skills/trpg-pdf-ingest",
  "plugins/coc-keeper/skills/coc-campaign-state",
  "plugins/coc-keeper/skills/coc-steward-parse",
  "plugins/coc-keeper/rulesets/coc7/skills/coc-character",
  "plugins/coc-keeper/rulesets/coc7/skills/coc-rules-engine",
] as const;

export type ChargenClerkMode = "quick_fire" | "pregen";

export interface ChargenClerkBrief {
  name: string;
  occupation_or_concept: string;
  assignment_priority?: string;
  interest_allocation_intent?: string;
  mode: ChargenClerkMode;
  pregen_id?: string;
}

export function isChargenClerkProcess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[CHARGEN_CLERK_ENV] === "1";
}

export function slugInvestigatorToken(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "investigator";
}

export function parseChargenClerkBrief(params: JsonObject): ChargenClerkBrief {
  const name = String(params.name ?? "").trim();
  const occupation = String(params.occupation_or_concept ?? "").trim();
  const modeRaw = String(params.mode ?? "").trim();
  if (!name) throw new Error("coc_chargen_delegate requires name");
  if (!occupation) {
    throw new Error("coc_chargen_delegate requires occupation_or_concept");
  }
  if (modeRaw !== "quick_fire" && modeRaw !== "pregen") {
    throw new Error('coc_chargen_delegate mode must be "quick_fire" or "pregen"');
  }
  const brief: ChargenClerkBrief = {
    name,
    occupation_or_concept: occupation,
    mode: modeRaw,
  };
  const assignment = String(params.assignment_priority ?? "").trim();
  if (assignment) brief.assignment_priority = assignment;
  const interest = String(params.interest_allocation_intent ?? "").trim();
  if (interest) brief.interest_allocation_intent = interest;
  const pregenId = String(params.pregen_id ?? "").trim();
  if (pregenId) brief.pregen_id = pregenId;
  if (modeRaw === "pregen" && !pregenId) {
    throw new Error("coc_chargen_delegate pregen mode requires pregen_id");
  }
  return brief;
}

export function extractCompactClerkJson(stdout: string): JsonObject {
  const trimmed = stdout.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const lastBrace = trimmed.lastIndexOf("{");
  if (lastBrace >= 0) {
    const fromLast = trimmed.slice(lastBrace);
    const end = fromLast.lastIndexOf("}");
    if (end > 0) candidates.push(fromLast.slice(0, end + 1));
  }
  candidates.push(trimmed);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
    } catch {
      /* try next */
    }
  }
  return {
    ok: false,
    error: "clerk_stdout_not_compact_json",
    stdout_tail: trimmed.slice(-1200),
  };
}

export function clerkSessionId(campaignId: string, name: string): string {
  return `chargen-clerk-${campaignId}-${slugInvestigatorToken(name)}`;
}

function repoRootFromHere(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export async function runChargenClerk(options: {
  cwd: string;
  campaignId: string;
  brief: ChargenClerkBrief;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<JsonObject> {
  if (isChargenClerkProcess()) {
    return { ok: false, error: "nested_chargen_clerk_forbidden" };
  }
  if (!existsSync(CHARGEN_CLERK_PROMPT)) {
    return { ok: false, error: "chargen_clerk_prompt_missing" };
  }
  const timeoutMs = options.timeoutMs ?? CHARGEN_CLERK_TIMEOUT_MS;
  const repoRoot = repoRootFromHere();
  const invocation = piInvocation();
  const sessionId = clerkSessionId(options.campaignId, options.brief.name);
  const userMessage = JSON.stringify({
    campaign_id: options.campaignId,
    workspace_root: options.cwd,
    brief: options.brief,
  });
  const args = [
    ...invocation.args,
    "--no-builtin-tools",
    "--approve",
    "--no-context-files",
    "--no-skills",
    ...SETUP_SKILLS.flatMap((rel) => ["--skill", join(repoRoot, rel)]),
    "--append-system-prompt",
    CHARGEN_CLERK_PROMPT,
    "--session-id",
    sessionId,
    "--thinking",
    "off",
    "-p",
    userMessage,
  ];
  const child = spawn(invocation.command, args, {
    cwd: options.cwd,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: safeEnv({
      COC_HOST: "pi",
      COC_PROJECT_ROOT: options.cwd,
      COC_PI_SESSION_ROLE: "setup",
      PI_COC_CAMPAIGN_ID: options.campaignId,
      [CHARGEN_CLERK_ENV]: "1",
    }),
  });
  let stdout = "";
  let stderr = "";
  const code = await new Promise<number | null>((resolveClose, rejectClose) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      void terminateTree(child).then(
        () => rejectClose(error),
        (terminationError) => rejectClose(
          new Error(
            `${error.message}; clerk tree termination failed: ${
              terminationError instanceof Error
                ? terminationError.message
                : "unknown error"
            }`,
          ),
        ),
      );
    };
    const abort = () => finishError(new Error("chargen clerk aborted"));
    timer = setTimeout(
      () => finishError(new Error("chargen clerk timed out")),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > MAX_BYTES) {
        finishError(new Error("chargen clerk stdout exceeded limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr, "utf8") > MAX_BYTES) {
        finishError(new Error("chargen clerk stderr exceeded limit"));
      }
    });
    child.once("error", finishError);
    child.once("close", (closeCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolveClose(closeCode);
    });
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  }).catch((error: Error) => {
    return {
      ok: false,
      error: error.message,
      session_id: sessionId,
    } as const;
  });
  if (typeof code === "object" && code !== null && "error" in code) {
    return { ...code, session_id: sessionId };
  }
  const compact = extractCompactClerkJson(stdout);
  return {
    ...compact,
    session_id: sessionId,
    exit_code: code,
    ...(compact.ok === true ? {} : {
      stderr_tail: stderr.trim().slice(-800),
    }),
  };
}

export function chargenClerkActiveTools(): string[] {
  return ["coc_setup", "coc_context", "coc_rules", "coc_state"];
}

export function shouldRegisterChargenDelegate(): boolean {
  return !isChargenClerkProcess();
}
