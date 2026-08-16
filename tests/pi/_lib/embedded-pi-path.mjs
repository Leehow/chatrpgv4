// Resolve a file inside the embedded pi-coding-agent dependency tree under
// runtime/adapters/keeper/node_modules, accepting both dependency layouts:
// 0.81.x nested every @earendil-works sibling under
// pi-coding-agent/node_modules; 0.84.x hoists them next to pi-coding-agent
// at the top level. Test-only seam; no product code depends on it.
import { existsSync } from "node:fs";
import { join } from "node:path";

export function embeddedPiFile(repoRoot, pkg, ...segments) {
  const scope = join(
    repoRoot,
    "runtime/adapters/keeper/node_modules/@earendil-works",
  );
  const nested = join(
    scope,
    "pi-coding-agent/node_modules/@earendil-works",
    pkg,
  );
  const base = existsSync(nested) ? nested : join(scope, pkg);
  return join(base, ...segments);
}
