#!/usr/bin/env node
/**
 * Offline context replay — read-only analysis of a recorded pi session.
 *
 * Replays a `.pi/**\/sessions/**\/*.jsonl` transcript message by message, and at
 * every point where a model call would have happened it measures the context
 * twice with `lib/context-probe.ts`:
 *
 *   - baseline: the linear transcript pi actually sent
 *   - folded:   the same play run through the shipped `lib/context-fold.ts`,
 *               which collapses closed-turn tool results to stubs once the pile
 *               crosses a threshold (an epoch fold, not a sliding window — a
 *               sliding window would rewrite the prefix on every call and
 *               destroy prefix caching)
 *
 * Both are scored with the same cache model: characters that survived from the
 * previous call are cache reads, everything else is fresh input. That makes the
 * real question answerable from history instead of from a guess — does folding
 * at threshold T save more than the cache misses it causes?
 *
 * Usage:
 *   node --experimental-strip-types \
 *     plugins/coc-keeper/pi/bin/coc-context-replay.mjs <session.jsonl> [options]
 *
 *   --thresholds 20000,40000,80000   fold when the closed-turn pile exceeds T
 *   --cache-discount 0.1             price of a cached char vs a fresh one
 *   --json                           machine-readable output
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const { createContextProbe, estimateTokens } = await import(
  resolve(here, "../lib/context-probe.ts")
);
// The simulator runs the shipped fold, not a lookalike: one implementation
// decides both what a replay predicts and what a live session does.
const { createContextFold } = await import(resolve(here, "../lib/context-fold.ts"));

function parseArgs(argv) {
  const options = {
    file: null,
    thresholds: [20000, 40000, 80000],
    cacheDiscount: 0.1,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--thresholds") {
      options.thresholds = argv[++index].split(",").map((value) => Number(value.trim()));
    } else if (arg === "--cache-discount") {
      options.cacheDiscount = Number(argv[++index]);
    } else if (arg === "--json") {
      options.json = true;
    } else if (!options.file) {
      options.file = arg;
    }
  }
  return options;
}

function readMessages(file) {
  const messages = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message ?? entry;
    if (typeof message?.role === "string") messages.push(message);
  }
  return messages;
}

/** Fresh vs cached split for one call, priced with the same discount. */
function score(probe, discount) {
  const cached = probe.prefix.stable_chars;
  const fresh = Math.max(0, probe.chars - cached);
  return { fresh, cached, effective: fresh + cached * discount };
}

function runFolded(messages, callPoints, threshold, discount) {
  const probe = createContextProbe();
  const fold = createContextFold({ enabled: true, thresholdTokens: threshold });
  const totals = { fresh: 0, cached: 0, effective: 0, folds: 0, peak_chars: 0 };
  for (const point of callPoints) {
    const applied = fold.apply(messages.slice(0, point + 1));
    const observation = probe.observe(applied.messages);
    const call = score(observation, discount);
    totals.fresh += call.fresh;
    totals.cached += call.cached;
    totals.effective += call.effective;
    totals.peak_chars = Math.max(totals.peak_chars, observation.chars);
  }
  totals.folds = fold.stats().epochs;
  return totals;
}

const options = parseArgs(process.argv.slice(2));
if (!options.file) {
  process.stderr.write("usage: coc-context-replay.mjs <session.jsonl> [--thresholds a,b,c]\n");
  process.exit(2);
}

const messages = readMessages(options.file);
// pi calls the model after the player speaks and after every tool result.
const callPoints = messages
  .map((message, index) => (message.role === "user" || message.role === "toolResult" ? index : -1))
  .filter((index) => index >= 0);

const baselineProbe = createContextProbe();
const baseline = { fresh: 0, cached: 0, effective: 0, folds: 0, peak_chars: 0 };
let lastObservation = null;
for (const point of callPoints) {
  lastObservation = baselineProbe.observe(messages.slice(0, point + 1));
  const call = score(lastObservation, options.cacheDiscount);
  baseline.fresh += call.fresh;
  baseline.cached += call.cached;
  baseline.effective += call.effective;
  baseline.peak_chars = Math.max(baseline.peak_chars, lastObservation.chars);
}

const variants = options.thresholds.map((threshold) => ({
  threshold,
  ...runFolded(messages, callPoints, threshold, options.cacheDiscount),
}));

const report = {
  file: options.file,
  messages: messages.length,
  model_calls: callPoints.length,
  cache_discount: options.cacheDiscount,
  final_context: lastObservation
    ? {
      chars: lastObservation.chars,
      est_tokens: lastObservation.est_tokens,
      by_class_percent: Object.fromEntries(
        Object.entries(lastObservation.by_class)
          .map(([name, chars]) => [name, +(100 * chars / (lastObservation.chars || 1)).toFixed(1)]),
      ),
    }
    : null,
  baseline: {
    ...baseline,
    est_effective_tokens: estimateTokens(baseline.effective),
    peak_est_tokens: estimateTokens(baseline.peak_chars),
  },
  folded: variants.map((variant) => ({
    threshold_est_tokens: variant.threshold,
    folds: variant.folds,
    est_effective_tokens: estimateTokens(variant.effective),
    peak_est_tokens: estimateTokens(variant.peak_chars),
    effective_vs_baseline_percent: baseline.effective > 0
      ? +(100 * (variant.effective / baseline.effective - 1)).toFixed(1)
      : null,
    peak_vs_baseline_percent: baseline.peak_chars > 0
      ? +(100 * (variant.peak_chars / baseline.peak_chars - 1)).toFixed(1)
      : null,
  })),
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const percent = report.final_context?.by_class_percent ?? {};
  process.stdout.write(
    `会话 ${report.file}\n`
    + `  消息 ${report.messages} · 模型调用 ${report.model_calls}\n`
    + `  末次上下文 ${report.final_context?.est_tokens ?? 0} tokens`
    + `（工具结果 ${percent.tool_result ?? 0}% · 工具参数 ${percent.tool_call ?? 0}%`
    + ` · 思考 ${percent.assistant_thinking ?? 0}% · KP 叙事 ${percent.assistant_text ?? 0}%`
    + ` · 玩家 ${percent.user ?? 0}%）\n`
    + `  基线：等效 ${report.baseline.est_effective_tokens} tokens`
    + ` · 峰值 ${report.baseline.peak_est_tokens} tokens\n`,
  );
  for (const variant of report.folded) {
    process.stdout.write(
      `  折叠阈值 ${variant.threshold_est_tokens}：折叠 ${variant.folds} 次`
      + ` · 等效 ${variant.est_effective_tokens} tokens（${variant.effective_vs_baseline_percent}%）`
      + ` · 峰值 ${variant.peak_est_tokens} tokens（${variant.peak_vs_baseline_percent}%）\n`,
    );
  }
}
