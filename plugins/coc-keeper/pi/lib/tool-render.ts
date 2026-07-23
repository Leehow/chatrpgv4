/**
 * Compact Pi TUI renderers for COC gateway tools.
 *
 * Without renderResult, Pi dumps full JSON for every coc_invoke call.
 * Default view is one-line summary; Ctrl+O (app.tools.expand) shows full JSON.
 */
import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { summarizeCall, summarizeResult } from "./tool-summary.ts";

export { summarizeCall, summarizeResult };

function expandHint(action: "expand" | "collapse"): string {
  try {
    return keyHint("app.tools.expand", `to ${action}`);
  } catch {
    // Outside interactive TUI (tests / early load) theme may be uninitialized.
    return `ctrl+o to ${action}`;
  }
}

function textOutput(result: { content?: Array<{ type: string; text?: string }>; details?: unknown }): string {
  if (result.details !== undefined) {
    try {
      return JSON.stringify(result.details, null, 2);
    } catch {
      /* fall through */
    }
  }
  const blocks = result.content ?? [];
  return blocks
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

export function compactToolRenderers(toolName: string) {
  return {
    renderCall(args: unknown, theme: Theme, context: { lastComponent?: unknown }) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(theme.fg("toolTitle", theme.bold(summarizeCall(toolName, args))));
      return text;
    },
    renderResult(
      result: { content?: Array<{ type: string; text?: string }>; details?: unknown },
      options: { expanded?: boolean; isPartial?: boolean },
      theme: Theme,
      context: { args?: unknown; lastComponent?: unknown },
    ) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      if (options.isPartial) {
        text.setText(theme.fg("warning", "…"));
        return text;
      }
      const summary = summarizeResult(toolName, result.details, context.args);
      if (options.expanded) {
        const body = textOutput(result);
        const styled = body
          .split("\n")
          .map((line) => theme.fg("toolOutput", line))
          .join("\n");
        text.setText(
          `${theme.fg("success", summary)} ${theme.fg("muted", "(")}${expandHint("collapse")}${theme.fg("muted", ")")}\n${styled}`,
        );
      } else {
        text.setText(
          `${theme.fg("success", summary)} ${theme.fg("muted", "(")}${expandHint("expand")}${theme.fg("muted", ")")}`,
        );
      }
      return text;
    },
  };
}
