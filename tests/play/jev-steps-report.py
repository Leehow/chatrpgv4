"""SL-77 (D4/D6): per-class shadow agreement over `lane:"route", purpose:"consequence"` telemetry rows.

Read-only, a sibling of the long-gate triage scripts (`docs/specs/pi-native-single-loop-tickets/29-book-a/triage.py`):
reads `.coc/campaigns/<cid>/telemetry.jsonl` and `turns/*.json` only, never writes under that tree. No live model
calls, no npm installs.

The rows this reads are written by `runtime/jev/hybrid-engine.ts`'s `pairConsequences` (SL-76, D4): one row per
`(class, key)` this run's shadow route accumulated, each already carrying `keeper_did` (true/false/'other'),
computed by `keeperDidFor` off the turn's own receipts -- never off a model-origin call's arguments, and never by
reading prose. This script does the same kind of structural read for the write-up: for every row the shadow route
cleared but the Keeper's own receipts say it did not act (or acted on someone/something else), it looks at the
turn's receipts and calls to say, structurally, what the Keeper did to the same entity, and separately checks
whether the candidate's own key resolves to the same entity through a label/handle map -- a candidate class
(`npc_reaction`) keys itself on the pending-contact's display label (`bound.target`), while the first-impression
`roll` receipt the Keeper's own `resolve` call produces stores a normalized handle, so a real agreement can read
as `keeper_did: "other"` on the label/handle mismatch alone.

Usage:
    python3 tests/play/jev-steps-report.py <root> <glob> [<glob> ...]

`<root>` is a worktree (or any directory) containing `.coc/campaigns/`; each `<glob>` is matched against the
campaign directory names under `<root>/.coc/campaigns/` (e.g. `longgate14-haunting-*`). Every matching campaign is
reported separately, in the order it was passed.
"""
import sys
import os
import glob as globmod
import json
import statistics
import collections

NPC_REACTION_DECISION = 'natural-npc:first-impression'
CLASSES = ('npc_reaction', 'clue_follow_up', 'time_cost')


def load_jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def load_turn(campaign_dir, turn):
    path = os.path.join(campaign_dir, 'turns', f'{turn:04d}.json')
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def stranded_turns(telemetry_rows):
    """Turns whose `{lane:"run", type:"run_end"}` row(s) never say `status: "delivered"` -- the long-gate
    triage's own definition of a stranded turn, read off the same telemetry every other lane in this file reads."""
    by_turn = collections.defaultdict(list)
    for row in telemetry_rows:
        if row.get('lane') == 'run' and row.get('type') == 'run_end':
            by_turn[row.get('turn')].append(row)
    return {turn for turn, ends in by_turn.items() if ends and not all(e.get('status') == 'delivered' for e in ends)}


def parse_key(cls, key):
    """The candidate's own entity handle/label out of its telemetry `key`, built by `consequence-candidates.ts`:
    `consequence:npc_reaction:<actor>:<target>`, `consequence:clue_follow_up:<clue>`, `consequence:time_cost:<handle>`."""
    prefix = f'consequence:{cls}:'
    rest = key[len(prefix):] if key.startswith(prefix) else key
    if cls == 'npc_reaction':
        actor, _, target = rest.partition(':')
        return {'actor': actor, 'target': target}
    if cls == 'clue_follow_up':
        return {'clue': rest}
    if cls == 'time_cost':
        return {'handle': rest}
    return {}


def person_label_map(turn_records):
    """label -> handle, accumulated in turn order from `kind: "person"` receipts (`who` is the handle, `name`
    the display label a `pending_contacts` row's `target` field also uses) -- built once per campaign, never
    re-derived per row, since a person can be introduced in an earlier turn than the one being read."""
    mapping = {}
    for turn in sorted(t for t in turn_records if turn_records[t]):
        rec = turn_records[turn]
        for receipt in rec.get('receipts') or []:
            if receipt.get('kind') == 'person' and receipt.get('who') and receipt.get('name'):
                mapping[receipt['name']] = receipt['who']
    return mapping


