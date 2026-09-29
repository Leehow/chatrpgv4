"""SL-77/SL-78 (D4/D6, §135.32 addendum 2): per-class shadow agreement over `lane:"route", purpose:"consequence"`
telemetry rows, plus (SL-78) the `lane:"residual"` row `COC_JEV_STEPS=on` writes once per turn.

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

The "residual" section (SL-78) reads `{lane:"residual", turn, keeper_calls:{apply,resolve,look,lookup,recall},
compile_calls, clerk_calls, consequence_calls}` rows, written once per turn at turn close by
`runtime/jev/hybrid-engine.ts`'s `recordResidual`, `COC_JEV_STEPS=on` only (a campaign run under `shadow`/`off`
has none). `keeper_calls` is the design's own residual: the Keeper's free tool calls among the five bookkeeping
verbs, whatever SL-78's execute list did not already cover.

The "recall/precision" section (SL-86, ticket 86) reads the same candidate rows the per-class table above does,
per class: precision (`tp/(tp+fp)`, the same false positives the "cleared-but-false/other" detail already lists)
and recall (`tp/(tp+fn)`), where a false negative is a row Jev did NOT clear (`cleared` false or an unresolved
Noul) whose entity the Keeper's own receipts say it filed the same turn anyway (`keeper_did: true`) -- printed
with the Noul's own `yes` probability (`confidence`). This is the number ticket 86's per-class gate
(`jev_steps.classes.clue_follow_up.row_min`) is meant to move; the section is a read of already-recorded
telemetry, never a live re-ask.

SL-85 (ticket 85, §135.32 addendum 2's own ruling) adds two fields to the per-class table and a duplicate-row
section: `executed` (a row this run actually ran through the gateway, `COC_JEV_STEPS=on` and a listed class) and
`shadow` (every row that was only routed and paired, including a listed class's own row on a turn it did not
clear -- so under `on`, a class can show both `executed` and `shadow` rows over the campaign, never `on`'s
`shadow` count wrongly reading 0 for a class that simply never executes, such as `npc_reaction` today). The
duplicate-row section groups candidate rows by `(turn, class, key)` and names any group with more than one row --
the shape SL-85 fixed at the write site (a steer leg, or a turn delivered by the Keeper's own `narrate` without
ever proposing `turn_close`, each used to write the pairing/residual rows more than once, or not at all).

Ticket 05 of docs/specs/jev-decides-llm-writes.md (D-C): the report reads any number of *homes* and closes
with the D6 2a verdict of `docs/specs/jev-driven-steps.md`, aggregated over every campaign found. A home is any
directory the resolver below recognises; the campaign layout under it is the same everywhere (`.coc/campaigns/<cid>/
telemetry.jsonl` and `turns/NNNN.json`, written by the kernel's workspace, whose root is `PI_COC_HOME`):

- a repo checkout, or a PipiCOC App home: `<home>/.coc/campaigns/`. The packaged App's home is
  `<userData>/pi-coc` (`Electron/apps/electron/src/main/runtime-assets.ts`), userData being
  `~/Library/Application Support/Pipi/pipicoc` (`pipicoc/product.json`'s `userDataDirname`);
- the App's userData directory itself: `<userData>/pi-coc/.coc/campaigns/`;
- the `.coc` workspace directory (`<dir>/campaigns/`) or a `campaigns` directory.

The verdict (constants `AGREEMENT_MIN`, `FALSE_POSITIVES_MAX_PER_TABLE`, `ADDED_MS_MAX`, the D6 2a numbers). A
*table* is a campaign with at least one consequence route row; every other campaign (setup sessions, tables run
with `COC_JEV_STEPS=off`) is counted as scanned, never as a table. Per class, over the rows of every table:

- agreement = `tp / (tp + fp)`, the owner's own reading of 2a: the ruling that opened `clue_follow_up` ("agreement
  6/6, 6/6, false positives 0/0/1", SL-78) is SL-77's "every one of its 6 cleared rows paired true", precision over
  the cleared rows the Keeper's receipts can judge. A row is judged when it is cleared and its `keeper_did` is
  true, false or `other` (a `null` is no verdict and is not counted); `tp` is the cleared rows with `keeper_did`
  true, `fp` the cleared rows with false or `other`. A class with no cleared row the receipts can judge has no
  agreement to measure and reads NOT MET (no evidence): absence of evidence is never a pass;
- false positives = `fp`, counted per table, the worst table decides. The transcript read D6 asks for is still the
  owner's; the only automatic exemption is the label/handle artifact `corrected_npc_reaction` already names (a row
  the pairing read wrong because the candidate key carried a display label and the roll a handle), reported as
  `artifacts` and counted as the Keeper's own action;
- added Jev ms per turn = the mean of `consequence_budget` ms over the turns that made a shadow call, per table;
  every table must be at or under the line. It is one number for all classes;
- recall `tp / (tp + fn)` (SL-86: the rows the Keeper filed that Jev did not clear) is printed beside agreement as
  information only and is not part of the verdict. It is read over the tables that only shadowed the class: in a
  table that executed the class a cleared row became a clerk write, so its hits are not observable there.

Rows that are not Jev decisions on the shadow route are excluded and counted: stranded turns (the turn was never
delivered), `executed` rows (2a is the shadow gate; an executed row is a clerk write, and the Keeper's receipts
minus the clerk's own cannot say whether the Keeper would have filed it), `direct` rows (a stated amount the host
clears without asking Jev), unanswered rows (`confidence` null: a Jev outage or an incomplete batch), rows with no
`keeper_did` verdict, and duplicate `(turn, class, key)` rows, of which the last written is kept (SL-85: the last
writer is the true close). The script never edits the execute list (`jev_steps.execute`) or any other file.

The verdict is followed by one more section, "executed steps not in the prose" (D6 2b's line "every executed D1 step
appears in the prose or is reversed by the Keeper with a receipt"), read per table off the `executed: true` rows:

- an executed `clue_follow_up` row is *narrated* when the turn it belongs to carries a Keeper-placed marker for that
  clue in its delivered `text` (`turns/NNNN.json`): `{{clue:<handle>}}`, where `<handle>` is the part of the row key
  after `consequence:clue_follow_up:`, optionally followed by `-<n>` or `-t<n>` (the kernel's own repeat suffix and the
  receipt-id form a Keeper copies, e.g. `{{clue:dooley-macario-madness-t5}}`). The grammar is structural: a marker with
  another handle that merely starts with this one (`{{clue:ledger-book}}` for `ledger`) is not a marker for it.
  The turn is the one telemetry puts the row's `run` on (the run's other rows carrying both `run` and `turn`), the
  row's own `turn` when the run names none or several;
- `marked_text` is not read: the kernel appends a marker for every receipt the Keeper did not place
  (`placeUnplacedMechanics`, `kernel-ts/write/text.ts`), so a marker there says nothing about the Keeper. A turn record
  with no `text` is reported as not checkable, never as narrated;
- *reversed* cannot be measured: no receipt kind reverses a clue (`apply clue` only appends to `discovered_clues`,
  `kernel-ts/apply/entities.ts`, and no other write removes from it; none of the 5,133 turn records read for this
  ticket carries such a kind), so the column is printed `n/a`;
- *neither* is a row with no Keeper-placed marker: a proxy, since prose that tells the clue without its marker is not
  seen. Each one is listed with its turn, key and confidence, for the transcript read that stays with the owner.

Usage:
    python3 tests/play/jev-steps-report.py <home> [<home> ...] [--campaign <glob> ...] [--detail]
    python3 tests/play/jev-steps-report.py <root> <glob> [<glob> ...]        # the original form; implies --detail

`<home>` is any path the resolver accepts (above). `--campaign` filters campaign directory names (default `*`).
`--detail` prints every campaign's own sections before the verdict; without it only the verdict is printed. In
the original form the arguments that are not homes are campaign globs, e.g. `longgate14-haunting-*`, and every
matching campaign is reported in detail, in the order passed, before the verdict.
"""
import argparse
import re
import sys
import os
import glob as globmod
import json
import statistics
import collections

