"""§16 system language: no Chinese in code or in the system content the kernel serves, and
the delivery is verbatim -- a zh-Hans turn is delivered as written with every receipt
projected, and no player-facing field is refused by its script: the play language is open
(contract section 23), any tag-shaped play_language opens a table, and whether a delivery is
in it is the verifier lane's finding, never a kernel refusal.

The guard reads bytes, not semantics: any CJK character (ideographs, kana, hangul, CJK
punctuation, fullwidth forms) anywhere in the file -- comments included -- fails it.
Module content and the rules glossary are data and are not scanned."""

from __future__ import annotations

import json
import re
from pathlib import Path

from conftest import CAMPAIGN, MODULE, PREGEN, WORKTREE, open_turn

GUARDED_DIRS = ("kernel-ts", "content/setup")
# Contract §137: the craft lines a table's `style` carries are package system content, English like every instruction.
GUARDED_FILES = ("mods/narration-craft/style.json",)
GUARDED_GLOBS = ("bin/coc-*",)
SKIP_PARTS = {"__pycache__", ".pytest_cache"}

CJK = re.compile(
    "["
    "\u2e80-\u2fdf"    # CJK radicals, Kangxi radicals
    "\u3000-\u303f"    # CJK symbols and punctuation
    "\u3040-\u30ff"    # hiragana, katakana
    "\u3100-\u31ff"    # bopomofo, hangul compatibility jamo, kanbun, CJK strokes, katakana extensions
    "\u3200-\u33ff"    # enclosed CJK letters, CJK compatibility
    "\u3400-\u4dbf"    # CJK unified ideographs extension A
    "\u4e00-\u9fff"    # CJK unified ideographs
    "\uac00-\ud7af"    # hangul syllables
    "\uf900-\ufaff"    # CJK compatibility ideographs
    "\ufe30-\ufe4f"    # CJK compatibility forms
    "\uff00-\uffef"    # halfwidth and fullwidth forms
    "\U00020000-\U0003134f"  # CJK unified ideographs extensions B-G
    "]"
)


def guarded_files() -> list[Path]:
    files: list[Path] = []
    for directory in GUARDED_DIRS:
        for path in sorted((WORKTREE / directory).rglob("*")):
            if directory == "kernel-ts" and path.suffix != ".ts":
                continue
            if path.is_file() and not (SKIP_PARTS & set(path.parts)):
                files.append(path)
    files.extend(WORKTREE / f for f in GUARDED_FILES)
    for pattern in GUARDED_GLOBS:
        files.extend(sorted(WORKTREE.glob(pattern)))
    return files


def test_no_cjk_character_anywhere_in_code_or_system_content():
    hits: list[str] = []
    files = guarded_files()
    assert any(p.name == "handlers.ts" for p in files) and any(p.name == "visual-reader.md" for p in files)
    assert any(p.name == "coc-source" for p in files) and any(p.name == "style.json" for p in files)
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # bytes, not text (an image in a fixture)
        for number, line in enumerate(text.splitlines(), start=1):
            if CJK.search(line):
                hits.append(f"{path.relative_to(WORKTREE)}:{number}: {line.strip()[:80]}")
    assert not hits, "CJK characters in code or system content (§16.1):\n" + "\n".join(hits[:40])


