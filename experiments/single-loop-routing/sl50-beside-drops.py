"""SL-50 scope 1: pair every text_beside_tool_calls drop of long gates #3-#5 with its message and step, and classify the
step's calls (contract §135.11.1). Read-only over a `.coc` home the play driver wrote.

  python3 experiments/single-loop-routing/sl50-beside-drops.py <home containing .coc>

Pairing: the drop row and the provider-call row are written without awaiting each other, so the n-th message whose
provider-call blocks carry text beside a tool call is the n-th drop row (same turn, asserted). The dropped text is the
message's streamed text deltas in the play driver's events.jsonl; each call's outcome is its tool_execution_end; the
admission verdicts are the model-origin admission rows before each model tool row. Class A: every call an apply, all
landed; B: all applies, one not landed; C: a resolve among them; D: reads (look/lookup/recall) and no resolve.
"""
import json, sys, collections, glob, os
HOME = sys.argv[1].rstrip('/') + '/.coc' if len(sys.argv) > 1 else '.coc'
READS = {'look', 'lookup', 'recall'}
totals = collections.Counter()
for camp in ['longgate3-haunting-1058', 'longgate4-haunting-1308', 'longgate5-haunting-1447']:
    play = glob.glob(f'{HOME}/playtests/{camp}-*')[0]
    tel = [json.loads(l) for l in open(f'{HOME}/campaigns/{camp}/telemetry.jsonl')]
    ev = [json.loads(l) for l in open(f'{play}/events.jsonl')]
    results = {e['toolCallId']: e for e in ev if e.get('type') == 'tool_execution_end'}
    # streamed prose per assistant message (the persisted message lost the dropped text)
    msgs, cur = [], ''
    for e in ev:
        if e.get('type') == 'message_update' and (e.get('assistantMessageEvent') or {}).get('type') == 'text_delta':
            cur += e['assistantMessageEvent'].get('delta') or ''
        if e.get('type') == 'message_end' and e.get('message', {}).get('role') == 'assistant':
            calls = [b for b in e['message'].get('content') or [] if b.get('type') == 'toolCall']
            msgs.append({'text': cur, 'calls': calls}); cur = ''
    pcs = [i for i, r in enumerate(tel) if r.get('lane') == 'provider-call']
    assert len(pcs) == len(msgs), (camp, len(pcs), len(msgs))
    counts = collections.Counter(); rows = []
    drops_total = sum(1 for r in tel if r.get('reason') == 'text_beside_tool_calls')
    # the drop row and the provider-call row are both written without awaiting each other, so their order in the file can
    # swap; pair in order instead: the n-th message whose blocks carry text beside a tool call is the n-th drop.
    drops = [r for r in tel if r.get('lane') == 'delivery' and r.get('reason') == 'text_beside_tool_calls']
    beside = [k for k, at in enumerate(pcs) if 'text' in tel[at].get('blocks', []) and 'toolCall' in tel[at].get('blocks', [])]
    assert len(beside) == len(drops), (camp, len(beside), len(drops))
    for k, drop in zip(beside, drops):
        at, msg = pcs[k], msgs[k]
        assert drop.get('turn') == tel[at].get('turn'), (camp, k)
        end = pcs[k + 1] if k + 1 < len(pcs) else len(tel)
        window = tel[at:end]
        assert msg['calls'], (camp, k)
        # Each model message of a hybrid turn is one infer step, so the step pairs by order within the turn too (the rows'
        # file order can cross a provider-call row); a turn whose counts differ (the legacy opening) names no step.
        turn = tel[at].get('turn')
        in_turn = [i for i in pcs if tel[i].get('turn') == turn]
        infers = [r for r in tel if r.get('turn') == turn and r.get('lane') == 'run' and r.get('type') == 'step_end' and r.get('kind') == 'infer']
        infer = infers[in_turn.index(at)] if len(infers) == len(in_turn) else {}
        # admission rows and model tool rows in this window, in order; an admission row belongs to the next model tool row
        out, pending_adm = [], []
        for r in window:
            if r.get('lane') == 'admission' and r.get('origin', 'model') == 'model': pending_adm.append(r)
            elif r.get('tool') in ('apply', 'resolve', 'look', 'lookup', 'recall', 'narrate', 'ask') and r.get('origin') != 'policy' and 'event' not in r and not r.get('implicit'):
                out.append((r, pending_adm)); pending_adm = []
        calls = []
        for i, call in enumerate(msg['calls']):
            res = results.get(call['id'])
            err = (((res or {}).get('result') or {}).get('details') or {}).get('coc_error')
            adm = [a.get('verdict') or a.get('skipped') or a.get('reason') for a in (out[i][1] if i < len(out) else [])]
            calls.append({'tool': call['name'], 'ran': res is not None, 'ok': res is not None and not res.get('isError'),
                          'refusal': (err or {}).get('details', {}).get('reason') or (err or {}).get('code') if err else None, 'admission': adm})
        tools = {c['tool'] for c in calls}
        if tools == {'apply'} and all(c['ok'] for c in calls): cls = 'A apply-only, admitted, landed'
        elif tools == {'apply'}: cls = 'B apply-only, some refused/pending/not run'
        elif 'resolve' in tools: cls = 'C carries resolve'
        elif tools & READS and not (tools - READS - {'apply'}): cls = 'D reads (look/lookup/recall), no resolve'
        else: cls = 'E other'
        counts[cls] += 1
        rows.append({'turn': drop.get('turn'), 'step': infer.get('stepId', '').split(':')[-1], 'purpose': infer.get('purpose'), 'reason': infer.get('reason'),
                     'text_chars': len(msg['text'].strip()), 'text': msg['text'].strip()[:80], 'calls': [f"{c['tool']}:{'ok' if c['ok'] else (c['refusal'] or 'not_run')}{'/' + ','.join(map(str, c['admission'])) if c['admission'] else ''}" for c in calls], 'class': cls[0]})
    assert len(rows) == drops_total, (camp, len(rows), drops_total)
    print(f'== {camp}: {len(rows)} drops paired of {drops_total}')
    for r in rows: print('  ', json.dumps(r, ensure_ascii=False))
    for k, v in sorted(counts.items()): print('   ', v, k)
    totals.update(counts)
print('== totals over', sum(totals.values()), 'drops')
for k, v in sorted(totals.items()): print('  ', v, k)
