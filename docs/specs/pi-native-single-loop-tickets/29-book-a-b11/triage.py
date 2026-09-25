"""Per-turn structural triage of a driver table (same columns as batch-10's triage, extended for batch 11's
primary targets SL-65/66/67): python3 triage.py <campaign> <run>"""
import json, sys, os, glob, collections, statistics, re
W=os.environ.get('WT','/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b11'); CID, RUN = sys.argv[1], sys.argv[2]
C=os.path.join(os.environ.get('PI_COC_HOME',W),'.coc','campaigns',CID); P=f'{W}/.coc/playtests/{RUN}'
COC_HOME=os.path.dirname(os.path.dirname(C))
rows=[json.loads(l) for l in open(f'{C}/telemetry.jsonl') if l.strip()]
by=collections.defaultdict(list)
for r in rows: by[r.get('turn')].append(r)
def mech(t):
    p=f'{C}/turns/{t:04d}.json'
    if not os.path.exists(p): return [], None
    rec=json.load(open(p)); return rec.get('mechanics') or [], rec
def tool_result(t):
    # Driver tool-call records carry the kernel's reply as a JSON string in `result_text`, not as a
    # `result` dict (confirmed against real turn data: t.get('result') is always {} or None). Parse
    # result_text when present; fall back to `result` for any shape that does carry one.
    r = t.get('result')
    if isinstance(r, dict) and r: return r
    rt = t.get('result_text')
    if isinstance(rt, str) and rt.strip():
        try: return json.loads(rt)
        except (json.JSONDecodeError, ValueError): return {}
    return r or {}
