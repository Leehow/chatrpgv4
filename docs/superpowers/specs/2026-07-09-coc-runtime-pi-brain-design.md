# COC Runtime + Pi Brain Design

**Date:** 2026-07-09  
**Status:** Approved (implemented)  
**Scope:** Add an open, headless COC agent runtime with a project-level brain switch (`debug` | `pi`), while keeping `plugins/coc-keeper/` as the single canonical content track.

## Goal

Ship an open-source **agent interface**, not a finished frontend:

```text
programmer / host sends player input
  -> runtime returns structured events
  -> any frontend or agent host can render them
```

The runtime must preserve “developer-grade” agent intelligence (tools, skills, scripts, persistent `.coc/` state) while allowing two brains behind one protocol:

- `debug`: Cursor / Codex host LLM acts as Keeper (fast iteration inside IDE)
- `pi`: embedded Pi Coding Agent acts as Keeper (product-faithful path; IDE hosts only forward)

Both brains share the same content track, campaign state, and event schema.

## Decisions Locked In

| Topic | Decision |
|---|---|
| Product shape | Open headless agent API; others build frontends |
| Primary architecture | Shared turn engine + thin host adapters |
| Brain switch | Project-level only (`.coc/runtime.json`) |
| Default brain | `debug` when config missing |
| Content track | Single-track: `plugins/coc-keeper/` only |
| Search / Exa | Out of scope; not a runtime dependency |
| V1 transport | In-process SDK first; HTTP/SSE later |
| Session override of brain | No (not in V1) |

## Non-Goals

- Do not build a full Web/desktop frontend in V1.
- Do not bind Exa or any web-search vendor into this project.
- Do not create `plugins/coc-keeper-pi/` or any parallel plugin tree.
- Do not make Codex marketplace point at `runtime/`; marketplace stays on `plugins/coc-keeper/`.
- Do not add session-level brain override in V1.
- Do not require HTTP/SSE for V1.
- Do not expose raw LLM transcripts or arbitrary repo write/bash as the public API surface.
- Do not move Codex-only capabilities (e.g. investigator portrait generation) into Pi; keep host gates.

## Architecture

```text
┌─────────────────────────────────────────────┐
│  Hosts                                       │
│  Cursor · Codex · third-party frontends      │
└──────────────────┬──────────────────────────┘
                   │ open API
                   │ create_session / send / get_state / close
                   ▼
┌─────────────────────────────────────────────┐
│  runtime/                                    │
│  - protocol (Event, PublicState)             │
│  - engine (session, turn orchestration)      │
│  - adapters/debug · adapters/pi              │
│  - sdk                                       │
│  reads .coc/runtime.json  { brain }          │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
  brain=debug            brain=pi
  host LLM as KP         embedded Pi as KP
        │                     │
        └──────────┬──────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  plugins/coc-keeper/  (canonical content)    │
│  skills · scripts · rules-json · protocols   │
│  + workspace .coc/ campaign state            │
└─────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| `plugins/coc-keeper/` | Skills, Python scripts, rules JSON, mode/memory/director protocols | Host transport, Pi embedding, public HTTP |
| `runtime/` | Event schema, session API, brain switch, debug/pi adapters | Duplicate skills/rules trees |
| `.coc/` | Campaign saves, logs, `runtime.json` | Plugin source of truth |
| Host (Cursor/Codex) | Chat UX for debugging; optional thin client in `pi` mode | Second copy of keeper content |

## Project-Level Brain Switch

Path: `.coc/runtime.json`

```json
{
  "schema_version": 1,
  "brain": "debug"
}
```

Rules:

1. Only project-level config is authoritative in V1.
2. Missing file or missing `brain` → `"debug"`.
3. Valid values: `"debug"` | `"pi"`.
4. Changing the file takes effect on the next `create_session` / COC activation that reads config (document exact timing in implementation).
5. Switching brain does **not** create a new campaign; both modes read/write the same `.coc/` campaign state.
6. Whether `runtime.json` is gitignored is a repo preference; if committed, it declares the repo’s default brain.

### `brain: "debug"`

```text
Cursor/Codex chat
  -> load coc-keeper skills (current model)
  -> host LLM is Keeper
  -> call scripts / read-write .coc/
  -> emit the shared Event schema as faithfully as practical
```

Use for: editing skills, protocols, rules; fastest playtest loop.  
Limitation: observed intelligence is the host’s, not Pi’s.

### `brain: "pi"`

```text
Cursor/Codex / external client
  -> call runtime SDK only
  -> runtime starts or resumes embedded Pi session
  -> Pi loads the same coc-keeper skills + constrained tool surface
  -> returns the same Event schema
