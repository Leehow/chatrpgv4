import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type JsonObject = Record<string, unknown>;

export const KEEPER_BRIEFING_CUSTOM_TYPE = "coc-keeper-briefing";
const DOMAINS = ["init", "npc", "scene", "clue", "rule"] as const;
const MAX_BRIEFING_FILE_BYTES = 5_000_000;
const MAX_INDEX_ROWS = 48;
const MAX_TEXT = 180;
const MAX_WARNING_TEXT = 280;

type DomainName = typeof DOMAINS[number];
type DomainStatus = "pending" | "ready" | "partial" | "failed";

export type KeeperBriefing = {
  schema_version: 1;
  contract_id: "coc.keeper-briefing.v1";
  audience: "keeper_only";
  campaign_id: string;
  reason: "session_start" | "session_resume" | "steward_refresh";
  module: { summary: string; style: string; warnings: string[] };
  readiness: Record<DomainName, DomainStatus>;
  scene_index: Array<{ id: string; summary: string; source_refs: string[] }>;
  npc_index: Array<{ id: string; summary: string; source_refs: string[] }>;
  instruction: string;
};

function objectOrNull(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function clipped(value: unknown, maximum = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function strings(value: unknown, maximum = MAX_WARNING_TEXT): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => clipped(entry, maximum)).filter(
    (entry): entry is string => entry !== null,
  );
}

function sourceRefs(value: unknown): string[] {
  return strings(value, MAX_TEXT).slice(0, 2);
}

function domainStatus(value: unknown): DomainStatus {
  const status = objectOrNull(value)?.status;
  return ["pending", "ready", "partial", "failed"].includes(String(status))
    ? status as DomainStatus
    : "pending";
}

function firstRows(domain: JsonObject | null): JsonObject[] {
  if (domain === null) return [];
  for (const field of ["index", "items", "scenes", "locations", "npcs"]) {
    const rows = domain[field];
    if (!Array.isArray(rows)) continue;
    return rows.map(objectOrNull).filter((row): row is JsonObject => row !== null);
  }
  return [];
}

function compactIndex(domain: JsonObject | null): Array<{ id: string; summary: string; source_refs: string[] }> {
  const rows: Array<{ id: string; summary: string; source_refs: string[] }> = [];
  for (const row of firstRows(domain)) {
    const id = clipped(row.id ?? row.scene_id ?? row.location_id ?? row.npc_id, 128);
    if (id === null) continue;
    const name = clipped(row.name ?? row.title, 128);
    const summary = clipped(
      row.summary ?? row.one_line ?? row.brief ?? row.description,
    ) ?? "已解析；按需拉取详细素材。";
    rows.push({
      id,
      summary: name === null || summary.startsWith(name) ? summary : `${name}：${summary}`,
      source_refs: sourceRefs(row.source_refs),
    });
    if (rows.length >= MAX_INDEX_ROWS) break;
  }
  return rows;
}

function moduleMeta(init: JsonObject | null): JsonObject | null {
  const l0 = objectOrNull(init?.l0);
  return objectOrNull(l0?.module_meta) ?? objectOrNull(init?.module_meta);
}

function briefingText(briefing: KeeperBriefing): string {
  const statuses = DOMAINS.map((domain) => `${domain}=${briefing.readiness[domain]}`).join("；");
  const rows = (label: string, entries: KeeperBriefing["scene_index"]) => (
    entries.length === 0
      ? `${label}：暂无索引。`
      : `${label}：${entries.map((entry) => (
        `${entry.id}｜${entry.summary}${entry.source_refs.length ? `（${entry.source_refs.join("；")}）` : ""}`
      )).join("\n")}`
  );
  return [
    "【守秘人常驻轻量索引】",
    `模组：${briefing.module.summary}`,
    `风格：${briefing.module.style}`,
    `内容预警（常驻）：${briefing.module.warnings.length ? briefing.module.warnings.join("；") : "未解析到明确预警。"}`,
    `解析状态：${statuses}`,
    rows("场景索引", briefing.scene_index),
    rows("NPC 索引", briefing.npc_index),
    "只把以上当作导航：先看索引，再通过 steward.deliveries、steward.notebook 或场景供给按需拉取全文/数值；不得把索引或守秘素材直接写入玩家文本。",
  ].join("\n");
}

/** Build a whitelisted L0/L1-only keeper context. L2/body/stat fields are never read. */
export function buildKeeperBriefing(
  documentValue: unknown,
  campaignId: string,
  reason: KeeperBriefing["reason"],
): KeeperBriefing | null {
  const document = objectOrNull(documentValue);
  const domains = objectOrNull(document?.domains);
  if (document?.schema_version !== 2 || document?.campaign_id !== campaignId || domains === null) {
    return null;
  }
  const domain = (name: DomainName) => objectOrNull(domains[name]);
  const init = domain("init");
  const rule = domain("rule");
  const meta = moduleMeta(init);
  const title = clipped(meta?.title_zh ?? meta?.title_en, 128) ?? "模组信息待解析";
  const era = clipped(meta?.era, 80);
  const locale = clipped(meta?.locale, 100);
  const tone = strings(meta?.tone_tags, 80);
  const warnings = [
    ...strings(meta?.warnings), clipped(meta?.safety_notes, MAX_WARNING_TEXT),
    ...strings(rule?.warnings), clipped(rule?.safety_notes, MAX_WARNING_TEXT),
  ].filter((value): value is string => value !== null)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 12);
  const readiness = Object.fromEntries(DOMAINS.map((name) => [name, domainStatus(domain(name))])) as KeeperBriefing["readiness"];
  return {
    schema_version: 1,
    contract_id: "coc.keeper-briefing.v1",
    audience: "keeper_only",
    campaign_id: campaignId,
    reason,
    module: {
      summary: [title, era, locale].filter((value): value is string => value !== null).join("｜"),
      style: tone.length ? tone.join("、") : "风格待解析",
      warnings,
    },
    readiness,
    scene_index: compactIndex(domain("scene")),
    npc_index: compactIndex(domain("npc")),
    instruction: "Keep this compact briefing resident. Retrieve full source text and numbers only when needed through the canonical steward surfaces.",
  };
}

export function keeperBriefingMessage(briefing: KeeperBriefing): JsonObject {
  return {
    customType: KEEPER_BRIEFING_CUSTOM_TYPE,
    content: briefingText(briefing),
    display: false,
    details: briefing,
  };
}

export async function readKeeperBriefing(
  workspaceRoot: string,
  campaignId: string,
  reason: KeeperBriefing["reason"],
): Promise<KeeperBriefing | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(campaignId)) return null;
  const root = resolve(workspaceRoot);
  const saveRoot = resolve(root, ".coc", "campaigns", campaignId, "save");
  const path = resolve(saveRoot, "steward-state.json");
  if (!path.startsWith(`${saveRoot}${sep}`)) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_BRIEFING_FILE_BYTES) return null;
    return buildKeeperBriefing(JSON.parse(await readFile(path, "utf8")), campaignId, reason);
  } catch {
    return null;
  }
}
