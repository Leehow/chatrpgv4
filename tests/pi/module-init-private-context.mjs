#!/usr/bin/env node
import "./_lib/preload-embedded-pi.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const fixturePath = path.resolve(process.argv[3]);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const extension = await import(
  path.join(root, "plugins/coc-keeper/pi/extensions/index.ts"),
);
const { canonicalModuleInitPrivateContext } = extension;

const context = await canonicalModuleInitPrivateContext(
  fixture.workspace,
  fixture.params,
  fixture.envelope,
);
assert.notEqual(context, null, "source-bound private L0 projection was rejected");
assert.equal(context.schema_version, 1);
assert.equal(context.campaign_id, fixture.params.campaign);
assert.equal(context.secrecy, "keeper_only");
assert.equal(context.l0_sha256, fixture.expected_l0_sha256);
assert.deepEqual(context.l0, fixture.expected_l0);
const privateBytes = JSON.stringify(context);
assert.equal(privateBytes.includes("source_binding"), false);
assert.equal(privateBytes.includes("save/module-init.json"), false);
assert.equal(privateBytes.includes(fixture.sentinel), true);

const malformedContract = structuredClone(fixture.envelope);
malformedContract.data.kind = "wrong.contract.kind";
assert.equal(
  await canonicalModuleInitPrivateContext(
    fixture.workspace,
    fixture.params,
    malformedContract,
  ),
  null,
  "noncanonical contract authorized private source state",
);
const foreignRootParams = {
  ...fixture.params,
  root: path.dirname(fixture.workspace),
};
assert.equal(
  await canonicalModuleInitPrivateContext(
    fixture.workspace,
    foreignRootParams,
    fixture.envelope,
  ),
  null,
  "foreign workspace contract authorized private source state",
);

const statePath = path.join(
  fixture.workspace,
  ".coc",
  "campaigns",
  fixture.params.campaign,
  "save",
  "module-init.json",
);
const original = await readFile(statePath, "utf8");
try {
  const tampered = JSON.parse(original);
  tampered.source_binding.bundle_sha256 = "f".repeat(64);
  await writeFile(statePath, JSON.stringify(tampered), "utf8");
  assert.equal(
    await canonicalModuleInitPrivateContext(
      fixture.workspace,
      fixture.params,
      fixture.envelope,
    ),
    null,
    "stale source binding authorized private source state",
  );
} finally {
  await writeFile(statePath, original, "utf8");
}

function gatewayHarness({ failPrivateProjection = false } = {}) {
  const tools = new Map();
  const handlers = new Map();
  const sent = [];
  const fakePi = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand() {},
    registerShortcut() {},
    on: (name, handler) => {
      const entries = handlers.get(name) || [];
      entries.push(handler);
      handlers.set(name, entries);
    },
    appendEntry() {},
    sendMessage: (message, options) => {
      if (
        failPrivateProjection
        && message.customType === "coc-module-init-private"
      ) {
        throw new Error("injected private L0 delivery failure");
      }
      sent.push({ message, options });
    },
    setActiveTools() {},
    getThinkingLevel: () => "off",
  };
  extension.default(fakePi, {
    coordinatorEnabled: () => false,
    welcomeAgentDir: path.join(fixture.workspace, ".module-init-probe"),
    createClient: () => {
      const client = {
        async callTool(name) {
          if (name === "coc_capabilities") return { ok: true, host: "pi" };
          return fixture.envelope;
        },
        async callToolWithTransportMeta(name, params) {
          return { value: await client.callTool(name, params), transport: { attempts: 1 } };
        },
        async close() {},
      };
      return client;
    },
  });
  const ctx = {
    cwd: fixture.workspace,
    mode: "rpc",
    model: { provider: "probe", id: "probe" },
    sessionManager: {
      getSessionId: () => "module-init-private-projection",
      getEntries: () => [],
    },
    hasUI: false,
  };
  return { tools, handlers, sent, ctx };
}

async function startGateway(harness) {
  for (const handler of harness.handlers.get("session_start") || []) {
    await handler({ reason: "module-init-probe" }, harness.ctx);
  }
}

const gateway = gatewayHarness();
await startGateway(gateway);
const gatewayResult = await gateway.tools.get("coc_invoke").execute(
  "module-init-private-success",
  { ...fixture.params, root: fixture.workspace },
  undefined,
  undefined,
  gateway.ctx,
);
const gatewayEnvelope = JSON.parse(gatewayResult.content[0].text);
const privateDelivery = gateway.sent.find((entry) => (
  entry.message.customType === "coc-module-init-private"
));
assert.notEqual(privateDelivery, undefined);
assert.equal(privateDelivery.message.display, false);
assert.deepEqual(privateDelivery.options, { triggerTurn: false });
assert.deepEqual(
  JSON.parse(privateDelivery.message.content).l0,
  fixture.expected_l0,
);
assert.equal(gatewayEnvelope.ok, true);
assert.equal(JSON.stringify(gatewayEnvelope).includes(fixture.sentinel), false);

const failedGateway = gatewayHarness({ failPrivateProjection: true });
await startGateway(failedGateway);
const failedGatewayResult = await failedGateway.tools.get("coc_invoke").execute(
  "module-init-private-failure",
  { ...fixture.params, root: fixture.workspace },
  undefined,
  undefined,
  failedGateway.ctx,
);
const failedGatewayEnvelope = JSON.parse(failedGatewayResult.content[0].text);
assert.equal(failedGatewayEnvelope.ok, false);
assert.equal(
  failedGatewayEnvelope.error.code,
  "module_init_private_projection_failed",
);

process.stdout.write(JSON.stringify({
  ok: true,
  secrecy: context.secrecy,
  l0Sha256: context.l0_sha256,
}));
