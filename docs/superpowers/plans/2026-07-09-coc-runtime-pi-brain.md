# COC Runtime + Pi Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实现进度对账（2026-07-10）：全部 Task 已落地提交。** 正文 checkbox
> 保留为历史执行模板；当前状态以 commit 对账为准：Task1 `3a9dd4d` +
> `8f91acc`（runtime config）· Task2 `a4ee30b`（Event + schema）· Task3
> `dd09c0c` + `b0ab3e6`（live-turn mapper + roll 结构守卫）· Task4
> `ee501fc`（PublicState）· Task5 `19366f6`（Python session SDK）· Task6
> `593f300` + `1c246f6`（Pi bridge + 失败上报）· Task7 `eaa5398`
>（single-track runtime 边界与 no-Exa 约束）。实现计划归档提交为 `546785a`。

**Goal:** Add an open headless COC agent runtime (`runtime/`) with a project-level `debug` | `pi` brain switch, shared Event/PublicState protocol, Python SDK, and a thin Pi adapter — without forking `plugins/coc-keeper/`.

**Architecture:** Python owns protocol, config, session SDK, and the `debug` path (map `run_live_turn` output → Events). `pi` mode shells out to a small Node adapter that embeds `@earendil-works/pi-coding-agent`, constrains tools, and returns the same Event JSON. Both brains read `.coc/runtime.json` and the same campaign state under `.coc/`.

**Tech Stack:** Python 3 stdlib + pytest; existing `plugins/coc-keeper/scripts/coc_live_turn_runner.py`; Node.js + `@earendil-works/pi-coding-agent` only under `runtime/adapters/pi/`.

## Global Constraints

- Canonical keeper content stays only in `plugins/coc-keeper/` (Single-Track Law). Do not create `plugins/coc-keeper-pi/`.
- `runtime/` may own adapters and the open API; it must not duplicate skills/rules trees.
- Do not add Exa or any web-search vendor dependency to this project.
- Brain switch is project-level only: `.coc/runtime.json` → `{ "schema_version": 1, "brain": "debug" | "pi" }`. Missing file/key → `debug`. No session override in V1.
- Machine fields ASCII / stable enums; no keyword-based semantic routing (Semantic Matcher Constitution).
- Codex marketplace continues to point only at `./plugins/coc-keeper`.
- Before finishing plugin-adjacent work, run:  
  `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider`
- Follow TDD: failing test → run → minimal impl → pass → commit.
- `.coc/` remains gitignored; tests use `tmp_path` workspaces.

### Locked answers to spec open questions

1. **SDK language V1:** Python (protocol + engine + public SDK). Node only for Pi embed bridge.
2. **Pi package:** `@earendil-works/pi-coding-agent` (pin in `runtime/adapters/pi/package.json`).
3. **Debug structuring:** V1 maps structured `run_live_turn` results → Events (deterministic). Host-LLM free prose is out of the SDK path; Cursor/Codex chat can keep using skills, and may call the SDK when present.
4. **Smoke comparison:** Assert Event `type` sets + selected stable fields (`roll.skill_key`, `state_patch` keys, `choice.id` when present). Do not require identical narration text across brains.

---

## File Structure

```text
runtime/
  README.md
  protocol/
    events.schema.json          # JSON Schema for Event
    public_state.schema.json    # JSON Schema for PublicState
    PROTOCOL.md                 # Human-readable API semantics
  engine/
    __init__.py
    config.py                   # load .coc/runtime.json
    events.py                   # Event builders + validation helpers
    public_state.py             # build PublicState from .coc campaign
    live_turn_mapper.py         # run_live_turn result → list[Event]
    session.py                  # Session store + create/send/get_state/close
  adapters/
    debug/
      __init__.py
      adapter.py                # brain=debug: live_turn + mapper
    pi/
      package.json              # @earendil-works/pi-coding-agent
      run_turn.mjs              # stdin JSON → stdout events JSON
      README.md
      adapter.py                # Python wrapper: subprocess node run_turn.mjs
  sdk/
    __init__.py
    api.py                      # create_session / send / get_state / close_session

tests/
  test_runtime_config.py
  test_runtime_events.py
  test_runtime_live_turn_mapper.py
  test_runtime_public_state.py
  test_runtime_sdk_debug.py
  test_runtime_pi_adapter_contract.py   # contract + skip-if-no-node smoke
  test_runtime_no_exa_dependency.py

AGENTS.md                       # Modify: runtime vs single-track note
docs/superpowers/specs/2026-07-09-coc-runtime-pi-brain-design.md  # Status → Approved
```

