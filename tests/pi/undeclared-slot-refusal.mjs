#!/usr/bin/env node
/**
 * Project ONE real `unknown_semantic_input` settle envelope the way the
 * Keeper receives it, and print the result.
 *
 * The envelope is not written here. It is produced by the real RulesRuntime
 * in tests/test_undeclared_slot_refusal.py and handed over on disk, because a
 * hand-written fixture is exactly how this defect stayed alive: the host
 * rewrites canonical ids out of error prose (`rewriteCanonicalIdsInError`)
 * and holds the VALUES of identity-bearing keys to the ref grammar, so a
 * refusal can read perfectly at the runtime's return statement and arrive at
 * the model stripped. Whatever this prints is what the Keeper actually got.
 *
 * argv[2] = repo root, argv[3] = path to the canonical settle envelope JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || process.cwd());
const envelopePath = process.argv[3];
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { projectModelVisibleCanonicalResult } = await load(
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
);
const { attachExpectedSchema } = await load(
  "plugins/coc-keeper/pi/lib/typed-tools.ts",
);
const { createSemanticIdentityRegistry } = await load(
  "plugins/coc-keeper/pi/lib/semantic-identity-registry.ts",
);

const semanticIds = createSemanticIdentityRegistry().projectAll({
  sessionEpoch: 1,
  campaign: "undeclared-slot-refusal",
  playerTurnEpoch: 1,
});

const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));

// The delivery order the wire uses: the canonical projection first (identity
// sanitizer + error-prose rewrite), then the Pi failure classification that
// decides retryability and the allowed next action.
const canonical = projectModelVisibleCanonicalResult(
  "rules.settle", envelope, semanticIds, { unmapped: [] },
);
const delivered = attachExpectedSchema(canonical, "rules.settle");

process.stdout.write(JSON.stringify(delivered.error));