NPC_REACTION_DECISION = 'natural-npc:first-impression'
CLASSES = ('npc_reaction', 'clue_follow_up', 'time_cost')

# docs/specs/jev-driven-steps.md D6, line 2a (pre-registered): the numbers the aggregate verdict is judged against.
AGREEMENT_MIN = 0.9
FALSE_POSITIVES_MAX_PER_TABLE = 1
ADDED_MS_MAX = 1500


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
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None  # a live App may be mid-write; an unreadable turn is a missing turn, never a crash


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
    `consequence:npc_reaction:<actor>:<target>`, `consequence:clue_follow_up:<clue>`, `consequence:time_cost:<handle>`.
    `npc_reaction`'s `<target>` is the person's graph handle since SL-83 (`vittorio-macario`); a table played on a
    build before SL-83 wrote the display name there (`Vittorio Macario`), which `corrected_npc_reaction` resolves."""
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
    if any(r.get('npc') == target_label for r in rolls):
        parts.append(f"a first-impression roll's npc field this turn IS the row's own target {target_label!r} (a handle, SL-83's row shape): "
                      "the product's pairing should have read true -- check keeperDidFor before reading this as a disagreement")
    elif handle and any(r.get('npc') == handle for r in rolls):
        parts.append(f"label->handle map resolves target {target_label!r} to {handle!r}, which matches a first-impression roll's npc field this turn "
                      "-- reads as the SAME engagement; keeper_did disagrees only because the row's own key carries the display label, not the handle "
                      "the roll receipt normalizes to (a row written before SL-83; the product now carries the handle on the row)")
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
    computed only over rows whose turn is not stranded. On a table played after SL-83 the key already carries the
    handle, `label_map` resolves nothing, and this figure equals the raw one (SL-83 fixed the product: the row
    carries `handle`, the candidate's key/bound.target is that handle, and `keeperDidFor` compares handles)."""
    out = []
    for row in rows:
        target = parse_key('npc_reaction', row.get('key', '')).get('target', '')
        receipts = (turn_records.get(row.get('turn')) or {}).get('receipts') or []
        rolls = [r for r in receipts if r.get('kind') == 'roll' and r.get('decision') == NPC_REACTION_DECISION]
        handle = label_map.get(target)
        wanted = {value for value in (target, handle) if value}
        matched = any(r.get('npc') in wanted for r in rolls)
        corrected = 'true' if matched else ('other' if rolls else 'false')
        out.append((row, corrected))
    return out


