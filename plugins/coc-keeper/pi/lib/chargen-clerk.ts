import type { JsonObject, McpCaller } from "./runtime.ts";

export const CHARGEN_CLERK_ENV = "COC_PI_CHARGEN_CLERK";

export type ChargenClerkMode = "quick_fire" | "era_adaptive" | "pregen";

export const CHARGEN_BACKSTORY_KEYS = [
  "personal_description",
  "ideology_beliefs",
  "significant_people",
  "meaningful_locations",
  "treasured_possessions",
  "traits",
  "injuries_scars",
  "phobias_manias",
  "encounters",
  "scenario_bound",
] as const;
export const CHARGEN_KEY_CONNECTION_FIELDS = [
  "personal_description",
  "ideology_beliefs",
  "significant_people",
  "meaningful_locations",
  "treasured_possessions",
  "traits",
] as const;
export type ChargenBackstory = Partial<Record<typeof CHARGEN_BACKSTORY_KEYS[number], string>>;
export type ChargenKeyConnection = {
  backstory_field: typeof CHARGEN_KEY_CONNECTION_FIELDS[number];
  summary: string;
};

export interface ChargenClerkBrief {
  name: string;
  occupation_or_concept: string;
  age?: number;
  assignment_priority?: string;
  interest_allocation_intent?: string;
  occupation_skill_names?: string[];
  interest_skill_names?: string[];
  investigator_id?: string;
  mode: ChargenClerkMode;
  pregen_id?: string;
  backstory?: ChargenBackstory;
  equipment?: string[];
  key_connection?: ChargenKeyConnection;
  occupation_label?: string;
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
  if (
    modeRaw !== "quick_fire"
    && modeRaw !== "pregen"
    && modeRaw !== "era_adaptive"
  ) {
    throw new Error(
      'coc_chargen_delegate mode must be "quick_fire", "era_adaptive", or "pregen"',
    );
  }
  const brief: ChargenClerkBrief = {
    name,
    occupation_or_concept: occupation,
    mode: modeRaw,
  };
  if (params.age !== undefined) {
    const age = Number(params.age);
    if (!Number.isInteger(age) || age < 15 || age > 89) {
      throw new Error("coc_chargen_delegate age must be an integer from 15 to 89");
    }
    brief.age = age;
  }
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
  const forbiddenNumeric = [
    "cash", "assets", "spending_level", "living_standard", "credit_rating",
    "characteristics", "derived", "skills", "hp", "mp", "san", "luck_roll_total",
    "occupation_allocations", "interest_allocations",
  ];
  const presentForbidden = forbiddenNumeric.filter((key) => params[key] !== undefined);
  if (presentForbidden.length > 0) {
    throw new Error(
      "coc_chargen_delegate rejects KP-supplied numeric finance or stats: "
        + presentForbidden.join(", "),
    );
  }
  if (params.backstory !== undefined) {
    if (
      typeof params.backstory !== "object"
      || params.backstory === null
      || Array.isArray(params.backstory)
    ) {
      throw new Error("coc_chargen_delegate backstory must be an object");
    }
    const allowed = new Set<string>(CHARGEN_BACKSTORY_KEYS);
    const unknown = Object.keys(params.backstory).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new Error("coc_chargen_delegate backstory has unsupported keys");
    }
    const backstory: ChargenBackstory = {};
    for (const [key, value] of Object.entries(params.backstory)) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error("coc_chargen_delegate backstory values must be strings");
      }
      backstory[key as typeof CHARGEN_BACKSTORY_KEYS[number]] = value.trim();
    }
    brief.backstory = backstory;
  }
  if (params.equipment !== undefined) {
    if (!Array.isArray(params.equipment)) {
      throw new Error("coc_chargen_delegate equipment must be an array of strings");
    }
    brief.equipment = params.equipment.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  if (params.key_connection !== undefined) {
    if (
      typeof params.key_connection !== "object"
      || params.key_connection === null
      || Array.isArray(params.key_connection)
    ) {
      throw new Error("coc_chargen_delegate key_connection must be an object");
    }
    const field = String(
      (params.key_connection as JsonObject).backstory_field ?? "",
    ).trim();
    const summary = String(
      (params.key_connection as JsonObject).summary ?? "",
    ).trim();
    if (
      !(CHARGEN_KEY_CONNECTION_FIELDS as readonly string[]).includes(field)
      || !summary
    ) {
      throw new Error("coc_chargen_delegate key_connection is invalid");
    }
    brief.key_connection = {
      backstory_field: field as typeof CHARGEN_KEY_CONNECTION_FIELDS[number],
      summary,
    };
  }
  const occupationLabel = String(params.occupation_label ?? "").trim();
  if (occupationLabel) brief.occupation_label = occupationLabel;
  return brief;
}

