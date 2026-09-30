#!/bin/bash
# usage: play-turn.sh <worktree> <run> "<player line>"   -- one live turn; prints the prose and what rolled
wt=$1; run=$2; line=$3
cd "$wt" || exit 1
python3 tests/play/driver.py turn "$line" --run "$run" --timeout 300 > /dev/null 2>"$wt/.coc/playtests/$run/play-turn.err"; rc=$?
python3 - "$wt/.coc/playtests/$run" "$rc" <<'PY'
import json,sys,glob,os
d=sys.argv[1]; rc=sys.argv[2]
turns=sorted(glob.glob(d+'/turn-*.json'),key=lambda p:int(p.rsplit('-',1)[1].split('.')[0]))
t=json.load(open(turns[-1]))
print(f"[turn {t['turn']} rc {rc} wall {t.get('wall_seconds')} settle {t.get('settle_class')}/{t.get('stop_reason')} delivery {(t.get('delivery') or {}).get('kind')}]")
for x in t.get('tools') or []:
  if x['name'] in ('resolve',):
    a=(x.get('args') or {}).get('action') or {}
    r=x.get('result_text') or ''
    print(f"  KP resolve: {a.get('decision') or a.get('rule')} skill={a.get('skill')} intent={a.get('intent')} -> {r[:160]}")
ev=[json.loads(l) for l in open(d+'/events.jsonl')]
rows=[((e.get('entry') or {}).get('data') or {}) for e in ev if e.get('type')=='entry_appended' and ((e.get('entry') or {}).get('data') or {}).get('lane')=='jev-rolls']
if rows:
  r=rows[-1]; st=(r.get('stages') or [{}])[0]; a=st.get('answers') or {}
  rn=(a.get('route') or {}).get('roll_now'); rt=((a.get('route') or {}).get('route') or {})
  print(f"  jev-rolls: reason={r.get('reason')} roll_now={rn} route={rt.get('choice') if isinstance(rt,dict) else rt} skill={a.get('skill')} ms={st.get('ms')}")
  for x in r.get('executed') or []:
    print(f"  HOST roll: {x.get('skill') or x.get('decision')} -> {json.dumps(x.get('outcome'),ensure_ascii=False)[:200]}")
print('---'); print(t.get('final_text') or (t.get('delivery') or {}).get('rendered_text') or '(no prose)')
PY
