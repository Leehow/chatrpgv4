import { CARD_ID, CRAFT_REFERENCE_MAX_BYTES, type GenerationCard, type ReferenceBlock, type ReferenceBudget, type Variant } from "./types.ts";

const POSITIVE = new Set<Variant>(["acceptable", "stronger", "alternative"]);
const GENERATION_TEXT = [
  "title", "purpose", "useWhen", "avoidWhen", "context", "acceptable", "stronger", "alternative", "elaboration",
] as const;

const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Render one optional positive reference from whitelist fields only.
 * Drops the whole example, then the whole core. Never truncates a sentence,
 * serializes a card, or copies a card id or catalog hash into the text.
 * Does not call a provider or write world state.
 */
export function renderCraftReference(
  card: GenerationCard | null,
  catalogRevision: string,
  budget: ReferenceBudget,
  variant: Variant = "stronger",
): ReferenceBlock | null {
  if (!record(budget) || !Number.isSafeInteger(budget.maxBytes) || budget.maxBytes < 0
    || (budget.includeExample !== undefined && typeof budget.includeExample !== "boolean"))
    throw new Error("Invalid byte budget");
  if (!POSITIVE.has(variant)) throw new Error("Only positive variants may be rendered");
  if (typeof catalogRevision !== "string" || !catalogRevision) throw new Error("Catalog revision is required");
  if (card === null) return null;
  const source = generationView(card);
  const limit = Math.min(budget.maxBytes, CRAFT_REFERENCE_MAX_BYTES);
  const core = [
    "Optional craft reference; use only if it helps this exchange.",
    `Method: ${source.purpose}`,
    `Use when: ${source.useWhen}`,
    `Do not use when: ${source.avoidWhen}`,
    "Write naturally in play_language. Examples are separate fiction: transfer technique, not entities, facts, wording or English syntax. Existing authority and disclosure rules remain in force.",
  ].join("\n");
  const example = [
    "BEGIN SEPARATE EXAMPLE (original editorial fixture, not campaign evidence)",
    `Example context: ${source.context}`,
    `One possible rendering: ${source[variant]}`,
    `Variation and detail boundary: ${source.elaboration}`,
    "END SEPARATE EXAMPLE",
  ].join("\n");
  const withExample = `${core}\n\n${example}`;
  const useExample = budget.includeExample !== false && byteLength(withExample) <= limit;
  const text = useExample ? withExample : core;
  if (byteLength(text) > limit) return null;
  return Object.freeze({
    version: "craft-reference-v1",
    cardId: source.id,
    assetRevision: catalogRevision,
    exampleVariant: useExample ? variant : null,
    text,
    bytes: byteLength(text),
  });
}

function generationView(value: unknown): GenerationCard {
  if (!record(value) || typeof value.id !== "string" || !CARD_ID.test(value.id))
    throw new Error("Invalid craft card id");
  const card: Record<string, string> = { id: value.id };
  for (const field of GENERATION_TEXT) card[field] = textField(value[field], `${value.id}/${field}`);
  return card as unknown as GenerationCard;
}

function textField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing authored text: ${label}`);
  return value;
}
