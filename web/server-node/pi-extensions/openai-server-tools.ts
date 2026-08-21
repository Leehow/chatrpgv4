/**
 * Host Pi extension: inject OpenAI / ChatGPT Codex hosted web_search on
 * official Responses APIs. Custom OpenAI-compatible providers are ignored.
 */
import {
  OPENAI_HOSTED_SEARCH_FAMILIES,
  applyHostedWebSearch,
  applyHostedWebSearchSystemTip,
} from "./hosted-web-search.mjs";

type PiHooks = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
};

export default function openaiServerTools(pi: PiHooks) {
  pi.on("before_provider_request", (event, ctx) => {
    return applyHostedWebSearch(ctx?.model, event?.payload, OPENAI_HOSTED_SEARCH_FAMILIES) ?? undefined;
  });

  pi.on("before_agent_start", (event, ctx) => {
    return applyHostedWebSearchSystemTip(
      ctx?.model,
      event?.systemPrompt,
      OPENAI_HOSTED_SEARCH_FAMILIES,
    ) ?? undefined;
  });
}