KEEPER_CALL_KEYS = ('apply', 'resolve', 'look', 'lookup', 'recall')


def residual_section(telemetry, turn_files):
    """SL-78: the `lane:"residual"` rows, one per turn under `COC_JEV_STEPS=on`. Prints each turn's row and a
    per-verb summary (median/mean/max), the same shape as the "added Jev ms" section below reports the shadow
    route's own cost. A campaign run under `shadow`/`off` writes none of these rows -- reported as such, never
    inferred from their absence elsewhere."""
    rows = [r for r in telemetry if r.get('lane') == 'residual']
    print('\n-- residual (SL-78, `lane:"residual"`; `COC_JEV_STEPS=on` only) --')
    if not rows:
        print('  no residual rows in this campaign\'s telemetry -- this table ran `shadow`/`off`, or SL-78 is not deployed')
        return rows
    print(f'{"turn":>5} {"apply":>6} {"resolve":>8} {"look":>5} {"lookup":>7} {"recall":>7} {"compile":>8} {"clerk":>6} {"consequence":>12}')
    for row in sorted(rows, key=lambda r: (r.get('turn') is None, r.get('turn'))):
        kc = row.get('keeper_calls') or {}
        print(f'{str(row.get("turn")):>5} {kc.get("apply", 0):>6} {kc.get("resolve", 0):>8} {kc.get("look", 0):>5} '
              f'{kc.get("lookup", 0):>7} {kc.get("recall", 0):>7} {row.get("compile_calls", 0):>8} {row.get("clerk_calls", 0):>6} '
              f'{row.get("consequence_calls", 0):>12}')
    totals = {key: sum((r.get('keeper_calls') or {}).get(key, 0) for r in rows) for key in KEEPER_CALL_KEYS}
    keeper_per_turn = [sum((r.get('keeper_calls') or {}).values()) for r in rows]
    print(f'  keeper_calls totals over {len(rows)} turns: {totals} (sum {sum(totals.values())})')
    print(f'  keeper_calls per turn: median {statistics.median(keeper_per_turn):.1f}; mean {statistics.mean(keeper_per_turn):.2f}; max {max(keeper_per_turn)}')
    for label, key in (('compile_calls', 'compile_calls'), ('clerk_calls', 'clerk_calls'), ('consequence_calls', 'consequence_calls')):
        values = [r.get(key, 0) for r in rows]
        print(f'  {label} per turn: median {statistics.median(values):.1f}; mean {statistics.mean(values):.2f}; max {max(values)}; sum {sum(values)}')
    turns_with_row = {r.get('turn') for r in rows}
    missing = sorted(t for t in turn_files if t not in turns_with_row)
    if missing:
        print(f'  turns with a turn file but no residual row: {missing} (a run that never reached turn close, or ran before SL-78)')
    return rows


def recall_precision_section(candidate_rows, stranded):
    """SL-86 (ticket 86, §135.32 addendum 3): per class, precision (`tp/(tp+fp)`) and recall (`tp/(tp+fn)`) over
    the paired candidate rows -- a false positive is a cleared row the Keeper's own receipts say it did not act
    on (`keeper_did` false/other, the same rows the "cleared-but-false/other" section above lists in detail); a
    false negative is a row the shadow route did NOT clear (`cleared` falsy: `false` or an unresolved `null`
    Noul) whose entity the Keeper's own receipts say it filed the same turn anyway (`keeper_did: true`) -- read
    off the row's own `confidence` (the Noul's `yes` probability), never re-derived. A turn the run never
    delivered (`stranded`) is excluded, the same pairing rule the per-class table above already applies. This is
    a read of already-recorded telemetry: it reports what a table's `cleared`/`keeper_did` values were under
    whatever gate was live when it was played, never a live Jev re-ask."""
    print('\n-- recall/precision (SL-86, ticket 86): false negatives are offered rows the Keeper filed but Jev did not clear --')
    print(f'{"class":<16} {"tp":>4} {"fp":>4} {"fn":>4} {"precision":>10} {"recall":>8}')
    fn_by_class = collections.defaultdict(list)
    for cls in CLASSES:
        rows = [r for r in candidate_rows if r.get('class') == cls and r.get('turn') not in stranded]
        tp = sum(1 for r in rows if r.get('cleared') and r.get('keeper_did') is True)
        fp = sum(1 for r in rows if r.get('cleared') and str(r.get('keeper_did')).lower() in ('false', 'other'))
        fn_rows = [r for r in rows if not r.get('cleared') and r.get('keeper_did') is True]
        precision = f'{tp / (tp + fp):.2f}' if (tp + fp) else 'n/a'
        recall = f'{tp / (tp + len(fn_rows)):.2f}' if (tp + len(fn_rows)) else 'n/a'
        print(f'{cls:<16} {tp:>4} {fp:>4} {len(fn_rows):>4} {precision:>10} {recall:>8}')
        fn_by_class[cls] = fn_rows
    any_fn = False
    for cls in CLASSES:
        for row in fn_by_class.get(cls, []):
            any_fn = True
            print(f'  [{cls}] turn {row.get("turn")} key={row.get("key")!r} yes_probability={row.get("confidence")}')
    if not any_fn:
        print('  (no false negatives: every row the Keeper filed this turn, Jev also cleared)')