print('turn | wall(driver) | provider calls (ms) | prescreen | compile sel | routes | binds (path) | admission (origin verb:verdict:path:ms) | looks | drops | budget | run_end | mechanics | closed')
walls=[]; allcalls=0; adm=[]; looks_total=0; stranded=[]; errors=[]; speech=collections.Counter(); infer_bind=0; san=[]
reasoning=[]  # SL-61: usage.reasoning per provider call
prepares=[]   # SL-58: source_mode=prepare lookups, per turn
batch_person_applies=[]  # SL-59: apply calls with >=2 npc/person effects, receipt count vs effect count
resumed_rows=[]  # SL-60
resolved_from_rows=[]  # SL-62
unknown_entity_rows=[]  # SL-62 (contrast)
refusal_budget_rows=[]  # SL-63
person_name_events=[]  # SL-64: every distinct name attempted via apply/resolve, per turn, with outcome + candidates
scene_rosters=[]  # SL-67: per-turn table.look{focus:"scene"} present/roster
prose_name_hits=[]  # SL-66: every narrate rendered_text containing the investigator's stored name, checked for stray punctuation
for dt in sorted(glob.glob(f'{P}/turn-*.json'), key=lambda p:int(p.split('-')[-1][:-5])):
    d=json.load(open(dt)); n=d['turn']; walls.append(d['wall_seconds'])
    # the driver's turn N is the kernel's turn N (turn 0 is the opening)
    R=by.get(n,[])
    pc=[r for r in R if r.get('lane')=='provider-call']; allcalls+=len(pc)
    errors+= [ (n,r.get('stop_reason'),r.get('error')) for r in pc if r.get('stop_reason')=='error']
    for r in pc:
        usage = r.get('usage') or {}
        reas = usage.get('reasoning')
        if reas is None:
            reas = (usage.get('reasoning_tokens') if isinstance(usage, dict) else None)
        if reas is not None:
            reasoning.append((n, r.get('ms'), reas))
    pre=[f"{(r.get('prescreen') or {}).get('status')}({len(r.get('candidates') or [])}c,{(r.get('prescreen') or {}).get('ms')}ms{','+str((r.get('prescreen') or {}).get('fallback')) if (r.get('prescreen') or {}).get('fallback') else ''})" for r in R if r.get('lane')=='run' and r.get('event')=='read']
    comp=[ (f"{r['reason']}->{','.join(r['selected'])}" if r.get('selected') else r.get('reason')) for r in R if r.get('lane')=='route' and r.get('purpose')=='compile']
    routes=[ (r.get('exit') or '')+('*' if r.get('selected') else '') for r in R if r.get('lane')=='route' and r.get('purpose')=='route']
    binds=[f"{str(r.get('candidate','')).split(':')[1] if ':' in str(r.get('candidate','')) else r.get('candidate')}:{r.get('status')}[{','.join(sorted(set(b.get('path','') for b in r.get('bindings',[]))))}]" for r in R if r.get('lane')=='run' and r.get('event')=='bind']
    infer_bind+=sum(1 for r in R if r.get('lane')=='run' and r.get('type')=='step_start' and r.get('kind')=='infer' and r.get('purpose')=='bind')
    ad=[r for r in R if r.get('lane')=='admission' and not r.get('skipped')]; adm+= [(n,r) for r in ad]
    adms=[f"{(r.get('origin') or '?')[0]}{r.get('verb')}:{r.get('verdict')}:{r.get('path')}:{r.get('ms')}" for r in ad]
    lk=[t for t in d.get('tools') or [] if t['name'] in ('look','lookup')]; looks_total+=len(lk)
    looks=[f"{t['name']}{json.dumps(t.get('args'),ensure_ascii=False)[:40]}" for t in lk]
    drops=[r.get('reason') for r in R if r.get('lane')=='delivery' and r.get('ok') is False]
    bud=[f"{r.get('elapsed_ms')}/{r.get('budget_ms')}" for r in R if r.get('lane')=='run' and r.get('event')=='budget' and r.get('decision')=='model_batch']
    ends=[(r.get('status'),r.get('reason')) for r in R if r.get('lane')=='run' and r.get('type')=='run_end']
    if any(s!='delivered' for s,_ in ends): stranded.append(n)
    for r in R:
        if r.get('lane')=='speech': speech['resolved']+=r.get('resolved',0); speech['unresolved']+=r.get('unresolved',0)
    m,rec=mech(n)
    ms=[(x.get('kind'), x.get('skill') or x.get('to') or x.get('resource') or x.get('name') or '', x.get('roll') or x.get('after') or '') for x in m]
    san+= [n for x in m if x.get('kind')=='roll' and str(x.get('skill')).upper() in ('SAN','SANITY')]
    rd=[r for r in R if r.get('lane')=='reading' and (r.get('phase') or r.get('event') in ('stalled','unwaited','concurrency','resumed','requeued'))]
    reads=[f"{r.get('purpose')}:{r.get('focus','')}:{r.get('phase') or r.get('event')}:{r.get('ms','')}{'' if r.get('ok',True) else ':FAIL'}" for r in rd if r.get('phase') in ('read','index') or r.get('event') in ('stalled','resumed','requeued') or r.get('ok') is False]
    srcs=[t for t in d.get('tools') or [] if t['name']=='lookup' and (t.get('args') or {}).get('kind')=='source']
    timeouts=sum(1 for t in d.get('tools') or [] if 'reading_timeout' in (t.get('result_text') or ''))
    closed=f"{(rec or {}).get('closed_by')}/{(rec or {}).get('closed_how')}" if rec else 'no-record'
    print(f"{n} | {d['wall_seconds']:.1f} {d.get('settle_class')} | {len(pc)} ({sum(r.get('ms',0) for r in pc)}) | {' / '.join(pre) or '-'} | {'; '.join(comp) or '-'} | {','.join(routes) or '-'} | {'; '.join(binds) or '-'} | {','.join(adms) or '-'} | {','.join(looks) or 0} | {drops} | {' '.join(bud)} | {ends} | {ms} | {closed} | reads {reads} src_lookups {len(srcs)} reading_timeouts {timeouts}")

    # --- SL-58: source_mode=prepare lookups this turn ---
    for t in srcs:
        args = t.get('args') or {}
        if args.get('source_mode') == 'prepare':
            prepares.append((n, args.get('query') or args.get('focus'), t.get('ms'), (t.get('result_text') or '')[:200]))

    # --- SL-59: batch apply calls naming several npc/person effects ---
    for t in d.get('tools') or []:
        if t.get('name') != 'apply': continue
        args = t.get('args') or {}
        effects = args.get('effects') or (args if isinstance(args, list) else [])
        if isinstance(effects, dict): effects = [effects]
        person_effects = [e for e in effects if isinstance(e, dict) and e.get('kind') in ('npc', 'person')]
        if len(person_effects) >= 2:
            result = tool_result(t)
            receipts = result.get('receipts') or []
            refused = result.get('not_landed') or result.get('refused') or []
            batch_person_applies.append((n, len(person_effects), len(receipts) if isinstance(receipts, list) else None,
                                          [r.get('reason') or r.get('code') for r in refused] if isinstance(refused, list) else refused,
                                          (t.get('result_text') or '')[:200]))

    # --- SL-62/contrast: resolved_from and unknown_entity anywhere in this turn's tool results ---
    for t in d.get('tools') or []:
        rt = json.dumps(tool_result(t), ensure_ascii=False)
        if 'resolved_from' in rt:
            resolved_from_rows.append((n, t.get('name'), rt[:200]))
        if 'unknown_entity' in rt:
            unknown_entity_rows.append((n, t.get('name'), rt[:200]))

    # --- SL-64: every distinct name attempted via apply/resolve naming an npc/person, per turn, with outcome ---
    for t in d.get('tools') or []:
        if t.get('name') not in ('apply', 'resolve'): continue
        args = t.get('args') or {}
        effects = args.get('effects') or (args if isinstance(args, list) else [])
        if isinstance(effects, dict): effects = [effects]
        if not effects and isinstance(args, dict) and args.get('kind') in ('npc', 'person'): effects = [args]
        result = tool_result(t)
        result_text = t.get('result_text') or ''
        receipts = result.get('receipts') or []
        not_landed = result.get('not_landed') or []
        for idx, e in enumerate(effects):
            if not isinstance(e, dict) or e.get('kind') not in ('npc', 'person'): continue
            name = e.get('name') or e.get('who') or e.get('target')
            nl = next((x for x in not_landed if isinstance(x, dict) and x.get('index') == idx), None)
            if nl:
                outcome = 'refused'
                code = nl.get('code'); candidates = (nl.get('details') or {}).get('candidates') or nl.get('candidates')
            elif 'unknown_entity' in result_text and not receipts:
                outcome = 'refused'; code = 'unknown_entity'; candidates = (result.get('details') or {}).get('candidates')
            elif any(str(name or '') in str(r) for r in receipts) or (len(effects) == 1 and receipts):
                outcome = 'minted_or_resolved'; code = None; candidates = None
            else:
                outcome = 'unclear'; code = None; candidates = None
            person_name_events.append({'turn': n, 'tool': t.get('name'), 'name': name, 'outcome': outcome, 'code': code, 'candidates': candidates})

    # --- SL-67: table.look{focus:"scene"} present/roster this turn (cross-reference for name-resolution events) ---
    for t in d.get('tools') or []:
        if t.get('name') not in ('look', 'lookup'): continue
        args = t.get('args') or {}
        if args.get('focus') != 'scene': continue
        result = tool_result(t)
        if 'roster' in result or 'present' in result:
            scene_rosters.append({'turn': n, 'present': result.get('present'), 'roster': result.get('roster')})

    # --- SL-66: every narrate rendered_text this turn, scanned for the investigator's stored name plus trailing punctuation ---
    for t in d.get('tools') or []:
        if t.get('name') != 'narrate': continue
        result = tool_result(t)
        text = result.get('rendered_text') or t.get('result_text') or ''
        if isinstance(text, str) and text:
            prose_name_hits.append({'turn': n, 'text_len': len(text), 'text_sample': text[:400]})

