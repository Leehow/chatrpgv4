# Grok Build OAuth provider extension

Ported from the upstream PipiUI package `@pipiui/grok-build-oauth-extension`
(version 0.2.0) at `Electron/packages/grok-build-oauth-extension` of the
PipiUI checkout. The agent half is the shipped `agent/dist` JavaScript copied
verbatim (`.d.ts` files dropped); behavior is unchanged.

Registers the `grok-build` provider (`openai-responses` at
`https://api.x.ai/v1`, device/browser OAuth, conversation models `grok-4.6` /
`grok-4-fast` / `grok-code-fast-1` with hosted `web_search` / `x_search`) via
`pi.registerProvider`, plus the `image_gen` / `image_edit` agent tools.
`agent/host.js` re-exports the host library (`createGrokBuildHostLibrary`)
for the app-side generic loader. OAuth credentials live in the resolved agent
home (`PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`), never in `~/.pi`.

## Omitted upstream files, and what is lost

- `app/` (`image-card.tsx` + `app/dist`) — PipiUI tool renderer for the image
  tools. PipiCOC has no renderer host for it, so the manifest's `app` section
  is dropped; the image tools still return typed image content plus a saved
  path.
- `pipiui-host-receipt.json` — PipiUI bundled-sync provenance receipt. The
  copy here is the same artifact, tracked by this repository instead.
- TypeScript sources, tests, and the `sync-bundled-extension` postbuild —
  PipiUI build machinery; the compiled output is what this tree vendors.
