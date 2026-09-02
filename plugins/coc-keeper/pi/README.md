# COC Keeper for Pi

This directory is the **Pi Package** adapter for the canonical single-track
plugin. It loads `../skills` and `../rulesets/coc7/skills` directly; it does not
copy or fork Keeper behavior.

## Surface map

| Official name | Path | Role |
|---|---|---|
| **Pi Package** | this directory + repo-root `package.json` | Interactive Pi host (this product path) |
| **Headless Runtime** | `runtime/sdk` + `runtime/adapters/keeper` | Python Event API / keeper turn shell |
| **Narrator Bridge** | `runtime/adapters/pi/` | **Frozen** bounded narrator compatibility — not this package |

Do not wire progressive source, coordinator/leaf, or OCR product behavior into
Narrator Bridge. That path is frozen (kept, not deleted) until Headless Runtime
no longer needs the legacy narrator role.

## Dual entry: `pi` (coding) vs `pi-coc` (this campaign)

Do **not** `pi install` this repository into a global coding agent home
(`~/.pi/agent`). Pi homes are per-project. Coding and COC play use separate
directories inside this repo:

| Command | Config home | Role |
|---|---|---|
| `pi` / PipiUI coding | `{this-repo}/.pi/agent` | Coding only — no COC package |
| `pi-coc` | `{this-repo}/.pi/coc-agent` (override with `PI_COC_AGENT_DIR`) | This repo only — COC Keeper package |

`pi-coc` is [`bin/pi-coc`](bin/pi-coc). It sets `PI_CODING_AGENT_DIR` to the COC
home, forces cwd to this repository root, and launches with desktop defaults:

The launcher executes the exact patched Pi version pinned by
`runtime/adapters/keeper/package.json` and `package-lock.json` (currently
`0.84.2`) from that adapter's `node_modules`; a different `pi` on `PATH` is
never a fallback. If the bundled install is absent, mismatched, or not
executable, run `npm ci` in `runtime/adapters/keeper`. `COC_PI_CLI` is the only
caller override: it must be an absolute executable owned by an
`@earendil-works/pi-coding-agent` package at the same exact version, otherwise
the launcher fails closed.

```bash
pi --no-builtin-tools --approve --no-context-files \
  --append-system-prompt plugins/coc-keeper/pi/prompts/host-system.md \
  --session-id coc-keeper "$@"
```

With `--campaign` / `PI_COC_CAMPAIGN_ID`, the wrapper first asks
`plugins/coc-keeper/scripts/coc_session_role.py` for `setup` or `play`, exports
`COC_PI_SESSION_ROLE`, and assembles `--no-skills` / `--skill` /
`--append-system-prompt` from [`session-roles.json`](session-roles.json)
(`host-system-setup.md` or `host-system-play.md`). Role CLI or manifest failure
keeps the historical full package plus `host-system.md`. A setup child that
exits `42` (handoff complete) is re-resolved once and re-exec'd as play; any
other exit code is passed through. Without a campaign selector the launch line
above is unchanged.

Built-in coding tools (`read` / `bash` / `edit` / `write`) stay off; extension
gateway tools from this package remain. At startup, the wrapper validates
`uv 0.11.16` and prepends its directory to `PATH` for Pi and MCP children. It
uses `uv` already on `PATH`, or `$HOME/.local/bin/uv` for trimmed desktop PATHs;
a missing, wrong-version, or `.venv/bin/uv` candidate fails before Pi starts.
Repository `AGENTS.md` is not injected
(short host prompt is). `--session-id coc-keeper` reopens the same desktop
session when it exists. Use `pi-coc --new` for a fresh session. To change
repository code, open a separate `pi` session.

Pi transcript identity and COC campaign identity are separate namespaces:

- `PI_COC_SESSION_ID` selects the persisted Pi transcript/session only.
- `pi-coc --campaign <campaign_id>` explicitly selects an existing COC
  campaign for startup continuation. The wrapper consumes this option and
  exports it internally as `PI_COC_CAMPAIGN_ID`; it is never forwarded as a Pi
  session option.
- `PI_COC_CAMPAIGN_ID=<campaign_id> pi-coc` is the equivalent direct
  environment form.
