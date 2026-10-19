# DeepSeek Extended provider extension

Ported from the upstream PipiUI package `@pipiui/deepseek-extension` (version
0.1.0) at `Electron/packages/deepseek-extension` of the PipiUI checkout. The
agent half was ported from the TypeScript source as plain ESM JavaScript (no
build step; the PipiCOC host imports `agent/provider.js` with a native
`import()`), cross-checked against the shipped `agent/dist` output. All
Chinese error strings were translated to English; behavior is unchanged.

Registers the `deepseek-extended` provider (`openai-responses`) via
`pi.registerProvider` plus a `before_provider_request` hook that rewrites images
and JSON output. `agent/host.js` re-exports
`createAuthProvider` for the app-side generic auth-provider loader.

`deepseek-flash` automatically follows the official V4.1 Flash 1017 release;
no dated model ID or default-selection change is required. Granted foreground
Historical Reference requests use provider-private `web_search` and `web_fetch`
functions backed by the official `POST /v1/tools/search` and `/v1/tools/fetch`
APIs. These reuse the conversation API key and the same Responses streamer.
Flash ignores Responses hosted `web_search`; the old Messages search switch is
removed. Child lanes and unrelated requests acquire no retrieval capability.
The existing `coc-native-search` journal retains bounded private call/result
pairs and source metadata for matching replay, including normal game-tool
continuation. No extra Keeper verb, researcher or reference database is created.
Retrieval failures close optional search for that run and preserve ordinary game
tools; there is no silent protocol fallback or automatic retry.

OpenCode Go DeepSeek is a separate built-in provider. Its Historical Reference
integration in `extensions/native-search` reuses the same private retrieval and
replay owner, but searches the OpenCode client's public Exa MCP endpoint without
an additional key. This does not alter the direct DeepSeek Search/Fetch backend
or send either conversation credential to another provider.

References: [Search/Fetch guide](https://api-docs.deepseek.com/guides/search/),
[Responses compatibility](https://api-docs.deepseek.com/guides/responses_api/),
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
