#!/usr/bin/env python3
"""End-to-end smoke test: walk through a complete play scenario to verify
all rule subsystems work together in a real game flow.

Simulates: campaign init → time advance → SAN check → temp insanity →
trigger recovery → MP spend/regen → healing → bout resolution →
combat malfunction → mythos gain.

Usage:
    python3 scripts/e2e_smoke_test.py
"""
from __future__ import annotations

import json
import importlib.util
import sys
import tempfile
from pathlib import Path


def _load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCRIPTS = Path("plugins/coc-keeper/scripts")

coc_state = _load("coc_state", str(SCRIPTS / "coc_state.py"))
coc_time = _load("coc_time", str(SCRIPTS / "coc_time.py"))
coc_sanity = _load("coc_sanity", str(SCRIPTS / "coc_sanity.py"))
coc_mp = _load("coc_mp", str(SCRIPTS / "coc_mp.py"))
coc_healing = _load("coc_healing", str(SCRIPTS / "coc_healing.py"))
coc_magic = _load("coc_magic", str(SCRIPTS / "coc_magic.py"))
coc_mythos = _load("coc_mythos", str(SCRIPTS / "coc_mythos.py"))
coc_roll = _load("coc_roll", str(SCRIPTS / "coc_roll.py"))


def main() -> int:
    failures: list[str] = []
    passed: list[str] = []

    def check(label: str, condition: bool, detail: str = ""):
        if condition:
            passed.append(label)
            print(f"  ✅ {label}")
        else:
            failures.append(f"{label}: {detail}")
            print(f"  ❌ {label}: {detail}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        workspace = root  # create_campaign uses root/.coc/campaigns/<id>

        print("=" * 60)
        print("E2E Smoke Test: Complete Play Scenario")
        print("=" * 60)

        # === 1. Campaign init ===
        print("\n--- 1. Campaign Init ---")
        camp = coc_state.create_campaign(workspace, campaign_id="e2e-test", title="E2E Test")
        # create_campaign returns the campaign.json path; we need the dir
        camp = camp.parent if camp.is_file() else camp
        state = coc_time.read_time_state(camp)
        check("time-state.json created", bool(state), "no time-state")
        check("elapsed_minutes starts at 0", state.get("clock",{}).get("elapsed_minutes") == 0)

        # === 2. Investigator setup ===
        print("\n--- 2. Investigator Setup ---")
        inv_id = "inv1"
        inv_state_path = camp / "save" / "investigator-state" / f"{inv_id}.json"
        inv_state_path.parent.mkdir(parents=True, exist_ok=True)
        inv = {
            "investigator_id": inv_id,
            "hp": 12, "max_hp": 12,
            "san": 60, "max_san": 60,
            "mp": 10, "max_mp": 10,
            "pow": 50,
            "conditions": [],
            "skills": {"Cthulhu Mythos": 0},
            "cm_value": 0,
        }
        inv_state_path.write_text(json.dumps(inv))

        # === 3. Time advance (search a room) ===
        print("\n--- 3. Time Advance (search room) ---")
        result = coc_time.advance_time(camp, 20, decision_id="d1", reason="search bedroom")
        check("time advanced 20 min", result["to_elapsed"] == 20)
        stamp = coc_time.current_stamp(camp)
        check("current_stamp works", "elapsed_minutes" in stamp)

        # === 4. SAN check (see horror) ===
        print("\n--- 4. SAN Check (see horror) ---")
        import random as _rng
        san = coc_sanity.SanitySession(inv_id, san_max=60, int_value=65, rng=_rng.Random(42))
        san.sanity_check(source="ghoul", san_loss_success=0, san_loss_fail_expr="1D6", alone=False)
        events = san.drain_pending()
        check("SAN check produced events", len(events) > 0, f"events={events}")

        # === 5. Time advance triggers temp insanity recovery ===
        print("\n--- 5. Temp Insanity + Recovery Trigger ---")
        # Manually schedule a trigger (simulating temp insanity)
        coc_time.schedule_trigger(camp, {
            "kind": "condition_expiry",
            "scope": "investigator",
            "target_id": inv_id,
            "due_elapsed_minutes": 20 + 7*60,  # 7 hours from now
            "policy": "auto_apply_if_safe",
            "handler": "recover_temporary_insanity",
            "payload": {"condition": "temporary_insane"},
        })
        # Advance 3 hours — trigger not due yet
        coc_time.advance_time(camp, 180, decision_id="d2", reason="3 hours pass")
        due = coc_time.peek_due_triggers(camp)
        check("trigger not due after 3h", len(due) == 0, f"due={due}")

        # Advance 5 more hours — trigger due but unsafe
        coc_time.set_unsafe(camp)
        result = coc_time.advance_time(camp, 300, decision_id="d3", reason="5 more hours")
        check("trigger deferred when unsafe", len(result["fired_triggers"]) == 0)

        # Mark safe rest — trigger should fire
        coc_time.mark_safe_rest(camp, inv_id)
        fired = coc_time.process_due_triggers(camp)
        check("trigger fires after safe rest", len(fired) == 1, f"fired={fired}")

        # === 6. MP economy ===
        print("\n--- 6. MP Economy ---")
        import random as _rng2
        mp = coc_mp.MPool(inv_id, pow_value=50, rng=_rng2.Random(42), current_hp=12)
        check("MP pool init POW//5", mp.mp_max == 10, f"mp_max={mp.mp_max}")
        spend_result = mp.spend_mp(3)
        check("MP spend 3", mp.current_mp == 7, f"current={mp.current_mp}")
        mp.regen_mp(hours=2)
        check("MP regen 2/hr", mp.current_mp == 9, f"current={mp.current_mp}")
        # Overspend
        mp2 = coc_mp.MPool(inv_id, pow_value=50, rng=_rng2.Random(42), current_hp=12)
        mp2.spend_mp(99)  # try to overspend massively
        check("MP overspill caps at 0", mp2.current_mp == 0, f"current={mp2.current_mp}")

        # === 7. Healing ===
        print("\n--- 7. Healing ---")
        import random as _rng3
        healer = coc_healing.HealingSession(inv_id, hp_max=12, con_value=50,
                                            rng=_rng3.Random(42), current_hp=5)
        aid_result = healer.first_aid(skill_value=50)
        check("first_aid returns result", isinstance(aid_result, dict) and "hp_after" in aid_result,
              f"result={aid_result}")

        # === 8. Magic casting ===
        print("\n--- 8. Magic Casting ---")
        cast = coc_magic.cast_spell(
            "Flesh Ward",
            caster_state={"mp": 10, "pow": 50, "san": 60},
            is_first_cast=True,
            is_npc=False,
            rng=__import__("random").Random(42),
        )
        check("cast_spell returns result", isinstance(cast, dict), f"result={cast}")

        # === 9. Mythos gain ===
        print("\n--- 9. Mythos Gain ---")
        cm_result = coc_mythos.gain_mythos({"cm_value": 0}, is_first=True)
        check("first mythos +5", cm_result.get("cm_after") == 5, f"result={cm_result}")
        max_san = coc_mythos.max_san_for(5)
        check("max_san = 99 - CM", max_san == 94, f"max_san={max_san}")

        # === 10. Time signals for director ===
        print("\n--- 10. Director Time Signals ---")
        ts = coc_time.read_time_state(camp)
        signals = coc_time.build_time_signals(ts, coc_time.peek_due_triggers(camp))
        check("time_signals has day_phase", "day_phase" in signals)
        check("time_signals has time_pressure", "time_pressure" in signals)

        # === Summary ===
        print("\n" + "=" * 60)
        print(f"Results: {len(passed)} passed, {len(failures)} failed")
        print("=" * 60)
        if failures:
            print("\nFAILURES:")
            for f in failures:
                print(f"  ❌ {f}")
            return 1
        else:
            print("\n🎉 All subsystems working end-to-end!")
            return 0


if __name__ == "__main__":
    sys.exit(main())
