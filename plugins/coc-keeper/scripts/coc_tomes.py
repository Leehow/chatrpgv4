#!/usr/bin/env python3
"""Tome reading engine for Call of Cthulhu 7e — Keeper Rulebook Ch11 p.217-226.

Owns structured study progress for one investigator + one tome. Produces
structured read results (CM gains, SAN-loss expressions, week costs, research
roll contracts) without applying SAN itself — callers route ``san_loss_expr``
through SanitySession and merge CM into character sheets.

Rulebook basis (7e 40th Anniversary, Chapter 11):
- Language gate before study (p.211-212); plot-critical tomes must not dead-end.
- Skim: hours, atmosphere/contents only — no CM / SAN.
- Initial reading: CMI + sanity_cost + full_study_weeks // 4 (min 1 week).
- Full study: requires initial; CMF + Mythos Rating + full_study_weeks +
  spells glimpsed; repeat full doubles time, zero new CM.
- Research: after full, Mythos Rating as percentile target (contract only).
- Non-believer may defer SAN (believer_gate); choose_disbelief halves CM.

Files managed:
  save/tomes.json  — {investigator_id, tome_name, phases_completed, cm_gained, weeks_spent}
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")

VALID_PHASES = frozenset({"skim", "initial", "full", "research"})
SKIM_HOURS = 4  # "a few hours" — structured constant, not prose-derived


def _tomes_save_path(campaign_dir: Path) -> Path:
    return campaign_dir / "save" / "tomes.json"


def _inv_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"


def _read_believer(campaign_dir: Path | None, investigator_id: str) -> bool:
    """Return True only when investigator-state explicitly has believer: True.

    Absent file or missing/false field → not a believer (can defer SAN).
    """
    if campaign_dir is None:
        return False
    path = _inv_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return data.get("believer") is True


def _halve_cm(amount: int) -> int:
    """Floor-halve CM gain; minimum 1 when original amount > 0."""
    if amount <= 0:
        return 0
    return max(1, amount // 2)


class TomeSession:
    """Structured tome-study state for one investigator and one tome.

    Deterministic given the RNG handed in (RNG reserved for future use;
    research returns a roll contract and does not roll here).
    """

    def __init__(
        self,
        investigator_id: str,
        tome_name: str,
        *,
        rng: random.Random | None = None,
        campaign_dir: Path | None = None,
        language_skill: int = 0,
        read_language_ok: bool = False,
        plot_critical: bool = False,
    ) -> None:
        self.investigator_id = investigator_id
        self.tome_name = tome_name
        self._rng = rng or random.Random()
        self.campaign_dir = Path(campaign_dir) if campaign_dir is not None else None
        self.language_skill = int(language_skill)
        self.read_language_ok = bool(read_language_ok)
        self.plot_critical = bool(plot_critical)

        self.tome = dict(coc_rules.tome_by_name(tome_name))
        self.phases_completed: list[str] = []
        self.cm_gained: int = 0
        self.weeks_spent: int = 0
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0
        self._full_count = 0  # how many successful full studies completed

    # ------------------------------------------------------------------ #
    # Gates
    # ------------------------------------------------------------------ #
    def _language_blocked(self) -> bool:
        if self.language_skill >= 1 or self.read_language_ok:
            return False
        return not self.plot_critical

    def _believer_gate(self) -> dict[str, bool]:
        is_believer = _read_believer(self.campaign_dir, self.investigator_id)
        return {"can_defer_san": not is_believer}

    # ------------------------------------------------------------------ #
    # read(phase)
    # ------------------------------------------------------------------ #
    def read(self, phase: str, *, choose_disbelief: bool = False) -> dict[str, Any]:
        """Study the tome at ``phase`` ∈ {skim, initial, full, research}.

        Never applies SAN loss — returns ``san_loss_expr`` for the caller.
        CM amounts are recorded in this session's snapshot; the caller merges
        them into character sheets.
        """
        if phase not in VALID_PHASES:
            return {"blocked": "unknown_phase", "phase": phase}

        if self._language_blocked():
            return {"blocked": "language_gate"}

        if phase == "skim":
            return self._read_skim()
        if phase == "initial":
            return self._read_initial(choose_disbelief=choose_disbelief)
        if phase == "full":
            return self._read_full(choose_disbelief=choose_disbelief)
        return self._read_research()

    def _base_result(self, phase: str) -> dict[str, Any]:
        result: dict[str, Any] = {
            "phase": phase,
            "tome_name": self.tome_name,
            "investigator_id": self.investigator_id,
            "believer_gate": self._believer_gate(),
        }
        if self.plot_critical and self.language_skill < 1 and not self.read_language_ok:
            result["keeper_note"] = "skip_failure_gate"
        return result

    def _read_skim(self) -> dict[str, Any]:
        result = self._base_result("skim")
        result["hours"] = SKIM_HOURS
        result["cm_gain"] = 0
        result["summary"] = "atmosphere_and_contents_only"
        if "skim" not in self.phases_completed:
            self.phases_completed.append("skim")
        self._event("tome_skim", {
            "tome_name": self.tome_name,
            "hours": SKIM_HOURS,
            "summary": f"{self.investigator_id} skimmed {self.tome_name}.",
        })
        self._persist_if_campaign()
        return result

    def _read_initial(self, *, choose_disbelief: bool) -> dict[str, Any]:
        result = self._base_result("initial")
        full_weeks = int(self.tome["full_study_weeks"])
        weeks = max(1, full_weeks // 4)
        raw_cm = int(self.tome["cthulhu_mythos_initial"])
        cm_gain = _halve_cm(raw_cm) if choose_disbelief else raw_cm
        san_expr = self.tome["sanity_cost"]

        result["cm_gain"] = cm_gain
        result["san_loss_expr"] = san_expr
        result["weeks"] = weeks
        if choose_disbelief:
            result["disbelief_chosen"] = True

        self.cm_gained += cm_gain
        self.weeks_spent += weeks
        if "initial" not in self.phases_completed:
            self.phases_completed.append("initial")

        self._event("tome_initial", {
            "tome_name": self.tome_name,
            "cm_gain": cm_gain,
            "san_loss_expr": san_expr,
            "weeks": weeks,
            "disbelief_chosen": bool(choose_disbelief),
            "summary": (
                f"{self.investigator_id} initial-read {self.tome_name}: "
                f"+{cm_gain} CM, SAN {san_expr}, {weeks} weeks."
            ),
        })
        self._persist_if_campaign()
        return result

    def _read_full(self, *, choose_disbelief: bool) -> dict[str, Any]:
        if "initial" not in self.phases_completed:
            return {"blocked": "initial_required"}

        result = self._base_result("full")
        full_weeks = int(self.tome["full_study_weeks"])
        mythos_rating = int(self.tome["mythos_rating"])
        repeat = self._full_count >= 1

        if repeat:
            weeks = full_weeks * 2
            cm_gain = 0
        else:
            weeks = full_weeks
            raw_cm = int(self.tome["cthulhu_mythos_full"])
            cm_gain = _halve_cm(raw_cm) if choose_disbelief else raw_cm

        result["cm_gain"] = cm_gain
        result["mythos_rating"] = mythos_rating
        result["weeks"] = weeks
        result["spells_glimpsed"] = True
        # SAN cost applies on initial reading per table; full study may still
        # surface the expression for callers that track cumulative exposure.
        # Spec: initial carries san_loss_expr; full does not re-emit unless
        # choose_disbelief path needs the gate surface — keep san only on
        # phases that grant new Mythos insight with a cost. Repeat full has
        # no new CM and no new SAN expression.
        if not repeat:
            result["san_loss_expr"] = self.tome["sanity_cost"]
            if choose_disbelief:
                result["disbelief_chosen"] = True
                # Disbelief halves CM (already applied); SAN expr unchanged.
        else:
            result["repeat_full"] = True

        self.cm_gained += cm_gain
        self.weeks_spent += weeks
        self._full_count += 1
        if "full" not in self.phases_completed:
            self.phases_completed.append("full")

        self._event("tome_full", {
            "tome_name": self.tome_name,
            "cm_gain": cm_gain,
            "weeks": weeks,
            "mythos_rating": mythos_rating,
            "spells_glimpsed": True,
            "repeat_full": repeat,
            "summary": (
                f"{self.investigator_id} full-studied {self.tome_name}: "
                f"+{cm_gain} CM, {weeks} weeks, MR {mythos_rating}."
            ),
        })
        self._persist_if_campaign()
        return result

    def _read_research(self) -> dict[str, Any]:
        if "full" not in self.phases_completed:
            return {"blocked": "full_required"}

        result = self._base_result("research")
        mythos_rating = int(self.tome["mythos_rating"])
        result["roll"] = {
            "kind": "mythos_rating",
            "target": mythos_rating,
            "dice": "1D100",
            "tome_name": self.tome_name,
        }
        if "research" not in self.phases_completed:
            self.phases_completed.append("research")

        self._event("tome_research", {
            "tome_name": self.tome_name,
            "target": mythos_rating,
            "summary": (
                f"{self.investigator_id} researches via {self.tome_name} "
                f"(Mythos Rating {mythos_rating})."
            ),
        })
        self._persist_if_campaign()
        return result

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "investigator_id": self.investigator_id,
            "tome_name": self.tome_name,
            "phases_completed": list(self.phases_completed),
            "cm_gained": self.cm_gained,
            "weeks_spent": self.weeks_spent,
            "full_count": self._full_count,
            "language_skill": self.language_skill,
            "read_language_ok": self.read_language_ok,
            "plot_critical": self.plot_critical,
        }

    def save(self, campaign_dir: Path | None = None) -> Path:
        """Persist snapshot to save/tomes.json. Returns the path written."""
        root = Path(campaign_dir) if campaign_dir is not None else self.campaign_dir
        if root is None:
            raise ValueError("campaign_dir required to save TomeSession")
        path = _tomes_save_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        coc_fileio.write_json_atomic(
            path, self.snapshot(), indent=2, ensure_ascii=False, trailing_newline=True
        )
        return path

    def _persist_if_campaign(self) -> None:
        if self.campaign_dir is not None:
            self.save(self.campaign_dir)

    @classmethod
    def load(
        cls,
        campaign_dir: Path,
        investigator_id: str,
        *,
        rng: random.Random | None = None,
    ) -> "TomeSession":
        """Reconstruct from save/tomes.json.

        Raises FileNotFoundError if no snapshot exists. The saved
        investigator_id must match ``investigator_id``.
        """
        path = _tomes_save_path(campaign_dir)
        if not path.exists():
            raise FileNotFoundError(f"no tome snapshot at {path}")
        snap = json.loads(path.read_text(encoding="utf-8"))
        if snap.get("investigator_id") != investigator_id:
            raise ValueError(
                f"snapshot investigator_id {snap.get('investigator_id')!r} "
                f"!= {investigator_id!r}"
            )
        sess = cls(
            investigator_id,
            snap["tome_name"],
            rng=rng or random.Random(),
            campaign_dir=campaign_dir,
            language_skill=int(snap.get("language_skill", 0)),
            read_language_ok=bool(snap.get("read_language_ok", False)),
            plot_critical=bool(snap.get("plot_critical", False)),
        )
        sess.phases_completed = list(snap.get("phases_completed") or [])
        sess.cm_gained = int(snap.get("cm_gained", 0))
        sess.weeks_spent = int(snap.get("weeks_spent", 0))
        sess._full_count = int(snap.get("full_count", 0))
        if sess._full_count == 0 and "full" in sess.phases_completed:
            sess._full_count = 1
        return sess

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"tm{self._event_counter}", **payload}
        self.events.append(ev)
        return ev