def load_campaign(campaign_dir):
    """Everything the per-campaign report and the aggregate verdict read, off disk only (never written): the
    telemetry's consequence rows split into candidate and `exists` rows, the `consequence_budget` cost rows, the
    stranded turns, the turn records and the label->handle map."""
    cid = os.path.basename(campaign_dir)
    telemetry = load_jsonl(os.path.join(campaign_dir, 'telemetry.jsonl'))
    consequence = [r for r in telemetry if r.get('lane') == 'route' and r.get('purpose') == 'consequence']
    turn_files = sorted(int(stem) for stem in
                        (os.path.splitext(os.path.basename(p))[0] for p in globmod.glob(os.path.join(campaign_dir, 'turns', '*.json')))
                        if stem.isdigit())
    turn_records = {t: load_turn(campaign_dir, t) for t in turn_files}
    return {'cid': cid, 'dir': campaign_dir, 'telemetry': telemetry, 'consequence': consequence,
            'candidate_rows': [r for r in consequence if not r.get('exists')],
            'exists_rows': [r for r in consequence if r.get('exists')],
            'budget_rows': [r for r in telemetry if r.get('lane') == 'run' and r.get('event') == 'consequence_budget'],
            'stranded': stranded_turns(telemetry), 'turn_files': turn_files, 'turn_records': turn_records,
            'label_map': person_label_map(turn_records)}


def report_campaign(campaign_dir):
    loaded = load_campaign(campaign_dir)
    cid, telemetry, consequence = loaded['cid'], loaded['telemetry'], loaded['consequence']
    candidate_rows, exists_rows, budget_rows = loaded['candidate_rows'], loaded['exists_rows'], loaded['budget_rows']
    stranded, turn_files = loaded['stranded'], loaded['turn_files']
    turn_records, label_map = loaded['turn_records'], loaded['label_map']

    print(f'\n{"=" * 100}\ncampaign: {cid}')
    print(f'turn files present: {len(turn_files)} ({turn_files[0]}..{turn_files[-1]})' if turn_files else 'turn files present: 0')
    print(f'shadow consequence rows: {len(candidate_rows)} candidate + {len(exists_rows)} exists, over turns {sorted(set(r.get("turn") for r in consequence))}')
    print(f'stranded (undelivered) turns: {sorted(stranded)} ({len(stranded)})')

    print('\n-- per class (candidate rows) --')
    print(f'{"class":<16} {"offered":>7} {"cleared":>7} {"executed":>8} {"shadow":>6} {"true":>5} {"false":>5} {"other":>5} {"null":>5} {"unpaired":>8} {"agreement(true/(true+false))":>28}')
    false_other_detail = collections.defaultdict(list)
    for cls in CLASSES:
        rows = [r for r in candidate_rows if r.get('class') == cls]
        paired = [r for r in rows if r.get('turn') not in stranded]
        unpaired = [r for r in rows if r.get('turn') in stranded]
        offered, cleared = len(rows), sum(1 for r in rows if r.get('cleared'))
        # SL-85 (ticket 85, §135.32 addendum 2's own ruling): `executed` marks a row this run actually ran through
        # the gateway (COC_JEV_STEPS=on, a listed class); `shadow` is carried by every row that was only routed
        # and paired, including a listed class's row that did not clear -- so under `on`, `executed + shadow`
        # need not sum to `offered` (a `direct` time_cost row, or a row from a table run under `off`, carries
        # neither key at all).
        executed = sum(1 for r in rows if r.get('executed') is True)
        shadow_rows = sum(1 for r in rows if r.get('shadow') is True)
        counts = collections.Counter('null' if r.get('keeper_did') is None else str(r.get('keeper_did')).lower() for r in paired)
        t, f = counts.get('true', 0), counts.get('false', 0)
        agreement = f'{t}/{t + f} = {t / (t + f):.2f}' if (t + f) else 'n/a (no true+false rows)'
        print(f'{cls:<16} {offered:>7} {cleared:>7} {executed:>8} {shadow_rows:>6} {t:>5} {f:>5} {counts.get("other", 0):>5} {counts.get("null", 0):>5} {len(unpaired):>8} {agreement:>28}')
        for row in paired:
            if row.get('cleared') and str(row.get('keeper_did')).lower() in ('false', 'other'):
                false_other_detail[cls].append(row)

    # SL-85: a (turn, class, key) offered more than once is the duplicate this ticket's engine fix removes going
    # forward; flagged here (never silently deduped) so a report against pre-fix telemetry says so plainly, and a
    # report against post-fix telemetry shows none.
    dupe_counts = collections.Counter((r.get('turn'), r.get('class'), r.get('key')) for r in candidate_rows)
    dupes = {k: n for k, n in dupe_counts.items() if n > 1}
    if dupes:
        print(f'\n-- duplicate candidate rows for the same (turn, class, key) (SL-85: pre-fix telemetry, a steer leg or a bypassed turn_close) --')
        for (turn, cls, key), n in sorted(dupes.items()):
            print(f'  turn {turn} [{cls}] key={key!r}: {n} rows')

    recall_precision_section(candidate_rows, stranded)

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

    print('\n-- jev outages (SL-84, contract §122 addendum: `{lane:"jev", event:"attempt_failed"|"batch_failed"}` rows) --')
    attempt_failed = [r for r in telemetry if r.get('lane') == 'jev' and r.get('event') == 'attempt_failed']
    batch_failed = [r for r in telemetry if r.get('lane') == 'jev' and r.get('event') == 'batch_failed']
    if not attempt_failed and not batch_failed:
        print('  no jev attempt_failed/batch_failed rows in this campaign\'s telemetry')
    else:
        outage_turns = sorted({r.get('turn') for r in batch_failed})
        print(f'  turns with a batch outage: {outage_turns} ({len(outage_turns)})')
        statuses = collections.Counter(str(r.get('status', r.get('code'))) for r in attempt_failed)
        print(f'  attempt statuses/codes seen: {dict(statuses)} over {len(attempt_failed)} failed attempts')
        by_family = collections.Counter(r.get('family') for r in batch_failed)
        print(f'  batch_failed by family: {dict(by_family)}')

    print('\n-- added Jev ms per turn (from `{lane:"run", event:"consequence_budget"}` rows) --')
    if not budget_rows:
        print('  no consequence_budget rows in this campaign\'s telemetry -- cannot report added ms')
    else:
        for row in sorted(budget_rows, key=lambda r: r.get('turn', 0)):
            print(f'  turn {row.get("turn")}: {row.get("ms")} ms over {row.get("rows")} rows')
        ms = [r.get('ms') for r in budget_rows if isinstance(r.get('ms'), (int, float))]
        if ms:
            print(f'  turns with a shadow call: {len(ms)}/{len(turn_files)}; median {statistics.median(ms):.0f} ms; mean {statistics.mean(ms):.1f} ms; max {max(ms)} ms')

    residual_rows = residual_section(telemetry, turn_files)

    return {'cid': cid, 'candidate_rows': candidate_rows, 'exists_rows': exists_rows, 'stranded': stranded,
            'budget_rows': budget_rows, 'turn_files': turn_files,
            'jev_attempt_failed': attempt_failed, 'jev_batch_failed': batch_failed, 'residual_rows': residual_rows}


