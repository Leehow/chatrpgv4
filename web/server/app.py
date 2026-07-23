"""Stdlib HTTP + SSE bridge between the React web UI and the runtime SDK.

Run from the repository root:

    uv run --frozen python web/server/app.py [--workspace .] [--port 8765]

The server is a thin transport: all game semantics live in the canonical
runtime SDK and the keeper runner. It adds no rules, state, or narration
behavior of its own. SSE wraps one SDK ``send`` per player turn; live
``delta`` events are the keeper runner's own post-finalize token stream.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import queue
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from runtime.sdk import api as sdk  # noqa: E402

_DIST_DIR = _REPO_ROOT / "web" / "frontend" / "dist"

# One turn at a time: concurrent keeper turns against shared campaign state
# are never safe, and model env vars are process-global for the runner child.
_TURN_LOCK = threading.Lock()

# sid -> {"session_id", "campaign_id", "investigator_id"}
_SESSIONS: dict[str, dict[str, str]] = {}

_WORKSPACE: Path = _REPO_ROOT


# ---------------------------------------------------------------------------
# Workspace helpers (read-only projections; canonical writes stay in the SDK)


def _coc_root() -> Path:
    return _WORKSPACE / ".coc"


def _campaign_dir(campaign_id: str) -> Path:
    return _coc_root() / "campaigns" / campaign_id


def _load_session_module():
    path = _REPO_ROOT / "runtime" / "engine" / "session.py"
    spec = importlib.util.spec_from_file_location("runtime_session_web", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_locator():
    path = _REPO_ROOT / "runtime" / "engine" / "plugin_locator.py"
    spec = importlib.util.spec_from_file_location("runtime_plugin_locator_web", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_plugin_module(name: str):
    """Import a canonical plugin script (coc_*) exactly as the toolbox does."""
    scripts = _load_plugin_locator().plugin_scripts_dir(_WORKSPACE)
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    return __import__(name)


def _campaign_compat(campaign_id: str) -> dict[str, Any]:
    """Clean-slate compatibility: exact current campaign schema plus binding."""
    path = _campaign_dir(campaign_id) / "campaign.json"
    if not path.is_file():
        return {"exists": False, "compatible": False}
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {"exists": True, "compatible": False}
    if not isinstance(raw, dict):
        return {"exists": True, "compatible": False}
    schema = raw.get("schema_version")
    current = _load_plugin_locator().CURRENT_CAMPAIGN_SCHEMA_VERSION
    compatible = schema == current and isinstance(
        raw.get("ruleset_id"), str
    ) and bool(raw.get("ruleset_id"))
    return {"exists": True, "schema_version": schema, "compatible": compatible}


# Reusable workspace-level shell so a campaign can open a Keeper session and
# run the canonical coc-character skill before a real investigator exists.
SETUP_DRAFT_INVESTIGATOR_ID = "web-char-setup-draft"


def _resolve_investigator(campaign_id: str) -> str | None:
    state_dir = _campaign_dir(campaign_id) / "save" / "investigator-state"
    if not state_dir.is_dir():
        return None
    for path in sorted(state_dir.glob("*.json")):
        # Prefer a real investigator over the setup draft slot.
        if path.stem == SETUP_DRAFT_INVESTIGATOR_ID:
            continue
        return path.stem
    # Fall back to draft if that is the only linked party member.
    draft = state_dir / f"{SETUP_DRAFT_INVESTIGATOR_ID}.json"
    if draft.is_file():
        return SETUP_DRAFT_INVESTIGATOR_ID
    return None


def _ensure_setup_draft_investigator() -> str:
    """Ensure the reusable character-setup shell investigator exists."""
    inv_path = (
        _coc_root() / "investigators" / SETUP_DRAFT_INVESTIGATOR_ID / "character.json"
    )
    if inv_path.is_file():
        return SETUP_DRAFT_INVESTIGATOR_ID
    sdk.setup_workspace(
        _WORKSPACE,
        {
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": {
                "investigator_id": SETUP_DRAFT_INVESTIGATOR_ID,
                "sheet": {
                    "id": SETUP_DRAFT_INVESTIGATOR_ID,
                    "name": "（建卡引导中）",
                    "occupation": "调查员",
                    "era": "1920s",
                    "age": 28,
                    "skills": {
                        "Credit Rating": 20,
                        "Spot Hidden": 25,
                        "Listen": 20,
                        "Library Use": 20,
                    },
                },
                "creation": {
                    "method": "quick_fire_array",
                    "characteristic_assignment_order": [
                        "INT",
                        "POW",
                        "DEX",
                        "EDU",
                        "CON",
                        "APP",
                        "SIZ",
                        "STR",
                    ],
                    "luck_roll_total": 12,
                },
            },
        },
    )
    return SETUP_DRAFT_INVESTIGATOR_ID


def _link_setup_draft(campaign_id: str) -> str:
    """Link the setup draft so the live Keeper can run coc-character guidance."""
    draft_id = _ensure_setup_draft_investigator()
    sdk.setup_workspace(
        _WORKSPACE,
        {
            "schema_version": 1,
            "kind": "campaign.link_investigator",
            "payload": {
                "campaign_id": campaign_id,
                "investigator_ids": [draft_id],
            },
        },
    )
    return draft_id


def _display_character(
    character: dict[str, Any], play_language: str
) -> dict[str, Any]:
    """Project one character sheet into player-facing display labels.

    Labels come only from canonical sources: the sheet's own
    ``player_facing_sheet_<lang>`` layer (built by ``coc_starter`` for shipped
    pregens), otherwise the plugin's ``coc_language`` table vocabulary. When
    neither covers a term, the canonical English key is kept, exactly like the
    keeper's own renderers.
    """
    coc_language = _load_plugin_module("coc_language")
    suffix = {"zh-Hans": "zh", "zh": "zh"}.get(play_language)
    sheet: dict[str, Any] | None = None
    if suffix:
        candidate = character.get(f"player_facing_sheet_{suffix}")
        # Always run ensure for known starter pregens: older sheets may already
        # carry a pf layer that is missing equipment (or other display fields).
        try:
            coc_starter = _load_plugin_module("coc_starter")
            ensured = coc_starter.ensure_pregen_player_facing_sheet(character)
            ensured_sheet = ensured.get(f"player_facing_sheet_{suffix}")
            if isinstance(ensured_sheet, dict):
                candidate = ensured_sheet
        except Exception:  # noqa: BLE001 - display layer is best-effort
            pass
        if isinstance(candidate, dict):
            sheet = candidate
    terms = coc_language.default_localized_terms(play_language)

    raw_chars = character.get("characteristics")
    raw_chars = raw_chars if isinstance(raw_chars, dict) else {}
    pf_chars: dict[str, str] = {}
    if sheet and isinstance(sheet.get("characteristics"), dict):
        for label, entry in sheet["characteristics"].items():
            if isinstance(entry, dict) and entry.get("key"):
                pf_chars[str(entry["key"])] = str(label)
    characteristics = [
        {
            "key": str(key),
            "label": pf_chars.get(str(key)) or terms.get(str(key)) or str(key),
            "value": value,
        }
        for key, value in raw_chars.items()
    ]

    raw_skills = character.get("skills")
    raw_skills = raw_skills if isinstance(raw_skills, dict) else {}
    pf_skills: dict[str, str] = {}
    if sheet and isinstance(sheet.get("skills"), list):
        for entry in sheet["skills"]:
            if isinstance(entry, dict) and entry.get("key"):
                pf_skills[str(entry["key"])] = str(entry.get("label") or entry["key"])
    skills = [
        {
            "key": str(key),
            "label": pf_skills.get(str(key))
            or coc_language.player_facing_skill_label(
                str(key), play_language, terms=terms
            ),
            "value": value,
        }
        for key, value in raw_skills.items()
    ]

    pf_weapons = sheet.get("weapons") if sheet else None
    weapons: list[dict[str, Any]] = []
    for index, weapon in enumerate(character.get("weapons") or []):
        if not isinstance(weapon, dict):
            continue
        pf_weapon = (
            pf_weapons[index]
            if isinstance(pf_weapons, list)
            and index < len(pf_weapons)
            and isinstance(pf_weapons[index], dict)
            else {}
        )
        skill = pf_weapon.get("skill_label")
        if not skill and weapon.get("skill"):
            skill = coc_language.player_facing_skill_label(
                str(weapon["skill"]), play_language, terms=terms
            )
        weapons.append(
            {
                "label": pf_weapon.get("label")
                or weapon.get("name")
                or weapon.get("weapon_id"),
                "skill_label": skill,
                "damage": weapon.get("damage"),
                "range": weapon.get("range"),
                "ammo": pf_weapon.get("ammo_capacity", weapon.get("ammo")),
            }
        )

    raw_derived = character.get("derived")

    def _equipment_labels(source: Any) -> list[str]:
        if not isinstance(source, list):
            return []
        labels: list[str] = []
        for item in source:
            if isinstance(item, str) and item.strip():
                labels.append(item.strip())
            elif isinstance(item, dict):
                label = item.get("label") or item.get("name")
                if isinstance(label, str) and label.strip():
                    labels.append(label.strip())
        return labels

    # Prefer the player-facing equipment layer (Chinese for zh-Hans play);
    # fall back to machine-sheet strings when no localized list exists.
    equipment = _equipment_labels((sheet or {}).get("equipment"))
    if not equipment:
        equipment = _equipment_labels(character.get("equipment"))

    return {
        "name": (sheet or {}).get("display_name") or character.get("name"),
        "occupation": (sheet or {}).get("occupation") or character.get("occupation"),
        "era": (sheet or {}).get("era") or character.get("era"),
        "age": character.get("age"),
        "sex": character.get("sex"),
        "residence": character.get("residence"),
        "birthplace": character.get("birthplace"),
        "characteristics": characteristics,
        "derived": raw_derived if isinstance(raw_derived, dict) else {},
        "skills": skills,
        "weapons": weapons,
        "equipment": equipment,
        "localized": sheet is not None,
    }


# Closed pacing enums — fixed vocabulary, not open free-text translation.
_TENSION_LABELS_ZH = {
    "low": "平缓",
    "medium": "升高",
    "high": "紧绷",
    "climax": "高潮",
}
_DAY_PHASE_LABELS_ZH = {
    "morning": "上午",
    "afternoon": "下午",
    "evening": "傍晚",
    "night": "夜间",
}
_CN_DIGITS = "〇一二三四五六七八九"
_CN_MONTHS = (
    "正",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "十一",
    "十二",
)


def _zh_digits(value: int) -> str:
    """Spell a non-negative integer with Chinese numerals digit-by-digit (年用)."""
    return "".join(_CN_DIGITS[int(ch)] for ch in str(int(value)))


def _zh_small_number(value: int) -> str:
    """Spell 1–99 in common Chinese number words (十、十一、二十…)。"""
    n = int(value)
    if n < 0:
        return str(n)
    if n < 10:
        return _CN_DIGITS[n]
    if n == 10:
        return "十"
    if n < 20:
        return "十" + _CN_DIGITS[n - 10]
    if n < 100:
        tens, ones = divmod(n, 10)
        head = _CN_DIGITS[tens] + "十"
        return head if ones == 0 else head + _CN_DIGITS[ones]
    return _zh_digits(n)


def _zh_day_number(day: int) -> str:
    """Render calendar day 1–31 as 一日…三十一日 style numerals."""
    return _zh_small_number(int(day))


def _zh_hour_phrase(hour: int, minute: int) -> tuple[str, str]:
    """Return (phase_label, clock_phrase) for a calm zh-Hans clock line."""
    h = int(hour) % 24
    m = max(0, min(59, int(minute)))
    if 5 <= h < 12:
        phase = "上午"
    elif 12 <= h < 18:
        phase = "下午"
    elif 18 <= h < 21:
        phase = "傍晚"
    else:
        phase = "夜间"
    h12 = h % 12 or 12
    hour_s = _zh_small_number(h12)
    if m == 0:
        clock = f"{hour_s}时整"
    else:
        clock = f"{hour_s}时{_zh_small_number(m)}分"
    return phase, clock


def _format_player_time(
    clock: dict[str, Any], *, play_language: str, safe_place: Any
) -> dict[str, Any]:
    """Project time-state into a calm player-facing display payload."""
    raw_display = clock.get("display")
    local_dt = clock.get("local_datetime")
    payload: dict[str, Any] = {
        "display": raw_display if isinstance(raw_display, str) and raw_display else "—",
        "display_sub": None,
        "local_datetime": local_dt,
        "location_id": clock.get("location_id"),
        "elapsed_minutes": clock.get("elapsed_minutes"),
        "scale": clock.get("scale"),
        "safe_place": safe_place,
        "phase": None,
        "phase_label": None,
    }
    zh = play_language in ("zh-Hans", "zh")
    dt = None
    if isinstance(local_dt, str) and local_dt.strip():
        try:
            from datetime import datetime

            dt = datetime.fromisoformat(local_dt.strip())
        except ValueError:
            dt = None
    if zh and dt is not None:
        year = _zh_digits(dt.year) + "年"
        month = _CN_MONTHS[dt.month - 1] + "月"
        day = _zh_day_number(dt.day) + "日"
        phase, clock_phrase = _zh_hour_phrase(dt.hour, dt.minute)
        payload["display"] = f"{year}{month}{day}"
        payload["display_sub"] = f"{phase} · {clock_phrase}"
        payload["phase"] = {
            "上午": "morning",
            "下午": "afternoon",
            "傍晚": "evening",
            "夜间": "night",
        }.get(phase)
        payload["phase_label"] = phase
    elif zh and isinstance(raw_display, str) and raw_display.strip():
        # Keep source display but prefer a slightly quieter separator.
        payload["display"] = raw_display.strip().replace("T", " · ").replace("  ", " ")
    return payload


def _load_story_graph_scenes(campaign_id: str) -> list[dict[str, Any]]:
    path = _campaign_dir(campaign_id) / "scenario" / "story-graph.json"
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    scenes = raw.get("scenes") if isinstance(raw, dict) else None
    if not isinstance(scenes, list):
        return []
    return [s for s in scenes if isinstance(s, dict)]


def _scene_display_label(
    campaign_id: str, scene_id: str | None, play_language: str
) -> str | None:
    """Resolve a player-facing scene label from the campaign story-graph."""
    if not scene_id or not isinstance(scene_id, str):
        return None
    for scene in _load_story_graph_scenes(campaign_id):
        if str(scene.get("scene_id") or "") != scene_id:
            continue
        identity = scene.get("destination_identity")
        if isinstance(identity, dict):
            names = identity.get("localized_names")
            if isinstance(names, dict):
                for key in (play_language, "zh-Hans", "zh"):
                    label = names.get(key)
                    if isinstance(label, str) and label.strip():
                        return label.strip()
            canonical = identity.get("canonical_name")
            if isinstance(canonical, str) and canonical.strip():
                # Prefer authored display_name when present; else canonical.
                pass
        display = scene.get("display_name")
        if isinstance(display, str) and display.strip():
            return display.strip()
        if isinstance(identity, dict):
            canonical = identity.get("canonical_name")
            if isinstance(canonical, str) and canonical.strip():
                return canonical.strip()
        break
    return None


def _tension_display_label(level: str | None, play_language: str) -> str | None:
    if not level or not isinstance(level, str):
        return None
    if play_language in ("zh-Hans", "zh"):
        return _TENSION_LABELS_ZH.get(level, level)
    return level


def _character_extras(
    campaign_id: str, investigator_id: str, play_language: str = "zh-Hans"
) -> dict[str, Any]:
    """Read-only character sheet, inventory, and game clock for the side panel."""
    extras: dict[str, Any] = {"character": None, "time": None}
    sheet_path = _coc_root() / "investigators" / investigator_id / "character.json"
    try:
        raw = json.loads(sheet_path.read_text("utf-8"))
        if isinstance(raw, dict):
            character = dict(raw)
            # Inventory deltas appended during play override the sheet's base
            # list when they carry an explicit equipment/items snapshot.
            history_path = (
                _coc_root()
                / "investigators"
                / investigator_id
                / "inventory-history.jsonl"
            )
            try:
                for line in history_path.read_text("utf-8").splitlines():
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(row, dict):
                        continue
                    snapshot = row.get("equipment") or row.get("items")
                    if isinstance(snapshot, list) and all(
                        isinstance(x, str) for x in snapshot
                    ):
                        character["equipment"] = list(snapshot)
            except (OSError, UnicodeDecodeError):
                pass
            extras["character"] = _display_character(character, play_language)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    time_path = _campaign_dir(campaign_id) / "save" / "time-state.json"
    try:
        raw = json.loads(time_path.read_text("utf-8"))
        clock = raw.get("clock") if isinstance(raw.get("clock"), dict) else {}
        extras["time"] = _format_player_time(
            clock, play_language=play_language, safe_place=raw.get("safe_place")
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return extras


def _iter_clue_nodes(node: Any):
    """Yield clue dicts (objects that carry clue_id) from a clue-graph tree."""
    if isinstance(node, dict):
        if isinstance(node.get("clue_id"), str) and node.get("clue_id").strip():
            yield node
        for value in node.values():
            yield from _iter_clue_nodes(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_clue_nodes(item)


def _load_clue_index(campaign_id: str) -> dict[str, dict[str, Any]]:
    """Index campaign clue-graph entries by clue_id (first wins)."""
    path = _campaign_dir(campaign_id) / "scenario" / "clue-graph.json"
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    index: dict[str, dict[str, Any]] = {}
    for clue in _iter_clue_nodes(raw):
        clue_id = str(clue.get("clue_id") or "").strip()
        if not clue_id or clue_id in index:
            continue
        # Public panel only projects player-safe material.
        visibility = clue.get("visibility")
        if visibility is not None and str(visibility).strip() not in (
            "player-safe",
            "public",
            "player",
        ):
            continue
        index[clue_id] = clue
    return index


def _clue_player_summary(clue: dict[str, Any], play_language: str) -> str | None:
    """Prefer localized player_safe_summary, then the machine English summary."""
    localized = clue.get("localized_text")
    if isinstance(localized, dict):
        for key in (play_language, "zh-Hans", "zh"):
            block = localized.get(key)
            if isinstance(block, dict):
                text = block.get("player_safe_summary") or block.get("summary")
                if isinstance(text, str) and text.strip():
                    return text.strip()
            elif isinstance(block, str) and block.strip():
                return block.strip()
    for field in ("player_safe_summary", "summary"):
        text = clue.get(field)
        if isinstance(text, str) and text.strip():
            return text.strip()
    return None


def _discovered_clues_display(
    campaign_id: str,
    clue_ids: Any,
    play_language: str,
) -> list[dict[str, str]]:
    """Project discovered clue ids into ordered player-facing entries."""
    if not isinstance(clue_ids, list):
        return []
    index = _load_clue_index(campaign_id)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_id in clue_ids:
        if not isinstance(raw_id, str):
            continue
        clue_id = raw_id.strip()
        if not clue_id or clue_id in seen:
            continue
        seen.add(clue_id)
        clue = index.get(clue_id)
        summary = _clue_player_summary(clue, play_language) if clue else None
        # Never invent content for unknown ids; still surface the id so the
        # count stays honest and the KP can see what is missing from the graph.
        out.append(
            {
                "clue_id": clue_id,
                "summary": summary or clue_id,
            }
        )
    return out


def _state_payload(info: dict[str, str]) -> dict[str, Any]:
    state = sdk.get_state(info["session_id"])
    play_language = state.get("play_language")
    lang = (
        play_language
        if isinstance(play_language, str) and play_language
        else "zh-Hans"
    )
    state.update(
        _character_extras(
            info["campaign_id"],
            info["investigator_id"],
            lang,
        )
    )
    scene_id = state.get("active_scene_id")
    if isinstance(scene_id, str) and scene_id:
        state["active_scene_label"] = _scene_display_label(
            info["campaign_id"], scene_id, lang
        ) or scene_id
    else:
        state["active_scene_label"] = None
    tension = state.get("tension_level")
    if isinstance(tension, str) and tension:
        state["tension_label"] = _tension_display_label(tension, lang) or tension
    else:
        state["tension_label"] = None
    state["discovered_clues"] = _discovered_clues_display(
        info["campaign_id"], state.get("discovered_clue_ids"), lang
    )
    return state


def _sha256_bytes(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _list_source_bundles() -> list[dict[str, Any]]:
    """List validated-looking PDF source bundles under ``.coc/source-bundles/``.

    A bundle is a directory with ``manifest.json`` (codex-pdf-skill contract).
    Raw PDF files are never parsed here — only registered/selected.
    """
    root = _coc_root() / "source-bundles"
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    for path in sorted(root.iterdir()):
        if not path.is_dir():
            continue
        manifest = path / "manifest.json"
        if not manifest.is_file():
            continue
        title = path.name
        source_pdf: str | None = None
        page_count: int | None = None
        file_sha256: str | None = None
        try:
            raw = json.loads(manifest.read_text("utf-8"))
            if isinstance(raw, dict):
                pages = raw.get("pages")
                if isinstance(pages, list):
                    page_count = len(pages)
                source = raw.get("source")
                if isinstance(source, dict):
                    sp = source.get("path") or source.get("original_path")
                    if isinstance(sp, str) and sp.strip():
                        source_pdf = sp.strip()
                        title = Path(sp).name or title
                    sha = source.get("file_sha256")
                    if isinstance(sha, str) and len(sha) == 64:
                        file_sha256 = sha.lower()
                if isinstance(raw.get("title"), str) and raw["title"].strip():
                    title = raw["title"].strip()
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        out.append(
            {
                "bundle_id": path.name,
                "path": str(path.resolve()),
                "title": title,
                "source_pdf": source_pdf,
                "page_count": page_count,
                "file_sha256": file_sha256,
                "location_hint": f".coc/source-bundles/{path.name}/",
            }
        )
    return out


def _find_bundle_by_pdf_sha256(file_sha256: str) -> dict[str, Any] | None:
    digest = file_sha256.lower().strip()
    for bundle in _list_source_bundles():
        if str(bundle.get("file_sha256") or "").lower() == digest:
            return bundle
    return None


def _uploads_pdf_dir() -> Path:
    path = _coc_root() / "uploads" / "pdfs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _list_library_modules() -> list[dict[str, Any]]:
    """List compiled modules under ``.coc/module-library/`` for reuse.

    These are already-compiled seven-file scenarios (not raw PDF, not starter
    quick-starts). One library entry can be installed into many campaigns.
    """
    try:
        reg = _load_plugin_module("coc_module_registry")
    except Exception:  # noqa: BLE001
        return []
    try:
        summaries = reg.list_modules(_WORKSPACE)
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    for summary in summaries:
        if not isinstance(summary, dict):
            continue
        cid = str(summary.get("canonical_module_id") or "").strip()
        if not cid:
            continue
        title = cid
        chapter = summary.get("chapter")
        era = summary.get("era")
        rules_edition = summary.get("rules_edition")
        parent = summary.get("parent_module_id")
        identity_path = (
            _coc_root() / "module-library" / cid / "identity.json"
        )
        try:
            if identity_path.is_file():
                identity = json.loads(identity_path.read_text("utf-8"))
                if isinstance(identity, dict):
                    for key in ("canonical_title", "title"):
                        if isinstance(identity.get(key), str) and identity[key].strip():
                            title = identity[key].strip()
                            break
                    # Prefer Chinese alias when present.
                    aliases = identity.get("aliases")
                    if isinstance(aliases, list):
                        for alias in aliases:
                            if (
                                isinstance(alias, dict)
                                and alias.get("locale") in {"zh-Hans", "zh"}
                                and isinstance(alias.get("title"), str)
                                and alias["title"].strip()
                            ):
                                title = alias["title"].strip()
                                break
                    if identity.get("chapter") is not None:
                        chapter = identity.get("chapter")
                    if identity.get("rules_edition") is not None:
                        rules_edition = identity.get("rules_edition")
                    if identity.get("parent_module_id") is not None:
                        parent = identity.get("parent_module_id")
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        # Confirm compiled scenario exists on disk.
        scenario_dir = _coc_root() / "module-library" / cid / "scenario"
        if not scenario_dir.is_dir():
            continue
        out.append(
            {
                "canonical_module_id": cid,
                "title": title,
                "chapter": chapter,
                "era": era,
                "rules_edition": rules_edition,
                "parent_module_id": parent,
                "location_hint": f".coc/module-library/{cid}/",
            }
        )
    return out


def _player_visible_turn_error(exc: Any) -> str:
    """Map runtime turn failures to short player-facing Chinese messages."""
    kind = getattr(exc, "kind", None)
    name = exc.__class__.__name__ if isinstance(exc, Exception) else ""
    text = str(exc) if exc is not None else ""
    if kind == "keeper_finalization_blocked" or name == "KeeperFinalizationBlockedError":
        return (
            "本回合未能完成结算（KP 没有成功写出可对玩家发布的最终叙述）。"
            "世界状态可能已有部分写入，也可能完全未写；"
            "请重发同一行动，或换一种表述再试。"
            "若连续失败，用顶栏「⟳ 刷新」核对状态后再继续。"
        )
    if kind == "telemetry_persistence_failed" or name == "TelemetryPersistenceError":
        return (
            "本回合叙述可能已生成，但遥测回执写入失败。"
            "请刷新后确认对话是否已落盘；若缺失可重试该行动。"
        )
    if kind == "keeper_adapter_failed" or "KeeperAdapter" in name:
        return f"Keeper 进程/连接异常：{text or name}"
    if isinstance(exc, Exception):
        return f"{name}: {text}" if text and text != name else (text or name or "未知错误")
    return text or "未知错误"


def _parse_iso_ms(value: Any) -> int | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        from datetime import datetime

        return int(datetime.fromisoformat(raw).timestamp() * 1000)
    except ValueError:
        return None


def _read_jsonl_dicts(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text("utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return []
    out: list[dict[str, Any]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def _turn_total_ms_list(campaign_id: str) -> list[int]:
    """Full turn wall time from runtime-telemetry (player input → turn settled).

    This is the authoritative duration for a completed keeper turn — not the
    gap between two table-transcript log writes (those are both stamped near
    finalize, so their delta only covers late finalization / SSE presentation).
    """
    path = _campaign_dir(campaign_id) / "logs" / "runtime-telemetry.jsonl"
    totals: list[int] = []
    for row in _read_jsonl_dicts(path):
        tel = row.get("telemetry")
        if not isinstance(tel, dict):
            continue
        raw = tel.get("total_ms")
        try:
            ms = float(raw)
        except (TypeError, ValueError):
            continue
        if ms >= 0:
            totals.append(int(round(ms)))
    return totals


def _table_transcript_messages(campaign_id: str) -> list[dict[str, Any]] | None:
    """Prefer table-transcript.jsonl; duration from telemetry total_ms per turn."""
    rows = _read_jsonl_dicts(
        _campaign_dir(campaign_id) / "logs" / "table-transcript.jsonl"
    )
    dialogue = [
        row
        for row in rows
        if row.get("role") in ("player", "keeper")
        and isinstance(row.get("text"), str)
        and str(row.get("text")).strip()
    ]
    if not dialogue:
        return None

    by_turn: dict[Any, dict[str, dict[str, Any]]] = {}
    order: list[Any] = []
    for row in dialogue:
        turn = row.get("turn")
        key: Any = turn if turn is not None else id(row)
        if key not in by_turn:
            by_turn[key] = {}
            order.append(key)
        by_turn[key][str(row.get("role"))] = row

    totals = _turn_total_ms_list(campaign_id)
    out: list[dict[str, Any]] = []
    turn_index = 0
    for key in order:
        group = by_turn[key]
        player = group.get("player")
        keeper = group.get("keeper")
        # Content-ready wall clock ≈ keeper transcript stamp (finalize time).
        end_ms = _parse_iso_ms(keeper.get("ts")) if keeper else None
        if end_ms is None and player is not None:
            end_ms = _parse_iso_ms(player.get("ts"))
        duration_ms: int | None = None
        if turn_index < len(totals):
            duration_ms = totals[turn_index]
        turn_index += 1
        # Reconstruct input time: all-content-out minus full turn wall time.
        start_ms: int | None = None
        if end_ms is not None and duration_ms is not None and duration_ms >= 0:
            start_ms = end_ms - duration_ms
        elif player is not None:
            start_ms = _parse_iso_ms(player.get("ts"))

        if player is not None:
            entry: dict[str, Any] = {
                "role": "player",
                "text": str(player.get("text") or "").strip(),
            }
            if start_ms is not None:
                entry["at"] = start_ms
                entry["started_at"] = start_ms
            out.append(entry)
        if keeper is not None:
            entry = {
                "role": "keeper",
                "text": str(keeper.get("text") or "").strip(),
            }
            if end_ms is not None:
                entry["at"] = end_ms
            if start_ms is not None:
                entry["started_at"] = start_ms
            if duration_ms is not None:
                entry["duration_ms"] = duration_ms
            out.append(entry)
    return out


def _enrich_transcript_from_events(
    campaign_id: str, messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Attach turn timing from events + telemetry when table-transcript is absent."""
    path = _campaign_dir(campaign_id) / "logs" / "events.jsonl"
    turn_ts: list[int] = []
    for row in _read_jsonl_dicts(path):
        if row.get("event_type") != "turn":
            continue
        ms = _parse_iso_ms(row.get("ts"))
        if ms is not None:
            turn_ts.append(ms)
    totals = _turn_total_ms_list(campaign_id)
    if not turn_ts and not totals:
        return messages
    out: list[dict[str, Any]] = []
    turn_i = 0
    pending_start: int | None = None
    pending_duration: int | None = None
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        item = dict(msg)
        role = item.get("role")
        if role == "player":
            duration = totals[turn_i] if turn_i < len(totals) else None
            # events.ts is near finalize; backdate by full turn total when known.
            end_ms = turn_ts[turn_i] if turn_i < len(turn_ts) else None
            start_ms = (
                end_ms - duration
                if end_ms is not None and duration is not None
                else end_ms
            )
            if start_ms is not None:
                item["at"] = start_ms
                item["started_at"] = start_ms
            pending_start = start_ms
            pending_duration = duration
            turn_i += 1
        elif role == "keeper":
            if pending_duration is not None:
                item["duration_ms"] = pending_duration
            if pending_start is not None:
                item["started_at"] = pending_start
                if pending_duration is not None:
                    item["at"] = pending_start + pending_duration
                else:
                    item.setdefault("at", pending_start)
            pending_start = None
            pending_duration = None
        out.append(item)
    return out


