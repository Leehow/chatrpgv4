import { EXTENSION_ID_RE } from "./extension-manifest.js";

export const PRODUCT_PACK_MANIFEST_FILENAME = "pipiui-product-pack.json";
/**
 * v2 dropped the `profile` member: a pack's own extension carries the
 * dependencies and the layout that a separate Product Profile file used to.
 */
export const PRODUCT_PACK_SCHEMA_VERSION = 2 as const;

export type ProductPackExtension = {
  id: string;
  path: string;
};

/**
 * Pure Product Pack assembly data. It contains no executable settings or
 * secrets. `id` is the pack **extension**'s id, and that extension must be one
 * of `extensions[]` — it is what carries the form's dependencies and layout.
 */
export type ProductPackManifest = {
  schemaVersion: typeof PRODUCT_PACK_SCHEMA_VERSION;
  id: string;
  name: string;
  extensions: ProductPackExtension[];
};

export type ProductPackManifestValidation =
  | { ok: true; pack: ProductPackManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Paths are declarative, portable package-relative names — no absolute, parent, or empty segments. */
export function isProductPackRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).some(segment => !segment || segment === "." || segment === "..");
}

export function parseProductPackManifest(value: unknown): ProductPackManifestValidation {
  if (!isRecord(value)) return { ok: false, errors: ["Product Pack manifest must be an object"] };
  const errors: string[] = [];
  if (value.schemaVersion !== PRODUCT_PACK_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PRODUCT_PACK_SCHEMA_VERSION}`);
  }
  const id = string(value.id);
  if (!id || !EXTENSION_ID_RE.test(id)) errors.push("id must be a semantic slug");
  const name = string(value.name);
  if (!name) errors.push("name must be a non-empty string");
  if (!Array.isArray(value.extensions)) {
    errors.push("extensions must be an array");
  }
  const extensions: ProductPackExtension[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.extensions)) {
    for (const [index, item] of value.extensions.entries()) {
      if (!isRecord(item)) {
        errors.push(`extensions[${index}] must be an object`);
        continue;
      }
      const extensionId = string(item.id);
      const path = string(item.path);
      if (!extensionId || !EXTENSION_ID_RE.test(extensionId)) {
        errors.push(`extensions[${index}].id must be a semantic slug`);
        continue;
      }
      if (seen.has(extensionId)) {
        errors.push(`extensions contains duplicate extension '${extensionId}'`);
        continue;
      }
      seen.add(extensionId);
      if (!path || !isProductPackRelativePath(path)) {
        errors.push(`extensions[${index}].path must be a package-relative path`);
        continue;
      }
      extensions.push({ id: extensionId, path });
    }
  }
  if (id && !extensions.some(item => item.id === id)) {
    errors.push(`extensions must include the pack extension '${id}'`);
  }
  if (errors.length || !id || !name) return { ok: false, errors };
  return {
    ok: true,
    pack: {
      schemaVersion: PRODUCT_PACK_SCHEMA_VERSION,
      id,
      name,
      extensions,
    },
  };
}

export function parseProductPackManifestJson(text: string): ProductPackManifestValidation {
  try {
    return parseProductPackManifest(JSON.parse(text));
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
