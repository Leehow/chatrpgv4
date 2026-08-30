#!/usr/bin/env python3
"""Capture pre-slice golden envelopes for R6 lookup/damage/SAN legacy ops."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path("plugins/coc-keeper/scripts")))
sys.path.insert(0, "tests")
from toolbox_test_support import _run, _write_json, coc_starter  # noqa: E402

OUT = Path("tests/fixtures/lookups-pre-slice-golden.json")
_SCENE_HINT_PREFIX = "scene state was updated"


def _workspace(tmp: Path) -> dict:
    workspace = tmp / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "toolbox-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Toolbox Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _strip(result: dict) -> dict:
    data = dict(result.get("data") or {})
    for key in ("roll_id", "request_digest", "receipt_id", "integrity_digest"):
        data.pop(key, None)
    hints = [
        hint for hint in (result.get("hints") or [])
        if not str(hint).startswith(_SCENE_HINT_PREFIX)
    ]
    return {
        "ok": result["ok"],
        "warnings": list(result.get("warnings") or []),
        "hints": hints,
        "data_keys": sorted(data),
    }


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="r6-golden-"))
    ws = _workspace(tmp)
    skill = _run(ws, "rules.skill_describe", {"skill": "Persuade"})
    catalog = _run(ws, "rules.catalog_search", {"query": "handgun"})
    build = _run(ws, "rules.build_scale", {"build": 0})
    cash = _run(ws, "rules.cash_assets", {"credit_rating": 20})
    damage = _run(ws, "rules.damage", {
        "investigator": ws["investigator_id"],
        "amount": "1",
        "kind": "damage",
        "source": "golden fall",
        "seed": 3,
        "decision_id": "golden-damage",
    })
    sanity = _run(ws, "rules.sanity_check", {
        "investigator": ws["investigator_id"],
        "source": "golden corpse",
        "loss_success": "0",
        "loss_failure": "1",
        "seed": 3,
        "decision_id": "golden-san",
    })
    golden = {
        "provenance": {
            "generator": "tests/fixtures/_gen_lookups_golden.py",
            "note": (
                "Pre-slice golden from current main envelopes. Graph-absent "
                "legacy path must stay byte-stable on these pins."
            ),
        },
        "skill_describe": _strip(skill),
        "catalog_search": {"ok": catalog["ok"]},
        "build_scale": {"ok": build["ok"]},
        "cash_assets": {
            "ok": cash["ok"],
            "credit_rating": cash["data"]["credit_rating"],
        },
        "damage": {
            "ok": damage["ok"],
            "hp_after": damage["data"]["hp_after"],
        },
        "sanity_check": {
            "ok": sanity["ok"],
            "san_loss": sanity["data"]["san_loss"],
        },
    }
    OUT.write_text(json.dumps(golden, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(golden, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