---

### Task 1: Runtime config loader (`brain` switch)

**Files:**
- Create: `runtime/engine/__init__.py`
- Create: `runtime/engine/config.py`
- Test: `tests/test_runtime_config.py`

**Interfaces:**
- Consumes: workspace `Path` containing `.coc/`
- Produces: `load_runtime_config(workspace: Path) -> dict` with at least `schema_version: int`, `brain: Literal["debug","pi"]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_runtime_config.py
import json
from pathlib import Path
import importlib.util


def _load():
    path = Path("runtime/engine/config.py")
    spec = importlib.util.spec_from_file_location("runtime_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_missing_runtime_json_defaults_to_debug(tmp_path):
    cfg = _load().load_runtime_config(tmp_path)
    assert cfg["brain"] == "debug"
    assert cfg["schema_version"] == 1


def test_reads_pi_brain_from_coc_runtime_json(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({
        "schema_version": 1,
        "brain": "pi",
    }))
    cfg = _load().load_runtime_config(tmp_path)
    assert cfg["brain"] == "pi"


def test_invalid_brain_raises(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({"brain": "codex"}))
    try:
        _load().load_runtime_config(tmp_path)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "brain" in str(exc).lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_config.py -q -p no:cacheprovider`  
Expected: FAIL (module / function missing)

- [ ] **Step 3: Write minimal implementation**

```python
# runtime/engine/__init__.py
"""COC open runtime engine package."""

# runtime/engine/config.py
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ALLOWED_BRAINS = frozenset({"debug", "pi"})


def load_runtime_config(workspace: Path | str) -> dict[str, Any]:
    root = Path(workspace)
    path = root / ".coc" / "runtime.json"
    if not path.exists():
        return {"schema_version": 1, "brain": "debug"}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("runtime.json must be a JSON object")
    brain = raw.get("brain", "debug")
    if brain not in ALLOWED_BRAINS:
        raise ValueError(f"invalid brain: {brain!r}; allowed={sorted(ALLOWED_BRAINS)}")
    schema_version = int(raw.get("schema_version", 1))
    return {"schema_version": schema_version, "brain": brain}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_config.py -q -p no:cacheprovider`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/__init__.py runtime/engine/config.py tests/test_runtime_config.py
git commit -m "$(cat <<'EOF'
feat(runtime): load project-level brain from .coc/runtime.json

EOF
)"
```

---

### Task 2: Event builders + JSON Schema

**Files:**
- Create: `runtime/protocol/events.schema.json`
- Create: `runtime/engine/events.py`
- Create: `runtime/protocol/PROTOCOL.md` (API semantics summary from the design spec)
- Test: `tests/test_runtime_events.py`

**Interfaces:**
- Consumes: none beyond stdlib
- Produces:
  - `EVENT_TYPES = ("narration","speech","roll","state_patch","choice","spoiler_gate","system","error")`
  - `make_event(type: str, payload: dict, *, visibility: str = "player", event_id: str | None = None) -> dict`
  - `validate_event(event: dict) -> None` (raises `ValueError` on bad shape)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_runtime_events.py
from pathlib import Path
import importlib.util
import json


def _load():
    path = Path("runtime/engine/events.py")
    spec = importlib.util.spec_from_file_location("runtime_events", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_make_event_has_required_envelope():
    ev = _load().make_event("narration", {"text": "雨还在下。"})
    assert ev["type"] == "narration"
    assert ev["visibility"] == "player"
    assert ev["id"].startswith("evt_")
    assert "ts" in ev
    assert ev["payload"]["text"] == "雨还在下。"
    _load().validate_event(ev)


def test_validate_event_rejects_unknown_type():
    bad = {
        "type": "fanfic",
        "id": "evt_x",
        "ts": "2026-07-09T00:00:00Z",
        "visibility": "player",
        "payload": {},
    }
    try:
        _load().validate_event(bad)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_events_schema_file_lists_all_types():
    schema = json.loads(Path("runtime/protocol/events.schema.json").read_text())
    types = schema["properties"]["type"]["enum"]
    assert set(types) == {
        "narration", "speech", "roll", "state_patch",
        "choice", "spoiler_gate", "system", "error",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_events.py -q -p no:cacheprovider`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `runtime/protocol/events.schema.json` with `type` enum matching the eight event types, required `["type","id","ts","visibility","payload"]`, `visibility` enum `["player","keeper","system"]`.