- `pi-coc --new --campaign <campaign_id>` starts a fresh Pi transcript while
  resuming that existing campaign.

Both selector forms use the canonical safe campaign-ID grammar
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Invalid CLI or inherited environment
values are rejected by the launcher before Pi starts; they never fall through
to fresh-campaign onboarding.

When no campaign selector is present, the ordinary empty-workspace onboarding
remains unchanged and begins with `setup.inspect`.

On interactive start the package shows a short header + welcome/usage guide
(`/welcome` to repeat), sets `quietStartup` so skills are not dumped to the
screen, and prewarms MCP via `coc_capabilities`. Entering `pi-coc` **is** COC
activation: a fresh desktop auto-opens `coc-main` onboarding and never asks the
player to type「激活 COC」.

### One-time bootstrap

```bash
REPO=/absolute/path/to/chatrpgv4
COC_HOME=$REPO/.pi/coc-agent

mkdir -p "$COC_HOME/sessions"
cat > "$COC_HOME/settings.json" <<EOF
{
  "defaultProvider": "xai",
  "defaultModel": "grok-4.6",
  "defaultThinkingLevel": "low",
  "hideThinkingBlock": true,
  "packages": ["$REPO"],
  "theme": "light",
  "quietStartup": true
}
EOF

# Copy credentials into this repo. Do not symlink ~/.pi.
# cp /path/to/auth.json "$COC_HOME/auth.json"
# cp /path/to/models.json "$COC_HOME/models.json"

chmod +x "$REPO/plugins/coc-keeper/pi/bin/pi-coc"
ln -sfn "$REPO/plugins/coc-keeper/pi/bin/pi-coc" "$HOME/.npm-global/bin/pi-coc"
```

If the package was previously installed into a global coding home, remove it:

```bash
pi remove /absolute/path/to/chatrpgv4
```

Do not add the COC package to `{this-repo}/.pi/agent/settings.json`. Coding
`pi` / PipiUI in this repo uses `.pi/agent`; `pi-coc` uses `.pi/coc-agent`.

### Daily use

```bash
pi            # write code anywhere (including this repo)
pi-coc        # COC desktop (continues session-id coc-keeper)
pi-coc --new  # fresh COC desktop session
pi-coc --campaign my-campaign       # resume campaign; keep Pi transcript default
pi-coc --new --campaign my-campaign # fresh transcript, existing campaign
```

The root `package.json` manifest packages the canonical plugin plus the shared
Python and headless runtime contracts. The package exposes the canonical
`coc_capabilities`, `coc_discover`, and `coc_invoke` gateway tools through one
lazy, session-scoped MCP JSONL child. It also exposes the closed
`coc_dispatch_source_work` hierarchy and `coc_progressive_ocr` host bridge. It
never exposes a generic subagent prompt, model, tool, or workspace surface.
For the Pi main-Keeper profile, `coc_discover` omits
`progressive.claim_host_work`, `progressive.fulfill_host_work`,
`progressive.renew_host_work_leases`, and
`progressive.release_host_work_leases` from exact, domain, and catalog
discovery. Those operations remain canonical and exactly invocable by the
private lifecycle; this is a presentation boundary, not a second authorization
engine.

### Tool output (TUI fold)

By default, each COC tool row shows a **one-line summary** (operation, status,
counts). Full JSON is folded. Press **Ctrl+O** (`app.tools.expand`) to expand or
collapse all tool output — same binding as built-in bash/read tools. Without
these compact renderers Pi would dump every `coc_invoke` payload inline.

### Table HUD footer (game status, not coding chrome)

In interactive TUI sessions the package **replaces** Pi’s default footer
(path / tokens / model) with a **player-safe** table strip:

- investigator name, occupation, HP / SAN / luck
- in-fiction time and place
- item count and discovered-clue count

| Command / key | Action |
| --- | --- |
| `/hud bind <campaign_id>` | Bind the active campaign (also auto-binds from `coc_invoke` `campaign`) |
| `/hud` or `/hud refresh` | Reload snapshot from `scene.context` + inventory + clues |
| `/hud sheet` / `time` / `inv` / `clues` | Keyboard detail panel (Esc to close) |
| `Ctrl+Shift+H` | Detail menu |
| `/hud off` | Restore Pi’s coding footer |
| `/hud on` | Use the COC game footer again |

