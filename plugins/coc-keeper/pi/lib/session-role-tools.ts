/**
 * session-roles.json extra tools. Caller: activeToolsForPhase / registerTool.
 * Consumer: setup KP host. The launcher only consumed skills+prompt, so
 * manifest `tools` never reached setActiveTools until this helper.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionRole } from "./operation-policy.ts";

const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../session-roles.json",
);

export function extraToolsForSessionRole(role: SessionRole | null): string[] {
  if (role === "play") return [];
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      setup?: { tools?: unknown };
    };
    const tools = manifest.setup?.tools;
    if (!Array.isArray(tools)) return ["coc_chargen_delegate"];
    return tools.filter((name): name is string => typeof name === "string" && name.length > 0);
  } catch {
    return ["coc_chargen_delegate"];
  }
}
