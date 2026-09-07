/**
 * Agent-orchestration agent half.
 *
 * Besides the extension itself, this entry publishes the package's worker tool
 * projection for the kernel's runtime-info Debug snapshot. The kernel cannot
 * import a package (it ships in every session; packages ship in none), so a
 * package that can answer registers itself here and the kernel reads whatever
 * is present.
 */
import subagentExtension from "../subagent/index.ts";
import { buildSubagentToolProjection } from "./subagent-debug-projection.ts";

(globalThis as unknown as Record<symbol, unknown>)[Symbol.for("pipiui.runtime-debug.subagents")] =
	buildSubagentToolProjection;

export default subagentExtension;