def npc_evidence(target_label, turn_receipts, label_map):
    """What the Keeper's own calls this turn did to this NPC, read structurally off `receipts` (never prose):
    first-impression rolls (with npc handle), any label->handle resolution of the candidate's own target, and any
    plain `person` introduction. Never invents a verdict; states what it found."""
    rolls = [r for r in turn_receipts if r.get('kind') == 'roll' and r.get('decision') == NPC_REACTION_DECISION]
    other_rolls = [r for r in turn_receipts if r.get('kind') == 'roll' and r.get('decision') != NPC_REACTION_DECISION]
    persons = [r for r in turn_receipts if r.get('kind') == 'person']
    parts = []
    if rolls:
        parts.append('first-impression rolls this turn: ' + ', '.join(f"npc={r.get('npc')!r}" for r in rolls))
    handle = label_map.get(target_label)
    if handle and any(r.get('npc') == handle for r in rolls):
        parts.append(f"label->handle map resolves target {target_label!r} to {handle!r}, which matches a first-impression roll's npc field this turn "
                      "-- reads as the SAME engagement; keeper_did disagrees only because the row's own key carries the display label, not the handle "
                      "the roll receipt normalizes to (telemetry key/entity-id mismatch, not a real disagreement)")
    if other_rolls:
        parts.append('other (non-first-impression) rolls this turn: ' + ', '.join(f"{r.get('skill')}" for r in other_rolls))
    if persons:
        parts.append('person receipts this turn: ' + ', '.join(f"{r.get('name')}({r.get('who')})" for r in persons))
    if not parts:
        parts.append('no roll/person receipts this turn')
    return '; '.join(parts)


def clue_evidence(clue_handle, turn_receipts):
    clues = [r for r in turn_receipts if r.get('kind') == 'clue']
    hit = [r for r in clues if r.get('clue') == clue_handle]
    if hit:
        return 'clue receipt for this exact handle exists this turn (should have paired true): ' + ', '.join(r.get('id', '') for r in hit)
    if clues:
        return 'clue receipts this turn, none for this handle: ' + ', '.join(f"{r.get('clue')}" for r in clues)
    return 'no clue receipts this turn'


def time_evidence(turn_receipts):
    times = [r for r in turn_receipts if r.get('kind') == 'time']
    if times:
        return 'time receipts this turn: ' + ', '.join(f"{r.get('minutes')}min why={r.get('why')!r}" for r in times)
    return 'no time receipts this turn'


def corrected_npc_reaction(rows, turn_records, label_map):
    """Diagnostic only, never the product's own number: re-runs `npc_reaction`'s pairing with the candidate's
    `target` label resolved through `label_map` before comparing to a first-impression roll's `npc` handle, to
    size how much of the class's raw disagreement is the label/handle mismatch this file's `npc_evidence` keeps
    finding rather than a real Jev/Keeper disagreement. Same three-way shape as `keeperDidFor` (true/false/other),
    computed only over rows whose turn is not stranded."""
    out = []
    for row in rows:
        target = parse_key('npc_reaction', row.get('key', '')).get('target', '')
        receipts = (turn_records.get(row.get('turn')) or {}).get('receipts') or []
        rolls = [r for r in receipts if r.get('kind') == 'roll' and r.get('decision') == NPC_REACTION_DECISION]
        handle = label_map.get(target)
        matched = any(r.get('npc') in (target, handle) for r in rolls)
        corrected = 'true' if matched else ('other' if rolls else 'false')
        out.append((row, corrected))
    return out


