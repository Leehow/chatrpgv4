/**
 * Pure investigator portrait prompt builder for the pi-coc host.
 *
 * Consumes the chargen portrait seed from character.json (`portrait.source`,
 * `portrait.provenance`, `backstory.personal_description`) and returns an
 * image-model prompt plus metadata. Does not call an image API, does not
 * write character.json, and does not invent player-locked appearance.
 *
 * Result I/O (for a later POST /api/portraits/generate metadata write):
 *   { prompt, source, provenance, appearance_locked, aspect_ratio, framing }
 */

export const PORTRAIT_SOURCE_PLAYER = "player";
export const PORTRAIT_SOURCE_SHEET_CONCEPT = "sheet_concept";
export const PORTRAIT_SOURCE_HOST_NATIVE = "host_native";

export const DEFAULT_PORTRAIT_ASPECT_RATIO = "2:3";
export const DEFAULT_PORTRAIT_FRAMING = "vertical half-body bust";

export const PORTRAIT_PROVENANCE_KEYS = Object.freeze([
  "concept",
  "age",
  "occupation",
  "era",
  "region",
  "background",
  "appearance",
  "appearance_field",
  "social_class",
  "equipment",
]);

/** Player-facing backstory that may inform clothing, scars, or demeanor. */
export const SAFE_BACKGROUND_KEYS = Object.freeze([
  "personal_description",
  "injuries_scars",
  "traits",
  "treasured_possessions",
]);

/**
 * Module truth, Mythos, and non-appearance backstory. Never sent to the
 * image model even when chargen stored them on portrait.provenance.background.
 */
export const SECRET_BACKGROUND_KEYS = Object.freeze([
  "encounters",
  "scenario_bound",
  "phobias_manias",
  "ideology_beliefs",
  "significant_people",
  "meaningful_locations",
]);

const SECRET_FIELD_NAMES = new Set([
  ...SECRET_BACKGROUND_KEYS,
  "secret",
  "secrets",
  "keeper",
  "keeper_only",
  "kp_only",
  "module",
  "module_truth",
  "mythos",
  "spoiler",
  "hidden",
  "notes",
  "gm_notes",
  "san",
  "sanity",
  "hp",
  "mp",
  "cash",
  "assets",
  "spending_level",
  "credit_rating",
  "skills",
  "characteristics",
  "derived",
]);

const LIVING_STANDARD_ZH = {
  Penniless: "赤贫",
  Poor: "贫穷",
  Average: "普通",
  Wealthy: "富裕",
  Rich: "富有",
  "Super Rich": "超级富豪",
};

const FRAMING_BLOCK = [
  "Call of Cthulhu tabletop RPG character portrait for a campaign UI panel.",
  "Framing: vertical half-body / chest-up bust, still pose, facing the viewer, shallow background.",
  "Style: historically accurate period clothing and a photographic or painted portrait look suitable for a 1920s-era TRPG character sheet. Natural light, muted palette, no cinematic action.",
  "Do not include any text, letters, captions, signatures, logos, or watermarks.",
  "No modern clothing, modern weapons, or action poses unless the hard appearance constraint explicitly requires them.",
].join(" ");

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asIntAge(value) {
  if (typeof value === "boolean") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = trimStr(value);
    if (text) return text;
  }
  return "";
}

function occupationFrom(sheet) {
  const player = asObject(sheet.player_facing_sheet_zh);
  const occ = sheet.occupation;
  const fromDict = asObject(occ) ? trimStr(occ.name) : "";
  return firstNonEmpty(
    player && player.occupation,
    fromDict,
    typeof occ === "string" ? occ : "",
  );
}

function regionFrom(sheet) {
  const identity = asObject(sheet.identity);
  const player = asObject(sheet.player_facing_sheet_zh);
  return firstNonEmpty(
    sheet.nationality,
    identity && identity.nationality,
    player && player.nationality,
    sheet.region,
  );
}

function conceptFrom(sheet) {
  const identity = asObject(sheet.identity);
  const player = asObject(sheet.player_facing_sheet_zh);
  return firstNonEmpty(
    sheet.name,
    identity && identity.name,
    player && player.display_name,
    sheet.concept,
  );
}