```python
# runtime/engine/events.py
from __future__ import annotations

import time
import uuid
from typing import Any

EVENT_TYPES = (
    "narration", "speech", "roll", "state_patch",
    "choice", "spoiler_gate", "system", "error",
)
VISIBILITIES = ("player", "keeper", "system")


def make_event(
    type: str,
    payload: dict[str, Any],
    *,
    visibility: str = "player",
    event_id: str | None = None,
) -> dict[str, Any]:
    if type not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {type!r}")
    if visibility not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {visibility!r}")
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    event = {
        "type": type,
        "id": event_id or f"evt_{uuid.uuid4().hex[:12]}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "visibility": visibility,
        "payload": payload,
    }
    validate_event(event)
    return event


def validate_event(event: dict[str, Any]) -> None:
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    for key in ("type", "id", "ts", "visibility", "payload"):
        if key not in event:
            raise ValueError(f"event missing {key}")
    if event["type"] not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {event['type']!r}")
    if event["visibility"] not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {event['visibility']!r}")
    if not isinstance(event["payload"], dict):
        raise ValueError("payload must be an object")
```

Also write `runtime/protocol/PROTOCOL.md` summarizing `create_session` / `send` / `get_state` / `close_session` and the event table from the design spec (no Exa, project-level brain only).

- [ ] **Step 4: Run tests**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_events.py -q -p no:cacheprovider`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/protocol/events.schema.json runtime/protocol/PROTOCOL.md runtime/engine/events.py tests/test_runtime_events.py
git commit -m "$(cat <<'EOF'
feat(runtime): add Event envelope helpers and JSON Schema

EOF
)"
```

---

### Task 3: Map `run_live_turn` → Events (`debug` core)

**Files:**
- Create: `runtime/engine/live_turn_mapper.py`
- Create: `runtime/adapters/debug/__init__.py`
- Create: `runtime/adapters/debug/adapter.py`
- Test: `tests/test_runtime_live_turn_mapper.py`

**Interfaces:**
- Consumes: `run_live_turn(...)` result dict from `plugins/coc-keeper/scripts/coc_live_turn_runner.py`
- Produces: `map_live_turn_result(result: dict) -> list[dict]` (validated Events)
- Produces: `debug_send_turn(workspace, campaign_dir, character_path, investigator_id, player_text, **kwargs) -> list[dict]`

Mapping rules (V1):

| Source | Event |
|---|---|
| each turn's `choice_frame` with options | `choice` |
| each turn's rule / roll records if present under turn keys used by live runner | `roll` |
| `result["final_state"]` + applied `state_patch` | `state_patch` |
| `stop_actionability.immediate_handles` | `system` with `kind=stop_actionability` |
| `auto_advance.stop_reason` | `system` with `kind=stop_reason` |
| narrative directives text fields if present | `narration` (optional; skip if absent) |