const REQUIRED_CHARACTERISTICS = [
  "STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU",
] as const;
const GUIDED_DEFAULT_ASSIGNMENT = [
  "INT", "EDU", "POW", "DEX", "APP", "SIZ", "CON", "STR",
] as const;
const QUICK_FIRE_ARRAY = [80, 70, 60, 60, 50, 50, 50, 40] as const;
const STARTING_SKILL_CAP = 75;
const CONSERVATIVE_SKILL_BASE = 40;
const CREDIT_RATING = "Credit Rating";
const MAX_QUICK_FIRE_INT = 80;
const MAX_INTEREST_BUDGET = MAX_QUICK_FIRE_INT * 2;
const DEFAULT_OCCUPATION_FILLERS = [
  "First Aid", "Natural World", "Charm", "Navigate",
  "Mechanical Repair", "Listen", "Appraise", "Fast Talk",
] as const;
const DEFAULT_INTEREST_FILLERS = [
  "Listen", "First Aid", "Navigate", "Mechanical Repair",
  "Natural World", "Charm", "Fast Talk", "Appraise", "Law",
  "Accounting", "History", "Track",
] as const;
const ERA_ADAPTIVE_OCCUPATION_FILLERS = [
  "First Aid", "Natural World", "Charm", "Navigate",
  "Listen", "Appraise", "Fast Talk", "History", "Track", "Ride",
] as const;
const ERA_ADAPTIVE_INTEREST_FILLERS = [
  "Track", "Stealth", "Survival", "Charm", "Fast Talk",
  "Natural World", "Navigate", "First Aid", "Listen", "Appraise",
] as const;
const SKILL_CANONICAL: Record<string, string> = {
  photography: "Art and Craft (Photography)",
  "art/craft (photography)": "Art and Craft (Photography)",
  "art and craft (photography)": "Art and Craft (Photography)",
  "own language": "Language (Own)",
  "language (own)": "Language (Own)",
};

export function canonicalizeSkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return SKILL_CANONICAL[trimmed.toLowerCase()] ?? trimmed;
}

/** High-to-low: first listed characteristic receives Quick Fire 80. Do not reverse. */
export function resolveAssignmentPriority(raw: string | undefined): string[] {
  const tokens = (raw ?? "")
    .split(/[,/;|>→\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => (
      REQUIRED_CHARACTERISTICS as readonly string[]
    ).includes(part));
  const seen = new Set<string>();
  const listed: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    listed.push(token);
  }
  if (listed.length === REQUIRED_CHARACTERISTICS.length) return listed;
  if (listed.length === 0) return [...GUIDED_DEFAULT_ASSIGNMENT];
  const rest = REQUIRED_CHARACTERISTICS.filter((key) => !seen.has(key));
  return [...listed, ...rest];
}

const CATALOG_SHAPED_SKILL = /^[A-Za-z][A-Za-z0-9 .'/&()-]*$/;

function uniqueSkillNames(names: string[] | undefined): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of names ?? []) {
    const name = canonicalizeSkillName(raw);
    if (!name || !CATALOG_SHAPED_SKILL.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || key === CREDIT_RATING.toLowerCase()) continue;
    seen.add(key);
    ordered.push(name);
  }
  return ordered;
}

function quickFireCharacteristics(
  assignment: string[] | undefined,
): Record<string, number> {
  const order = assignment
    && assignment.length === REQUIRED_CHARACTERISTICS.length
    && new Set(assignment).size === REQUIRED_CHARACTERISTICS.length
    && REQUIRED_CHARACTERISTICS.every((key) => assignment.includes(key))
    ? assignment
    : [...REQUIRED_CHARACTERISTICS];
  const chars: Record<string, number> = {};
  for (let index = 0; index < order.length; index += 1) {
    chars[order[index]] = QUICK_FIRE_ARRAY[index];
  }
  return chars;
}

function conservativeBase(skillId: string, edu: number, dex: number): number {
  if (skillId === CREDIT_RATING || skillId === "Cthulhu Mythos") return 0;
  if (skillId === "Dodge") return Math.floor(dex / 2);
  if (skillId === "Language (Own)" || skillId === "Own Language") return edu;
  return CONSERVATIVE_SKILL_BASE;
}

