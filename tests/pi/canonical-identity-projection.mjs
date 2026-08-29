import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

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
      const data = params.operation === "module.context"
        ? {
          module: {
            module_id: "module-the-haunting",
            graph_contract_id: "coc.module-graph.v3",
            current_generation: "generation-machine-only",
            module_graph_sha256: "a".repeat(64),
            module_graph_path: "/private/module-graph.json",
          },
          candidates: [{
            node_id: "npc-michael-thomas",
            node_kind: "npc",
            name: "Michael Thomas",
            root_cause: "The authored cause remains visible.",
            escape_path: "The authored route remains visible.",
            family_generation: "third-generation custodians",
            shard_path: "shards/michael-thomas.json",
            evidence_path: "evidence/michael-thomas.json",
            review_path: "reviews/michael-thomas.json",
          }],
          context: {
            nodes: [{
              node_id: "npc-michael-thomas",
              source_refs: [{
                source_id: "pdf:the-haunting",
                pdf_index: 461,
                text_sha256: "b".repeat(64),
                grep_anchor: "machine-only anchor",
                grep_anchors: ["machine-only anchor"],
                bundle_path: "/private/source-bundle",
                markdown_path: "pages/0461.md",
              }],
            }],
          },
        }
        : {
          scene_id: "scene-commission-briefing",
          clue_id: "clue-knott-research-leads",
          npc_id: "npc-steven-knott",
          affordance_id: "ask-research-options",
        };
      return {
        value: {
          ok: true,
          tool: params.operation,
          wire: { full_result_sha256: "c".repeat(64) },
          data,
          warnings: [],
          hints: [],
        },
        transport: null,
      };
    },
    async close() {},
  }),
});

const moduleResult = await tools.get("coc_invoke").execute(
  "module-context-projection",
  {
    operation: "module.context",
    campaign: "identity-projection-campaign",
    arguments: { query: "Michael Thomas" },
  },
  undefined,
  undefined,
  {
    cwd: root,
    mode: "rpc",
    model: { provider: "xai", id: "grok-4.5" },
    sessionManager: {
      getSessionId: () => "module-context-projection",
      getEntries: () => [],
    },
    hasUI: false,
  },
);
const moduleVisible = JSON.parse(moduleResult.content[0].text);
process.stdout.write(JSON.stringify({
  module: {
    ok: moduleVisible.ok,
    tool: moduleVisible.tool,
    semantic: {
      module_id: moduleVisible.data?.module?.module_id,
      graph_contract_id: moduleVisible.data?.module?.graph_contract_id,
      node_id: moduleVisible.data?.candidates?.[0]?.node_id,
      source_id: moduleVisible.data?.context?.nodes?.[0]?.source_refs?.[0]?.source_id,
    },
    authoredProperties: {
      root_cause: moduleVisible.data?.candidates?.[0]?.root_cause,
      escape_path: moduleVisible.data?.candidates?.[0]?.escape_path,
      family_generation: moduleVisible.data?.candidates?.[0]?.family_generation,
    },
    opaqueFieldsAbsent:
      !("wire" in moduleVisible)
      && !("current_generation" in moduleVisible.data.module)
      && !("module_graph_sha256" in moduleVisible.data.module)
      && !("module_graph_path" in moduleVisible.data.module)
      && !("shard_path" in moduleVisible.data.candidates[0])
      && !("evidence_path" in moduleVisible.data.candidates[0])
      && !("review_path" in moduleVisible.data.candidates[0])
      && !("text_sha256" in moduleVisible.data.context.nodes[0].source_refs[0])
      && !("grep_anchor" in moduleVisible.data.context.nodes[0].source_refs[0])
      && !("grep_anchors" in moduleVisible.data.context.nodes[0].source_refs[0])
      && !("bundle_path" in moduleVisible.data.context.nodes[0].source_refs[0])
      && !("markdown_path" in moduleVisible.data.context.nodes[0].source_refs[0]),
  },
  canonicalDetailsPreserved:
    moduleResult.details?.tool === "module.context"
    && moduleResult.details?.data?.module?.module_graph_sha256 === "a".repeat(64),
}));