Do **not** invent rolls from prose. Only emit `roll` when structured roll data exists on the turn object.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_runtime_live_turn_mapper.py
from pathlib import Path
import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_maps_choice_frame_and_stop_reason():
    mapper = _load("live_turn_mapper", "runtime/engine/live_turn_mapper.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")
    result = {
        "schema_version": 1,
        "turns": [{
            "decision_id": "turn-001",
            "choice_frame": {
                "id": "onboarding",
                "prompt": "你有现成的剧本吗？",
                "options": [
                    {"id": "import", "label": "我有剧本"},
                    {"id": "starter", "label": "新手开玩"},
                ],
            },
        }],
        "auto_advance": {"stop_reason": "awaiting_player_input", "turns_run": 1},
        "final_state": {"active_scene": "scene-1", "tension": "low", "turn_number": 1},
        "state_patch": {"applied": False},
        "stop_actionability": {"immediate_handles": [{"id": "look-around"}], "must_surface_handles": True},
    }
    events = mapper.map_live_turn_result(result)
    for ev in events:
        events_mod.validate_event(ev)
    types = [e["type"] for e in events]
    assert "choice" in types
    assert "state_patch" in types
    assert "system" in types
    choice = next(e for e in events if e["type"] == "choice")
    assert choice["payload"]["id"] == "onboarding"
    assert len(choice["payload"]["options"]) == 2
```

Reuse / adapt the campaign fixture pattern from `tests/test_live_turn_runner.py::_build_live_campaign` for an integration-style test that calls `debug_send_turn` only if the mapper unit test is green and a second test is added in the same file:

```python
def test_debug_adapter_runs_live_turn(tmp_path):
    # Build minimal campaign like test_live_turn_runner._build_live_campaign
    # Then:
    # events = debug_adapter.debug_send_turn(...)
    # assert all validate_event; assert len(events) >= 1
```

Copy the fixture helper into the test file (do not import from another test module). Keep the player text simple (`"我环顾四周。"`).

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_live_turn_mapper.py -q -p no:cacheprovider`  
Expected: FAIL

- [ ] **Step 3: Implement mapper + debug adapter**

`live_turn_mapper.map_live_turn_result` builds events via `make_event`.  
`adapters/debug/adapter.py` loads `coc_live_turn_runner` the same way tests do (`importlib` from `plugins/coc-keeper/scripts/coc_live_turn_runner.py`), calls `run_live_turn`, then maps.

- [ ] **Step 4: Run tests**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_runtime_live_turn_mapper.py -q -p no:cacheprovider`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/live_turn_mapper.py runtime/adapters/debug/__init__.py runtime/adapters/debug/adapter.py tests/test_runtime_live_turn_mapper.py
git commit -m "$(cat <<'EOF'
feat(runtime): map live_turn results to Event stream for debug brain

EOF
)"
```

---

### Task 4: PublicState builder

**Files:**
- Create: `runtime/protocol/public_state.schema.json`
- Create: `runtime/engine/public_state.py`
- Test: `tests/test_runtime_public_state.py`

**Interfaces:**
- Consumes: `workspace: Path`, `campaign_id: str`
- Produces: `build_public_state(workspace: Path, campaign_id: str) -> dict` with keys:
  - `schema_version`, `campaign_id`, `play_language`, `active_scene_id`, `tension_level`, `turn_number`, `discovered_clue_ids`, `investigators` (list of `{id, current_hp, current_san, current_mp, conditions}`), `brain` (from config), `pending_choice` (optional / null)

Read from existing paths under `.coc/campaigns/<id>/save/` (`world-state.json`, `pacing-state.json`, `investigator-state/*.json`) and campaign metadata if present. Missing files → safe empty defaults, not crash.

- [ ] **Step 1: Write failing tests** for a tmp campaign with world/pacing/investigator files; assert HP/SAN and `active_scene_id` round-trip; assert `brain` reflects `runtime.json`.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `build_public_state`**

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add runtime/protocol/public_state.schema.json runtime/engine/public_state.py tests/test_runtime_public_state.py
git commit -m "$(cat <<'EOF'
feat(runtime): build player-safe PublicState snapshots

EOF
)"
```

---

### Task 5: Session SDK (`create_session` / `send` / `get_state` / `close`)

**Files:**
- Create: `runtime/sdk/__init__.py`
- Create: `runtime/sdk/api.py`
- Create: `runtime/engine/session.py`
- Create: `runtime/README.md`
- Test: `tests/test_runtime_sdk_debug.py`

**Interfaces:**
- Produces:

```python
def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str: ...

def send(session_id: str, player_input: str) -> list[dict]: ...

def get_state(session_id: str) -> dict: ...

