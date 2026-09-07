/**
 * Tool ownership: which extension is answerable for each tool a session sees.
 *
 * This used to be a hand-written `id → tool names` table that had to be edited
 * in lockstep with every extension's `registerTool` calls, plus a second frozen
 * table in the registry for the core-capability packages. Nothing kept either
 * in sync with the code, and a rename showed up as a silently unowned tool.
 *
 * Ownership is now read from the manifests: a package declares `agent.tools`
 * beside its entry point, the loader refuses to enable two packages that claim
 * the same name, and everything here is a projection of that. What remains
 * hard-coded is only the set that genuinely belongs to nobody — pi's own
 * runtime tools.
 *
 * Dynamic tools stay out of the table by construction: `mcp-extension` mounts
 * `mcp_`-prefixed tools discovered from `{projectRoot}/.pi/mcp.json`, and
 * hosted provider search variants are deduplicated against `web_search` rather
 * than adding names.
 */

/** pi (pi-coding-agent) runtime tools; `file-tools` replaces read/grep/ls with composite versions. */
export const PI_RUNTIME_TOOL_NAMES: readonly string[] = Object.freeze([
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "grep",
  "find",
]);

/** Manifest-shaped ownership input: whatever can report `id → declared tools`. */
export type ToolOwnershipSource = Readonly<Record<string, readonly string[]>>;

/** Normalize one ownership source: sorted, deduplicated, frozen. */
export function extensionToolOwnership(source: ToolOwnershipSource): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(source)
        .filter(([, tools]) => tools.length > 0)
        .map(([id, tools]) => [id, Object.freeze([...new Set(tools)].sort())]),
    ),
  );
}

/** Every claimed tool name in one ownership map (deduplicated, sorted). */
export function claimedToolNames(ownership: ToolOwnershipSource): readonly string[] {
  return Object.freeze([...new Set(Object.values(ownership).flat())].sort());
}

/** The extension id that claims `tool`, or undefined when nothing claims it. */
export function owningExtension(ownership: ToolOwnershipSource, tool: string): string | undefined {
  for (const [id, tools] of Object.entries(ownership)) {
    if (tools.includes(tool)) return id;
  }
  return undefined;
}

/** Tool names claimed by more than one id. Empty is the only healthy answer. */
export function conflictingToolClaims(ownership: ToolOwnershipSource): Record<string, string[]> {
  const claimants = new Map<string, string[]>();
  for (const [id, tools] of Object.entries(ownership)) {
    for (const tool of tools) {
      const list = claimants.get(tool) ?? [];
      if (!list.includes(id)) list.push(id);
      claimants.set(tool, list);
    }
  }
  const conflicts: Record<string, string[]> = {};
  for (const [tool, ids] of claimants) {
    if (ids.length > 1) conflicts[tool] = ids.sort();
  }
  return conflicts;
}
