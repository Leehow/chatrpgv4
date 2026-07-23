// Test-only. Import this as the FIRST statement of a probe that dynamically
// import()s product .ts files using bare @earendil-works/* specifiers. It
// registers a resolve hook redirecting those specifiers to the embedded
// pi-coding-agent copy under runtime/adapters/keeper/node_modules — the same
// copy cli-faux-provider.ts and these probes' spawned cli.js depend on.
// Lets lifecycle probes run under bare `node` without a repo-root node_modules.
import { register } from "node:module";
const hook = new URL("./embedded-pi-resolve.mjs", import.meta.url);
register(hook.href, import.meta.url);