def close_session(session_id: str) -> None: ...
```

Session record (in-memory process dict is fine for V1):  
`{session_id, workspace, campaign_id, investigator_id, character_path, brain_at_create}`  

**Brain binding:** read `load_runtime_config(workspace)` at `create_session` and store `brain_at_create`. Later changes to `runtime.json` do **not** affect an open session (documents the “next create_session” rule from the spec).

`send` dispatch:
- if `brain_at_create == "debug"` → `debug_send_turn`
- if `brain_at_create == "pi"` → `pi` adapter (Task 6); until Task 6 lands, `send` may raise `NotImplementedError` with message `pi brain not wired` — but Task 5 tests only cover `debug`.

Resolve `campaign_dir = workspace / ".coc" / "campaigns" / campaign_id`.  
Default `character_path = workspace / ".coc" / "investigators" / investigator_id / "character.json"` when omitted.

- [ ] **Step 1: Write failing SDK test** using tmp `.coc` campaign + `brain=debug`; `create_session` → `send` → validate events → `get_state` → `close_session`; second `send` after close raises.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement session store + sdk/api.py**

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Write `runtime/README.md`** with install-free usage example:

```python
from runtime.sdk.api import create_session, send, get_state, close_session

sid = create_session("/path/to/workspace", campaign_id="live", investigator_id="inv1")
events = send(sid, "我打开抽屉。")
state = get_state(sid)
close_session(sid)
```

- [ ] **Step 6: Commit**

```bash
git add runtime/sdk/__init__.py runtime/sdk/api.py runtime/engine/session.py runtime/README.md tests/test_runtime_sdk_debug.py
git commit -m "$(cat <<'EOF'
feat(runtime): add Python session SDK for debug brain turns

EOF
)"
```

---

### Task 6: Pi adapter (Node bridge + Python wrapper)

**Files:**
- Create: `runtime/adapters/pi/package.json`
- Create: `runtime/adapters/pi/run_turn.mjs`
- Create: `runtime/adapters/pi/README.md`
- Create: `runtime/adapters/pi/adapter.py`
- Test: `tests/test_runtime_pi_adapter_contract.py`

**Interfaces:**
- Python: `pi_send_turn(request: dict) -> list[dict]` where request includes `workspace`, `campaign_id`, `investigator_id`, `character_path`, `player_text`
- Node `run_turn.mjs`: read one JSON object from stdin; write one JSON object to stdout: `{ "ok": true, "events": [ ... ] }` or `{ "ok": false, "error": "..." }`

**V1 Pi behavior (constrained, product-faithful enough):**

1. Start / reuse is **per process invocation** in V1 (stateless subprocess). Session continuity lives in `.coc/` + Python session store, not Pi’s own session files.
2. System prompt: “You are the COC Keeper runtime brain. Prefer calling the provided `coc_live_turn` tool. Return only structured results via the tool; do not invent rule math.”
3. Register **one** custom tool `coc_live_turn` that runs the same Python debug path (`debug_send_turn` / live_turn mapper) via `python3 -c` or a small `runtime/adapters/pi/call_debug.py` helper, and returns the Event list.
4. Built-in coding tools: pass an allowlist that **excludes** unconstrained `edit`/`write` of the repo. Prefer tool allowlist empty except `coc_live_turn` (+ maybe `read` if required by the SDK). If the Pi SDK requires at least one built-in, use read-only tools only.
5. After the agent finishes, `run_turn.mjs` must output the Event list from the tool result (not free prose). If the model returns prose without tool use, wrap as a single `error` or `system` event with `kind=pi_missing_tool_use` and still `ok: true` with that event — so the Python SDK always gets schema-valid events.

**Tests:**

1. Contract test (always runs): mock/subprocess a fake `run_turn.mjs` is unnecessary if we unit-test Python wrapper parsing; test `adapter.py` parses stdout JSON and validates events; test non-zero exit → raises.
2. Optional integration: if `node` and `npm` available and `runtime/adapters/pi/node_modules` exists, run one real turn; otherwise `@pytest.mark.skip`.

Also wire `session.send` for `brain=pi` to call `pi_send_turn`.

- [ ] **Step 1: Write failing contract tests for adapter.py parsing**

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `adapter.py` + `run_turn.mjs` + `package.json`**

`package.json`:

```json
{
  "name": "coc-runtime-pi-adapter",
  "private": true,
  "type": "module",
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.79.9"
  }
}
```

Document in `runtime/adapters/pi/README.md`:

```bash
cd runtime/adapters/pi && npm install
```

Model/auth: use Pi’s normal auth discovery (`~/.pi/agent` or env). Do not commit secrets.

- [ ] **Step 4: Run contract tests → PASS**

- [ ] **Step 5: Commit** (do **not** commit `node_modules`)

```bash
git add runtime/adapters/pi/package.json runtime/adapters/pi/run_turn.mjs runtime/adapters/pi/README.md runtime/adapters/pi/adapter.py runtime/sdk/api.py runtime/engine/session.py tests/test_runtime_pi_adapter_contract.py
git commit -m "$(cat <<'EOF'
feat(runtime): add Pi brain adapter via constrained Node bridge

