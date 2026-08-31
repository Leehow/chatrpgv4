#!/usr/bin/env node
/**
 * Cross-provider capability projection must not change product schema semantics.
 * supportsStrictTools / supportsStrictMode only change provider sampling flags.
 * supportsDeveloperRole only changes message roles.
 *
 * Product schema is the registered model-owned view: archive inputSchema plus
 * the canonical Pi presentation overlays (decision_id grammar, semantic
 * investigator handle, host-owned field projection). Raw archive bytes are
 * not the model-visible surface; typed-tool-surface.mjs pins the same view.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { embeddedPiFile } from "./_lib/embedded-pi-path.mjs";

const root = path.resolve(process.argv[2] || process.cwd());
const archive = JSON.parse(readFileSync(
  path.join(root, "plugins/coc-keeper/references/mcp-operation-contracts.json"),
  "utf8",
));
const typed = await import(
  pathToFileURL(path.join(root, "plugins/coc-keeper/pi/lib/typed-tools.ts")).href
);
const { getJsonSchemaToolParameters, resolveJsonSchemaStrictSampling } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/constrained-sampling.js")).href
);
const { convertMessages } = await import(
  pathToFileURL(embeddedPiFile(root, "pi-ai", "dist/api/openai-completions.js")).href
);

const SPOTLIGHT = [
  "npc.reaction",
  "state.journal",
  "turn.output_context",
  "turn.finalize",
];
const GRAPH_HIDDEN_LEGACY = ["rules.roll", "rules.social_adjudicate"];
const catalog = typed.defaultTypedToolCatalog();

function presentedProduct(operation) {
  return typed.projectModelOwnedSchema(
    operation,
    typed.presentedTypedToolParameters(
      operation,
      archive.operations[operation].inputSchema,
    ),
  );
}

function asProviderTool(operation) {
  const tool = catalog.byOperation.get(operation);
  assert.ok(tool, operation);
  return {
    name: tool.name,
    description: tool.description,
    parameters: structuredClone(tool.parameters),
  };
}

function projectAnthropic(tool, supportsStrictTools) {
  const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictTools);
  const parameters = getJsonSchemaToolParameters(tool, strict);
  const legacy = {
    type: "object",
    properties: parameters.properties ?? {},
    required: parameters.required ?? [],
  };
  return {
    name: tool.name,
    strict: strict === true,
    input_schema: strict === true ? { ...parameters, ...legacy } : legacy,
  };
}

function semanticKeys(schema) {
  return {
    required: [...(schema.required || [])].sort(),
    properties: Object.keys(schema.properties || {}).sort(),
    additionalProperties: schema.additionalProperties,
  };
}

test("product schemas stay presented archive inputSchema across strict capabilities", () => {
  for (const operation of GRAPH_HIDDEN_LEGACY) {
    assert.ok(archive.operations[operation], operation);
    assert.equal(catalog.byOperation.get(operation), undefined, operation);
  }
  for (const operation of SPOTLIGHT) {
    const product = catalog.byOperation.get(operation).parameters;
    assert.deepEqual(product, presentedProduct(operation), operation);
    const tool = asProviderTool(operation);
    assert.equal(resolveJsonSchemaStrictSampling(tool, true), undefined, operation);
    assert.equal(resolveJsonSchemaStrictSampling(tool, false), undefined, operation);
    assert.deepEqual(getJsonSchemaToolParameters(tool, false), product, operation);
    assert.deepEqual(getJsonSchemaToolParameters(tool, undefined), product, operation);
    const loose = projectAnthropic(tool, false);
    const strict = projectAnthropic(tool, true);
    assert.equal(loose.strict, false, operation);
    assert.equal(strict.strict, false, operation);
    assert.deepEqual(loose.input_schema.required, product.required, operation);
    assert.deepEqual(strict.input_schema.required, product.required, operation);
    assert.deepEqual(
      Object.keys(loose.input_schema.properties).sort(),
      Object.keys(product.properties).sort(),
      operation,
    );
    assert.deepEqual(
      Object.keys(strict.input_schema.properties).sort(),
      Object.keys(product.properties).sort(),
      operation,
    );
    assert.equal(product.additionalProperties, false, operation);
    assert.deepEqual(semanticKeys(catalog.byOperation.get(operation).parameters), semanticKeys(product));
  }
});

function baseModel(overrides = {}) {
  return {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    api: "openai-completions",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8000,
    maxTokens: 256,
    baseUrl: "https://api.openai.com/v1",
    ...overrides,
  };
}

function history() {
  return [
    {
      role: "system",
      content: "KP system",
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "coc_rules_roll", arguments: { campaign: "c1" } },
      ],
      api: "openai-completions",
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "coc_rules_roll",
      content: [{ type: "text", text: '{"ok":true,"tool":"rules.roll"}' }],
      isError: false,
      timestamp: 3,
    },
  ];
}

test("developer-role capability does not mutate tool schema semantics", () => {
  const withDev = baseModel({
    compat: { supportsDeveloperRole: true, supportsStrictMode: true },
  });
  const withoutDev = baseModel({
    provider: "jellytoken",
    baseUrl: "https://aiservice.jellytoken.com/v1",
    compat: { supportsDeveloperRole: false, supportsStrictMode: false },
  });
  const withDevCompat = { ...withDev.compat };
  const withoutDevCompat = { ...withoutDev.compat };
  assert.equal(withDevCompat.supportsDeveloperRole, true);
  assert.equal(withoutDevCompat.supportsDeveloperRole, false);

  const messages = history();
  const enabled = convertMessages(
    withDev,
    { messages, systemPrompt: "Host system prompt stays first." },
    withDevCompat,
  );
  const disabled = convertMessages(
    withoutDev,
    { messages, systemPrompt: "Host system prompt stays first." },
    withoutDevCompat,
  );
  const enabledRoles = enabled.map((row) => row.role);
  const disabledRoles = disabled.map((row) => row.role);
  assert.ok(enabledRoles.includes("developer") || enabledRoles.includes("system"));
  assert.ok(!disabledRoles.includes("developer"));
  assert.ok(disabledRoles.includes("system"));

  for (const operation of SPOTLIGHT) {
    assert.deepEqual(
      catalog.byOperation.get(operation).parameters,
      presentedProduct(operation),
      operation,
    );
  }
});