# --- homes and the aggregate D6 2a verdict (ticket 05) -------------------------------------------------------------

HOME_LAYOUTS = (
    # (path under the given directory, layout name). The first is a repo checkout and also the packaged App's home
    # (`<userData>/pi-coc`, `PI_COC_HOME`): both keep the kernel workspace at `<home>/.coc`.
    (('.coc', 'campaigns'), 'home'),
    (('campaigns',), 'workspace'),
    (('pi-coc', '.coc', 'campaigns'), 'app-userdata'),
)


def resolve_home(path):
    """`(campaigns_dir, layout)` for a home path, or None when it holds no campaigns directory. Structural only:
    which directory exists, never a name list."""
    base = os.path.abspath(os.path.expanduser(path))
    for parts, layout in HOME_LAYOUTS:
        candidate = os.path.join(base, *parts)
        if os.path.isdir(candidate):
            return candidate, layout
    if os.path.basename(base) == 'campaigns' and os.path.isdir(base):
        return base, 'campaigns-dir'
    return None


def split_arguments(positionals):
    """The original form was `<root> <glob> ...`; the new one is homes only. A positional that resolves as a home
    is a home, every other positional is a campaign glob (the original form). A positional that is an existing
    directory yet resolves to no campaigns directory is an error, never a glob: a typo must not read as no data."""
    homes, globs, errors = [], [], []
    seen = set()
    for value in positionals:
        resolved = resolve_home(value)
        if resolved:
            key = os.path.realpath(resolved[0])
            if key not in seen:
                seen.add(key)
                homes.append({'given': value, 'campaigns_dir': resolved[0], 'layout': resolved[1]})
        elif os.path.isdir(os.path.expanduser(value)):
            errors.append(f'{value!r} is a directory but holds no .coc/campaigns, campaigns, or pi-coc/.coc/campaigns')
        else:
            globs.append(value)
    return homes, globs, errors


def campaign_dirs(homes, globs):
    """Every campaign directory of every home whose name matches one of `globs`, in home order, each once."""
    out, seen = [], set()
    for index, home in enumerate(homes, 1):
        for pattern in globs:
            for path in sorted(p for p in globmod.glob(os.path.join(home['campaigns_dir'], pattern)) if os.path.isdir(p)):
                if (index, path) not in seen:
                    seen.add((index, path))
                    out.append((index, path))
    return out


def d6_rows(loaded, cls):
    """The rows of `cls` the D6 2a verdict counts for one table, and why the others are not counted. Returns
    `(kept, artifacts, excluded, executes)`: `kept` is `[(row, cleared, keeper_acted)]`; `artifacts` how many of
    them the label/handle correction (`corrected_npc_reaction`) turned from a disagreement into the Keeper's own
    action; `executes` whether this table ran the class in execute mode (any `executed` row of it)."""
    latest = {}
    for row in loaded['candidate_rows']:
        if row.get('class') == cls:
            latest[(row.get('turn'), row.get('key'))] = row
    all_rows = [r for r in loaded['candidate_rows'] if r.get('class') == cls]
    excluded = collections.Counter()
    excluded['duplicate'] = len(all_rows) - len(latest)
    executes = any(row.get('executed') is True for row in latest.values())
    kept_rows = []
    for row in latest.values():
        if row.get('turn') in loaded['stranded']:
            excluded['stranded'] += 1
        elif row.get('executed') is True:
            excluded['executed'] += 1
        elif row.get('direct'):
            excluded['direct'] += 1
        elif row.get('confidence') is None:
            excluded['unanswered'] += 1
        elif row.get('keeper_did') is None:
            excluded['no_verdict'] += 1
        else:
            kept_rows.append(row)
    corrected = {}
    if cls == 'npc_reaction':
        corrected = {id(row): value for row, value in corrected_npc_reaction(kept_rows, loaded['turn_records'], loaded['label_map'])}
    kept, artifacts = [], 0
    for row in kept_rows:
        acted = row.get('keeper_did') is True
        if not acted and corrected.get(id(row)) == 'true':
            acted, artifacts = True, artifacts + 1
        kept.append((row, bool(row.get('cleared')), acted))
    return kept, artifacts, {k: v for k, v in excluded.items() if v}, executes