Undiscovered clues and keeper-only fields never appear on this strip.

### Turn timing telemetry (`/timing`)

`{this-repo}/.pi/coc-agent/telemetry/turns.jsonl` is a machine-first, fine-grained log
for offline latency and context analysis (schema v5, one JSON line per
record). A `record:"session"` header opens each session (label, mode, agent dir). Every
`record:"turn"` line reconstructs the full timeline of one KP turn:

- every step carries dual clocks — `at` (epoch ms) plus `offset_ms`
  (monotonic, turn-relative) — so gaps between steps are derivable;
- model calls record the whole phase chain
  `before_provider_request -> after_provider_response -> message_start ->
  first delta -> (thinking stream) -> first non-thinking -> (generation) ->
  last delta -> message_end`, yielding `network_ms`/`ttft_ms`/`thinking_ms`/
  `gen_ms`/`stream_ms`/`call_ms`, delta counts, thinking/text char volumes,
  provider `usage` (input/output/cache read+write/cost), and stop reason.
  Provider request/response events depend on the host stream path; when a
  host does not emit them the request phases are `null` and `call_ms` falls
  back to the stream span;
- tool calls record `toolCallId`, `tool_name`, `coc_invoke.<operation>`
  label, duration (extension execute -> result; MCP child + toolbox runtime
  inside), and args/result sizes. MCP/python internals are not visible at
  this layer;
- turn totals: wall/model/tool/other buckets, summed tokens and cost,
  provider context usage (`getContextUsage`), prompt excerpt, and Pi
  `turnIndex` stamping per model round-trip;
- `context_probe` on each model step plus a per-turn roll-up: model-visible
  context size by class (player / KP prose / thinking / tool arguments / tool
  results), how much a fold could still reclaim, and whether the prefix was
  `append_only` or `rewritten` — the prefix-cache baseline. Observation only;
  see `lib/context-probe.ts`;
- `context_fold` on each model step and per turn: standing epoch-fold state
  (epochs, folded results, chars reclaimed, pending pile, threshold);
- `request_prefix` on each model step plus a per-turn roll-up: the composition
  of the **provider request body itself**. Observation only; see
  `lib/request-prefix-probe.ts` and the section below.

### Request prefix probe

`context_probe` measures the message array. The provider bills for a request
body with four sections, and the message array is one of them. On the
`dirgraph-smoke-20260901` play session the first model call of a fresh process
scanned 717 chars / 180 `est_tokens` in `context_probe` while the provider
billed **33,000 tokens** for that same call; a mid-turn call read 39,967
`est_tokens` against 58,191 billed. The gap is where that session's largest
cost lived, and the message-array probe is structurally unable to see it.

`lib/request-prefix-probe.ts` reads pi's `before_provider_request` payload —
the assembled provider params, the one object that holds system prompt,
advertised tools and transcript at once — and records per model call:

| field | what it settles |
|---|---|
| `instructions_bytes` | system prompt as the provider received it, not reconstructed |
| `tools_count` / `tools_bytes` / `tools` | the advertised working set **including the first call of a session**, which the `coc-tool-working-set` audit entry cannot cover because it is emitted after that call |
| `tools_status` | `stable` / `changed` versus the previous call, next to that call's `usage.cache_read` on the same step |
| `tool_names_digest` vs `tools_digest` | separates a membership change from a reschema of the same names |
| `input_messages` / `input_bytes` | the transcript actually sent, post-fold |
| `other_bytes` | the residual — model id, sampling, reasoning config, tool_choice, cache directives |

It is an observation and nothing else: a `before_provider_request` handler that
returns a value *replaces* the provider payload, so this one returns nothing;
only byte counts, tool names and digests are recorded, never prompt text,
message content or schema bodies; and a payload it cannot serialize yields
`null` rather than throwing. Nothing it produces reaches the model.

### Epoch context fold

Closed-turn tool results are 85–91% of the model-visible context on real
sessions, while KP prose is under 2%. Once `turn.finalize` closes a turn its
tool payloads are dead weight — the next turn's authority comes from `state.*`,
scene projections, and `session.resume`, not from rereading old transcript
JSON. `lib/context-fold.ts` collapses them to stubs on pi's `context` hook.

