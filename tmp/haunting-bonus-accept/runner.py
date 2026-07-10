#!/usr/bin/env python3
import json, sys
from pathlib import Path
TURNS = [
    ("我先问诺特先生：这栋房子之前的房客出了什么事？为什么租金压得这么低？", "social"),
    ("我去报社的旧报档案室，翻查这栋房子地址相关的旧新闻。", "investigate"),
    ("带上手电和撬棍，我们直接去科比特老宅，从正门进去。", "move"),
    ("我在一楼客厅仔细搜查，注意地板、墙壁和任何异常的痕迹。", "investigate"),
    ("我们上楼，去那间传说闹鬼最凶的卧室看看。", "move"),
    ("我检查床底和衣柜，留意有没有暗格或者被翻动过的地方。", "investigate"),
]
sp = Path(__file__).with_suffix(".state")
i = int(sp.read_text()) if sp.exists() else 0
json.loads(sys.stdin.read())
t, intent = TURNS[min(i, len(TURNS)-1)]
sp.write_text(str(i+1))
print(json.dumps({"ok": True, "player_text": t, "intent_class": intent, "player_notes": f"turn {i+1}"}, ensure_ascii=False))
