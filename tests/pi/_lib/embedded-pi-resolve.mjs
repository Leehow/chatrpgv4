// Test-only ESM resolve hook. Lifecycle probes dynamically import() product
// .ts files that use bare @earendil-works/* specifiers meant for the real
// `pi` runtime. Bare `node` runs have no repo-root node_modules, so redirect
// those specifiers to the embedded pi-coding-agent copy under
// runtime/adapters/keeper/node_modules (the same copy cli-faux-provider.ts
// and these probes' spawned cli.js already depend on). For subpath imports
// we hand off to Node's normal resolver with the package dir as parentURL so
// the package's exports map is honored. No product code is changed.
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.env.PI_TEST_REPO_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const embedded = join(repoRoot, "runtime/adapters/keeper/node_modules/@earendil-works");
const nested = join(embedded, "pi-coding-agent/node_modules/@earendil-works");

function pkgDir(specifier) {
  const m = /^@earendil-works\/([^/]+)/.exec(specifier);
  if (!m) return null;
  const pkg = m[1];
  const base = pkg === "pi-coding-agent" ? join(embedded, pkg) : join(nested, pkg);
  return existsSync(base) ? base : null;
}

export async function resolve(specifier, context, nextResolve) {
  if (typeof specifier === "string" && specifier.startsWith("@earendil-works/")) {
    const dir = pkgDir(specifier);
    if (dir) {
      // Resolve against the package dir so Node applies its exports map for
      // subpaths and picks the right entry for bare package import.
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(join(dir, "x")).href });
    }
  }
  return nextResolve(specifier, context);
}