def _transcript_payload(info: dict[str, str]) -> list[dict[str, Any]]:
    """Public transcript with turn wall-clock timing for the web panel.

    Duration = full turn from player input acceptance to all content settled
    (``runtime-telemetry.total_ms``), not SSE token drip or late log-write gaps.
    """
    campaign_id = info["campaign_id"]
    timed = _table_transcript_messages(campaign_id)
    if timed is not None:
        return timed
    session_mod = _load_session_module()
    base = session_mod._recent_public_transcript(
        _campaign_dir(campaign_id), limit=10000
    )
    if not isinstance(base, list):
        return []
    return _enrich_transcript_from_events(
        campaign_id, [m for m in base if isinstance(m, dict)]
    )


def _models_payload() -> dict[str, Any]:
    agent_dir = Path(
        os.environ.get("PI_AGENT_DIR") or str(Path.home() / ".pi" / "agent")
    )
    raw: dict[str, Any] = {}
    try:
        loaded = json.loads((agent_dir / "models.json").read_text("utf-8"))
        if isinstance(loaded, dict):
            raw = loaded
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    auth_providers: set[str] = set()
    try:
        auth_raw = json.loads((agent_dir / "auth.json").read_text("utf-8"))
        if isinstance(auth_raw, dict):
            inner = auth_raw.get("providers")
            source = inner if isinstance(inner, dict) else auth_raw
            auth_providers = {k for k in source if isinstance(k, str)}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    providers: dict[str, Any] = {}
    for name, cfg in (raw.get("providers") or {}).items():
        if not isinstance(cfg, dict):
            continue
        models = [
            {"id": m["id"], "label": str(m.get("name") or m["id"])}
            for m in cfg.get("models") or []
            if isinstance(m, dict) and isinstance(m.get("id"), str) and m["id"]
        ]
        if models:
            providers[name] = {
                "label": str(cfg.get("name") or name),
                "models": models,
                "hasAuth": name in auth_providers or bool(cfg.get("apiKey")),
            }
    default = {"provider": "coding-relay", "model": "gpt-5.6-luna"}
    provider_ids = {
        m["id"] for m in providers.get(default["provider"], {}).get("models", [])
    }
    if default["provider"] not in providers or default["model"] not in provider_ids:
        for name, cfg in providers.items():
            default = {"provider": name, "model": cfg["models"][0]["id"]}
            break
    return {"providers": providers, "default": default}


