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
    async callToolWithTransportMeta(name, params) {
      clientCalls.push({ name, params });
      return {
        value: {
          ok: true,
          tool: params.operation,
          data: { status: "PASS" },
        },
        transport: {
          request_id: `req-${clientCalls.length}`,
          attempts: 1,
          reconnect_attempts: 0,
        },
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
const retainedGate = new main.OpeningTerminalContinuationGate();
retainedGate.rememberReviewedAdoptFacts({
  status: "reviewed",
  campaign_id: campaign,
  facts: exactFactsArguments.facts,
});
const retainedRecovered = retainedGate.bindRetainedAdoptSourceFacts({
  operation: "setup.adopt_source_facts",
  campaign,
  arguments: '{"campaign_id":',
});
const retainedNormalized = main.normalizePiCocInvokeArguments(retainedRecovered);
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

const argumentSchema = invoke.parameters;
process.stdout.write(JSON.stringify({
  // The REGISTERED generic envelope is one closed operation-discriminated
  // schema: top-level oneOf branches, each pinning its operation const at
  // the envelope level (the shape real calls have) and carrying only
  // operation + model-owned arguments — campaign/root are host-bound and
  // absent.
  discriminated: argumentSchema.oneOf !== undefined
    && argumentSchema.oneOf.every((branch) =>
      branch.additionalProperties === false
      && branch.properties.operation.const !== undefined
      && Object.hasOwn(branch.properties, "arguments")
      && !Object.hasOwn(branch.properties, "campaign")
      && !Object.hasOwn(branch.properties, "root")
    ),
  branchCount: (argumentSchema.oneOf ?? []).length,
  stringifiedDeliveredExact:
    JSON.stringify(clientCalls[0].params.arguments)
      === JSON.stringify(exactFactsArguments),
  // The gateway copies the caller's object rather than mutating it — it
  // attaches host-bound identity by provenance — so reference identity is
  // deliberately not preserved. What must be preserved is the content: a
  // native object path is forwarded exactly, never re-serialized or
  // normalized.
  objectPathForwardedExactly:
    clientCalls[1].params.arguments !== nativeArguments
    && JSON.stringify(clientCalls[1].params.arguments)
      === JSON.stringify(nativeArguments),
  stringResultOk: JSON.parse(stringResult.content[0].text).ok,
  objectResultOk: JSON.parse(objectResult.content[0].text).ok,
  malformedRetainedAdoptRecovered:
    JSON.stringify(retainedNormalized.arguments)
      === JSON.stringify(exactFactsArguments),
  clientCallCount: clientCalls.length,
  rejected,
}));
