# DeepSeek Extended provider extension

Ported from the upstream PipiUI package `@pipiui/deepseek-extension` (version
0.1.0) at `Electron/packages/deepseek-extension` of the PipiUI checkout. The
agent half was ported from the TypeScript source as plain ESM JavaScript (no
build step; the PipiCOC host imports `agent/provider.js` with a native
`import()`), cross-checked against the shipped `agent/dist` output. All
Chinese error strings were translated to English; behavior is unchanged.

Registers the independent `deepseek-extended` provider using Pi's existing
`anthropic-messages` serializer and SSE streamer. The official conversation
root is `https://api.deepseek.com/anthropic`; the configured API root still
owns model discovery and existing Files utilities. Explicit compatible gateway
roots are preserved. Source and contributed App/child loading share the same
provider factory; no Pi patch, extra inference loop or protocol fallback is used.

Thinking uses `thinking.type: enabled/disabled` and
`output_config.effort: low/high/max`. The former 150-word reasoning directive
has been removed. There is no replacement reasoning-length instruction or
thinking token budget. Native thinking blocks (including empty signatures) are
retained beside their tool calls and restored from the ordinary Pi transcript.
Historical Responses records retain their original API and are never relabelled
as signed Messages thinking.

Flash's first system prompt stays fixed. Later persisted system deltas become
complete effective prompt snapshots at their history position, after pending
tool results. This is deterministic after restart and does not depend on an
in-memory prompt cache. Additive tool changes use deferred declarations and
native tool_addition blocks. Removal/redefinition sends the current tool set;
Pro and unknown models use the conservative collapsed-system path. These
changes, model switches and image representation changes may invalidate cache
from the affected boundary. Cache hits are claimed only from reported usage.
DeepSeek ignores Anthropic cache_control and thinking budget_tokens; neither is
sent as a cache or speed mechanism. The Files beta header permits Messages file
images; inline and nested tool-result images keep native Messages shapes.
Messages supports only effort in output_config, so this provider no longer
advertises forced structured-output formats. Explicit format requests fail
before dispatch; they do not silently fall back to Responses.

Granted foreground Historical Reference requests keep the provider-private
web_search and web_fetch functions backed by official POST /v1/tools/search and
/v1/tools/fetch. They reuse the conversation credential and the same Messages
stream. The existing bounded coc-native-search journal retains private
call/result pairs and source metadata for matching replay, including ordinary
game-tool continuation. No extra Keeper verb or research model is created.
Retrieval failures close optional search for that run and preserve ordinary game
tools; there is no silent protocol fallback or automatic retrieval retry.

OpenCode Go DeepSeek is a separate built-in provider. Its Historical Reference
integration in `extensions/native-search` reuses the same private retrieval and
replay owner, but searches the OpenCode client's public Exa MCP endpoint without
an additional key. This does not alter the direct DeepSeek Search/Fetch backend
or send either conversation credential to another provider.

References: [Search/Fetch guide](https://api-docs.deepseek.com/guides/search/),
[Messages compatibility](https://api-docs.deepseek.com/guides/anthropic_api/),
and [official Harness API provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-deepseek-api).

## Omitted upstream files, and what is lost

- `app/usage-panel.tsx` — dead upstream: not referenced by the manifest
  (`app.ui.panels` is empty). Nothing lost.
- `scripts/postbuild.mjs` — PipiUI packaging step (copies build output into
  the PipiUI runtime tree). Not needed; this package ships plain JS.
- `pipiui-deepseek-server-tools.ts` — a 751-line PipiUI-host-specific runtime
  extension. Lost without it:
  - Chat Completions → Responses remap for the reserved `deepseek` provider;
  - settings-driven `ext.deepseek.forceWebSearch` (this port enables hosted
    search from declared model capabilities only);
  - citation capture and citation UI;
  - fetch interception / stream tee.
- Upstream vitest suite — not ported in this pass.

## Relationship to the reserved `deepseek` provider

pi-coc's reserved `deepseek` provider in `.pi/coc-agent/models.json` is a
separate registration and is untouched by this package.
