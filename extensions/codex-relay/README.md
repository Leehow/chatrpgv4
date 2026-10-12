# Codex Relay

Select **GPT-6 Luna (Codex Relay)** in the PipiCOC model picker. This extension
exposes only `codex-relay/gpt-6-luna` and uses the running local coding relay at
`http://127.0.0.1:18890/v1`. No Pi login or copied Codex token is needed.

The relay service must be running and signed in to Codex. It owns credential
renewal, network routing and upstream access. A stopped relay or expired relay
login fails the request; the plugin never switches to Pi OAuth or another model.
The older relay on port 18888 is a different service.

Settings -> Extensions -> Codex Relay offers a local Base URL override. Source
sessions can set `PIPICOC_CODEX_RELAY_URL`. Only loopback HTTP URLs are accepted.
Endpoint changes apply to new sessions. Existing selections and the product's
Grok 4.5/low default are preserved.

The standard Pi Responses transport handles streaming, images, reasoning,
function calls, tool results and cancellation. The manifest and provider factory
share one model shape, and normal runtime manifest discovery also mounts it in
reader children. See [the host contract](../../docs/specs/codex-relay.md).