for r in rows:
    if r.get('event') == 'resumed' or (r.get('lane') == 'reading' and r.get('event') == 'resumed'):
        resumed_rows.append(r)
    if r.get('reason') == 'refusal_budget' or r.get('event') == 'refusal_budget' or (r.get('lane') == 'runaway' and r.get('after') == 'refusal_budget'):
        refusal_budget_rows.append(r)

print('\n=== table-wide')
w=sorted(walls); print('walls', [round(x) for x in walls]);
if w: print('median', round(statistics.median(w),1), '<=60s', sum(1 for x in w if x<=60), '/', len(w), 'max', round(max(w),1))
if allcalls: pcalls_ms = sorted(r.get('ms',0) for r in rows if r.get('lane')=='provider-call')
if allcalls:
    p = pcalls_ms
    def pct(p, q):
        if not p: return None
        k = (len(p)-1) * q
        f, c = int(k), min(int(k)+1, len(p)-1)
        return p[f] if f == c else p[f] + (p[c]-p[f]) * (k-f)
    print('model-call ms p50', round(pct(p,0.5),1) if p else None, 'p90', round(pct(p,0.9),1) if p else None,
          'over 45s', [x for x in p if x and x > 45000])
print('provider calls', allcalls, 'provider errors', errors)
print('infer(bind) steps', infer_bind)
print('admission paths', collections.Counter((r.get('origin'),r.get('path')) for _,r in adm))
print('admission max ms', max([r.get('ms') or 0 for _,r in adm] or [0]), 'review_timeout', [(n,r.get('verb')) for n,r in adm if r.get('verdict')=='review_timeout'])
print('verdicts', collections.Counter(r.get('verdict') for _,r in adm))
print('looks', looks_total, 'stranded/undelivered turns', stranded, 'speech', dict(speech), 'sanity rolls on turns', san)

