import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  claimedToolNames,
  conflictingToolClaims,
  extensionToolOwnership,
  owningExtension,
  PI_RUNTIME_TOOL_NAMES,
} from "../src/extension-tool-ownership.js";
import { EXTENSION_AGENT_TOOL_NAME_RE, parseExtensionManifestJson } from "../src/extension-manifest.js";
import { KERNEL_MOUNTS } from "../src/kernel-mounts.js";

const EXTENSIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../packs");

/**
 * Ownership as the shipped tree declares it.
 *
 * There is no host-side id → tools table any more: every claim is read out of
 * the package's own `pipiui-extension.json`, which is also what the loader
 * reads. A package that adds a tool and forgets to declare it shows up here as
 * an unowned name in the Boss toolset, not as a silent gap.
 */
function shippedOwnership(): Record<string, readonly string[]> {
  const source: Record<string, readonly string[]> = {};
  for (const entry of readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(EXTENSIONS_DIR, entry.name, "pipiui-extension.json");
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const parsed = parseExtensionManifestJson(text);
    expect(parsed.ok, `${entry.name} manifest validates: ${parsed.ok ? "" : parsed.errors.join("; ")}`).toBe(true);
    if (!parsed.ok) continue;
    if (parsed.manifest.agentTools?.length) source[parsed.manifest.id] = parsed.manifest.agentTools;
  }
  return extensionToolOwnership(source);
}

/**
 * Kernel tools have no manifest by definition: they belong to the machinery
 * that is still mounted when every extension is disabled, so they are named
 * once, here, as the complement of the manifest-declared set.
 */
const KERNEL_TOOL_NAMES: readonly string[] = [
  // secret-vault
  "secret_vault_put",
  "secret_vault_list",
  "secret_vault_mount",
  "secret_vault_unmount",
  "secret_vault_delete",
  // context-fold
  "recall_folded",
  "unfold",
  // runtime-info
  "pipiui_runtime_info",
];

/**
 * The Boss's complete static toolset: pi's own runtime tools, the kernel's, and
 * every manifest-declared claim. Dynamic tools are deliberately absent — the
 * `mcp_`-prefixed tools mcp-extension discovers from `.pi/mcp.json`, and the
 * provider-hosted search variants that are deduplicated against `web_search`
 * rather than adding names.
 */
const EXPECTED_BOSS_TOOLSET: readonly string[] = Object.freeze(
  [
    ...PI_RUNTIME_TOOL_NAMES,
    ...KERNEL_TOOL_NAMES,
    // web-access-extension (frozen contract)
    "web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch",
    // webview-browser-extension (frozen contract)
    "browser", "browser_search", "browser_fetch", "browser_flow",
    // memory-extension (frozen contract)
    "memory_query", "memory_status",
    // agent-orchestration
    "subagent", "subagent_manage", "subagent_status", "subagent_progress", "subagent_resolve",
    "subagent_watch", "subagent_chain", "subagent_abort", "subagent_alarm_ack",
    "ledger_note", "context_doc", "context_manage", "session_recall", "secretary_commit",
    // skill-loader-extension
    "skill_search", "skill_load",
    // plan-extension
    "plan_publish", "plan_task_update", "plan_approve", "plan_cancel", "plan_check",
    // goal-extension
    "goal_complete", "goal_blocked", "goal_wait",
    // git-capability
    "git",
    // terminal-extension
    "terminal",
    // document-workbench
    "list_open_documents", "pipiui_firecrawl_anydoc",
    // pdf-extension
    "pipiui_firecrawl_pdf",
    // paper-library
    "paper_library", "paper_search", "paper_read", "paper_cite_check", "paper_cite_meta",
    // office-workbench
    "docx",
    // latex-workbench
    "latex",
    // writing-desk
    "refs",
    // deepwood-sync
    "deepwood_sync",
    // file-tools (composite replacements for pi's read/grep/ls, plus its own)
    "reload_runtime",
    // hello-pipiui (the sample package)
    "hello-pipiui",
  ].sort(),
);

describe("extension tool ownership", () => {
  it("gives every claimed tool exactly one owner", () => {
    expect(conflictingToolClaims(shippedOwnership())).toEqual({});
  });

  it("declares well-formed names only", () => {
    for (const tool of claimedToolNames(shippedOwnership())) {
      expect(EXTENSION_AGENT_TOOL_NAME_RE.test(tool), `tool name '${tool}'`).toBe(true);
    }
  });

  it("pins the Boss main-session toolset", () => {
    const boss = [...new Set([...PI_RUNTIME_TOOL_NAMES, ...KERNEL_TOOL_NAMES, ...claimedToolNames(shippedOwnership())])].sort();
    expect(boss).toEqual([...EXPECTED_BOSS_TOOLSET]);
  });

  it("resolves ownership lookups from the declarations, not a host table", () => {
    const ownership = shippedOwnership();
    expect(owningExtension(ownership, "browser_flow")).toBe("webview-browser-extension");
    expect(owningExtension(ownership, "arxiv_fetch")).toBe("web-access-extension");
    expect(owningExtension(ownership, "subagent_manage")).toBe("agent-orchestration");
    expect(owningExtension(ownership, "plan_publish")).toBe("plan-extension");
    // Kernel tools belong to no package, and neither do dynamic MCP tools.
    expect(owningExtension(ownership, "secret_vault_put")).toBeUndefined();
    expect(owningExtension(ownership, "mcp_context7_search")).toBeUndefined();
  });

  it("keeps the kernel's own tools out of every manifest", () => {
    const claimed = new Set(claimedToolNames(shippedOwnership()));
    for (const tool of KERNEL_TOOL_NAMES) {
      expect(claimed.has(tool), `${tool} is kernel-owned and must not be claimed by a package`).toBe(false);
    }
    expect(KERNEL_MOUNTS.length).toBeGreaterThan(0);
  });

  it("reports conflicts when two packages claim one name", () => {
    const ownership = extensionToolOwnership({ "a-extension": ["shared_tool"], "b-extension": ["shared_tool", "own_tool"] });
    expect(conflictingToolClaims(ownership)).toEqual({ shared_tool: ["a-extension", "b-extension"] });
  });
});
