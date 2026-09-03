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
// A play-role operation with a nested object argument. The point of this
// probe is that the gateway forwards a deep payload byte-identically whether
// it arrived stringified or native; the operation only has to be one this
// session may call, and setup operations no longer are.
const exactFactsArguments = {
  intent_evidence: {
    primary_intent: "search_clippings",
    semantic_reason: "the player asks the clerk to retrieve the house file",
    action_resolution: { router: "semantic", confidence: "high" },
  },
};
// The host no longer retains reviewed opening facts to rebind a truncated
// call from: the opening-fast-facts review is retired, so there is nothing to
// remember. Argument normalization itself is still exercised below.
const invoke = tools.get("coc_invoke");
const stringResult = await invoke.execute(
  "xai-stringified-exact-card",
  {
    operation: "actions.advise",
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
    operation: "actions.advise",
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
        operation: "actions.advise",
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
  clientCallCount: clientCalls.length,
  rejected,
}));