The shape is dictated by prefix caching (automatic, no pinnable breakpoints,
~96% hit rate here): a rewrite inside the prefix invalidates everything after
it, so this is an **epoch fold**, not a sliding window.

- Folds closed-turn **tool results** (to stubs) and closed-turn **reasoning**
  (dropped outright). Providers that return `reasoning_content` get every
  earlier trace echoed back on each later call — measured at 59.5% of a live
  DeepSeek context — so it goes stale exactly like a tool payload. Player
  input, KP prose, and tool call arguments are never touched.
- Folds only on the first model call of a turn, never mid-turn; the running
  turn's own results and reasoning are always intact.
- Folds only when the unfolded closed-turn pile crosses the threshold, so most
  turns are pure appends and keep hitting cache.
- Each stub is frozen under its `toolCallId`, and reasoning is dropped by a
  monotonic timestamp watermark: identical bytes on every later call, and
  folding never reverses. Results under `MIN_FOLD_CHARS` (400) are
  left alone because a stub costs more than they do.
- The stub is structural — tool, canonical operation, ok/error,
  `full_result_sha256`, folded size, and a re-read note. It never summarizes
  the payload. Host-side `details` is untouched, so the TUI still renders the
  original call.

| env | default | effect |
|---|---|---|
| `PI_COC_CONTEXT_FOLD` | on | `off` / `0` / `false` disables folding |
| `PI_COC_CONTEXT_FOLD_TOKENS` | `20000` | est_tokens of closed-turn pile that opens a fold |
| `PI_COC_REQUEST_PREFIX_PROBE` | on | `off` / `0` / `false` stops measuring the provider request body |

Size a threshold against recorded play before changing it — the replay runs the
shipped fold, so its predictions are the live policy:

```bash
node --experimental-strip-types plugins/coc-keeper/pi/bin/coc-context-replay.mjs \
  .pi/coc-agent/sessions/<dir>/<session>.jsonl --thresholds 10000,20000,40000
```

Human surfaces over the same log: a one-line summary after each settled turn
(`/timing off|on` toggles only the line; the log is always written) and the
`/timing` detail panel. Headless/RPC sessions log without the line.

When a gateway call fails, the host-visible error must include the toolbox
`error.code` and `error.message` (for example
`turn_pending_finalization` / finalize-before-next-mutation). Opaque
`canonical coc_invoke operation failed` strings without a code are a
regression: the live KP cannot repair a stuck turn from them.

## Workspace and session

Use `pi-coc` so the process cwd is this repository root (the campaign
workspace) unless `COC_WORKSPACE` is set. The web/Electron UI is an attached
player surface of this same host: it launches `pi-coc --mode rpc --campaign
<id>` with `COC_WORKSPACE` pointing at the player workspace and
`COC_PI_ATTACHED_UI=1` so a fresh desktop auto-opens the table. The adapter
passes that exact `ctx.cwd` as `COC_PROJECT_ROOT`, sets
`COC_HOST=pi`, and binds the MCP child to the current Pi session id. No child
starts merely by loading the package. COC sessions live under
`{this-repo}/.pi/coc-agent/sessions`, separate from coding sessions.

`--session-id` / `PI_COC_SESSION_ID` affects only that Pi session storage.
Existing-campaign continuation is armed only by the distinct explicit
`--campaign <campaign_id>` / `PI_COC_CAMPAIGN_ID` selector.

## Progressive OCR

Progressive OCR remains an external host capability. Configure an absolute
executable or script path:

```bash
export COC_PROGRESSIVE_OCR_COMMAND=/absolute/path/to/progressive_ocr.py
```

For a Python script, optionally set `COC_PROGRESSIVE_OCR_PYTHON`; otherwise the
adapter uses `python`. Copy `secrets.env.example` to a private user-local file,
normally `~/.config/coc-keeper/secrets.env`, set directory mode `0700` and file
mode `0600`, then add the token value. Set `COC_KEEPER_ENV_FILE` to an absolute
alternative path when needed. Only the OCR child receives `BAIDUOCR_TOKEN`;
the MCP and Pi source-agent children explicitly have it removed.

