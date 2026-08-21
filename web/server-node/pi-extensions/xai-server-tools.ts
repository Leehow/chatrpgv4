/**
 * Host Pi extension: inject xAI Responses hosted web_search (`provider=xai`).
 * Custom OpenAI-compatible providers are ignored.
 */
import {
  XAI_HOSTED_SEARCH_FAMILIES,
  applyHostedWebSearch,
  applyHostedWebSearchSystemTip,
} from "./hosted-web-search.mjs";

type PiHooks = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
};

export default function xaiServerTools(pi: PiHooks) {
  pi.on("before_provider_request", (event, ctx) => {
    return applyHostedWebSearch(ctx?.model, event?.payload, XAI_HOSTED_SEARCH_FAMILIES) ?? undefined;
  });

  pi.on("before_agent_start", (event, ctx) => {
    return applyHostedWebSearchSystemTip(
      ctx?.model,
      event?.systemPrompt,
      XAI_HOSTED_SEARCH_FAMILIES,
    ) ?? undefined;
  });
}