def added_ms_per_turn(loaded):
    """Added Jev ms per turn that made a shadow call, off the `consequence_budget` rows: the last row of a
    `(turn, run)` (SL-85 wrote some twice), summed over the runs of a turn. Empty when the table has none."""
    latest = {}
    for row in loaded['budget_rows']:
        if isinstance(row.get('ms'), (int, float)) and not isinstance(row.get('ms'), bool):
            latest[(row.get('turn'), row.get('run'))] = row['ms']
    per_turn = collections.defaultdict(float)
    for (turn, _run), ms in latest.items():
        per_turn[turn] += ms
    return dict(per_turn)


def d6_table(index, loaded):
    """One table's D6 2a numbers: per class tp/fp/fn/tn and exclusions, and the added-ms figures."""
    per_turn = added_ms_per_turn(loaded)
    values = list(per_turn.values())
    classes = {}
    for cls in CLASSES:
        kept, artifacts, excluded, executes = d6_rows(loaded, cls)
        classes[cls] = {'rows': len(kept), 'artifacts': artifacts, 'excluded': excluded, 'executes': executes,
                        'tp': sum(1 for _, cleared, acted in kept if cleared and acted),
                        'fp': sum(1 for _, cleared, acted in kept if cleared and not acted),
                        'fn': sum(1 for _, cleared, acted in kept if not cleared and acted),
                        'tn': sum(1 for _, cleared, acted in kept if not cleared and not acted)}
    return {'label': f'h{index}:{loaded["cid"]}', 'cid': loaded['cid'], 'home': index, 'turns': len(loaded['turn_files']),
            'classes': classes, 'executed_steps': executed_steps(loaded),
            'cost': {'turns_with_call': len(values), 'mean_ms': statistics.mean(values) if values else None,
                     'median_ms': statistics.median(values) if values else None, 'max_ms': max(values) if values else None}}


CLUE_KEY_PREFIX = 'consequence:clue_follow_up:'


def run_turns(telemetry):
    """run id -> the turns the telemetry rows carrying both a `run` and a `turn` put it on. The consequence rows being
    resolved are left out: the map is independent evidence (bind, budget and residual rows of the same run), never the
    row's own `turn` read back."""
    out = collections.defaultdict(set)
    for row in telemetry:
        if row.get('lane') == 'route' and row.get('purpose') == 'consequence':
            continue
        run, turn = row.get('run'), row.get('turn')
        if isinstance(run, str) and isinstance(turn, int) and not isinstance(turn, bool):
            out[run].add(turn)
    return out


def clue_marker(handle):
    """The Keeper's marker for a clue handle: `{{clue:<handle>}}`, optionally with the kernel's `-<n>` repeat suffix or
    the `-t<n>` receipt-id form. Anchored on the closing braces, so another handle starting with this one is not it."""
    return re.compile(r'\{\{clue:' + re.escape(handle) + r'(?:-t?\d+)?\}\}')


def executed_steps(loaded):
    """D6 2b for one table: of the `executed: true` `clue_follow_up` rows, how many the Keeper narrated (a marker for the
    clue in the turn's delivered `text`) and which it did not. Other executed classes are counted, not checked; a row
    on an undelivered turn, with no turn record, or with no `text` cannot be checked and is counted as such."""
    turns_of = run_turns(loaded['telemetry'])
    latest = {}
    mismatched = 0
    for row in loaded['candidate_rows']:
        if row.get('executed') is not True:
            continue
        named = turns_of.get(row.get('run'), set())
        turn = next(iter(named)) if len(named) == 1 else row.get('turn')
        if len(named) == 1 and row.get('turn') is not None and row.get('turn') != turn:
            mismatched += 1
        latest[(turn, row.get('class'), row.get('key'))] = (turn, row)
    result = {'executed': 0, 'narrated': 0, 'neither': [], 'not_checkable': collections.Counter(),
              'other_classes': collections.Counter(), 'turn_mismatch': mismatched}
    for (turn, cls, key), (_turn, row) in latest.items():
        if cls != 'clue_follow_up':
            result['other_classes'][cls] += 1
            continue
        result['executed'] += 1
        record = loaded['turn_records'].get(turn)
        if turn in loaded['stranded']:
            result['not_checkable']['undelivered_turn'] += 1
        elif record is None:
            result['not_checkable']['no_turn_record'] += 1
        elif not isinstance(record.get('text'), str):
            result['not_checkable']['no_text'] += 1
        elif clue_marker(key[len(CLUE_KEY_PREFIX):] if key.startswith(CLUE_KEY_PREFIX) else key).search(record['text']):
            result['narrated'] += 1
        else:
            result['neither'].append({'turn': turn, 'key': key, 'confidence': row.get('confidence')})
    result['neither'].sort(key=lambda item: (item['turn'] is None, item['turn'], item['key']))
    return result


