import { createHash } from "node:crypto";
import {
  CARD_ID, CRAFT_CANDIDATE_MAX, CRAFT_CATALOG_MAX_CARDS, SOURCE_STUDY_ID, TEXT_FIELDS,
  type CandidateSummary, type CraftCard, type Family, type GenerationCard,
} from "./types.ts";

const FAMILIES = new Set<Family>(["exchange", "voice", "dialogue", "sensory", "horror", "rhythm", "memory", "action"]);
const META = ["schemaVersion", "id", "family", "sourceStudyIds", "starter", "examplesOrigin", "validationStatus"];
const ALLOWED = new Set<string>([...META, ...TEXT_FIELDS]);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function authoredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing authored text: ${label}`);
  return value;
}

function freezeCard(item: Record<string, unknown>): CraftCard {
  if (Object.keys(item).some(key => !ALLOWED.has(key))) throw new Error("Unexpected card shape or review-only field");
  if (item.schemaVersion !== "2.0" || typeof item.id !== "string" || !CARD_ID.test(item.id))
    throw new Error("Invalid card identity, family or provenance");
  if (!FAMILIES.has(item.family as Family) || typeof item.starter !== "boolean"
    || item.examplesOrigin !== "original_editorial_fixture" || item.validationStatus !== "not_human_calibrated")
    throw new Error("Invalid card identity, family or provenance");
  const sourceStudyIds = item.sourceStudyIds;
  if (!Array.isArray(sourceStudyIds) || !sourceStudyIds.length
    || sourceStudyIds.some(entry => typeof entry !== "string" || !SOURCE_STUDY_ID.test(entry)))
    throw new Error("Invalid source study references");
  const card: Record<string, unknown> = {
    schemaVersion: "2.0",
    id: item.id,
    family: item.family,
    sourceStudyIds: Object.freeze([...sourceStudyIds]),
    starter: item.starter,
    examplesOrigin: "original_editorial_fixture",
    validationStatus: "not_human_calibrated",
  };
  for (const field of TEXT_FIELDS) card[field] = authoredText(item[field], `${item.id}/${field}`);
  return Object.freeze(card) as CraftCard;
}

function canonicalCards(cards: readonly CraftCard[], candidateIds: readonly string[]): string {
  return JSON.stringify({
    candidateIds,
    cards: cards.map(card => ({
      schemaVersion: card.schemaVersion,
      id: card.id,
      family: card.family,
      sourceStudyIds: card.sourceStudyIds,
      starter: card.starter,
      examplesOrigin: card.examplesOrigin,
      validationStatus: card.validationStatus,
      title: card.title,
      purpose: card.purpose,
      useWhen: card.useWhen,
      avoidWhen: card.avoidWhen,
      context: card.context,
      acceptable: card.acceptable,
      stronger: card.stronger,
      alternative: card.alternative,
      nearMiss: card.nearMiss,
      diagnosis: card.diagnosis,
      boundaryContext: card.boundaryContext,
      boundaryText: card.boundaryText,
      why: card.why,
      elaboration: card.elaboration,
    })),
  });
}

/**
 * Validates a caller-supplied catalog and starter list.
 * Does not read the filesystem, call a provider, or write world state.
 */
export class CraftCatalog {
  readonly revision: string;
  readonly candidateIds: readonly string[];
  readonly #byId: ReadonlyMap<string, CraftCard>;

  constructor(value: unknown, starterIds: unknown) {
    if (!Array.isArray(value) || value.length === 0) throw new Error("Card catalog must be a nonempty array");
    if (value.length > CRAFT_CATALOG_MAX_CARDS) throw new Error(`Card catalog exceeds ${CRAFT_CATALOG_MAX_CARDS} cards`);
    const seen = new Set<string>();
    const cards = value.map(item => {
      if (!record(item)) throw new Error("Unexpected card shape or review-only field");
      const card = freezeCard(item);
      if (seen.has(card.id)) throw new Error(`Duplicate craft card id: ${card.id}`);
      seen.add(card.id);
      return card;
    });
    this.candidateIds = Object.freeze(candidateIds(starterIds, cards));
    this.#byId = new Map(cards.map(card => [card.id, card]));
    this.revision = createHash("sha256").update(canonicalCards(cards, this.candidateIds)).digest("hex");
    Object.freeze(this);
  }

  get(id: string): CraftCard {
    const card = this.#byId.get(id);
    if (!card) throw new Error(`Unknown craft card: ${id}`);
    return card;
  }

  /** Issued candidate summaries, in starter-list order. Not every card. */
  candidates(): readonly CandidateSummary[] {
    return Object.freeze(this.candidateIds.map(id => {
      const card = this.get(id);
      return Object.freeze({
        id: card.id,
        title: card.title,
        purpose: card.purpose,
        useWhen: card.useWhen,
        avoidWhen: card.avoidWhen,
      });
    }));
  }

  /** Positive fields only. Near-miss, diagnosis, boundary, and review text are omitted. */
  generationCard(id: string): GenerationCard {
    const card = this.get(id);
    return Object.freeze({
      id: card.id,
      title: card.title,
      purpose: card.purpose,
      useWhen: card.useWhen,
      avoidWhen: card.avoidWhen,
      context: card.context,
      acceptable: card.acceptable,
      stronger: card.stronger,
      alternative: card.alternative,
      elaboration: card.elaboration,
    });
  }
}

function candidateIds(value: unknown, cards: readonly CraftCard[]): string[] {
  if (!Array.isArray(value)) throw new Error("Starter list must be an array of card ids");
  if (value.length > CRAFT_CANDIDATE_MAX) throw new Error(`Starter list exceeds ${CRAFT_CANDIDATE_MAX} ids`);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !CARD_ID.test(entry)) throw new Error(`Unknown craft card: ${String(entry)}`);
    if (seen.has(entry)) throw new Error(`Duplicate starter id: ${entry}`);
    if (!cards.some(card => card.id === entry)) throw new Error(`Unknown craft card: ${entry}`);
    seen.add(entry);
    ids.push(entry);
  }
  const marked = cards.filter(card => card.starter).map(card => card.id);
  if (marked.length !== ids.length || marked.some(id => !seen.has(id)))
    throw new Error("Starter list does not match card starter fields");
  return ids;
}
