#!/usr/bin/env python3
"""Time from the player's prompt to the first prose the player can see: the owner's 60 s metric (2026-09-26).

Usage: python3 tests/play/first_prose.py <playtest run dir>   (a driver run under .coc/playtests/)


Narrate / apply.narrate prose is not rendered while its tool args stream: it appears when the
coc-mechanics entry lands (pipicoc/mechanics.js). A host-placed or implicit delivery shows at the
message end. t0 is the run's agent_start (the driver's own quiet-wait before the prompt is harness time, not
play). The App records the same moment itself in turns.jsonl (durations.firstProseMs, contract section 135.11.5).
"""
import json, sys
from datetime import datetime
P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
run = sys.argv[1]
ev = [json.loads(l) for l in open(f'{run}/events.jsonl')]
rows = []
for n in range(1, 100):
    try: t = json.load(open(f'{run}/turn-{n}.json'))
    except FileNotFoundError: break
    s, e = P(t['started_at']), P(t['ended_at'])
    win = [d for d in ev if s <= P(d['_recv_at']) <= e]
    starts = [i for i, d in enumerate(win) if d['type'] == 'agent_start']
    if not starts: rows.append((n, None, None, 'no-agent-start')); continue
    a = starts[-1]
    prompt = next((P(d['_recv_at']) for d in win if d['type'] == 'response' and d.get('command') == 'prompt' and P(d['_recv_at']) >= P(win[a]['_recv_at'])), None)
    t0 = P(win[a]['_recv_at'])
    vis, how = None, None
    for d in win[a:]:
        if d['type'] == 'entry_appended' and d['entry'].get('customType') == 'coc-mechanics':
            vis, how = P(d['_recv_at']), 'mechanics'; break
    if vis is None:
        end = next((P(d['_recv_at']) for d in win[a:] if d['type'] == 'agent_end'), e)
        vis, how = end, 'message_end'
    rows.append((n, round((vis - t0).total_seconds(), 1), round(t['wall_seconds'], 1), how))
for r in rows: print(*r)
v = sorted(r[1] for r in rows if r[1] is not None)
print(f'first visible prose: median {v[len(v)//2]} max {v[-1]} <=60: {sum(x <= 60 for x in v)}/{len(v)}')
