#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const VALID_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function fail(message) {
  process.stderr.write(`pi-coc: ${message}\n`);
  process.exit(2);
}

function readJson(path, label, required = true) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return undefined;
    }
    fail(`cannot read ${label} at ${path}: ${error.message}`);
  }
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--help", "-h", "--version", "-v", "--list-models"].includes(arg)) {
      parsed.informational = true;
    } else if (arg === "--provider" && index + 1 < args.length) {
      parsed.provider = args[++index];
    } else if (arg === "--model" && index + 1 < args.length) {
      parsed.model = args[++index];
    } else if (arg === "--thinking" && index + 1 < args.length) {
      parsed.thinking = args[++index];
    }
  }
  return parsed;
}

function splitModelPattern(pattern) {
  if (!pattern) {
    return {};
  }
  let model = pattern;
  let thinking;
  const colon = model.lastIndexOf(":");
  if (colon >= 0 && VALID_THINKING_LEVELS.has(model.slice(colon + 1))) {
    thinking = model.slice(colon + 1);
    model = model.slice(0, colon);
  }
  const slash = model.indexOf("/");
  if (slash >= 0) {
    return {
      provider: model.slice(0, slash),
      model: model.slice(slash + 1),
      thinking,
    };
  }
  return { model, thinking };
}

function findModel(catalog, provider, modelId) {
  const models = catalog?.[provider]?.models;
  return Array.isArray(models)
    ? models.find((model) => model?.id === modelId)
    : undefined;
}

function findConfiguredModel(config, provider, modelId) {
  const models = config?.providers?.[provider]?.models;
  return Array.isArray(models)
    ? models.find((model) => model?.id === modelId)
    : undefined;
}

function firstSupportedThinkingLevel(model) {
  for (const level of VALID_THINKING_LEVELS) {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) {
      continue;
    }
    if ((level === "xhigh" || level === "max") && mapped === undefined) {
      continue;
    }
    return level;
  }
  return "off";
}

const [agentDir, ...userArgs] = process.argv.slice(2);
if (!agentDir) {
  fail("internal thinking preflight requires the Pi agent directory");
}

const parsed = parseArguments(userArgs);
if (parsed.informational) {
  process.exit(0);
}

const settingsPath = join(agentDir, "settings.json");
const settings = readJson(settingsPath, "COC settings");
const modelPattern = splitModelPattern(parsed.model);
const requestedThinking =
  parsed.thinking ?? modelPattern.thinking ?? settings.defaultThinkingLevel;

if (requestedThinking === "none") {
  fail(
    `${settingsPath} uses invalid defaultThinkingLevel "none"; use "off" for a real no-thinking request, ` +
      `or deliberately use "low" with hideThinkingBlock=true (UI hiding is not true thinking-off)`,
  );
}
if (requestedThinking !== "off") {
  process.exit(0);
}

const provider =
  parsed.provider ?? modelPattern.provider ?? settings.defaultProvider;
const modelId = modelPattern.model ?? settings.defaultModel;
if (!provider || !modelId) {
  fail(
    'thinking "off" was requested, but the exact provider/model could not be resolved; ' +
      "pass --provider <provider> --model <model>",
  );
}
if (/[*?[\]]/.test(modelId)) {
  fail(
    `thinking "off" was requested for non-exact model pattern ${provider}/${modelId}; ` +
      "pass an exact model so support can be verified before launch",
  );
}

const customModels = readJson(
  join(agentDir, "models.json"),
  "custom model configuration",
  false,
);
const modelStore = readJson(
  join(agentDir, "models-store.json"),
  "Pi model catalog",
  false,
);
const model =
  findConfiguredModel(customModels, provider, modelId) ??
  findModel(modelStore, provider, modelId);
if (!model) {
  fail(
    `thinking "off" was requested for ${provider}/${modelId}, but its model metadata is unavailable; ` +
      "refusing to risk Pi silently selecting a thinking level",
  );
}

if (model.reasoning && model.thinkingLevelMap?.off === null) {
  const clampedLevel = firstSupportedThinkingLevel(model);
  fail(
    `${provider}/${modelId} declares thinking off unsupported; Pi would silently clamp --thinking off ` +
      `to "${clampedLevel}". Choose a model whose catalog supports off, or deliberately use ` +
      "--thinking low with hideThinkingBlock=true; hiding the block is not true thinking-off",
  );
}