print('\n=== SL-58: source_mode=prepare lookups (want: pending within the answer allowance, no full reading_timeout in foreground)')
for row in prepares: print(' ', row)
if not prepares: print('  none this table')

print('\n=== SL-59: batch apply calls with >=2 npc/person effects (want: line-level landing, not whole-batch refusal)')
for row in batch_person_applies: print(' ', row)
if not batch_person_applies: print('  none this table')

print('\n=== SL-60: resumed telemetry rows (event: "resumed")')
for row in resumed_rows: print(' ', row)
if not resumed_rows: print('  none this table (no displacement/resume exercised, or the row is still missing)')

print('\n=== SL-61: reasoning tokens per provider call (want: 0 on every call, thinking off)')
nonzero = [r for r in reasoning if r[2]]
print('  calls with reasoning field:', len(reasoning), 'nonzero:', len(nonzero))
for row in nonzero: print('  NONZERO', row)

print('\n=== SL-62: resolved_from rows (a person resolved against scene candidates) vs unknown_entity refusals')
for row in resolved_from_rows: print('  resolved_from', row)
for row in unknown_entity_rows: print('  unknown_entity', row)

print('\n=== SL-63: refusal_budget rows and whether the run still delivered')
for row in refusal_budget_rows: print(' ', row)
if not refusal_budget_rows: print('  none this table (refusal budget never tripped)')
print('  stranded/undelivered turns (from run_end, above):', stranded)

print('\n=== SL-64 (this batch\'s primary target): npc-ledger.json entry count and per-name mint/resolve/refuse outcomes')
ledger_path = f'{C}/npc-ledger.json'
if os.path.exists(ledger_path):
    ledger = json.load(open(ledger_path))
    entries = ledger if isinstance(ledger, list) else (ledger.get('entries') or list(ledger.values()) if isinstance(ledger, dict) else [])
    print(f'  npc-ledger.json entries: {len(entries)}')
    for e in entries:
        if isinstance(e, dict):
            print('   ', {k: e.get(k) for k in ('id', 'handle', 'name', 'established', 'first_turn') if k in e} or e)
else:
    print(f'  npc-ledger.json not found at {ledger_path}')
print('\n  per-name events this table (apply/resolve naming an npc/person):')
by_name = collections.defaultdict(list)
for ev in person_name_events: by_name[ev['name']].append(ev)
for name, evs in by_name.items():
    outcomes = [e['outcome'] for e in evs]
    print(f'   {name}: {len(evs)} attempt(s), outcomes={outcomes}')
    for e in evs:
        if e['outcome'] == 'refused':
            print(f'      turn {e["turn"]} refused code={e["code"]} candidates={e["candidates"]}')
print('\n  distinct names that ever minted/resolved:', sorted(set(n for n, evs in by_name.items() if any(e['outcome'] == 'minted_or_resolved' for e in evs))))
print('  distinct names that only ever refused:', sorted(set(n for n, evs in by_name.items() if all(e['outcome'] == 'refused' for e in evs))))
print('  SL-64 success check: ledger entries > 1 required to confirm the fix was exercised (a single-person table cannot distinguish fixed-from-broken).')