EOF
)"
```

---

### Task 7: Guardrails, AGENTS.md, no-Exa check, metadata

**Files:**
- Create: `tests/test_runtime_no_exa_dependency.py`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-09-coc-runtime-pi-brain-design.md` (Status → Approved after implementation note, or keep “Approved for implementation”)
- Modify: `runtime/README.md` if needed for brain switch docs

- [ ] **Step 1: Write test that scans runtime package manifests / imports**

```python
# tests/test_runtime_no_exa_dependency.py
from pathlib import Path

FORBIDDEN = ("exa", "web_search_exa", "mcp.exa.ai")


def test_runtime_tree_has_no_exa_vendor_strings():
    root = Path("runtime")
    assert root.is_dir()
    hits = []
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        if "node_modules" in path.parts:
            continue
        if path.suffix.lower() not in {".py", ".md", ".json", ".mjs", ".ts", ".js", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
        for token in FORBIDDEN:
            if token in text:
                hits.append(f"{path}: {token}")
    assert hits == [], hits
```

- [ ] **Step 2: Run → should PASS if no Exa leaked; if FAIL, remove the strings**

- [ ] **Step 3: Update `AGENTS.md`** with a short section:

```markdown
## Runtime Track

`runtime/` is the open headless agent interface (Event SDK + debug/pi adapters).
It must not fork keeper skills or rules. Shared behavior remains in
`plugins/coc-keeper/`. Project brain switch lives at `.coc/runtime.json`.
```

- [ ] **Step 4: Run full relevant suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_config.py \
  tests/test_runtime_events.py \
  tests/test_runtime_live_turn_mapper.py \
  tests/test_runtime_public_state.py \
  tests/test_runtime_sdk_debug.py \
  tests/test_runtime_pi_adapter_contract.py \
  tests/test_runtime_no_exa_dependency.py \
  tests/test_plugin_metadata.py \
  -q -p no:cacheprovider
```

Expected: PASS (Pi live integration may skip)

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md tests/test_runtime_no_exa_dependency.py docs/superpowers/specs/2026-07-09-coc-runtime-pi-brain-design.md runtime/README.md
git commit -m "$(cat <<'EOF'
docs(runtime): record single-track runtime boundary and ban Exa deps

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Open headless API, not frontend | 5, README |
| Project-level `debug` \| `pi` switch | 1, 5 |
| Default `debug` | 1 |
| Single-track `plugins/coc-keeper/` | Global + 7 |
| No Exa | 7 |
| Event schema | 2, 3 |
| PublicState | 4 |
| SDK create/send/get_state/close | 5 |
| debug adapter via shared rails | 3, 5 |
| pi adapter embedded | 6 |
| Same `.coc/` state both brains | 3–6 |
| Smoke / schema-valid both brains | 5–6 |
| Marketplace stays on coc-keeper | Global (no marketplace edit) |
| HTTP/SSE out of V1 | Global (not scheduled) |

## Placeholder / consistency self-review

- No TBD/TODO left in task steps.
- Names aligned: `load_runtime_config`, `make_event`, `map_live_turn_result`, `debug_send_turn`, `pi_send_turn`, `create_session`, `send`, `get_state`, `close_session`, `build_public_state`.
- Brain binding at `create_session` matches spec timing note.
