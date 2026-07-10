#!/usr/bin/env python3
"""Scripted fake player runner v2: structured intent_class per turn."""
import json
import sys
from pathlib import Path

TURNS = [
    ("我先向中尉确认任务细节：我们要炸的隧道段在哪里，预计奥军哨位分布如何？", "social"),
    ("出发前我检查装备，然后沿着鞍部侧脊隐蔽推进，注意雪面上的脚印。", "move"),
    ("我趴在雪脊后用望远镜观察奥军阵地，数一数哨兵人数和换岗节奏。", "investigate"),
    ("我示意队伍绕开哨位，从冰川裂缝一侧下降，寻找进入隧道的入口。", "move"),
    ("隧道里太安静了，我停下来仔细听——有没有凿冰声或者别的什么声音。", "investigate"),
    ("我举着提灯慢慢往前走，检查坑道壁上的支撑木和任何不自然的痕迹。", "investigate"),
    ("不管那声音是什么，任务优先。我们找到爆破室，开始安放炸药。", "move"),
    ("我让弟兄们先撤，自己最后离开，边退边放导火索。", "move"),
]

state_path = Path(__file__).with_suffix(".state")
idx = int(state_path.read_text()) if state_path.exists() else 0
req = json.loads(sys.stdin.read())
text, intent = TURNS[min(idx, len(TURNS) - 1)]
state_path.write_text(str(idx + 1))
out = {"ok": True, "player_text": text, "intent_class": intent,
       "player_notes": f"turn {idx + 1}: scripted acceptance input"}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