print('\n=== SL-65 (batch-11 primary target): reading-lease stage_budget rows and budget_input_tokens refusals')
rt_path = f'{COC_HOME}/reading-telemetry.jsonl'
if os.path.exists(rt_path):
    rt_rows = [json.loads(l) for l in open(rt_path) if l.strip()]
    by_job = collections.defaultdict(list)
    for r in rt_rows: by_job[r.get('job') or r.get('job_id')].append(r)
    budget_rows = [r for r in rt_rows if 'stage_budget' in json.dumps(r)]
    refusals = [r for r in rt_rows if r.get('refusal') == 'budget_input_tokens' or 'budget_input_tokens' in json.dumps(r)]
    print(f'  reading-telemetry rows: {len(rt_rows)}; jobs: {sorted(j for j in by_job if j)}')
    for r in budget_rows:
        sb = r.get('stage_budget') or {k: r.get(k) for k in ('ceiling', 'floor', 'contextWindow') if k in r}
        print('   stage_budget', {'job': r.get('job') or r.get('job_id'), 'purpose': r.get('purpose'), **({'stage_budget': sb} if sb else {})})
    print(f'  budget_input_tokens refusals: {len(refusals)}')
    for r in refusals:
        print('   REFUSAL', {k: r.get(k) for k in ('job', 'job_id', 'purpose', 'focus', 'ceiling', 'used', 'requested', 'elapsed_ms') if k in r})
    print('  SL-65 success check: 0 budget_input_tokens refusals required (batch-10 had 5 across read-1/read-2/read-4, floor was the old fixed 4,000,000).')
else:
    print(f'  reading-telemetry.jsonl not found at {rt_path}')
gen_glob = glob.glob(f'{COC_HOME}/module-campaigns/{CID}/modules/*/generations/generation-*')
print('  generation directories present:', [os.path.basename(g) for g in gen_glob])

print('\n=== SL-66 (batch-11 primary target): investigator card name field, checked for stray leading/trailing punctuation')
inv_path = f'{C}/party/investigator.json'
# Plain Unicode punctuation/space set (category P/Z is what SL-66 trims); Python's `re` has no \p{} without
# the third-party `regex` module, so this checks the common CJK+ASCII punctuation/space set directly.
STRIP_CHARS = '，。！？、,.!?;；:：""\'\'（）()[]【】《》〈〉…—-　 \t\r\n'
if os.path.exists(inv_path):
    inv = json.load(open(inv_path))
    name = inv.get('name')
    print(f'  investigator.json name: {name!r}')
    if isinstance(name, str) and name:
        leading_bad = name[0] in STRIP_CHARS
        trailing_bad = name[-1] in STRIP_CHARS
        print(f'  leading char {name[0]!r} is punctuation/space: {leading_bad}; trailing char {name[-1]!r} is punctuation/space: {trailing_bad}')
        print(f'  SL-66 success check (punctuation/whitespace only): {"PASS" if not leading_bad and not trailing_bad else "FAIL"}')
else:
    print(f'  investigator.json not found at {inv_path}')
print('  prose occurrences of the stored name (from setup + this table\'s narrate calls), checked for the name riding beside stray text:')
if isinstance(inv.get('name') if os.path.exists(inv_path) else None, str):
    nm = inv['name']
    hits = [h for h in prose_name_hits if nm and nm in h['text_sample']]
    print(f'   name {nm!r} found in {len(hits)} of {len(prose_name_hits)} narrate samples this table')
    for h in hits[:5]:
        idx = h['text_sample'].find(nm)
        ctx = h['text_sample'][max(0, idx-5):idx+len(nm)+5]
        print(f'    turn {h["turn"]}: ...{ctx}...')

print('\n=== SL-67 (batch-11 primary target): shortened/variant person names, split by present-vs-roster-only, resolve/refuse outcome')
roster_by_turn = {r['turn']: r for r in scene_rosters}
print(f'  table.look scene rows with roster/present captured: {len(scene_rosters)}')
for r in scene_rosters:
    print('   ', r)
print('  per-name events cross-referenced against the nearest prior scene roster:')
for ev in person_name_events:
    n = ev['turn']
    prior = None
    for t2 in sorted(roster_by_turn, reverse=True):
        if t2 <= n: prior = roster_by_turn[t2]; break
    present = (prior or {}).get('present') or []
    roster = (prior or {}).get('roster') or []
    name = ev.get('name') or ''
    in_present = any(str(name) in str(p) for p in present) if name else False
    in_roster_only = (any(str(name) in str(p) for p in roster) if name else False) and not in_present
    print(f'   turn {n} name={name!r} outcome={ev["outcome"]} code={ev.get("code")} in_present={in_present} in_roster_only={in_roster_only}')
print('  SL-67 success check: a shortened/variant name of a person in roster-only (established but not present) should resolve, not refuse unknown_entity (per the ticket\'s own live-Jev caveat, not every ambiguous fragment necessarily clears the row — report the actual outcome).')
