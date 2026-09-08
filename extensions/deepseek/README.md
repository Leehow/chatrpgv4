# DeepSeek Extended provider extension

Ported from the upstream PipiUI package `@pipiui/deepseek-extension` (version
0.1.0) at `Electron/packages/deepseek-extension` of the PipiUI checkout. The
agent half was ported from the TypeScript source as plain ESM JavaScript (no
build step; the PipiCOC host imports `agent/provider.js` with a native
`import()`), cross-checked against the shipped `agent/dist` output. All
Chinese error strings were translated to English; behavior is unchanged.

Registers the `deepseek-extended` provider (`openai-responses`, hosted
`web_search` for the DeepSeek V4 family) via `pi.registerProvider` plus a
`before_provider_request` hook that merges the hosted search built-in and
rewrites images / JSON output. `agent/host.js` re-exports
`createAuthProvider` for the app-side generic auth-provider loader.

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
