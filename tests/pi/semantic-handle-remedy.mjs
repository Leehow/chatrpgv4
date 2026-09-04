// Appended by the graph playtest: an error whose remedy is the operation that
// just failed sends the model in a circle. scene.context is what establishes
// the party binding, so it cannot be its own prerequisite.
import assert from "node:assert";
import { restoreSemanticEntityHandles } from "../../plugins/coc-keeper/pi/lib/tool-contract-projection.ts";
const CURRENT = "current-investigator";
const other = restoreSemanticEntityHandles(
  "rules.damage", { investigator: CURRENT }, null,
);
assert.equal(other.ok, false);
assert.equal(other.code, "semantic_entity_binding_missing");
assert.match(other.message, /call scene\.context first/);

const itself = restoreSemanticEntityHandles(
  "scene.context", { investigator: CURRENT }, null,
);
assert.equal(itself.ok, false);
assert.equal(itself.code, "semantic_entity_binding_missing");
assert.doesNotMatch(itself.message, /call scene\.context first/,
  "scene.context was told to call scene.context first");
assert.match(itself.message, /without `investigator`/);
console.log(JSON.stringify({ ok: true, module: "semantic-handle-remedy" }));
