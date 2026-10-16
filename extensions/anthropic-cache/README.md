# Anthropic Active Cache

This product extension places explicit cache boundaries on MiniMax foreground
Keeper requests. It initially accepts only `minimax-cn` and `minimax` with the
`anthropic-messages` API. Other providers require a deliberate protocol-policy
entry in `shared/policy.js` and request tests; an Anthropic-compatible URL alone
does not enable the extension.

The four boundaries are the last tool, last system text, the table's exact
`coc-context-brief` text, and the last cacheable conversation block. Coincident
positions use one slot. A missing, modified or ambiguous brief is not guessed.
Pi's existing direct block markers are replaced with at most four
`{type:"ephemeral"}` markers, with no one-hour TTL. Requests with no markers
(including Pi's `cacheRetention: "none"`) and request-level cache policies are
preserved. The model's `supportsCacheControlOnTools: false` is respected.

The extension observes typed context after table projection and matches it after
the native provider serializer runs. It never changes prompt text, state, tool
definitions, tool pairs, thinking, model, credentials or output limits. It adds
no calls, retries, refresh timer or independent-lane policy. Pi's explicit
`cacheRetention: "none"` remains the request-level cache opt-out.
Managed desktop sessions additionally obey `PIPIUI_MOUNTED_EXTENSIONS`; disabling
the extension in the host prevents the shared COC mount from re-enabling it.
Source CLI sessions enable the policy by default.
Only cache annotations and equivalent string-to-text-block representations may
change. It deliberately does not split the capsule or move dynamic state into
the system prompt.

After a successful request, hashes retain its marked prefixes for five minutes.
If an identical conversation prefix falls outside the growing tail's twenty-block
lookback, the extension preserves that old boundary using a spare slot (or the
tool slot when a system boundary already covers the tools). It retains at most
four markers. Failed responses, expired snapshots, changed models or changed
prefixes cannot authorize reuse. Request diagnostics record the first changed
block and matching count, without persisting prompt content.

Private `coc-telemetry` session entries with lane `anthropic-cache` record request
ordinals, breakpoint paths and brief-match status. Matching raw Anthropic stream
events supply the actual input/read/write/output counts. Usage can be reported,
partial or unreported; absent counts are never fabricated. Read ratio is
`read / (read + write + input)` only when every input count is reported.
No prompts, responses, arguments, headers, credentials, billing estimates or
subscription-credit guesses are saved. These entries are session diagnostics,
not an additional campaign-state writer or model-context message.
MiniMax Enhanced's status command and settings pane read this same journal,
including reported cache writes, per-counter coverage and recent requests. An
unreported value is shown explicitly. A reported zero is preserved, but is not
proof that the server created no cache entry. No request or estimate fills a gap.

The manifest drives runtime building and packaging; the shared COC mount and
profile installer deliver the compiled entry in source and standalone sessions.
Use `node --test tests/extension/anthropic-cache.test.mjs` for offline tests.
The tests inject an HTTP-free client into the actual Pi Anthropic adapter;
offline transport verification does not establish server cache hits or savings.
MiniMax's current active-cache model table does not list M3.1 Flash Preview;
real M3.1 calls on 2026-10-16 did report large cache reads. The same account's
streaming responses omitted creation counts, while non-streaming returned zero
even for a cold unique prefix. Complete write accounting remains service-limited.

References: [MiniMax active caching](https://platform.minimax.cn/docs/api-reference/anthropic-api-compatible-cache)
and [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
Both describe prefix boundaries and a twenty-block lookback. MiniMax documents
five-minute refresh-on-hit and four markers. Anthropic's request-level automatic
caching, one-hour TTL and tool-block grouping are not assumed on MiniMax.
