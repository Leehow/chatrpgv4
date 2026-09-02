// The embedded Pi runtime must resolve before any extension module is
// imported; without it this file cannot load tool-render.ts at all.
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const { OpeningTerminalContinuationGate } = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts")
);
const { createTurnOutputGateMethods } = await import(
  path.join(root, "plugins/coc-keeper/pi/lib/turn-output-gate.ts")
);

const owned = createTurnOutputGateMethods({});
assert.equal(typeof owned.markFinalizedOutputReady, "function");
assert.equal(typeof owned.acceptVisibleAssistantFinal, "undefined");
assert.equal(typeof owned.coordinatorContinuationContext, "function");

const digest = (value) => `sha256:${createHash("sha256")
  .update(JSON.stringify(value), "utf8")
  .digest("hex")}`;
const gate = new OpeningTerminalContinuationGate();
gate.markExternalUserInput("我推开门。 ");
const exactText = "门轴发出一声短促的呻吟。";
assert.equal(gate.markFinalizedOutputReady(exactText, digest(exactText)), true);
assert.deepEqual(
  gate.acceptVisibleAssistantFinal("这段未结算文字不得送达。"),
  { replacementText: exactText },
);
assert.equal(gate.hasPendingFinalizedOutput(), false);
assert.equal(gate.acceptVisibleAssistantFinal("重复输出。"), false);

const mechanicalGate = new OpeningTerminalContinuationGate();
mechanicalGate.markExternalUserInput("检定。 ");
assert.equal(
  mechanicalGate.acceptVisibleAssistantFinal("【明骰】掷骰：47"),
  false,
);
assert.equal(
  mechanicalGate.takeMechanicalOutputGateEnvelope()?.kind,
  "mechanical_output_gate",
);

console.log(JSON.stringify({ ok: true, module: "turn-output-gate" }));
