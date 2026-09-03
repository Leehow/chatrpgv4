/**
 * Onboarding position, read from disk.
 *
 * Every `done` judgement in the step table reads this, and this reads the
 * campaign directory -- never in-memory progress. A resumed or restarted
 * onboarding session therefore recomputes the same position instead of
 * trusting a counter that survived a crash.
 *
 * The player's own answers (which module, which language) are the one thing
 * disk cannot supply before the campaign exists, so they are held here
 * explicitly and marked as such.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PlayerChoice = {
  /** Built-in starter id, or null when the player named a PDF module. */
  starterId: string | null;
  /** Bundle directory inside the workspace, or null until it exists. */
  bundlePath: string | null;
  sourceTitle: string | null;
  scenarioId: string | null;
  playLanguage: string;
};

export type OnboardingState = {
  readonly root: string;
  readonly campaignId: string;
  readonly isStarter: boolean;
  readonly starterId: string | null;
  readonly bundlePath: string | null;
  readonly sourceTitle: string | null;
  readonly scenarioId: string | null;
  readonly playLanguage: string;
  readonly source: string | null;
  readonly campaignExists: boolean;
  readonly scenarioBound: boolean;
  readonly factsAdopted: boolean;
  readonly briefingPath: string | null;
  readonly investigatorId: string | null;
  readonly investigatorLinked: boolean;
  readonly readyForTable: boolean;
};

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Envelope keys that carry the contract, not an answer. */
const FACT_ENVELOPE_KEYS = new Set(["schema_version", "contract_id"]);

/**
 * True when `setup.adopt_source_facts` has landed a complete answer set.
 *
 * Every question must be answered `source` or `unresolved` -- "unresolved" is
 * an honest answer and is never harder to submit than a fabricated one. A
 * default the bind guessed counts as neither; that is exactly how a campaign
 * ended up claiming 1920s for a Roman module.
 *
 * The two envelope keys are skipped deliberately: they are strings and an
 * integer, so folding them into the row scan makes an adopted campaign read as
 * un-adopted and deadlocks the review step.
 */
function factsAreAdopted(campaign: Record<string, unknown> | null): boolean {
  const facts = campaign?.source_fast_facts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) return false;
  const rows = Object.entries(facts as Record<string, unknown>)
    .filter(([key]) => !FACT_ENVELOPE_KEYS.has(key));
  if (rows.length === 0) return false;
  return rows.every(([, row]) => {
    if (row === null || typeof row !== "object") return false;
    const status = (row as Record<string, unknown>).status;
    return status === "source" || status === "unresolved";
  });
}

export function readState(
  root: string,
  campaignId: string,
  choice: PlayerChoice,
): OnboardingState {
  const campaignDir = join(root, ".coc", "campaigns", campaignId);
  const campaign = readJson(join(campaignDir, "campaign.json"));
  const scenarioDir = join(campaignDir, "scenario");
  const party = readJson(join(campaignDir, "party.json"));
  const investigatorIds = Array.isArray(party?.investigator_ids)
    ? (party.investigator_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  const creation = campaign?.character_creation;
  const briefingPath = creation !== null && typeof creation === "object"
    ? (() => {
        const value = (creation as Record<string, unknown>).briefing_path;
        return typeof value === "string" && value.trim() ? value : null;
      })()
    : null;

  const isStarter = choice.starterId !== null;
  const source = isStarter ? choice.starterId : choice.bundlePath ?? choice.sourceTitle;

  return {
    root,
    campaignId,
    isStarter,
    starterId: choice.starterId,
    bundlePath: choice.bundlePath,
    sourceTitle: choice.sourceTitle
      ?? (typeof campaign?.title === "string" ? campaign.title as string : null),
    scenarioId: choice.scenarioId,
    playLanguage: choice.playLanguage,
    source,
    campaignExists: campaign !== null,
    scenarioBound: existsSync(join(scenarioDir, "scenario.json")),
    factsAdopted: factsAreAdopted(campaign),
    briefingPath,
    // Campaign-scoped only. `.coc/investigators/` is shared across campaigns,
    // so reading it here would attribute another table's character to this one.
    investigatorId: investigatorIds[0] ?? null,
    investigatorLinked: investigatorIds.length > 0,
    readyForTable: campaign?.status === "ready_for_table"
      && campaign?.setup_handoff !== undefined
      && campaign?.setup_handoff !== null,
  };
}
