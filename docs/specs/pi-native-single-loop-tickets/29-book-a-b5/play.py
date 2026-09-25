#!/usr/bin/env python3
"""Play script.md through driver.py, one sentence a turn, choosing marked branches from the kernel's turn records by
structural conditions only (never by reading prose). Usage: play.py <campaign> <run> [first_turn]"""
import json, os, subprocess, sys, time
W = '/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5'
HOME = f'{W}/.coc/playtests/sl29a-b5/home'
CID, RUN = sys.argv[1], sys.argv[2]
FIRST = int(sys.argv[3]) if len(sys.argv) > 3 else 1
def record(n):
    p = f'{HOME}/.coc/campaigns/{CID}/turns/{n:04d}.json'
    return json.load(open(p)) if os.path.exists(p) else {}
def world(n): return record(n).get('world') or {}
def present(n): return bool(world(n).get('present'))
def moved(n): return ((world(n).get('scene') or {}).get('name')) != ((world(n - 1).get('scene') or {}).get('name'))
def hurt(n):
    m = record(n).get('mechanics') or []
    return any(x.get('kind') == 'change' and x.get('resource') == 'hp' and (x.get('after') or 0) < (x.get('before') or 0) for x in m) \
        or any(x.get('kind') == 'session' for x in m)
T = {1: "我继续往前开，盯着油表，留意路边有没有加油站的牌子。",
     2: "我把收音机开大一点听听，再摊开地图看看这条路前面通到哪里。",
     3: "看到那块写着五英里后右转的小牌，我减速，记下里程表的数字。",
     4: "到了土路口我停车看了看那两块木头路标，然后拐上土路，往阿巴托尔开。",
     5: "过那座旧木桥之前我先下车，看看桥板和桥桩结不结实。",
     6: "到了镇口，我把车停在路边先不下车，看看镇子的样子，有没有人在外面。",
     7: "我开车去找能加油的地方，路标上说这里有汽油。",
     9: "等加油的时候，我拿出那个姑娘的照片，问这个月有没有见过她路过这里。",
     10: "我留意对方回答时的眼神和手，看他是不是在说谎。",
     11: "我付了钱，顺便问镇上有没有能住一晚的地方，管事的警长或者镇长在哪。",
     12: "我把车开进镇里，沿着主街慢慢开一遍，看看都有些什么店。",
     14: "我跟店里的人聊聊天气和生意，然后拿照片问那个姑娘。",
     15: "我去找镇上管事的人，问最近有没有外地人来过、有没有人报过失踪。",
     16: "我找个能看见主街的地方坐一会儿，留意有没有人在盯着我。",
     19: "我回到皮卡上，把今天问到的都记在本子上，再看看地图。"}
def sentence(n):
    if n == 8: return "我下车跟对方打招呼，说要把油加满，再问附近哪里能吃饭。" if present(7) else "我下车按了两下喇叭，喊一声有没有人能加油。"
    if n == 13: return "我在最近的一家店门口停车，进去买两瓶水和一点吃的。" if moved(12) else "我把车停在路边，下车沿着街走一遍。"
    if n == 17: return "我往皮卡那边退，手按着左轮，不先开枪。" if hurt(16) else "我去找个能吃饭的地方，边吃边听旁边的人聊什么。"
    if n == 18: return "我请旁边的人喝一杯，问他镇上的人为什么都不怎么出门。" if present(17) else "我问端菜的人，镇上晚上都干些什么。"
    if n == 20: return "我发动皮卡，掉头往大路上开。" if any(hurt(k) for k in range(15, 20)) else "我去能住的地方要一间房，顺便问老板这姑娘有没有在这住过。"
    return T[n]
log = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', '.coc', 'playtests', 'sl29a-b5', 'turns.log'), 'a')
env = dict(os.environ, PI_COC_HOME=HOME)
for n in range(FIRST, 21):
    s = sentence(n); t0 = time.time()
    out = subprocess.run(['uv', 'run', '--frozen', 'python', 'tests/play/driver.py', 'turn', s, '--run', RUN, '--timeout', '600'],
                         cwd=W, capture_output=True, text=True, env=env)
    tail = (out.stdout.strip().splitlines() or [''])[-1]
    line = f"turn {n} | {time.time() - t0:.1f}s | {s} | {tail[:160]}"
    print(line, flush=True); log.write(line + '\n'); log.flush()
    if out.returncode != 0: log.write(f"  rc={out.returncode} stderr={out.stderr[-300:]}\n"); log.flush()
