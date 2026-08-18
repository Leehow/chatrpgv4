import type { JsonObject, McpCaller } from "./runtime.ts";

export const CHARGEN_CLERK_ENV = "COC_PI_CHARGEN_CLERK";

export type ChargenClerkMode = "quick_fire" | "pregen";

export interface ChargenClerkBrief {
  name: string;
  occupation_or_concept: string;
  assignment_priority?: string;
  interest_allocation_intent?: string;
  occupation_skill_names?: string[];
  interest_skill_names?: string[];
  investigator_id?: string;
  mode: ChargenClerkMode;
  pregen_id?: string;
}

export function isChargenClerkProcess(
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return false;
}

const GENERIC_INVESTIGATOR_IDS = new Set([
  "investigator",
  "inv-investigator",
  "inv",
  "inv-",
]);

export function slugInvestigatorToken(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "investigator";
}

export function isGenericInvestigatorPlaceholder(
  investigatorId: string | undefined,
): boolean {
  if (investigatorId === undefined) return true;
  const token = investigatorId.trim().toLowerCase();
  return token.length === 0 || GENERIC_INVESTIGATOR_IDS.has(token);
}

export function shortStableToken(value: string, length = 8): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, length);
}

export function allocateInvestigatorId(
  campaignId: string,
  name: string,
  explicitId?: string,
): string {
  const explicit = (explicitId ?? "").trim();
  if (explicit && !isGenericInvestigatorPlaceholder(explicit)) {
    return explicit.slice(0, 128);
  }
  const nameSlug = slugInvestigatorToken(name);
  const namePart = nameSlug === "investigator"
    ? `x${shortStableToken(name.trim())}`
    : nameSlug;
  const campaignPart = shortStableToken(campaignId.trim() || "campaign");
  return `inv-${namePart}-${campaignPart}`.slice(0, 128);
}

export function parseChargenClerkBrief(params: JsonObject): ChargenClerkBrief {
  const name = String(params.name ?? "").trim();
  const occupation = String(params.occupation_or_concept ?? "").trim();
  const modeRaw = String(params.mode ?? "quick_fire").trim() || "quick_fire";
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
  const investigatorId = String(params.investigator_id ?? "").trim();
  if (investigatorId) brief.investigator_id = investigatorId;
  if (Array.isArray(params.occupation_skill_names)) {
    brief.occupation_skill_names = params.occupation_skill_names
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (Array.isArray(params.interest_skill_names)) {
    brief.interest_skill_names = params.interest_skill_names
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  const pregenId = String(params.pregen_id ?? "").trim();
  if (pregenId) brief.pregen_id = pregenId;
  if (modeRaw === "pregen" && !pregenId) {
    throw new Error("coc_chargen_delegate pregen mode requires pregen_id");
  }
  return brief;
}

function assignmentList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export async function runChargenInProcess(options: {
  campaignId: string;
  brief: ChargenClerkBrief;
  callTool: McpCaller;
  signal?: AbortSignal;
}): Promise<JsonObject> {
  if (options.brief.mode === "pregen") {
    return {
      ok: false,
      stage: "pregen",
      error: "pregen mode uses setup.quick_start, not setup.chargen_run",
    };
  }
  const investigatorId = allocateInvestigatorId(
    options.campaignId,
    options.brief.name,
    options.brief.investigator_id,
  );
  const args: JsonObject = {
    campaign_id: options.campaignId,
    investigator_id: investigatorId,
    name: options.brief.name,
    occupation_name: options.brief.occupation_or_concept,
    luck: { mode: "auto_roll" },
  };
  const assignment = assignmentList(options.brief.assignment_priority);
  if (assignment) args.assignment_priority = assignment;
  if (options.brief.occupation_skill_names?.length) {
    args.occupation_skill_names = options.brief.occupation_skill_names;
  }
  if (options.brief.interest_skill_names?.length) {
    args.interest_skill_names = options.brief.interest_skill_names;
  }
  const envelope = await options.callTool("setup.chargen_run", args, options.signal);
  if (envelope.ok === true && envelope.data && typeof envelope.data === "object") {
    const data = envelope.data as JsonObject;
    const result = (data.result && typeof data.result === "object")
      ? data.result as JsonObject
      : data;
    return result;
  }
  const details = envelope.error && typeof envelope.error === "object"
    ? (envelope.error as JsonObject).details
    : undefined;
  if (details && typeof details === "object") return details as JsonObject;
  return {
    ok: false,
    stage: "delegate",
    error: String(
      (envelope.error && typeof envelope.error === "object"
        ? (envelope.error as JsonObject).message
        : envelope.error) || "setup.chargen_run failed",
    ),
  };
}

/** @deprecated spawn clerk retired; kept as alias of in-process run */
export const runChargenClerk = runChargenInProcess;

export function chargenClerkActiveTools(): string[] {
  return ["coc_setup", "coc_context", "coc_rules", "coc_state"];
}

export function shouldRegisterChargenDelegate(): boolean {
  return true;
}