function simulateSpend(
  skillIds: string[],
  budget: number,
  edu: number,
  dex: number,
  prior: Map<string, number>,
): Map<string, number> {
  const allocations = new Map(skillIds.map((id) => [id, 0]));
  let remaining = budget;
  while (remaining > 0) {
    let progressed = false;
    for (const skillId of skillIds) {
      if (remaining <= 0) break;
      const current = conservativeBase(skillId, edu, dex)
        + (prior.get(skillId) ?? 0)
        + (allocations.get(skillId) ?? 0);
      if (current >= STARTING_SKILL_CAP) continue;
      allocations.set(skillId, (allocations.get(skillId) ?? 0) + 1);
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return allocations;
}

function spendTotal(allocations: Map<string, number>): number {
  let total = 0;
  for (const value of allocations.values()) total += value;
  return total;
}

function hasName(pool: string[], name: string): boolean {
  return pool.some((item) => item.toLowerCase() === name.toLowerCase());
}

export function planChargenSkillLists(brief: ChargenClerkBrief): {
  occupation_skill_names: string[];
  interest_skill_names: string[];
  occupation_budget: number;
  interest_budget: number;
} {
  const assignment = resolveAssignmentPriority(brief.assignment_priority);
  const chars = quickFireCharacteristics(assignment);
  const edu = chars.EDU ?? 80;
  const dex = chars.DEX ?? 50;
  const occupationBudget = edu * 4;
  const interestBudget = Math.max((chars.INT ?? MAX_QUICK_FIRE_INT) * 2, MAX_INTEREST_BUDGET);
  const occupationFillers = brief.mode === "era_adaptive"
    ? ERA_ADAPTIVE_OCCUPATION_FILLERS
    : DEFAULT_OCCUPATION_FILLERS;
  const interestFillers = brief.mode === "era_adaptive"
    ? ERA_ADAPTIVE_INTEREST_FILLERS
    : DEFAULT_INTEREST_FILLERS;
  const mains = uniqueSkillNames(brief.occupation_skill_names);
  const statedInterests = uniqueSkillNames(brief.interest_skill_names);
  const occupation = [...mains];
  const occPool = (pool: string[]) => (
    pool.includes(CREDIT_RATING) ? pool : [...pool, CREDIT_RATING]
  );
  const canPlaceOcc = (pool: string[]) => (
    spendTotal(simulateSpend(occPool(pool), occupationBudget, edu, dex, new Map()))
      === occupationBudget
  );
  for (const filler of occupationFillers) {
    if (canPlaceOcc(occupation)) break;
    if (hasName(occupation, filler) || hasName(statedInterests, filler)) continue;
    occupation.push(filler);
  }
  const stealFrom = [...statedInterests].reverse();
  while (!canPlaceOcc(occupation) && stealFrom.length > 0) {
    const next = stealFrom.shift() as string;
    if (!hasName(occupation, next)) occupation.push(next);
  }
  for (const filler of occupationFillers) {
    if (canPlaceOcc(occupation)) break;
    if (hasName(occupation, filler)) continue;
    occupation.push(filler);
  }
  const occAlloc = simulateSpend(
    occPool(occupation),
    occupationBudget,
    edu,
    dex,
    new Map(),
  );
  const interest = [...statedInterests];
  const canPlaceInterest = (pool: string[]) => (
    spendTotal(simulateSpend(pool, interestBudget, edu, dex, occAlloc)) === interestBudget
  );
  for (const filler of interestFillers) {
    if (canPlaceInterest(interest)) break;
    if (hasName(interest, filler)) continue;
    interest.push(filler);
  }
  for (const filler of [...occupationFillers, ...mains]) {
    if (canPlaceInterest(interest)) break;
    if (hasName(interest, filler)) continue;
    interest.push(filler);
  }
  return {
    occupation_skill_names: occupation,
    interest_skill_names: interest,
    occupation_budget: occupationBudget,
    interest_budget: interestBudget,
  };
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
  if (options.brief.age !== undefined) args.age = options.brief.age;
  args.assignment_priority = resolveAssignmentPriority(
    options.brief.assignment_priority,
  );
  const planned = planChargenSkillLists(options.brief);
  if (planned.occupation_skill_names.length) {
    args.occupation_skill_names = planned.occupation_skill_names;
  }
  if (planned.interest_skill_names.length) {
    args.interest_skill_names = planned.interest_skill_names;
  }
  if (options.brief.backstory) args.backstory = options.brief.backstory;
  if (options.brief.equipment?.length) args.equipment = options.brief.equipment;
  if (options.brief.key_connection) args.key_connection = options.brief.key_connection;
  if (options.brief.occupation_label) args.occupation_label = options.brief.occupation_label;
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
