import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

// `decision_id` is declared host-owned for state.move_scene, so the model
// schema hides it — and nothing used to supply a value. On a live table the
// Keeper's four move attempts failed with missing_param, were repeat-blocked,
// and it narrated a crossing that never landed: the fiction moved to 1287
// while the authoritative scene stayed on the 1895 opening.
process.env.COC_PI_SESSION_ROLE = "play";
const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const tools = new Map();
const seen = [];
const fakePi = {
  registerTool: (tool) => tools.set(tool.name, tool),
  registerCommand() {},
  registerShortcut() {},
  on() {},
  appendEntry() {},
  sendMessage() {},
  setActiveTools() {},
  getThinkingLevel: () => "off",
};
main.default(fakePi, {
  coordinatorEnabled: () => false,
  createClient: () => ({
    async callToolWithTransportMeta(_name, params) {
      seen.push(params);
      return {
        value: {
          ok: true,
          tool: params.operation,
          wire: { full_result_sha256: "c".repeat(64) },
          data: { active_scene_id: "scene-the-woods" },
          warnings: [],
          hints: [],
        },
        transport: null,
      };
    },
    async close() {},
  }),
});

const moveTool = tools.get("coc_state_move_scene");
const schema = moveTool?.parameters ?? {};
const properties = schema.properties ?? {};

// The model must not be asked for a field the host owns...
const modelSeesDecisionId = Object.hasOwn(properties, "decision_id");

const projection = await import(path.join(
  root,
  "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
));
const hostOwned = projection.HOST_OWNED_FIELDS["state.move_scene"] ?? [];

process.stdout.write(JSON.stringify({
  toolRegistered: moveTool !== undefined,
  // The host claims this field, so the model is never shown it...
  decisionIdIsHostOwned: hostOwned.includes("decision_id"),
  modelSeesDecisionId,
  modelRequiredArguments: schema.required ?? [],
  // ...which means the host has to put a value there before the canonical
  // operation, whose contract requires it, ever sees the call. The gateway
  // branch that does so cannot be reached from a synthetic session (the
  // scene-supply preflight closes first), so the live-table evidence in
  // docs/status/module-pipeline-unification-stage-b.md is its acceptance.
  contractWouldRejectAModelOnlyCall: !modelSeesDecisionId,
}, null, 2) + "\n");