def test_a_zh_hans_turn_is_delivered_verbatim_with_every_receipt_projected(kernel):
    open_turn(kernel, "我翻看桌上的文件，然后去档案馆。")
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "找线索", "method": "翻找",
                                                    "skill": "Spot Hidden"})
    kernel.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-keys", "label": "钥匙"},
        {"kind": "time", "minutes": 15},
        {"kind": "item", "name": "温彻斯特霰弹枪", "quantity": 1},
        {"kind": "damage", "dice": "1D3", "why": "被抽屉夹了"},
        {"kind": "move", "to": "hall-of-records", "travel_minutes": 20, "label": "档案馆"},
    ])
    status = kernel.table("status")
    receipts = {r["kind"] + ("-dice" if r.get("form") == "dice" else ""): r for r in status["receipts"]}
    roll, dice, delta = receipts["roll"], receipts["roll-dice"], receipts["delta"]
    assert [m["kind"] for m in status["mechanics"]] == ["roll", "clue", "time", "item", "dice", "change", "scene"]

    text = (f"你翻了翻文件，掷出 {roll['roll']}，侦查 {roll['target']}。抽屉夹了你的手，伤害 {dice['total']}，"
            f"生命值从 {delta['before']} 掉到 {delta['after']}。一刻钟（15 分钟）后你带着钥匙和一把霰弹枪去了档案馆。")
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert "【" not in result["rendered_text"]
    mechanics = result["mechanics"]
    assert [m["receipt"] for m in mechanics] == [r["id"] for r in status["receipts"]]
    assert mechanics[0] == {"kind": "roll", "marker": "check:spot-hidden", "receipt": roll["id"], "actor": "thomas-hayes", "skill": "Spot Hidden",
                            "actor_label": "托马斯·海斯", "actor_is_investigator": True,
                            "roll": roll["roll"], "target": roll["target"], "threshold": roll["threshold"],
                            "difficulty": "regular", "level": roll["level"], "passed": roll["passed"], "pushed": False,
                            "bonus": 0, "penalty": 0,
                            "visibility": "public", "call": "t1-c1", "family": "core-check"}
    assert mechanics[1] == {"kind": "clue", "marker": "clue:knott-keys", "receipt": "clue:knott-keys-t1", "clue": "knott-keys", "label": "钥匙",
                            "call": "t1-c2"}
    assert mechanics[2] == {"kind": "time", "marker": "time", "receipt": "time:t1-c2", "minutes": 15, "call": "t1-c2"}
    assert mechanics[3] == {"kind": "item", "marker": "item", "receipt": "item:t1-c2", "name": "温彻斯特霰弹枪", "quantity": 1,
                            "to": "thomas-hayes", "label": "温彻斯特霰弹枪", "to_label": "托马斯·海斯", "call": "t1-c2"}
    assert mechanics[4] == {"kind": "dice", "marker": "dice:damage", "receipt": dice["id"], "actor": "thomas-hayes", "label": "damage",
                            "actor_label": "托马斯·海斯", "actor_is_investigator": True,
                            "expression": "1D3", "faces": dice["faces"], "total": dice["total"], "visibility": "public",
                            "call": "t1-c2"}
    assert mechanics[5] == {"kind": "change", "marker": "change:hp", "receipt": delta["id"], "resource": "hp", "subject": "thomas-hayes",
                            "before": delta["before"], "after": delta["after"], "subject_label": "托马斯·海斯",
                            "subject_is_investigator": True, "call": "t1-c2"}
    assert mechanics[6] == {"kind": "scene", "marker": "scene:hall-of-records", "receipt": "move:hall-of-records-t1-c2", "from": "commission-briefing",
                            "to": "hall-of-records", "minutes": 20, "from_label": "Knott's Office", "to_label": "档案馆",
                            "call": "t1-c2"}
    # nothing the kernel wrote for the keeper is Chinese
    for line in result["facts"]["committed"][1:] + result["facts"]["keeper_only"]:
        assert not CJK.search(line.replace("托马斯·海斯", "").replace("钥匙", "").replace("温彻斯特霰弹枪", "").replace("档案馆", "")), line


def test_story_is_separate_from_roll_and_clock_json(kernel):
    open_turn(kernel)
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y", "skill": "Spot Hidden"})
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 10}])
    # The prose carries neither the roll nor the ten minutes: both reach the player only as
    # projection rows, and whatever the keeper wrote arrives verbatim (§16.3, 2026-09-09).
    done = kernel.table("narrate", call_id="t1-c3", text="你收起了笔记，走回门边。")
    assert done["rendered_text"] == "你收起了笔记，走回门边。"
    assert [row["kind"] for row in done["mechanics"]] == ["roll", "time"]
    assert done["mechanics"][1]["minutes"] == 10


def test_no_player_facing_field_is_refused_by_its_script(kernel):
    """Latin-only prose, prompt and options on the zh-Hans table are delivered as written: the
    kernel has no script table to look in (contract section 23)."""
    open_turn(kernel)
    text = "The Scene is quiet. The Keeper waits."
    prose = kernel.table("narrate", call_id="t1-c1", text=text)
    assert prose["rendered_text"] == text
    kernel.table("player_input", text="我四处看看。")
    asked = kernel.table("ask", call_id="t2-c1", prompt="What does the Investigator do?", options=["Look around", "离开"])
    assert asked["state"] == "asked"
    assert asked["rendered_text"] == ""
    assert asked["interaction"]["options"] == ["Look around", "离开"]


def test_any_tag_shaped_play_language_opens_a_table_and_a_malformed_one_names_the_shape(kernel):
    error = kernel.err("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN, "play_language": "Not A Tag"})
    assert error["code"] == "invalid_params" and error["details"]["field"] == "play_language"
    assert error["details"]["suggested"] == json.loads((WORKTREE / "content/languages.json").read_text())["suggested"]
    assert "options" not in error["details"] and "BCP-47" in error["fix"]
    # A tag no data names, delivered in whatever script the Keeper writes.
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN, "play_language": "pt-BR"})
    assert kernel.table("view")["play_language"] == "pt-BR"
    kernel.table("narrate", call_id="t0-c1", text="Boston, 1920. Knott sets a key on the desk. 钥匙。")
    kernel.table("player_input", text="I look around.")
    asked = kernel.table("ask", call_id="t1-c1", prompt="What do you do?",
                         options=["Search the desk", "离开"])
    assert asked["state"] == "asked"
    assert asked["rendered_text"] == ""
    assert asked["interaction"]["options"] == ["Search the desk", "离开"]