### Built-in baiduocr adapter

A bundled adapter at `bin/coc-ocr-adapter.py` bridges the
`coc_progressive_ocr` contract (`status`/`fast`/`enhance`/`export`) to the
existing `~/.codex/skills/baiduocr/scripts/baiduocr.py` CLI. To use it:

```bash
export COC_PROGRESSIVE_OCR_COMMAND=<repo>/plugins/coc-keeper/pi/bin/coc-ocr-adapter.py
```

The adapter translates `fast <pdf> --corpus <dir>` into `baiduocr.py <pdf>
--output-dir <dir>`, and returns exactly one strict JSON object on stdout.
`fast` reports only external OCR corpus facts; it never creates, validates, or
mutates `manifest.json`, assigns PDF page indices, invents `review_state` or
`parse_confidence`, or truncates the corpus. Those Markdown files are not a
validated source bundle; `fast` does not form a validated source bundle. An
external PDF skill/contract producer must review the evidence and deliver the
canonical manifest; repository code may then validate/reformat that handoff.
`status` inspects the corpus directory; `enhance` returns cached documents
(baiduocr doesn't support per-page re-extraction via CLI); `export`
concatenates corpus markdown into a single output file.

The OCR tool accepts only `status`, `fast`, `enhance`, and `export`. It validates
paths and structured JSON results, but deliberately does not reject ordinary
OCR wording, column-order, or layout noise.

## External PDF scope locator

Pi has no built-in PDF/document tool. To enable the hidden bounded locator,
configure a separate absolute external PDF-skill producer:

```bash
chmod +x <repo>/plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter
export COC_PI_SOURCE_SCOPE_LOCATOR_COMMAND=<repo>/plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter
```

The bundled thin adapter starts one isolated, logged-in Pi child in one-shot
`pi -p` mode and loads the installed external `pdf` skill explicitly. Override
the Pi executable with `COC_PI_COMMAND` and the skill directory or `SKILL.md`
path with `COC_PI_PDF_SKILL` when needed. The locator/full-parse PDF-skill
child defaults to `xai/grok-4.6` with `thinking low` (overridable via
`COC_PI_PDF_MODEL`) and receives only the `read,bash,write` tool allowlist.
Sessions, implicit skills/extensions, prompt
templates, and context files stay disabled. The main KP receives no PDF/image
tools or child built-ins. xAI Grok 4.6 supports `low`, `medium`, `high`, and
`xhigh`; true `off` is unsupported, so Pi would clamp a direct `off` request to
`low`. Using `low` with `hideThinkingBlock: true` keeps reasoning summaries out
of the table UI to reduce spoiler exposure, but it does not disable provider
reasoning or its latency.

Optional external native router (locator + full-parse batch): the router is
a thin Node subprocess over the Firecrawl `@firecrawl/pdf-inspector` binding
(1.12.0). It is deployed **outside the repo** at
`$HOME/.pi/coc-tools/pdf-inspector/` (the AGENTS PDF contract keeps parsers
out of the repository); the `pi-coc` launcher exports
`COC_PI_PDF_INSPECTOR_COMMAND` pointing at
`$HOME/.pi/coc-tools/pdf-inspector/coc-pi-pdf-inspector-router` by default
and a user-set value always wins. Reinstall/upgrade the binding with
`cd ~/.pi/coc-tools/pdf-inspector && npm install --save-exact
@firecrawl/pdf-inspector@1.12.0` (needs Node ≥ 20; verified with Node
22.19.0 / npm 10.9.3). `COC_PI_PDF_INSPECTOR_BINDING` (optional absolute
path) overrides the binding module for alternate installs and hermetic
tests.

The adapter never opens or parses the PDF; it only subprocesses that command
with a versioned JSON request on stdin and expects a versioned JSON result
on stdout. The router implements two live modes: `locator_first_bundle`
(native-extract the requested window, default pages 0-4) and
`full_parse_batch` (native-extract `missing_pdf_indices`). Opening source
review no longer calls the router's `opening_review` page-window mode. On
`status=ok` the command must have written a legal schema-v1 source bundle
(`producer: codex-pdf-skill`) at the task's absolute `source_bundle_path`.
Any requested page that needs OCR yields `status=fallback reason=needs_ocr`
— the router never OCRs. The adapter still runs `load_host_bundle` (and the
existing register/fulfill half-chain for full-parse) before adopting the
result. Any unset/invalid command, non-zero exit, timeout, bad JSON,
`fallback` / `needs_ocr` / `unsupported` / `failed`, path drift, or illegal
bundle falls through to the existing Pi PDF-skill path (locator/full-parse).

Opening review is split into materialization plus one text-model child and
no longer depends on the visual Grok/PDF-skill path or a locator page
window: (1) the adapter copies the bound source's already-parsed Markdown
pages into the reviewed output directory; (2) facts + module_init_l0
extraction runs a separate text-model `pi -p` child that reads every
materialized Markdown page and semantically selects
`selected_opening_pdf_indices` (contiguous 1..3) plus
`fact_evidence_pdf_indices` (1..8). Its model defaults to
`deepseek/deepseek-v4-flash` (pi's built-in deepseek catalog ships only
v4-flash/v4-pro, so `deepseek/deepseek-chat` is not resolvable and falls
back to unauthenticated openrouter) and is overridable via
`COC_PI_OPENING_MODEL` (Grok remains an explicit option). The adapter
forwards `DEEPSEEK_API_KEY` (and `DEEPSEEK_BASE_URL` for a custom provider
override) to that child's environment; the extractor tolerates fenced/prose
stdout with one retry and fails as `extractor_invalid_output` rather than a
bare JSON error. The bind + `_apply_opening_source_review_fulfillment` seam
and the transport contract `coc.pi-opening-source-review-transport-result.v1`
are unchanged.

The adapter contains no PDF parser, renderer, OCR, page-text scanner, queue, or
fulfillment engine.

Pi runs `--capabilities` before every closed task, then `--run` with one bounded
JSON packet. The producer may only locate, render, visually review, and write
the exact canonical 1..3-page bundle. The Pi extension validates its versioned
receipt and uses the bundle for the raw-PDF first-bundle bind retry; the
main Keeper never receives PDF bytes, source pages, bash/read/write tools, or
raw producer output. Module text for play comes from the S1 full-parse lane
and steward deliveries.

`coc_source_scope_locator_v1` remains statically unavailable because
`coc_capabilities` cannot prove a process-local command preflight. The hidden
runtime gate is authoritative: a missing, relative, incompatible, timed-out, or
malformed producer fails closed without source or campaign mutation. Promotion
to `experimental` requires a provider-authenticated end-to-end lifecycle probe.

## Source hierarchy

The only nested hierarchy is:

```text
main Keeper (depth 0) -> source coordinator (depth 1) -> source-pack leaves (depth 2)
```

The published manifest loads only the main extension. It starts the coordinator
with Pi 0.81.1's explicit `--no-extensions --no-skills --no-prompt-templates
--no-context-files --no-builtin-tools` isolation flags, a role-fixed `--tools`
allowlist, a private extension, explicit canonical skill directories, and a
one-use capability pipe; that coordinator has
one deterministic packet-bound lifecycle tool, not generic invoke/discover or
dispatch tools. The lifecycle tool claims once, launches at most four exact
repository-produced Pi leaf wrappers, validates their exact packet/work-group/
job bindings, and exact-forwards each result once. Each leaf is started with a
different private extension and `--no-tools`. Its async factory fail-closes
before provider use while preloading the exact cached refs, then injects one
immutable `coc.pi-leaf-evidence-context.v1` custom user message through Pi's
transient `context` hook. Raw pages are absent from Pi session entries, agent
events, leaf stdout, and coordinator input.
Neither private role can be selected through public role/depth environment
variables. Children inherit the exact parent provider/model and thinking
level, use ephemeral sessions, receive no campaign transcript, and are never
retried for the same task.

Coordinator leaves settle with indexed `Promise.allSettled`: one rejected or
invalid leaf cannot suppress a valid sibling. Canonical fulfillment stops only
the rejected packet's remaining rows and continues independent packets. The
coordinator emits one deterministic `coc.source-coordinator-result.v1` tool
receipt. The process terminal JSON must be deeply identical to that exact tool
receipt; an assistant-authored replacement, impossible task counts, or a
single-run `design_issue` claim is rejected. Leaf activation/process,
non-bare framing, and contract/binding failures retain distinct structured
failure classes through sibling settlement. The public extension records it
once and queues it for the next natural parent
turn with `triggerTurn=false`. Failed leases remain on the canonical expiry and
recovery path; Pi creates no release ledger or fake fulfillment.

Lifecycle completion and parent notification are separate evidence. A failed
append or next-turn message does not erase a validated completed receipt;
duplicate diagnostics retain the receipt plus a bounded delivered/partial/
failed notification status. Session shutdown marks the manager closing before
termination, rejects new dispatch, and clears only the exact owned child.
Canonical owner-checked lease renewal and graceful release operations now exist
in the shared toolbox. Pi heartbeat/shutdown consumption remains pending until
the private lifecycle integration is component-tested; abrupt termination
continues to recover through bounded lease TTL. The main KP must never discover
or invoke claim, fulfill, renew, or release itself.

The repository-root artifact carries the frozen Python project and shared
runtime. In a clean root-package installation, `mcp/launch` runs that packaged
project with `uv run --project <package-root> --frozen`; the opened campaign
directory remains the MCP working directory. The compiler files and resolution
path are package-tested, but no provider-authenticated cold semantic compile is
claimed by component tests.

Pi source coordination remains capability-enabled as `experimental`. The
recorded isolated Pi 0.81.1 claim -> nested leaves -> exact fulfillment probe
used `openai/gpt-5.6-luna`
(`tests/pi/real-lifecycle-probe.mjs`, engineering-probe only). It is not
provider evidence for the configured `xai/grok-4.6` Keeper. Typed-thinking
framing has component coverage. The repository `pi-coc` wrapper forwards an
explicit `--thinking off` unchanged and now checks the selected model metadata
before Pi starts. Pi 0.81.1's bundled `xai/grok-4.5` model declares
`thinkingLevelMap.off=null`; without this guard Pi clamps that unsupported
request to `low` and may stream typed thinking blocks. `pi-coc` therefore
refuses that combination instead of silently downgrading it. True Grok
thinking-off is an upstream model/provider capability boundary, not a
repository adapter mode, and must not be claimed from the launch argument
alone. The bundled bootstrap and PDF adapter therefore deliberately use
`--thinking low` with `hideThinkingBlock: true`; hiding thought summaries from
the table UI reduces spoiler exposure but does not disable provider reasoning
or its latency. Grok promotion remains
pending the lead's fresh provider-authenticated lifecycle run. Neither that
future probe nor the existing component suite alone establishes product parity
or window-equivalent play acceptance. The dispatch tool still fails closed
whenever the capability flag is absent; there is no production environment
bypass.

POSIX child shutdown targets the private process group with SIGTERM followed by
a bounded SIGKILL escalation. Windows uses direct-child termination and remains
untested for descendant-tree containment, so Windows lifecycle support stays
fail-closed/unadvertised.

## Host-only parallel debug experiments

During an idle `play` session, `/system debug` is intercepted by the host before
ordinary Keeper-only `/system` delivery. It never becomes model or player input.

```text
/system debug run {"player_input":"我检查伤口。","lanes":[{"id":"production-1","profile":"production"}],"record":["rules","director","timing"],"concurrency":1,"timeout_seconds":180}
/system debug status current
/system debug cancel current
/system debug report current
```

Use `rules-director-single-draft` for the narrow graph-card surface. Use
`rules-all-single-draft` when a focused debug matrix must retain the full
production rules/subsystem surface but should draft/finalize once without the
text-review loop. Neither profile changes the production default.

The host seals the latest finalized and delivery-confirmed `tl-main` tip, gives
each lane an independent campaign repo/worktree and private Pi home, requires
`session.resume` first, sends the natural player action once, and applies one
absolute maximum-180-second watchdog. Debug evidence is selective, redacted,
retained under `<workspace>/.coc/debug/runs/`, and never enters production
campaign Git. See [the DebugExperiment specification](../../../docs/specs/pi-coc-debug-experiment.md).
One run accepts 1–20 semantic lanes. Explicit `concurrency` is limited to
1–`min(20, lane count)`; when omitted it remains `min(2, lane count)`.
