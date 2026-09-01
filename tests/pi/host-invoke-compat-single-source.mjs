#!/usr/bin/env node
/**
 * The `coc_invoke` compatibility allowlist must mean the same thing on both
 * sides of the host boundary.
 *
 * Python (`coc_operation_policy.HOST_INVOKE_COMPAT_OPERATIONS`) decides what
 * `_operation_card` may advertise as `invoke_via`; TypeScript
 * (`operation-policy.HOST_INVOKE_COMPAT_OPERATIONS`) decides what the execute
 * ACL will accept. If they drift, the host advertises an invocation the ACL
 * refuses — which is exactly the `host_private_operation` dead end the
 * ten-family cutover exposed on `combat.end`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] || process.cwd());
const { HOST_INVOKE_COMPAT_OPERATIONS } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/operation-policy.ts")
);

const pythonList = JSON.parse(execFileSync(
  "uv",
  [
    "run", "--frozen", "python", "-c",
    "import sys,json;sys.path.insert(0,'plugins/coc-keeper/scripts');"
    + "import coc_operation_policy as p;"
    + "print(json.dumps(sorted(p.HOST_INVOKE_COMPAT_OPERATIONS)))",
  ],
  { cwd: root, encoding: "utf8" },
).trim());

assert.deepEqual(
  [...HOST_INVOKE_COMPAT_OPERATIONS].sort(),
  pythonList,
  "the Python and TypeScript coc_invoke compatibility allowlists must match",
);

console.log(
  `host-invoke compat single source: ${pythonList.length} operations agree`,
);
