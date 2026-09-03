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

const RULES_DIRECTOR_SINGLE_DRAFT_PROFILE = "rules-director-single-draft";

export function extraToolsForSessionRole(role: SessionRole | null): string[] {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      play?: { tools?: unknown };
      profiles?: Record<string, { role?: unknown; tools?: unknown }>;
    };
    const profile = process.env.COC_PI_ACCEPTANCE_PROFILE;
    const profileEntry = (
      role === "play"
      && profile === RULES_DIRECTOR_SINGLE_DRAFT_PROFILE
      && manifest.profiles?.[profile]?.role === "play"
    ) ? manifest.profiles[profile] : null;
    // The setup role is retired, and its manifest half is gone. A null role is
    // the legacy launch with no campaign selector, and it used to read the
    // setup half -- so deleting that half silently took `read` off the legacy
    // surface. Both answer from the play half now: it is the only table there
    // is, and it already carries `read` plus `coc_source_assets`.
    const tools = (profileEntry ?? manifest.play)?.tools;
    if (!Array.isArray(tools)) return [];
    return tools.filter((name): name is string => typeof name === "string" && name.length > 0);
  } catch {
    return [];
  }
}