function livingStandardFrom(sheet) {
  const raw = firstNonEmpty(sheet.living_standard, sheet.social_class);
  if (!raw) return "";
  const zh = LIVING_STANDARD_ZH[raw];
  return zh ? `${raw} (${zh})` : raw;
}

function equipmentFrom(sheet) {
  const raw = sheet.equipment;
  if (Array.isArray(raw)) {
    return raw.map((item) => trimStr(item)).filter(Boolean);
  }
  const text = trimStr(raw);
  return text ? [text] : [];
}

function backstoryFrom(sheet) {
  return asObject(sheet.backstory) || {};
}

function isSecretKey(key) {
  const lower = String(key || "").toLowerCase();
  if (SECRET_FIELD_NAMES.has(key) || SECRET_FIELD_NAMES.has(lower)) return true;
  if (lower.includes("keeper") || lower.includes("mythos")) return true;
  if (lower.endsWith("_secret") || lower.startsWith("secret_")) return true;
  return false;
}

export function filterSafeBackground(background) {
  const src = asObject(background);
  if (!src) return {};
  const out = {};
  for (const key of SAFE_BACKGROUND_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    if (isSecretKey(key)) continue;
    const text = trimStr(src[key]);
    if (text) out[key] = text;
  }
  return out;
}

function appearanceFrom(sheet, provenance) {
  const backstory = backstoryFrom(sheet);
  return firstNonEmpty(
    provenance && provenance.appearance,
    backstory.personal_description,
    sheet.personal_description,
  );
}

/**
 * Confirmed concept facts. Invents no appearance; strips KP-only / module fields.
 *
 * @param {object} [input]
 * @returns {object}
 */
export function collectPortraitSeed(input = {}) {
  const root = asObject(input) || {};
  const sheet = asObject(root.character) || root;
  const portrait = asObject(root.portrait) || asObject(sheet.portrait) || {};
  const stored = asObject(portrait.provenance) || {};
  const seed = {};

  const concept = firstNonEmpty(stored.concept, conceptFrom(sheet));
  if (concept) seed.concept = concept;

  const age = asIntAge(stored.age != null ? stored.age : sheet.age);
  if (age != null) seed.age = age;

  const occupation = firstNonEmpty(stored.occupation, occupationFrom(sheet));
  if (occupation) seed.occupation = occupation;

  const era = firstNonEmpty(stored.era, sheet.era, root.era);
  if (era) seed.era = era;

  const region = firstNonEmpty(stored.region, regionFrom(sheet));
  if (region) seed.region = region;

  const social = firstNonEmpty(stored.social_class, livingStandardFrom(sheet));
  if (social) seed.social_class = social;

  const equipment = Array.isArray(stored.equipment)
    ? stored.equipment.map((item) => trimStr(item)).filter(Boolean)
    : equipmentFrom(sheet);
  if (equipment.length) seed.equipment = equipment;

  const appearance = appearanceFrom(sheet, stored);
  const background = filterSafeBackground({
    ...backstoryFrom(sheet),
    ...asObject(stored.background),
  });
  if (appearance) {
    seed.appearance = appearance;
    seed.appearance_field = firstNonEmpty(
      stored.appearance_field,
      "personal_description",
    );
    background.personal_description = appearance;
  }
  if (Object.keys(background).length) seed.background = background;
  return seed;
}

export function isPlayerAppearanceLocked(input = {}) {
  const root = asObject(input) || {};
  const sheet = asObject(root.character) || root;
  const portrait = asObject(root.portrait) || asObject(sheet.portrait) || {};
  const source = trimStr(portrait.source);
  if (source === PORTRAIT_SOURCE_PLAYER) return true;
  const seed = collectPortraitSeed(root);
  return Boolean(seed.appearance);
}