def is_table(loaded):
    return any(row.get('class') in CLASSES for row in loaded['consequence'])


def rate(numerator, denominator):
    return numerator / denominator if denominator else None


def aggregate(homes, globs=('*',)):
    """Read every campaign of every home and fold the D6 2a verdict. Read-only. `homes` is what `split_arguments`
    returns. The result is plain data, rendered by `render_verdict`."""
    tables, scanned = [], 0
    for index, path in campaign_dirs(homes, globs):
        scanned += 1
        loaded = load_campaign(path)
        if is_table(loaded):
            tables.append(d6_table(index, loaded))
    with_cost = [t for t in tables if t['cost']['mean_ms'] is not None]
    cost_over = [t['label'] for t in with_cost if t['cost']['mean_ms'] > ADDED_MS_MAX]
    cost_met = bool(with_cost) and not cost_over
    verdicts = {}
    for cls in CLASSES:
        rows = [t for t in tables if t['classes'][cls]['rows']]
        tp, fp, fn, tn = (sum(t['classes'][cls][k] for t in tables) for k in ('tp', 'fp', 'fn', 'tn'))
        shadow_only = [t for t in tables if not t['classes'][cls]['executes']]
        recall_tp, recall_fn = (sum(t['classes'][cls][k] for t in shadow_only) for k in ('tp', 'fn'))
        agreement = rate(tp, tp + fp)
        fp_over = [t['label'] for t in tables if t['classes'][cls]['fp'] > FALSE_POSITIVES_MAX_PER_TABLE]
        agreement_met = agreement is not None and agreement >= AGREEMENT_MIN
        fp_met = not fp_over
        excluded = collections.Counter()
        for t in tables:
            excluded.update(t['classes'][cls]['excluded'])
        verdicts[cls] = {'tables_with_rows': len(rows), 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'agreement': agreement,
                         'agreement_met': agreement_met, 'fp_max_per_table': max((t['classes'][cls]['fp'] for t in tables), default=0),
                         'fp_over': fp_over, 'fp_met': fp_met, 'cost_met': cost_met,
                         'recall': rate(recall_tp, recall_tp + recall_fn), 'recall_tp': recall_tp, 'recall_fn': recall_fn,
                         'recall_tables': len(shadow_only),
                         'artifacts': sum(t['classes'][cls]['artifacts'] for t in tables), 'excluded': dict(excluded),
                         'met': bool(rows) and agreement_met and fp_met and cost_met}
    executed_total = {'tables': sum(1 for t in tables if t['executed_steps']['executed']),
                      'executed': sum(t['executed_steps']['executed'] for t in tables),
                      'narrated': sum(t['executed_steps']['narrated'] for t in tables),
                      'neither': sum(len(t['executed_steps']['neither']) for t in tables),
                      'not_checkable': sum(sum(t['executed_steps']['not_checkable'].values()) for t in tables)}
    return {'homes': homes, 'scanned': scanned, 'tables': tables, 'classes': verdicts, 'executed_steps': executed_total,
            'cost': {'tables_with_data': len(with_cost), 'over': cost_over, 'met': cost_met}}


def fraction(numerator, denominator, digits=2):
    return f'{numerator}/{denominator} = {numerator / denominator:.{digits}f}' if denominator else 'n/a'