```

Use for: product-faithful acceptance; third-party frontend integration.  
Limitation: one extra hop while debugging.

### Pi tool surface (V1 intent)

Pi defaults to a coding agent. In COC `pi` mode:

- Do **not** expose unconstrained repo edit/write as the player-facing contract.
- Allow only tools needed for Keeper operation (run approved scripts, read rules/state, update `.coc/` through existing script APIs).
- Host-specific features remain gated; skip rather than reimplement.

## Open API Surface

Language-agnostic semantics for V1:

```text
create_session(workspace) -> session_id
send(session_id, player_input) -> events[] | AsyncIterator[Event]
get_state(session_id) -> PublicState
close_session(session_id)
```

Transport:

- V1: in-process SDK (Node and/or Python — choose in implementation plan; protocol is source of truth).
- Later: HTTP + SSE/WebSocket and/or stdio JSON-RPC wrapping the same semantics.

### Event

```json
{
  "type": "narration | speech | roll | state_patch | choice | spoiler_gate | system | error",
  "id": "evt_...",
  "ts": "...",
  "visibility": "player | keeper | system",
  "payload": {}
}
```

| type | Role |
|---|---|
| `narration` | Keeper narration |
| `speech` | NPC / investigator dialogue |
| `roll` | Check request or result (skill, difficulty, dice, success level) |
| `state_patch` | Public state deltas (HP, SAN, clues, scene, etc.) |
| `choice` | Player choices (including scenario onboarding) |
| `spoiler_gate` | Keeper-only info requiring confirmation |
| `system` | Mode / save / brain / session notices |
| `error` | Recoverable or fatal errors |

Hard rules:

1. Frontends must not infer game state by scanning free prose; use `state_patch` + `get_state()`.
2. Machine fields stay ASCII / stable enums; player-visible strings follow existing `play_language` / `localized_terms`.
3. `debug` and `pi` must emit the **same** schema. Debug may be imperfect at first, but schema compatibility is mandatory for cross-mode comparison.
4. Align with Semantic Matcher Constitution: no new keyword-based meaning extraction in runtime routing.

### PublicState

Player-safe snapshot sufficient to render UI without replaying the full event log (campaign id, scene, investigators’ public fields, known clues, pending choice if any, play language). Exact fields are fixed in the implementation plan against existing `.coc/` / player-view artifacts.

### Not in the public V1 API

- Raw model transcripts (optional separate debug channel later)
- Arbitrary shell / repo mutation for external clients
- Any search-provider integration
- Full frontend assets

## Repository Layout

```text
chatrpgv4/
├── plugins/coc-keeper/          # canonical content (unchanged role)
├── runtime/                     # new open agent interface
│   ├── README.md
│   ├── protocol/                # Event / PublicState / API semantics
│   ├── engine/                  # sessions, config load, turn orchestration
│   ├── adapters/
│   │   ├── debug/
│   │   └── pi/
│   └── sdk/
├── .coc/
│   └── runtime.json             # { "brain": "debug" | "pi" }
├── AGENTS.md                    # document runtime vs single-track law
└── docs/superpowers/specs/      # this document
```

`AGENTS.md` addition (intent):

- Shared keeper behavior still lives only in `plugins/coc-keeper/`.
- `runtime/` may host adapters and the open API, but must not fork skills/rules.
- Platform-specific capabilities stay explicitly gated; other hosts skip them.

## V1 Scope

**In:**

1. `.coc/runtime.json` project-level brain switch  
2. Stable Event / PublicState protocol docs + schemas  
3. SDK: `create_session` / `send` / `get_state` / `close_session`  
4. `debug` adapter path usable from Cursor/Codex play  
5. `pi` adapter: embedded Pi session over the same content + schema  
6. Smoke tests: same fixture input yields schema-valid events under both brains (narrative need not match verbatim)

**Out:**

- HTTP/SSE server  
- Production web UI  
- Exa / web search  
- Session-level brain override  
- Parallel plugin marketplace entries  
- Porting Codex-only imagegen into Pi  

## Implementation Order

1. Protocol + `runtime.json` loader  
2. Align `debug` path to emit events (enables IDE play immediately)  
3. Embed Pi adapter with constrained tools  
4. Optional later: HTTP/SSE wrapper for external frontends  

## Success Criteria

1. A third-party programmer can drive a turn via SDK without using Cursor/Codex UI.  
2. Flipping `.coc/runtime.json` between `debug` and `pi` does not require a second plugin tree or a new campaign.  
3. In `pi` mode, Cursor/Codex (or any thin client) observes Pi’s returned events, not a separate host-only narration path.  
4. No Exa or search-vendor dependency appears in runtime package metadata.  
5. Existing Codex plugin install path via `plugins/coc-keeper/` remains valid.  

## Open Questions For Implementation Plan

1. SDK primary language for V1: Python (closer to existing scripts) vs TypeScript (closer to Pi embedding)?  
2. Exact Pi package pin (`@earendil-works/pi-coding-agent` vs current upstream) and how skills are loaded from `plugins/coc-keeper/skills`.  
3. How strictly `debug` mode must structure host prose into events in the first milestone vs best-effort wrappers.  
4. Whether smoke tests compare event *types* only, or also selected stable fields (rolls, state_patch keys).  
