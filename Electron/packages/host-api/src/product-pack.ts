/**
 * Product packs.
 *
 * A pack is an ordinary extension that declares `dependencies.required` (the
 * capability set its form needs) and `app.ui.layout` (the shell that form
 * presents). Declaring a layout is the only thing that makes an extension a
 * form; there is no separate Profile object, catalog, or activation call.
 * Switching forms is `setExtensionEnabled` on the pack.
 */

/** Workbench layout a pack contributes; slots hold Workbench container ids. */
export type ProductPackLayout = {
  primarySidebar?: string;
  center?: string;
  auxiliarySidebar?: string;
  activity?: string[];
};

/** Project-owned explicit per-extension toggles. Settings and secrets are separate. */
export type ProjectExtensionActivation = {
  schemaVersion: 3;
  overrides: Record<string, "enabled" | "disabled">;
};

export type ProductPackArchiveResult = {
  archivePath: string;
  /** The pack extension's id. */
  packId: string;
  bytes: number;
  extensionCount: number;
};

/** What installing a pack settled on: the pack, and everything now enabled with it. */
export type ProductPackInstallResult = {
  packId: string;
  extensionIds: string[];
};