def report_campaign(campaign_dir):
    cid = os.path.basename(campaign_dir)
    telemetry = load_jsonl(os.path.join(campaign_dir, 'telemetry.jsonl'))
    consequence = [r for r in telemetry if r.get('lane') == 'route' and r.get('purpose') == 'consequence']
    candidate_rows = [r for r in consequence if not r.get('exists')]
    exists_rows = [r for r in consequence if r.get('exists')]
    budget_rows = [r for r in telemetry if r.get('lane') == 'run' and r.get('event') == 'consequence_budget']
    stranded = stranded_turns(telemetry)

    turn_files = sorted(int(os.path.splitext(os.path.basename(p))[0]) for p in
                         globmod.glob(os.path.join(campaign_dir, 'turns', '*.json')))
    turn_records = {t: load_turn(campaign_dir, t) for t in turn_files}
    label_map = person_label_map(turn_records)

    print(f'\n{"=" * 100}\ncampaign: {cid}')
    print(f'turn files present: {len(turn_files)} ({turn_files[0]}..{turn_files[-1]})' if turn_files else 'turn files present: 0')
    print(f'shadow consequence rows: {len(candidate_rows)} candidate + {len(exists_rows)} exists, over turns {sorted(set(r.get("turn") for r in consequence))}')
    print(f'stranded (undelivered) turns: {sorted(stranded)} ({len(stranded)})')

    print('\n-- per class (candidate rows) --')
    print(f'{"class":<16} {"offered":>7} {"cleared":>7} {"true":>5} {"false":>5} {"other":>5} {"null":>5} {"unpaired":>8} {"agreement(true/(true+false))":>28}')
    false_other_detail = collections.defaultdict(list)
    for cls in CLASSES:
        rows = [r for r in candidate_rows if r.get('class') == cls]
        paired = [r for r in rows if r.get('turn') not in stranded]
        unpaired = [r for r in rows if r.get('turn') in stranded]
        offered, cleared = len(rows), sum(1 for r in rows if r.get('cleared'))
        counts = collections.Counter('null' if r.get('keeper_did') is None else str(r.get('keeper_did')).lower() for r in paired)
        t, f = counts.get('true', 0), counts.get('false', 0)
        agreement = f'{t}/{t + f} = {t / (t + f):.2f}' if (t + f) else 'n/a (no true+false rows)'
        print(f'{cls:<16} {offered:>7} {cleared:>7} {t:>5} {f:>5} {counts.get("other", 0):>5} {counts.get("null", 0):>5} {len(unpaired):>8} {agreement:>28}')
        for row in paired:
            if row.get('cleared') and str(row.get('keeper_did')).lower() in ('false', 'other'):
                false_other_detail[cls].append(row)

    print('\n-- exists rows (does the family apply at all; no keeper_did) --')
    print(f'{"class":<16} {"offered":>7} {"cleared=true":>13} {"cleared=false":>14} {"unresolved(null)":>17}')
    for cls in CLASSES:
        rows = [r for r in exists_rows if r.get('class') == cls]
        print(f'{cls:<16} {len(rows):>7} {sum(1 for r in rows if r.get("cleared") is True):>13} '
              f'{sum(1 for r in rows if r.get("cleared") is False):>14} {sum(1 for r in rows if r.get("cleared") is None):>17}')

    print('\n-- cleared-but-false/other rows: turn, key, confidence, and the turn\'s own receipts --')
    any_detail = False
    for cls in CLASSES:
        for row in false_other_detail.get(cls, []):
            any_detail = True
            turn = row.get('turn')
            rec = turn_records.get(turn) or {}
            receipts = rec.get('receipts') or []
            parts = parse_key(cls, row.get('key', ''))
            if cls == 'npc_reaction':
                evidence = npc_evidence(parts.get('target', ''), receipts, label_map)
            elif cls == 'clue_follow_up':
                evidence = clue_evidence(parts.get('clue', ''), receipts)
            else:
                evidence = time_evidence(receipts)
            print(f'  [{cls}] turn {turn} key={row.get("key")!r} confidence={row.get("confidence")} keeper_did={row.get("keeper_did")!r}')
            print(f'    player_text: {rec.get("player_text", "")!r}')
            print(f'    evidence: {evidence}')
    if not any_detail:
        print('  (none)')

    npc_rows = [r for r in candidate_rows if r.get('class') == 'npc_reaction' and r.get('turn') not in stranded]
    if npc_rows:
        pairs = corrected_npc_reaction(npc_rows, turn_records, label_map)
        counts = collections.Counter(c for _, c in pairs)
        t, f = counts.get('true', 0), counts.get('false', 0)
        agreement = f'{t}/{t + f} = {t / (t + f):.2f}' if (t + f) else 'n/a'
        print('\n-- npc_reaction, label->handle corrected (diagnostic only, NOT the product\'s own pairing) --')
        print(f'  corrected: true={t} false={f} other={counts.get("other", 0)}; agreement true/(true+false) = {agreement}')
        for row, corrected in pairs:
            raw = str(row.get('keeper_did')).lower()
            if corrected != raw:
                print(f'    turn {row.get("turn")} key={row.get("key")!r} cleared={row.get("cleared")}: raw keeper_did={raw!r} -> corrected {corrected!r}')

    print('\n-- added Jev ms per turn (from `{lane:"run", event:"consequence_budget"}` rows) --')
    if not budget_rows:
        print('  no consequence_budget rows in this campaign\'s telemetry -- cannot report added ms')
    else:
        for row in sorted(budget_rows, key=lambda r: r.get('turn', 0)):
            print(f'  turn {row.get("turn")}: {row.get("ms")} ms over {row.get("rows")} rows')
        ms = [r.get('ms') for r in budget_rows if isinstance(r.get('ms'), (int, float))]
        if ms:
            print(f'  turns with a shadow call: {len(ms)}/{len(turn_files)}; median {statistics.median(ms):.0f} ms; mean {statistics.mean(ms):.1f} ms; max {max(ms)} ms')

    return {'cid': cid, 'candidate_rows': candidate_rows, 'exists_rows': exists_rows, 'stranded': stranded,
            'budget_rows': budget_rows, 'turn_files': turn_files}


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    root, globs = argv[1], argv[2:]
    campaigns_dir = os.path.join(root, '.coc', 'campaigns')
    matched = []
    for pattern in globs:
        matched.extend(sorted(p for p in globmod.glob(os.path.join(campaigns_dir, pattern)) if os.path.isdir(p)))
    if not matched:
        print(f'no campaign directories under {campaigns_dir!r} matched {globs!r}')
        return 1
    for campaign_dir in matched:
        report_campaign(campaign_dir)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