# ---------------------------------------------------------------------------
# HTTP layer


_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -- plumbing -----------------------------------------------------------

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[web] %s\n" % (fmt % args))

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("request body must be a JSON object")
        return data

    def _send_sse_headers(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def _sse(self, event: str, data: Any) -> None:
        frame = (
            f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        ).encode("utf-8")
        self.wfile.write(frame)
        self.wfile.flush()

    # -- routing ------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/api/health":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "workspace": str(_WORKSPACE),
                        "sessions": len(_SESSIONS),
                        "dist_built": _DIST_DIR.is_dir(),
                    },
                )
                return
            if path == "/api/models":
                self._send_json(200, _models_payload())
                return
            if path == "/api/bootstrap":
                result = sdk.setup_workspace(
                    _WORKSPACE,
                    {"schema_version": 1, "kind": "onboarding.inspect", "payload": {}},
                )
                campaigns = result.get("result", {}).get("campaigns")
                if isinstance(campaigns, list):
                    for summary in campaigns:
                        if isinstance(summary, dict) and summary.get("campaign_id"):
                            summary.update(_campaign_compat(summary["campaign_id"]))
                if isinstance(result.get("result"), dict):
                    result["result"]["source_bundles"] = _list_source_bundles()
                    result["result"]["library_modules"] = _list_library_modules()
                self._send_json(200, result)
                return
            parts = [p for p in path.split("/") if p]
            if len(parts) == 4 and parts[:2] == ["api", "sessions"]:
                info = _SESSIONS.get(parts[2])
                if info is None:
                    self._send_json(404, {"error": "unknown session"})
                    return
                if parts[3] == "state":
                    self._send_json(200, _state_payload(info))
                    return
                if parts[3] == "transcript":
                    self._send_json(200, {"messages": _transcript_payload(info)})
                    return
            if path.startswith("/api/"):
                self._send_json(404, {"error": "not found"})
                return
            self._serve_static(path)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": f"{exc.__class__.__name__}: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/api/uploads/pdf":
                self._handle_upload_pdf()
                return
            body = self._read_json()
            if path == "/api/campaigns":
                self._handle_create_campaign(body)
                return
            if path == "/api/campaigns/attach-investigator":
                self._handle_attach_investigator(body)
                return
            if path == "/api/sessions":
                self._handle_create_session(body)
                return
            if path == "/api/investigators":
                self._handle_create_investigator(body)
                return
            parts = [p for p in path.split("/") if p]
            if (
                len(parts) == 4
                and parts[:2] == ["api", "sessions"]
                and parts[3] == "turns"
            ):
                self._handle_turn(parts[2], body)
                return
            self._send_json(404, {"error": "not found"})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._send_json(500, {"error": f"{exc.__class__.__name__}: {exc}"})

    # -- API handlers -------------------------------------------------------

    def _handle_upload_pdf(self) -> None:
        """Accept a raw PDF upload, hash it, dedupe against source bundles.

        Does **not** parse the PDF. If a source bundle already declares the same
        ``file_sha256``, return that bundle path for immediate open. Otherwise
        store the file under ``.coc/uploads/pdfs/`` for later external ingest.
        """
        import re
        from email import message_from_bytes
        from email.policy import default as email_policy

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise ValueError("PDF 上传需要 multipart/form-data")
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0 or length > 200 * 1024 * 1024 + 64 * 1024:
            raise ValueError("PDF 体积无效或超过上限")
        raw_body = self.rfile.read(length)
        # Parse multipart via email (stdlib; cgi was removed in newer CPython).
        msg = message_from_bytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
            + raw_body,
            policy=email_policy,
        )
        data: bytes | None = None
        filename = "upload.pdf"
        if msg.is_multipart():
            for part in msg.iter_parts():
                disposition = str(part.get("Content-Disposition") or "")
                if "name=\"file\"" not in disposition and "name=file" not in disposition:
                    # Also accept first filename-bearing part.
                    if "filename=" not in disposition:
                        continue
                part_name = part.get_filename()
                if part_name:
                    filename = str(part_name)
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes) and payload:
                    data = payload
                    break
        if data is None:
            raise ValueError("缺少 file 字段或文件为空")
        if not filename.lower().endswith(".pdf"):
            raise ValueError("仅支持 .pdf 文件")
        if len(data) > 200 * 1024 * 1024:
            raise ValueError("PDF 超过 200MB 上限")
        if not data.startswith(b"%PDF"):
            raise ValueError("文件不是有效的 PDF（缺少 %PDF 头）")
        file_sha256 = _sha256_bytes(data)
        matched = _find_bundle_by_pdf_sha256(file_sha256)
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)[:80]
        stored = _uploads_pdf_dir() / f"{file_sha256[:16]}_{safe_name}"
        if not stored.is_file():
            stored.write_bytes(data)
        elif _sha256_file(stored) != file_sha256:
            stored = _uploads_pdf_dir() / f"{file_sha256}_{safe_name}"
            stored.write_bytes(data)
        payload_out: dict[str, Any] = {
            "filename": filename,
            "file_sha256": file_sha256,
            "stored_path": str(stored.resolve()),
            "size_bytes": len(data),
            "location_hint": f".coc/uploads/pdfs/{stored.name}",
        }
        if matched is not None:
            payload_out["status"] = "matched_bundle"
            payload_out["matched_bundle"] = matched
            payload_out["message"] = (
                "已找到相同哈希的 PDF 源包，可直接用该源包开局。"
            )
        else:
            payload_out["status"] = "stored_pending_ingest"
            payload_out["matched_bundle"] = None
            payload_out["message"] = (
                "PDF 已按哈希登记到 .coc/uploads/pdfs/；工作区尚无匹配源包。"
                "仓库不解析 PDF，请用 mineru / 外部 PDF skill 生成 "
                ".coc/source-bundles/<id>/ 后再开局。"
            )
            payload_out["source_bundles_dir"] = str(
                (_coc_root() / "source-bundles").resolve()
            )
        self._send_json(200, {"ok": True, "result": payload_out})

    def _handle_create_investigator(self, body: dict[str, Any]) -> None:
        """Create a reusable investigator via Quick Fire materialization."""
        import re
        import time

        name = str(body.get("name") or "").strip()
        occupation = str(body.get("occupation") or "").strip() or "调查员"
        era = str(body.get("era") or "1920s").strip() or "1920s"
        age_raw = body.get("age", 28)
        try:
            age = int(age_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("age must be an integer") from exc
        if age < 15 or age > 90:
            raise ValueError("age must be between 15 and 90")
        if not name:
            raise ValueError("name is required")
        slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or "investigator"
        stamp = time.strftime("%Y%m%d%H%M%S")
        investigator_id = (
            str(body.get("investigator_id") or "").strip()
            or f"{slug[:40]}-{stamp}"
        )
        # Quick Fire array assignment: high → low priority for a generalist.
        order = [
            "INT",
            "POW",
            "DEX",
            "EDU",
            "CON",
            "APP",
            "SIZ",
            "STR",
        ]
        luck_total = body.get("luck_roll_total", 12)
        try:
            luck_total = int(luck_total)
        except (TypeError, ValueError) as exc:
            raise ValueError("luck_roll_total must be an integer") from exc
        if luck_total < 3 or luck_total > 18:
            raise ValueError("luck_roll_total must be 3–18 (3D6 total)")
        receipt = sdk.setup_workspace(
            _WORKSPACE,
            {
                "schema_version": 1,
                "kind": "investigator.create",
                "payload": {
                    "investigator_id": investigator_id,
                    "sheet": {
                        "id": investigator_id,
                        "name": name,
                        "occupation": occupation,
                        "era": era,
                        "age": age,
                        "skills": {
                            "Credit Rating": 20,
                            "Spot Hidden": 40,
                            "Listen": 30,
                            "Library Use": 30,
                        },
                    },
                    "creation": {
                        "method": "quick_fire_array",
                        "characteristic_assignment_order": order,
                        "luck_roll_total": luck_total,
                    },
                },
            },
        )
        self._send_json(200, receipt)

    def _handle_create_campaign(self, body: dict[str, Any]) -> None:
        mode = str(body.get("mode") or "starter").strip() or "starter"
        if mode == "pdf":
            self._handle_create_campaign_from_pdf(body)
            return
        if mode == "library":
            self._handle_create_campaign_from_library(body)
            return
        payload: dict[str, Any] = {
            "scenario_id": str(body.get("scenario_id") or "").strip(),
            "pregen_id": str(body.get("pregen_id") or "").strip(),
        }
        if not payload["scenario_id"] or not payload["pregen_id"]:
            raise ValueError("scenario_id and pregen_id are required")
        for key in ("campaign_id", "title"):
            value = str(body.get(key) or "").strip()
            if value:
                payload[key] = value
        result = sdk.setup_workspace(
            _WORKSPACE,
            {"schema_version": 1, "kind": "campaign.quick_start", "payload": payload},
        )
        self._send_json(200, result)

    def _handle_create_campaign_from_library(self, body: dict[str, Any]) -> None:
        """Install a compiled module-library entry into a fresh campaign."""
        import re
        import time

        module_id = str(body.get("canonical_module_id") or "").strip()
        investigator_id = str(body.get("investigator_id") or "").strip()
        title = str(body.get("title") or "").strip()
        if not module_id:
            raise ValueError("canonical_module_id is required for 已解析剧本开局")
        try:
            reg = _load_plugin_module("coc_module_registry")
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"无法加载 module-library：{exc}") from exc
        entry_dir = _coc_root() / "module-library" / module_id
        if not entry_dir.is_dir():
            raise ValueError(f"未知剧本库条目：{module_id}")
        if not title:
            title = module_id
            identity_path = entry_dir / "identity.json"
            try:
                if identity_path.is_file():
                    identity = json.loads(identity_path.read_text("utf-8"))
                    if isinstance(identity, dict):
                        for key in ("canonical_title", "title"):
                            if isinstance(identity.get(key), str) and identity[key].strip():
                                title = identity[key].strip()
                                break
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                pass
        slug = re.sub(r"[^a-z0-9]+", "-", module_id.casefold()).strip("-") or "library"
        stamp = time.strftime("%Y%m%dT%H%M%S")
        campaign_id = (
            str(body.get("campaign_id") or "").strip()
            or f"lib-{slug[:40]}-{stamp}"
        )
        try:
            created = sdk.setup_workspace(
                _WORKSPACE,
                {
                    "schema_version": 1,
                    "kind": "campaign.create",
                    "payload": {
                        "campaign_id": campaign_id,
                        "title": title,
                        "play_language": "zh-Hans",
                    },
                },
            )
            installed = reg.install_to_campaign(
                _WORKSPACE, module_id, campaign_id
            )
            linked: Any = None
            if investigator_id:
                linked = sdk.setup_workspace(
                    _WORKSPACE,
                    {
                        "schema_version": 1,
                        "kind": "campaign.link_investigator",
                        "payload": {
                            "campaign_id": campaign_id,
                            "investigator_ids": [investigator_id],
                        },
                    },
                )
        except Exception as exc:  # noqa: BLE001
            raise ValueError(str(exc)) from exc
        self._send_json(
            200,
            {
                "schema_version": 1,
                "status": "PASS",
                "kind": "campaign.library_start",
                "result": {
                    "campaign_id": campaign_id,
                    "canonical_module_id": module_id,
                    "investigator_id": investigator_id or None,
                    "needs_investigator": not bool(investigator_id),
                    "create": created.get("result") if isinstance(created, dict) else created,
                    "install": installed,
                    "link": (
                        linked.get("result") if isinstance(linked, dict) else linked
                    ),
                },
            },
        )

    def _handle_create_campaign_from_pdf(self, body: dict[str, Any]) -> None:
        """Create a campaign from a validated PDF *source bundle* (not raw PDF).

        Repository runtime never parses PDFs. The host (or an external PDF skill)
        must already have produced a codex-pdf-skill source bundle directory.
        """
        import re
        import time

        source_bundle_path = str(body.get("source_bundle_path") or "").strip()
        investigator_id = str(body.get("investigator_id") or "").strip()
        title = str(body.get("title") or "").strip()
        if not source_bundle_path:
            raise ValueError("source_bundle_path is required for PDF 开局")
        bundle = Path(source_bundle_path).expanduser().resolve()
        if not bundle.is_dir() or not (bundle / "manifest.json").is_file():
            raise ValueError(
                "PDF 开局需要已解析的源包目录（含 manifest.json）。"
                "仓库不直接解析 PDF；请先用外部 PDF skill / mineru 等产出 source bundle。"
            )
        if not title:
            title = bundle.name
        slug = re.sub(r"[^a-z0-9]+", "-", bundle.name.casefold()).strip("-") or "pdf-module"
        stamp = time.strftime("%Y%m%dT%H%M%S")
        campaign_id = str(body.get("campaign_id") or "").strip() or f"pdf-{slug[:40]}-{stamp}"
        # Unique scenario identity per campaign so source-cache pages never
        # collide with an earlier bind of the same bundle name.
        scenario_id = (
            str(body.get("scenario_id") or "").strip()
            or f"{slug[:40]}-{stamp}"
        )

        try:
            created = sdk.setup_workspace(
                _WORKSPACE,
                {
                    "schema_version": 1,
                    "kind": "campaign.create",
                    "payload": {
                        "campaign_id": campaign_id,
                        "title": title,
                        "play_language": "zh-Hans",
                    },
                },
            )
            bound = sdk.setup_workspace(
                _WORKSPACE,
                {
                    "schema_version": 1,
                    "kind": "scenario.bind_pdf",
                    "payload": {
                        "campaign_id": campaign_id,
                        "scenario_id": scenario_id,
                        "title": title,
                        "source_bundle_path": str(bundle),
                        # Progressive binding: no cold compiler required.
                        "compile_now": False,
                    },
                },
            )
            linked: Any = None
            if investigator_id:
                linked = sdk.setup_workspace(
                    _WORKSPACE,
                    {
                        "schema_version": 1,
                        "kind": "campaign.link_investigator",
                        "payload": {
                            "campaign_id": campaign_id,
                            "investigator_ids": [investigator_id],
                        },
                    },
                )
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if "content drift" in message.casefold():
                raise ValueError(
                    "该 PDF 已在本工作区以不同页面内容写入模块缓存，"
                    "不能用这份源包覆盖旧证据。"
                    "请换用与缓存一致的源包，或在干净工作区开局；"
                    f"技术细节：{message}"
                ) from exc
            raise ValueError(message) from exc
        self._send_json(
            200,
            {
                "schema_version": 1,
                "status": "PASS",
                "kind": "campaign.pdf_start",
                "result": {
                    "campaign_id": campaign_id,
                    "scenario_id": scenario_id,
                    "investigator_id": investigator_id or None,
                    "needs_investigator": not bool(investigator_id),
                    "source_bundle_path": str(bundle),
                    "create": created.get("result") if isinstance(created, dict) else created,
                    "bind": bound.get("result") if isinstance(bound, dict) else bound,
                    "link": (
                        linked.get("result") if isinstance(linked, dict) else linked
                    ),
                },
            },
        )

    def _handle_attach_investigator(self, body: dict[str, Any]) -> None:
        """Create (optional) and link an investigator onto an existing campaign.

        Used by the main-panel character-creation guide after「新建」开局.
        """
        import re
        import time

        campaign_id = str(body.get("campaign_id") or "").strip()
        if not campaign_id:
            raise ValueError("campaign_id is required")
        compat = _campaign_compat(campaign_id)
        if compat.get("exists") is not True:
            raise ValueError(f"未知战役：{campaign_id!r}")
        if compat.get("compatible") is not True:
            raise ValueError(
                f"战役 {campaign_id!r} 是旧版存档，无法挂接调查员。"
            )

        investigator_id = str(body.get("investigator_id") or "").strip()
        created_receipt: Any = None
        if not investigator_id:
            name = str(body.get("name") or "").strip()
            if not name:
                raise ValueError("新建角色需要 name，或传入已有 investigator_id")
            occupation = str(body.get("occupation") or "").strip() or "调查员"
            era = str(body.get("era") or "1920s").strip() or "1920s"
            try:
                age = int(body.get("age", 28))
            except (TypeError, ValueError) as exc:
                raise ValueError("age must be an integer") from exc
            if age < 15 or age > 90:
                raise ValueError("age must be between 15 and 90")
            slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or "investigator"
            stamp = time.strftime("%Y%m%d%H%M%S")
            investigator_id = f"{slug[:40]}-{stamp}"
            order = ["INT", "POW", "DEX", "EDU", "CON", "APP", "SIZ", "STR"]
            luck_total = body.get("luck_roll_total", 12)
            try:
                luck_total = int(luck_total)
            except (TypeError, ValueError) as exc:
                raise ValueError("luck_roll_total must be an integer") from exc
            if luck_total < 3 or luck_total > 18:
                raise ValueError("luck_roll_total must be 3–18 (3D6 total)")
            created_receipt = sdk.setup_workspace(
                _WORKSPACE,
                {
                    "schema_version": 1,
                    "kind": "investigator.create",
                    "payload": {
                        "investigator_id": investigator_id,
                        "sheet": {
                            "id": investigator_id,
                            "name": name,
                            "occupation": occupation,
                            "era": era,
                            "age": age,
                            "skills": {
                                "Credit Rating": 20,
                                "Spot Hidden": 40,
                                "Listen": 30,
                                "Library Use": 30,
                            },
                        },
                        "creation": {
                            "method": "quick_fire_array",
                            "characteristic_assignment_order": order,
                            "luck_roll_total": luck_total,
                        },
                    },
                },
            )

        linked = sdk.setup_workspace(
            _WORKSPACE,
            {
                "schema_version": 1,
                "kind": "campaign.link_investigator",
                "payload": {
                    "campaign_id": campaign_id,
                    "investigator_ids": [investigator_id],
                },
            },
        )
        self._send_json(
            200,
            {
                "schema_version": 1,
                "status": "PASS",
                "kind": "campaign.attach_investigator",
                "result": {
                    "campaign_id": campaign_id,
                    "investigator_id": investigator_id,
                    "created": (
                        created_receipt.get("result")
                        if isinstance(created_receipt, dict)
                        else created_receipt
                    ),
                    "link": linked.get("result") if isinstance(linked, dict) else linked,
                },
            },
        )

    def _handle_create_session(self, body: dict[str, Any]) -> None:
        campaign_id = str(body.get("campaign_id") or "").strip()
        if not campaign_id:
            raise ValueError("campaign_id is required")
        compat = _campaign_compat(campaign_id)
        if compat.get("exists") is not True:
            raise ValueError(f"未知战役：{campaign_id!r}")
        if compat.get("compatible") is not True:
            schema = compat.get("schema_version")
            raise ValueError(
                f"战役 {campaign_id!r} 是旧版存档（schema v{schema}）。"
                "当前运行时按清洁重开策略只接受 v2 战役，不做迁移；"
                "请从左侧「＋ 新战役」开局。"
            )
        investigator_id = str(body.get("investigator_id") or "").strip()
        character_setup = False
        if not investigator_id:
            resolved = _resolve_investigator(campaign_id)
            if not resolved:
                # No party yet (「新建调查员」开局): open with setup shell so the
                # live Keeper can run the canonical coc-character skill in chat.
                investigator_id = _link_setup_draft(campaign_id)
                character_setup = True
            else:
                investigator_id = resolved
                character_setup = investigator_id == SETUP_DRAFT_INVESTIGATOR_ID
        session_id = sdk.create_session(
            _WORKSPACE,
            campaign_id=campaign_id,
            investigator_id=investigator_id,
        )
        info = {
            "session_id": session_id,
            "campaign_id": campaign_id,
            "investigator_id": investigator_id,
        }
        _SESSIONS[session_id] = info
        self._send_json(
            200,
            {
                "session_id": session_id,
                "character_setup": character_setup,
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                "state": _state_payload(info),
            },
        )

    def _handle_turn(self, sid: str, body: dict[str, Any]) -> None:
        info = _SESSIONS.get(sid)
        if info is None:
            self._send_json(404, {"error": "unknown session"})
            return
        player_input = str(body.get("input") or "").strip()
        if not player_input:
            raise ValueError("input is required")
        provider = str(body.get("provider") or "").strip()
        model = str(body.get("model") or "").strip()

        self._send_sse_headers()
        if not _TURN_LOCK.acquire(blocking=False):
            self._sse("error", {"message": "另一个回合仍在进行，请等待它结束。"})
            return

        events_queue: queue.Queue[tuple[str, Any]] = queue.Queue()

        def _worker() -> None:
            saved: dict[str, str | None] = {}
            try:
                if provider:
                    saved["COC_KEEPER_MODEL_PROVIDER"] = os.environ.get(
                        "COC_KEEPER_MODEL_PROVIDER"
                    )
                    os.environ["COC_KEEPER_MODEL_PROVIDER"] = provider
                if model:
                    saved["COC_KEEPER_MODEL_ID"] = os.environ.get(
                        "COC_KEEPER_MODEL_ID"
                    )
                    os.environ["COC_KEEPER_MODEL_ID"] = model
                events = sdk.send(
                    info["session_id"],
                    player_input,
                    on_keeper_stream=lambda event: events_queue.put(
                        ("stream", event)
                    ),
                )
                events_queue.put(("done", events))
            except Exception as exc:  # noqa: BLE001
                events_queue.put(("failed", exc))
            finally:
                for key, value in saved.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
                _TURN_LOCK.release()

        threading.Thread(target=_worker, daemon=True).start()
        self._sse("status", {"phase": "accepted"})

        while True:
            try:
                kind, payload = events_queue.get(timeout=15)
            except queue.Empty:
                try:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                except OSError:
                    return  # client gone; let the turn finish server-side
                continue
            try:
                if kind == "stream":
                    stream_type = payload.get("$stream")
                    if stream_type == "delta":
                        self._sse("delta", {"text": str(payload.get("text") or "")})
                    elif stream_type == "delta_reset":
                        self._sse("delta_reset", {})
                    elif stream_type == "tool":
                        self._sse(
                            "tool",
                            {
                                "phase": str(payload.get("phase") or ""),
                                "tool": str(payload.get("tool") or ""),
                            },
                        )
                elif kind == "done":
                    try:
                        state: Any = _state_payload(info)
                    except Exception as exc:  # noqa: BLE001
                        state = {"error": f"{exc.__class__.__name__}: {exc}"}
                    self._sse("turn", {"events": payload, "state": state})
                    self._sse("end", {})
                    return
                elif kind == "failed":
                    self._sse(
                        "error",
                        {"message": _player_visible_turn_error(payload)},
                    )
                    return
            except OSError:
                return  # client gone; the turn still settles canonically

    # -- static -------------------------------------------------------------

    def _serve_static(self, path: str) -> None:
        if not _DIST_DIR.is_dir():
            body = (
                "<!doctype html><meta charset='utf-8'><title>coc web</title>"
                "<body style='font-family:monospace;background:#10161a;color:#cfe;'>"
                "<h2>Frontend not built</h2>"
                "<pre>cd web/frontend && npm install && npm run build</pre>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rel = path.lstrip("/") or "index.html"
        candidate = (_DIST_DIR / rel).resolve()
        if not str(candidate).startswith(str(_DIST_DIR.resolve())):
            self._send_json(403, {"error": "forbidden"})
            return
        if not candidate.is_file():
            candidate = _DIST_DIR / "index.html"  # SPA fallback
        body = candidate.read_bytes()
        content_type = _CONTENT_TYPES.get(
            candidate.suffix.lower(), "application/octet-stream"
        )
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    global _WORKSPACE
    parser = argparse.ArgumentParser(description="COC Keeper web UI server")
    parser.add_argument("--workspace", default=str(_REPO_ROOT))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    _WORKSPACE = Path(args.workspace).expanduser().resolve()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"coc-web listening on http://{args.host}:{args.port}  workspace={_WORKSPACE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
