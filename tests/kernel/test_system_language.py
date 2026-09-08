"""§16 system language: no Chinese in code or in the system content the kernel serves, and
the delivery floor -- a zh-Hans turn is delivered verbatim with every receipt projected,
a text that skips a public number is refused naming the receipt, and a player-facing field
that carries no CJK is refused as play_language_mismatch.

The guard reads bytes, not semantics: any CJK character (ideographs, kana, hangul, CJK
punctuation, fullwidth forms) anywhere in the file -- comments included -- fails it.
Module content and the rules glossary are data and are not scanned."""

from __future__ import annotations

import re
from pathlib import Path

from conftest import CAMPAIGN, MODULE, PREGEN, WORKTREE, open_turn, stating

GUARDED_DIRS = ("kernel", "content/setup")
GUARDED_FILES = ("content/craft/beat-directives.json",)
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
            if path.is_file() and not (SKIP_PARTS & set(path.parts)):
                files.append(path)
    files.extend(WORKTREE / f for f in GUARDED_FILES)
    for pattern in GUARDED_GLOBS:
        files.extend(sorted(WORKTREE.glob(pattern)))
    return files


def test_no_cjk_character_anywhere_in_code_or_system_content():
    hits: list[str] = []
    files = guarded_files()
    assert any(p.name == "table.py" for p in files) and any(p.name == "visual-reader.md" for p in files)
    assert any(p.name == "coc-source" for p in files) and any(p.name == "beat-directives.json" for p in files)
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
    assert mechanics[0] == {"kind": "roll", "receipt": roll["id"], "actor": "thomas-hayes", "skill": "Spot Hidden",
                            "actor_label": "托马斯·海斯", "actor_is_investigator": True,
                            "roll": roll["roll"], "target": roll["target"], "threshold": roll["threshold"],
                            "difficulty": "regular", "level": roll["level"], "passed": roll["passed"], "pushed": False,
                            "visibility": "public", "call": "t1-c1", "family": "core-check"}
    assert mechanics[1] == {"kind": "clue", "receipt": "clue:knott-keys-t1", "clue": "knott-keys", "label": "钥匙",
                            "summary": "Knott hands over the house keys, the address, and $20 cash in advance.",
                            "call": "t1-c2"}
    assert mechanics[2] == {"kind": "time", "receipt": "time:t1-c2", "minutes": 15, "call": "t1-c2"}
    assert mechanics[3] == {"kind": "item", "receipt": "item:t1-c2", "name": "温彻斯特霰弹枪", "quantity": 1,
                            "to": "thomas-hayes", "label": "温彻斯特霰弹枪", "to_label": "托马斯·海斯", "call": "t1-c2"}
    assert mechanics[4] == {"kind": "dice", "receipt": dice["id"], "actor": "thomas-hayes", "label": "damage",
                            "actor_label": "托马斯·海斯", "actor_is_investigator": True,
                            "expression": "1D3", "faces": dice["faces"], "total": dice["total"], "visibility": "public",
                            "call": "t1-c2"}
    assert mechanics[5] == {"kind": "change", "receipt": delta["id"], "resource": "hp", "subject": "thomas-hayes",
                            "before": delta["before"], "after": delta["after"], "subject_label": "托马斯·海斯",
                            "subject_is_investigator": True, "call": "t1-c2"}
    assert mechanics[6] == {"kind": "scene", "receipt": "move:hall-of-records-t1-c2", "from": "commission-briefing",
                            "to": "hall-of-records", "minutes": 20, "from_label": "Knott's Office", "to_label": "档案馆",
                            "call": "t1-c2"}
    # nothing the kernel wrote for the keeper is Chinese
    for line in result["facts"]["committed"][1:] + result["facts"]["keeper_only"]:
        assert not CJK.search(line.replace("托马斯·海斯", "").replace("钥匙", "").replace("温彻斯特霰弹枪", "").replace("档案馆", "")), line


def test_story_is_separate_from_roll_and_clock_json(kernel):
    open_turn(kernel)
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "x", "method": "y", "skill": "Spot Hidden"})
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 10}])
    # §16.3 has two floors and this test is about neither: the delivery must state the
    # figures its public receipts settled (#84), so `stating` supplies them the way a keeper
    # would, and the point being made is that whatever the keeper wrote arrives verbatim.
    text = stating(kernel, "你收起了笔记，走回门边。")
    done = kernel.table("narrate", call_id="t1-c3", text=text)
    assert done["rendered_text"] == text
    assert [row["kind"] for row in done["mechanics"]] == ["roll", "time"]
    assert done["mechanics"][1]["minutes"] == 10


def test_zh_hans_player_facing_english_is_refused(kernel):
    open_turn(kernel)
    error = kernel.table_err(
        "ask", call_id="t1-c1",
        prompt="What does the Investigator do?",
        options=["Look around", "Leave"],
    )
    assert error["code"] == "invalid_params" and error["code_detail"] == "play_language_mismatch"
    assert error["details"]["play_language"] == "zh-Hans"
    assert error["details"]["fields"] == ["prompt", "options[0]", "options[1]"]
    assert "prompt" in error["fix"] and "zh-Hans" in error["fix"]
    assert not CJK.search(error["message"]) and not CJK.search(error["fix"])
    assert kernel.table("status")["state"] == "open"

    one = kernel.table_err(
        "ask", call_id="t1-c1", prompt="你要怎么做？", options=["留下", "Leave"],
    )
    assert one["code_detail"] == "play_language_mismatch"
    assert one["details"]["fields"] == ["options[1]"]

    prose = kernel.table_err("narrate", call_id="t1-c1", text="The Scene is quiet. The Keeper waits.")
    assert prose["code_detail"] == "play_language_mismatch"
    assert prose["details"]["fields"] == ["text"]
    assert kernel.table("status")["state"] == "open"

    done = kernel.table("ask", call_id="t1-c1", prompt="你要怎么做？", options=["留下", "离开"])
    assert done["state"] == "asked"
    assert done["rendered_text"] == ""
    assert done["interaction"]["options"] == ["留下", "离开"]


def test_en_delivery_is_not_script_checked(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN, "play_language": "en"})
    kernel.table("narrate", call_id="t0-c1", text="Boston, 1920. Knott sets a key on the desk.")
    kernel.table("player_input", text="I look around.")
    asked = kernel.table("ask", call_id="t1-c1", prompt="What do you do?",
                         options=["Search the desk", "Leave"])
    assert asked["state"] == "asked"
    assert asked["rendered_text"] == ""
    assert asked["interaction"]["options"] == ["Search the desk", "Leave"]
