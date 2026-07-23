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

Install the npm/Pi package from the repository root. The manifest packages the
canonical plugin plus the shared Python and headless runtime contracts:

```bash
pi install /absolute/path/to/chatrpgv4
```

The package exposes the canonical `coc_capabilities`, `coc_discover`, and
`coc_invoke` gateway tools through one lazy, session-scoped MCP JSONL child. It
also exposes the closed `coc_dispatch_source_work` hierarchy and
`coc_progressive_ocr` host bridge. It never exposes a generic subagent prompt,
model, tool, or workspace surface.

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

When a gateway call fails, the host-visible error must include the toolbox
`error.code` and `error.message` (for example
`turn_pending_finalization` / finalize-before-next-mutation). Opaque
`canonical coc_invoke operation failed` strings without a code are a
regression: the live KP cannot repair a stuck turn from them.

## Workspace and session

Open Pi in the repository/workspace that owns the campaign. The adapter passes
that exact `ctx.cwd` as `COC_PROJECT_ROOT`, sets `COC_HOST=pi`, and binds the MCP
child to the current Pi session id. No child starts merely by loading the
package.

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

The OCR tool accepts only `status`, `fast`, `enhance`, and `export`. It validates
paths and structured JSON results, but deliberately does not reject ordinary
OCR wording, column-order, or layout noise.

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

The repository-root artifact carries the frozen Python project and shared
runtime. In a clean root-package installation, `mcp/launch` runs that packaged
project with `uv run --project <package-root> --frozen`; the opened campaign
directory remains the MCP working directory. The compiler files and resolution
path are package-tested, but no provider-authenticated cold semantic compile is
claimed by component tests.

Pi source coordination is capability-enabled (`experimental`) after a real
isolated Pi 0.81.1 claim -> nested leaves -> exact fulfillment lifecycle probe
succeeded (`tests/pi/real-lifecycle-probe.mjs`, an engineering-probe only).
That probe, like the package/component tests, does not establish Pi product
parity or window-equivalent play acceptance. The dispatch tool still fails
closed whenever the capability flag is absent. Component probes inject fake
transports through unshipped tests; there is no production environment bypass.

POSIX child shutdown targets the private process group with SIGTERM followed by
a bounded SIGKILL escalation. Windows uses direct-child termination and remains
untested for descendant-tree containment, so Windows lifecycle support stays
fail-closed/unadvertised.
