import "./_lib/preload-embedded-pi.mjs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] || process.cwd());
const main = await import(path.join(
  root,
  "plugins/coc-keeper/pi/extensions/index.ts",
));

const tools = new Map();
const clientCalls = [];
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
    async callTool(name, params) {
      clientCalls.push({ name, params });
      return {
        ok: true,
        tool: params.operation,
        data: { status: "PASS" },
      };
    },
    async close() {},
  }),
});

const ctx = {
  cwd: root,
  mode: "rpc",
  model: { provider: "xai", id: "grok-4.5" },
  sessionManager: {
    getSessionId: () => "invoke-string-arguments",
    getEntries: () => [],
  },
  hasUI: false,
};
const campaign = "xai-stringified-facts";
const sourceRefs = [{ source_id: "pdf:xai-fixture", pdf_index: 0 }];
const unresolved = {
  status: "unresolved",
  inspected_source_refs: sourceRefs,
};
const exactFactsArguments = {
  campaign_id: campaign,
  facts: {
    schema_version: 1,
    contract_id: "coc.opening-fast-facts.v1",
    era: { status: "source", value: "1920s", source_refs: sourceRefs },
    place: { status: "source", value: "Boston", source_refs: sourceRefs },
    investigator_hook: unresolved,
    investigator_constraints: unresolved,
    player_safe_summary: unresolved,
    content_flags: unresolved,
  },
};
const invoke = tools.get("coc_invoke");
const stringResult = await invoke.execute(
  "xai-stringified-exact-card",
  {
    operation: "setup.adopt_source_facts",
    campaign,
    arguments: JSON.stringify(exactFactsArguments),
  },
  undefined,
  undefined,
  ctx,
);
const nativeArguments = structuredClone(exactFactsArguments);
const objectResult = await invoke.execute(
  "native-object-exact-card",
  {
    operation: "setup.adopt_source_facts",
    campaign,
    arguments: nativeArguments,
  },
  undefined,
  undefined,
  ctx,
);

const rejected = {};
for (const [name, argumentsValue] of Object.entries({
  malformed: "{\"facts\":",
  array: "[]",
  null: "null",
  scalar: "\"facts\"",
})) {
  try {
    await invoke.execute(
      `reject-${name}`,
      {
        operation: "setup.adopt_source_facts",
        campaign,
        arguments: argumentsValue,
      },
      undefined,
      undefined,
      ctx,
    );
    rejected[name] = null;
  } catch (error) {
    rejected[name] = String(error?.message || error);
  }
}

const argumentSchema = invoke.parameters.properties.arguments;
process.stdout.write(JSON.stringify({
  schemaTypes: argumentSchema.anyOf.map((entry) => entry.type),
  stringifiedDeliveredExact:
    JSON.stringify(clientCalls[0].params.arguments)
      === JSON.stringify(exactFactsArguments),
  objectPathIdentityUnchanged: clientCalls[1].params.arguments === nativeArguments,
  stringResultOk: JSON.parse(stringResult.content[0].text).ok,
  objectResultOk: JSON.parse(objectResult.content[0].text).ok,
  clientCallCount: clientCalls.length,
  rejected,
}));
