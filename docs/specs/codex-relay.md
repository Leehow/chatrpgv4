# Codex Relay provider extension

The operator can select `codex-relay/gpt-6-luna` in PipiCOC and run through the
existing local coding relay's Codex authentication instead of Pi OAuth.

- `extensions/codex-relay/pipiui-extension.json` contributes exactly one model:
  GPT-6 Luna, with the Responses API, text/image input and the full effort map.
- The agent and host register the same provider factory. Source sessions,
  compiled sessions and reader/lane children use the manifest-discovered mount.
- The default endpoint is `http://127.0.0.1:18890/v1`, the active coding relay.
  The old `18888` relay is a separate service and failed its auth probe.
- `ext.codex-relay.baseUrl` or `PIPICOC_CODEX_RELAY_URL` can select another local
  loopback HTTP endpoint. No automatic fallback or upstream OAuth is allowed.
- A non-secret placeholder satisfies Pi's required API-key field. The extension
  never imports, copies, refreshes or persists Codex OAuth credentials. The relay
  owns login and renewal; connection/auth failures remain request failures.
- The standard Responses adapter owns streaming, function calls, tool-result
  replay, cancellation and provider telemetry. Model compat disables unsupported
  output-token and cache-retention parameters and preserves `strict:false` tools.
- Luna uses the existing OpenAI Fast composer control. Its final request hook
  uses `gpt-6-luna-fast` on the wire when enabled, which this relay maps to Luna
  plus priority. Off uses plain Luna. Canonical session identity and reasoning
  remain unchanged; actual terminal tier, not the requested alias, determines
  whether the UI reports effective Fast. See `docs/pi-host-contract.md`.
- The profile installer materializes the manifest and compiled agent alongside
  the provider module before App discovery. It preserves model selections,
  existing credentials and grants; Grok 4.5/low remains the default.

Writer: the extension catalog and relay responses. Reader: Pi's model runtime
and the existing App model selector. Actor: the selected Pi agent or reader
child makes a Responses request; the kernel retains rule/transaction authority.

Existing practice: PipiUI's `pipiui-media.ts` uses a loopback coding relay with
server-owned credentials; PipiCOC's Flapcode extension uses the same manifest
provider and Responses registration seam. The local coding relay source at
`vpnserver/coding-relay/providers/codex/` confirms Responses and OAuth ownership.
[OpenAI's Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
confirms Responses function calls and the model limits. The
[Codex app-server authentication contract](https://developers.openai.com/codex/app-server#authentication-endpoints)
confirms that authentication can be owned by the Codex host. That contract does
not establish access through this custom relay: a completed local Luna request
on 2026-10-12 did. No Codex agent or Pi source fork is needed.

Implementation evidence: the real vendored Pi model runtime completed a Luna
function call and a second request replaying its tool result through port 18890.
The focused provider/profile/system-language checks passed 15/15. The profile
installation check runs twice and preserves settings, auth and grants byte for
byte. These are transport/plugin checks, not campaign playtest evidence.