function formatFactLines(seed, { includeAppearance }) {
  const lines = [];
  if (seed.concept) lines.push(`Name: ${seed.concept}`);
  if (seed.age != null) lines.push(`Age: ${seed.age}`);
  if (seed.occupation) lines.push(`Occupation: ${seed.occupation}`);
  if (seed.era) lines.push(`Era: ${seed.era}`);
  if (seed.region) lines.push(`Region: ${seed.region}`);
  if (seed.social_class) lines.push(`Social class / living standard: ${seed.social_class}`);
  if (Array.isArray(seed.equipment) && seed.equipment.length) {
    lines.push(`Visible clothing / equipment: ${seed.equipment.join(", ")}`);
  }
  const background = asObject(seed.background) || {};
  if (!includeAppearance && background.traits) {
    lines.push(`Demeanor / traits: ${background.traits}`);
  }
  if (!includeAppearance && background.injuries_scars) {
    lines.push(`Visible scars or injuries: ${background.injuries_scars}`);
  }
  if (!includeAppearance && background.treasured_possessions) {
    lines.push(`Visible personal item: ${background.treasured_possessions}`);
  }
  return lines;
}

function buildLockedPrompt(seed) {
  const appearance = seed.appearance;
  const facts = formatFactLines(seed, { includeAppearance: true });
  const context = facts.length
    ? `Confirmed context (must not contradict the hard constraint):\n${facts.join("\n")}`
    : "Confirmed context: none beyond the hard appearance constraint.";
  return [
    FRAMING_BLOCK,
    "HARD APPEARANCE CONSTRAINT from the player. Copy this look exactly. Do not rewrite, beautify, glamorize, youth-wash, or change age, ethnicity, body type, hair color, scars, or any other stated feature.",
    `"""${appearance}"""`,
    context,
  ].join("\n\n");
}

function buildConstructedPrompt(seed) {
  const facts = formatFactLines(seed, { includeAppearance: false });
  const factBlock = facts.length
    ? facts.join("\n")
    : "No further confirmed facts.";
  return [
    FRAMING_BLOCK,
    "No player-specified appearance. Design a historically plausible look only from the confirmed character facts below. Do not modernize, glamorize, celebrity-liken, or invent ethnicity, hair color, body type, or scars that the facts do not support.",
    `Confirmed facts:\n${factBlock}`,
  ].join("\n\n");
}

function publicProvenance(seed, { appearanceLocked }) {
  const out = {};
  for (const key of PORTRAIT_PROVENANCE_KEYS) {
    if (seed[key] == null || seed[key] === "" || seed[key] === false) continue;
    if (key === "background") {
      const background = filterSafeBackground(seed.background);
      if (Object.keys(background).length) out.background = background;
      continue;
    }
    if (Array.isArray(seed[key])) {
      if (seed[key].length) out[key] = [...seed[key]];
      continue;
    }
    out[key] = seed[key];
  }
  if (!appearanceLocked) {
    delete out.appearance;
    delete out.appearance_field;
  }
  return out;
}

/**
 * @param {object} [input] character.json, or `{ character, portrait }`
 * @returns {{
 *   prompt: string,
 *   source: string,
 *   provenance: object,
 *   appearance_locked: boolean,
 *   aspect_ratio: string,
 *   framing: string,
 * }}
 */
export function buildPortraitPrompt(input = {}) {
  const root = asObject(input) || {};
  const seed = collectPortraitSeed(root);
  const appearanceLocked = isPlayerAppearanceLocked(root);
  const source = appearanceLocked
    ? PORTRAIT_SOURCE_PLAYER
    : PORTRAIT_SOURCE_SHEET_CONCEPT;
  const prompt = appearanceLocked && seed.appearance
    ? buildLockedPrompt(seed)
    : buildConstructedPrompt(seed);
  return {
    prompt,
    source,
    provenance: publicProvenance(seed, { appearanceLocked }),
    appearance_locked: appearanceLocked,
    aspect_ratio: DEFAULT_PORTRAIT_ASPECT_RATIO,
    framing: DEFAULT_PORTRAIT_FRAMING,
  };
}

/** Slice stored on an image API response; never includes KP-only fields. */
export function portraitPromptMetadata(result) {
  const built = asObject(result) || {};
  return {
    source: built.source || PORTRAIT_SOURCE_SHEET_CONCEPT,
    provenance: asObject(built.provenance) || {},
    appearance_locked: built.appearance_locked === true,
    aspect_ratio: built.aspect_ratio || DEFAULT_PORTRAIT_ASPECT_RATIO,
    framing: built.framing || DEFAULT_PORTRAIT_FRAMING,
  };
}
