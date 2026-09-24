/** English craft-card shapes. Assets are passed in; this module does not load them. */

export const TEXT_FIELDS = [
  "title", "purpose", "useWhen", "avoidWhen", "context", "acceptable", "stronger",
  "alternative", "nearMiss", "diagnosis", "boundaryContext", "boundaryText", "why", "elaboration",
] as const;

export type TextField = typeof TEXT_FIELDS[number];

/** Fields a Keeper may see. Diagnostics and review text stay off this list. */
export const GENERATION_FIELDS = [
  "id", "title", "purpose", "useWhen", "avoidWhen", "context",
  "acceptable", "stronger", "alternative", "elaboration",
] as const;

export type GenerationField = typeof GENERATION_FIELDS[number];

export const CARD_ID = /^CRAFT-[A-Z]{3}-\d{2}$/;
export const SOURCE_STUDY_ID = /^(LIT|MOD)-\d{2}$/;

/** Structural caps. Not prose targets and not a selector. */
export const CRAFT_CATALOG_MAX_CARDS = 64;
export const CRAFT_CANDIDATE_MAX = 12;
export const CRAFT_REFERENCE_MAX_BYTES = 1800;

export type Family = "exchange" | "voice" | "dialogue" | "sensory" | "horror" | "rhythm" | "memory" | "action";
export type Variant = "acceptable" | "stronger" | "alternative";

export type CraftCard = Readonly<Record<TextField, string> & {
  schemaVersion: "2.0";
  id: string;
  family: Family;
  sourceStudyIds: readonly string[];
  starter: boolean;
  examplesOrigin: "original_editorial_fixture";
  validationStatus: "not_human_calibrated";
}>;

export type GenerationCard = Readonly<{
  id: string;
  title: string;
  purpose: string;
  useWhen: string;
  avoidWhen: string;
  context: string;
  acceptable: string;
  stronger: string;
  alternative: string;
  elaboration: string;
}>;

export type CandidateSummary = Readonly<{
  id: string;
  title: string;
  purpose: string;
  useWhen: string;
  avoidWhen: string;
}>;

/** Host-supplied budget in UTF-8 bytes. The renderer clamps maxBytes to CRAFT_REFERENCE_MAX_BYTES. */
export interface ReferenceBudget {
  maxBytes: number;
  includeExample?: boolean;
}

export interface ReferenceBlock {
  version: "craft-reference-v1";
  cardId: string;
  assetRevision: string;
  exampleVariant: Variant | null;
  text: string;
  bytes: number;
}