def render_verdict(agg):
    """The D6 2a verdict, per class, as met / not met with the table count and every table's numbers."""
    tables = agg['tables']
    print(f'\n{"=" * 100}\nD6 2a verdict (docs/specs/jev-driven-steps.md): per class, agreement (precision over the cleared rows the Keeper\'s receipts can judge) >= {AGREEMENT_MIN:.2f}; '
          f'false positives <= {FALSE_POSITIVES_MAX_PER_TABLE} per table; added Jev <= {ADDED_MS_MAX} ms per turn')
    for index, home in enumerate(agg['homes'], 1):
        print(f'  h{index}: {home["campaigns_dir"]}  [{home["layout"]}]')
    print(f'  campaigns scanned: {agg["scanned"]}; tables with consequence telemetry: {len(tables)}'
          f' ({agg["scanned"] - len(tables)} without: setup sessions, tables run with COC_JEV_STEPS=off, or older builds)')
    for cls in CLASSES:
        v = agg['classes'][cls]
        print(f'\n[{cls}] {"MET" if v["met"] else "NOT MET"} -- {v["tables_with_rows"]} of {len(tables)} tables have rows of this class')
        if v['agreement'] is None:
            print(f'  agreement (cleared rows the Keeper\'s receipts can judge, tp/(tp+fp)): n/a -- no such row (tp {v["tp"]}, fp {v["fp"]}): NOT MET, no evidence')
        else:
            print(f'  agreement (cleared rows the Keeper\'s receipts can judge, tp/(tp+fp)): {fraction(v["tp"], v["tp"] + v["fp"], 3)} '
                  f'(>= {AGREEMENT_MIN:.2f}): {"met" if v["agreement_met"] else "NOT MET"}')
        print(f'  recall tp/(tp+fn), information only, over the {v["recall_tables"]} tables that only shadowed the class: '
              f'{fraction(v["recall_tp"], v["recall_tp"] + v["recall_fn"])}')
        print(f'  false positives per table: worst {v["fp_max_per_table"]} (<= {FALSE_POSITIVES_MAX_PER_TABLE}): '
              f'{"met" if v["fp_met"] else "NOT MET in " + ", ".join(v["fp_over"])}')
        cost = agg['cost']
        print('  added Jev ms per turn: ' + ('no table has a consequence_budget row: NOT MET, no evidence' if not cost['tables_with_data'] else
              f'{"met" if cost["met"] else "NOT MET in " + ", ".join(cost["over"])} (see below)'))
        if v['artifacts']:
            print(f'  label/handle pairing artifacts read as the Keeper\'s own action (not false positives): {v["artifacts"]}')
        if v['excluded']:
            print(f'  rows not counted: {v["excluded"]}')
        for table in tables:
            t = table['classes'][cls]
            if not t['rows'] and t['excluded']:
                print(f'    {table["label"]}: not counted {t["excluded"]}')
            if t['rows']:
                print(f'    {table["label"]}: rows {t["rows"]} tp {t["tp"]} fp {t["fp"]} fn {t["fn"]} tn {t["tn"]} '
                      f'agreement {fraction(t["tp"], t["tp"] + t["fp"])} recall {fraction(t["tp"], t["tp"] + t["fn"]) if not t["executes"] else "n/a (executed)"}' + (f' artifacts {t["artifacts"]}' if t['artifacts'] else '')
                      + (f' not counted {t["excluded"]}' if t['excluded'] else ''))
    print('\nadded Jev ms per turn (mean over the turns that made a shadow call; each table must be <= '
          f'{ADDED_MS_MAX} ms), all classes:')
    if not tables:
        print('  no tables')
    for table in tables:
        c = table['cost']
        if c['mean_ms'] is None:
            print(f'  {table["label"]}: no consequence_budget rows (no Jev time recorded)')
        else:
            print(f'  {table["label"]}: {c["turns_with_call"]}/{table["turns"]} turns with a call; mean {c["mean_ms"]:.0f} ms; '
                  f'median {c["median_ms"]:.0f} ms; max {c["max_ms"]:.0f} ms')
    render_executed_steps(agg)


def render_executed_steps(agg):
    """The "executed steps not in the prose" section (D6 2b), per table with an executed clue row, then the totals."""
    total = agg['executed_steps']
    print('\n-- executed steps not in the prose (D6 2b: every executed step appears in the prose or is reversed with a receipt) --')
    print('  narrated: a Keeper-placed {{clue:<handle>}} marker (also -N / -tN) in the turn\'s delivered `text`; a structural proxy, '
          'prose that tells the clue without its marker is not seen')
    print('  reversed: n/a -- no receipt kind reverses a clue (kernel-ts `apply clue` only appends to discovered_clues)')
    for table in agg['tables']:
        e = table['executed_steps']
        if not e['executed'] and not e['other_classes']:
            continue
        extras = ''.join(f'; {label} {value}' for label, value in
                         (('not checkable', dict(e['not_checkable'])), ('other executed classes, not checked', dict(e['other_classes'])),
                          ('row turn differs from its run\'s turn', e['turn_mismatch'])) if value)
        print(f'  {table["label"]}: executed {e["executed"]}, narrated {e["narrated"]}, reversed n/a, neither {len(e["neither"])}{extras}')
        for item in e['neither']:
            print(f'    neither: turn {item["turn"]} key={item["key"]!r} confidence={item["confidence"]}')
    print(f'  totals: {total["executed"]} executed clue steps over {total["tables"]} tables; narrated {total["narrated"]}; '
          f'reversed n/a; neither {total["neither"]}; not checkable {total["not_checkable"]}')


def main(argv):
    parser = argparse.ArgumentParser(prog='jev-steps-report.py', add_help=True,
                                     description='Read-only D6 2a shadow report over one or more homes (see the module docstring).')
    parser.add_argument('paths', nargs='*', help='homes; in the original form `<root> <glob> ...`, the non-home arguments are campaign globs')
    parser.add_argument('--campaign', action='append', default=[], metavar='GLOB', help='campaign directory name filter (default *)')
    parser.add_argument('--detail', action='store_true', help='print every campaign\'s own sections before the verdict')
    if len(argv) < 2:
        print(__doc__)
        return 2
    args = parser.parse_args(argv[1:])
    homes, positional_globs, errors = split_arguments(args.paths)
    for message in errors:
        print(message)
    if errors:
        return 1
    if not homes:
        print(f'no home given: none of {args.paths!r} holds a .coc/campaigns, campaigns, or pi-coc/.coc/campaigns directory')
        return 1
    globs = list(positional_globs) + list(args.campaign)
    detail = args.detail or bool(positional_globs)
    matched = campaign_dirs(homes, globs or ['*'])
    if not matched:
        print(f'no campaign directories under {[h["campaigns_dir"] for h in homes]!r} matched {globs or ["*"]!r}')
        return 1
    if detail:
        for _index, campaign_dir in matched:
            report_campaign(campaign_dir)
    render_verdict(aggregate(homes, globs or ['*']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
