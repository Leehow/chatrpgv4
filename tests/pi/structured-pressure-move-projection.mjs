import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

// story-graph-schema.md §2 lets a scene author structured pressure moves whose
// members are named by a bare `id`. The committed starter only uses the string
// form, so a graph-backed module was the first to send the documented object
// form through scene.context — and an undeclared `id` made the whole canonical
// result fail closed as semantic_identity_unavailable, leaving the Keeper with
// no scene at all.
process.env.COC_PI_SESSION_ROLE = "play";
const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const tools = new Map();
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
      const machine = String(params?.campaign || "").includes("machine");
      return {
        value: {
          ok: true,
          tool: "scene.context",
          wire: { full_result_sha256: "c".repeat(64) },
          data: {
            active_scene_id: "scene-opening-smuggling-1895",
            scene: {
              scene_id: "scene-opening-smuggling-1895",
              dramatic_question: "The authored question stays visible.",
              pressure_moves: machine
                ? [{ id: "job-9f2c1ab4d7e6", cue: "machine-shaped id" }]
                : [{
                  id: "storm-rising",
                  cue: "The wind rises and the surf turns on the boats.",
                  tick: 1,
                  clock_id: "clock-loop-doom",
                }],
            },
          },
          warnings: [],
          hints: [],
        },
        transport: null,
      };
    },
    async close() {},
  }),
});

const invoke = (campaign, label) => tools.get("coc_invoke").execute(
  label,
  {
    operation: "scene.context",
    campaign,
    arguments: {},
  },
  undefined,
  undefined,
  {
    cwd: root,
    mode: "rpc",
    model: { provider: "xai", id: "grok-4.5" },
    sessionManager: {
      getSessionId: () => label,
      getEntries: () => [],
    },
    hasUI: false,
  },
);

const authored = await invoke("authored-pressure-campaign", "authored-pressure-move");
const machine = await invoke("machine-pressure-campaign", "machine-pressure-move");
const visible = JSON.parse(authored.content[0].text);
const machineVisible = JSON.parse(machine.content[0].text);
const moves = visible.data?.scene?.pressure_moves ?? [];
process.stdout.write(JSON.stringify({
  ok: visible.ok,
  errorCode: visible.error?.code ?? null,
  authoredId: moves[0]?.id ?? null,
  authoredClockId: moves[0]?.clock_id ?? null,
  authoredCueVisible: typeof moves[0]?.cue === "string",
  machineIdFailsClosed: machineVisible.ok === false
    && machineVisible.error?.code === "semantic_identity_unavailable",
}, null, 2) + "\n");
