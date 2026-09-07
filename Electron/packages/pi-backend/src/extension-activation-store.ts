import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PROJECT_EXTENSION_ENABLED_FILE = "ext-enabled.json";
export const PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION = 3 as const;

const EXTENSION_ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * The two Product Profiles this base ever shipped, mapped onto the extension
 * id that was once their form. `base` was never a form — with additive
 * enablement a project that names it is simply a project with no pack — so it
 * is absent here and migrates to no pack at all.
 *
 * The base no longer bundles `coding-workbench` (it shipped no form at all;
 * a product supplies its own — see docs/extension-architecture-v1.md). This
 * migration still has to fire and still has to write that id into the
 * project's overrides, because the override is just data: whether it
 * resolves to an installed extension is for the enablement resolver to
 * decide, and a base project simply won't find one. A product that still
 * ships its own `coding-workbench` extension picks the override right up.
 */
const LEGACY_PROFILE_PACK_IDS: Readonly<Record<string, string>> = { coding: "coding-workbench" };

export type ProjectExtensionOverride = "enabled" | "disabled";

/**
 * A project's explicit per-extension toggles — the only thing a project stores
 * about enablement. Everything else is derived: manifest defaults plus the
 * required closure of whatever pack is on.
 */
export type ProjectExtensionActivation = {
  schemaVersion: typeof PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION;
  overrides: Record<string, ProjectExtensionOverride>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverrides(value: unknown): Record<string, ProjectExtensionOverride> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, ProjectExtensionOverride> = {};
  for (const [id, state] of Object.entries(value)) {
    if (!EXTENSION_ID_RE.test(id) || (state !== "enabled" && state !== "disabled")) return undefined;
    out[id] = state;
  }
  return out;
}

function parseCurrent(value: unknown): ProjectExtensionActivation | undefined {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION) return undefined;
  const overrides = parseOverrides(value.overrides);
  if (!overrides) throw new Error("project extension overrides are invalid");
  return { schemaVersion: PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION, overrides };
}

/**
 * schemaVersion 2 (`{ profile, overrides }`): the named Profile becomes an
 * explicit enable of the extension that is now that form, and every override is
 * carried across untouched. An override the user already wrote for the pack id
 * wins over the derived one.
 */
function parseProfileActivation(value: unknown): ProjectExtensionActivation | undefined {
  if (!isRecord(value) || value.schemaVersion !== 2) return undefined;
  if (typeof value.profile !== "string" || !EXTENSION_ID_RE.test(value.profile)) {
    throw new Error("project Product Profile id must be a semantic slug");
  }
  const overrides = parseOverrides(value.overrides);
  if (!overrides) throw new Error("project Product Profile overrides are invalid");
  const packId = LEGACY_PROFILE_PACK_IDS[value.profile];
  return {
    schemaVersion: PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION,
    overrides: packId && !(packId in overrides) ? { ...overrides, [packId]: "enabled" } : overrides,
  };
}

/** A boolean map predating named Profiles. Every entry was already explicit. */
function parseLegacyBooleans(value: unknown): ProjectExtensionActivation | undefined {
  if (!isRecord(value)) return undefined;
  const overrides: Record<string, ProjectExtensionOverride> = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled !== "boolean" || !EXTENSION_ID_RE.test(id)) return undefined;
    overrides[id] = enabled ? "enabled" : "disabled";
  }
  return { schemaVersion: PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION, overrides };
}

export function projectExtensionActivationPath(projectAgentDir: string): string {
  return join(projectAgentDir, PROJECT_EXTENSION_ENABLED_FILE);
}

export function emptyProjectExtensionActivation(): ProjectExtensionActivation {
  return { schemaVersion: PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION, overrides: {} };
}

/** Project toggles as the boolean overlay the registry and enable closure read. */
export function projectActivationOverlay(activation: ProjectExtensionActivation): Record<string, boolean> {
  return Object.fromEntries(Object.entries(activation.overrides).map(([id, state]) => [id, state === "enabled"]));
}

export async function writeProjectExtensionActivation(
  projectAgentDir: string,
  activation: ProjectExtensionActivation,
): Promise<ProjectExtensionActivation> {
  const parsed = parseCurrent(activation);
  if (!parsed) {
    throw new Error(`project extension activation must use schemaVersion ${PROJECT_EXTENSION_ACTIVATION_SCHEMA_VERSION}`);
  }
  await mkdir(projectAgentDir, { recursive: true });
  const path = projectExtensionActivationPath(projectAgentDir);
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return parsed;
}

/**
 * Read this project's explicit toggles, migrating an older file in place.
 * A file already at the current schema is returned untouched — migration never
 * rewrites what it did not need to change.
 */
export async function readProjectExtensionActivation(
  projectAgentDir: string,
): Promise<ProjectExtensionActivation> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(projectExtensionActivationPath(projectAgentDir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProjectExtensionActivation();
    throw error;
  }
  const current = parseCurrent(raw);
  if (current) return current;
  const migrated = parseProfileActivation(raw) ?? parseLegacyBooleans(raw);
  if (!migrated) throw new Error("project extension activation file is invalid");
  return writeProjectExtensionActivation(projectAgentDir, migrated);
}

export async function setProjectExtensionOverride(
  projectAgentDir: string,
  id: string,
  enabled: boolean,
): Promise<ProjectExtensionActivation> {
  const current = await readProjectExtensionActivation(projectAgentDir);
  return writeProjectExtensionActivation(projectAgentDir, {
    ...current,
    overrides: { ...current.overrides, [id]: enabled ? "enabled" : "disabled" },
  });
}
