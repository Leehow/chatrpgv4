"""Offline replay of reading children's image windows (contract §186.1, ticket RC-01).

Reads the retained reading logs of a Pipi home (read only) and prices candidate image-count budgets for the reader
context hook: today's sliding four-image window with submission retirement (the measured baseline), and §186.1's
batch eviction (when the next image would overflow the budget, evict the oldest delivered images down to half of it)
at several budgets, each with the submission retirement on or off.

Inputs per child run (an author attempt `read-<round>[-targeted].jsonl`, a review unit attempt `events.jsonl`): the Pi
event log (assistant `message_end` usage), its `.images.jsonl` (one `attempted` row per provider request with the image
keys the request held) and `.requests.jsonl` (provider and model). Only `guidance/opening/detail/answer` runs are in
scope (the purposes that had `imageHistory: 4`).

Per request i of a run, with Tot = input + cacheRead (the whole prompt) and T the tokens of one image:

- new(i) = Tot(i) - Tot(i-1) + T * dropped(i): what was appended since the previous request (a dropped image became a
  placeholder, so the measured total shrank by about one image).
- miss(i) = max(0, input(i) - new(i)). At a request where the actual run dropped images (its window or a submission's
  retirement) it is our rewrite miss; elsewhere a provider-side miss (the prefix only grew and still missed).
- A policy's prompt Tot'(i) = Tot(i) + T * (images the policy holds - images the run held).
- A policy's uncached input'(i):
  * where the policy rewrites (evicts or retires): k * (Tot'(i) - position of the earliest rewritten image), where the
    position is the policy's prompt size before that image arrived (for the first request's own images, its prompt
    less those images) and k calibrates this position model against the run's own rewrite events (k = measured input
    / modelled input over them);
  * where only the actual run rewrote: input(i) - miss(i);
  * elsewhere: input(i), plus, at a provider-side miss, T for every image the policy holds and the run did not whose
    arrival lies after the prefix the provider matched (cacheRead(i)): that region was recomputed.
- Reopens (a `pdf`/`read` image of a (page, box) the run had already viewed): "fixed" keeps the actual trajectory;
  "adjusted" drops a reopen that followed a drop when the policy still held the earlier image, and charges, for each
  image the policy evicted while the run still held it, the measured reopen rate after a drop (one image, uncached
  once, then carried cached).

T is fitted per provider/model from consecutive requests: dTot = T * dImages + a * dChars + b * output(i-1) + c.
Price: cost units = uncached + ratio * cached, ratio = cacheRead price / input price, derived from the usage cost fields
where the provider prices them (luna 0.01 / 0.1 per M = 0.1; deepseek-flash 0.003 / 0.15 = 0.02); grok-build reports
zero cost (subscription), so its ratio is an assumption (--grok-ratio, default 0.25, xAI's published cached/uncached
ratio for its grok-4 family).

Usage: uv run --frozen python tests/play/reading_image_replay.py [--home <pi-coc home>] [--since 2026-10-02]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

AFFECTED = {"guidance", "opening", "detail", "answer"}
DEFAULT_HOME = os.path.expanduser("~/Library/Application Support/Pipi/pipicoc/pi-coc")
BYTE_BUDGET = 32 * 1024 * 1024


@dataclass
class Request:
    keys: list[str]
    count: int
    bytes: int
    input: int
    cache_read: int
    output: int
    cost_input: float = 0.0  # the usage cost fields, where the provider prices them
    cost_cached: float = 0.0
    chars: int = 0           # text appended since the previous request
    submitted: bool = False  # a submit_reading ended since the previous request (the hook retired on any)
    views: list[tuple[str, tuple]] = field(default_factory=list)  # (key, (page, box)) first held here

    @property
    def tot(self) -> int:
        return self.input + self.cache_read


@dataclass
class Run:
    path: str
    role: str
    provider: str
    model: str
    purpose: str
    requests: list[Request]


def jsonl(path: str):
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def text_chars(message: dict) -> int:
    content = message.get("content")
    if isinstance(content, str):
        return len(content)
    total = 0
    for block in content or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                total += len(block.get("text") or "")
            elif block.get("type") == "thinking":
                total += len(block.get("thinking") or "")
            elif block.get("type") == "toolCall":
                total += len(json.dumps(block.get("arguments") or {}))
    return total


def view_identity(details: dict) -> list[tuple]:
    out = []
    for row in details.get("observations") or details.get("pages") or []:
        if isinstance(row, dict) and isinstance(row.get("page"), int):
            out.append((row["page"], tuple(row.get("box") or (0, 0, 1, 1))))
    return out


def parse_run(images_log: str) -> Run | None:
    event_log = images_log[: -len(".images.jsonl")]
    directory = os.path.dirname(event_log)
    try:
        with open(event_log + ".requests.jsonl", encoding="utf-8") as handle:
            first = json.loads(handle.readline())
        provider, model = first.get("provider") or "?", first.get("model") or "?"
        with open(os.path.join(directory, "task.json"), encoding="utf-8") as handle:
            purpose = json.load(handle).get("purpose") or "?"
    except (OSError, ValueError):
        return None
    if purpose not in AFFECTED:
        return None
    attempted = [row for row in jsonl(images_log) if row.get("delivery") == "attempted"]
    requests: list[Request] = []
    chars, submitted = 0, False
    views: dict[str, list[tuple]] = {}
    for event in jsonl(event_log):
        kind = event.get("type")
        if kind == "tool_execution_end":
            if event.get("toolName") == "submit_reading":
                submitted = True
            result = event.get("result") or {}
            if not event.get("isError") and any(isinstance(b, dict) and b.get("type") == "image" for b in result.get("content") or []):
                identity = view_identity(result.get("details") or {})
                if not identity and event.get("toolName") == "read":
                    identity = [(str((event.get("args") or {}).get("path") or ""), (0, 0, 1, 1))]
                views[event.get("toolCallId")] = identity
            continue
        if kind != "message_end":
            continue
        message = event.get("message") or {}
        details = message.get("details") if isinstance(message.get("details"), dict) else {}
        if message.get("role") == "custom" and details.get("kind") == "host_source_pages":
            for row in details.get("pages") or []:
                if isinstance(row, dict) and isinstance(row.get("page"), int):
                    views["host:" + str(row.get("image_sha256"))] = [(row["page"], tuple(row.get("box") or (0, 0, 1, 1)))]
        if message.get("role") != "assistant":
            chars += text_chars(message)
            continue
        if len(requests) >= len(attempted):
            break
        usage = message.get("usage") or {}
        row = attempted[len(requests)]
        failed = message.get("stopReason") in ("error", "aborted")
        requests.append(Request(keys=list(row.get("candidates") or []), count=int(row.get("count") or 0), bytes=int(row.get("bytes") or 0),
                                input=0 if failed else int(usage.get("input") or 0), cache_read=0 if failed else int(usage.get("cacheRead") or 0),
                                output=int(usage.get("output") or 0), chars=chars, submitted=submitted,
                                cost_input=float((usage.get("cost") or {}).get("input") or 0), cost_cached=float((usage.get("cost") or {}).get("cacheRead") or 0)))
        chars, submitted = text_chars(message), False
    seen: set[str] = set()
    for request in requests:
        for key in request.keys:
            if key in seen:
                continue
            seen.add(key)
            lookup = "host:" + key.rsplit(":", 1)[-1] if key.startswith("host:") else key
            for identity in views.get(lookup) or [("unknown", (key,))]:
                request.views.append((key, identity))
    ok = [r for r in requests if r.tot > 0]
    if not ok:
        return None
    return Run(images_log, "review" if "/verify-" in images_log else "author", provider, model, purpose, requests)


def collect(home: str, since: float) -> list[Run]:
    runs = []
    for path in glob.glob(os.path.join(home, ".coc", "**", "work", "**", "*.jsonl.images.jsonl"), recursive=True):
        try:
            if os.path.getmtime(path) < since:
                continue
        except OSError:
            continue
        run = parse_run(path)
        if run:
            runs.append(run)
    return runs


def solve(rows: list[list[float]], ys: list[float]) -> list[float]:
    """Least squares by normal equations (small, dense)."""
    n = len(rows[0])
    a = [[sum(r[i] * r[j] for r in rows) for j in range(n)] for i in range(n)]
    b = [sum(r[i] * y for r, y in zip(rows, ys)) for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda k: abs(a[k][col]))
        a[col], a[pivot], b[col], b[pivot] = a[pivot], a[col], b[pivot], b[col]
        if abs(a[col][col]) < 1e-12:
            continue
        for k in range(n):
            if k != col:
                f = a[k][col] / a[col][col]
                for j in range(col, n):
                    a[k][j] -= f * a[col][j]
                b[k] -= f * b[col]
    return [b[i] / a[i][i] if abs(a[i][i]) > 1e-12 else 0.0 for i in range(n)]


def price_ratio(runs: list[Run]) -> float | None:
    """cacheRead price / input price from the usage cost fields; None when the provider reports no cost."""
    requests = [r for run in runs for r in run.requests if r.tot]
    tokens_in, tokens_cached = sum(r.input for r in requests), sum(r.cache_read for r in requests)
    cost_in, cost_cached = sum(r.cost_input for r in requests), sum(r.cost_cached for r in requests)
    if not (tokens_in and tokens_cached and cost_in and cost_cached):
        return None
    return (cost_cached / tokens_cached) / (cost_in / tokens_in)


def fit_image_tokens(runs: list[Run]) -> list[float]:
    rows, ys = [], []
    for run in runs:
        ok = [r for r in run.requests if r.tot]
        for prev, cur in zip(ok, ok[1:]):
            rows.append([cur.count - prev.count, cur.chars, prev.output, 1.0])
            ys.append(cur.tot - prev.tot)
    return solve(rows, ys) if len(rows) >= 20 else [1500.0, 0.0, 0.0, 0.0]


@dataclass
class Prepared:
    ok: list[Request]
    submitted: list[bool]               # a submit_reading ended since the previous answered request
    sets: list[set[str]]
    dropped: list[set[str]]
    kind: list[str | None]
    miss: list[float]
    first: dict[str, int]
    position: dict[str, float]          # prompt size before the image arrived (first request: before its images)
    after_drop_reopen: dict[str, str]   # reopened key -> the earlier key of the same view
    reopens_after_drop: int
    reopens_while_held: int
    avg_bytes: float


def prepare(run: Run, t_img: float) -> Prepared:
    ok, submitted, pending = [], [], False
    for request in run.requests:
        pending = pending or request.submitted
        if request.tot:
            ok.append(request)
            submitted.append(pending)
            pending = False
    sets = [set(r.keys) for r in ok]
    dropped, kind, miss = [set()], [None], [0.0]
    for i in range(1, len(ok)):
        gone = sets[i - 1] - sets[i]
        new = max(0.0, ok[i].tot - ok[i - 1].tot + t_img * len(gone))
        dropped.append(gone)
        kind.append(("retire" if submitted[i] else "window") if gone else None)
        miss.append(max(0.0, ok[i].input - new))
    first: dict[str, int] = {}
    position: dict[str, float] = {}
    for i, request in enumerate(ok):
        for key in request.keys:
            if key not in first:
                first[key] = i
                position[key] = float(ok[i - 1].tot) if i else max(0.0, ok[0].tot - t_img * ok[0].count)
    by_view: dict[tuple, list[str]] = defaultdict(list)
    reopen: dict[str, str] = {}
    after = held = 0
    for i, request in enumerate(ok):
        for key, identity in request.views:
            if identity[0] == "unknown" or first.get(key) != i:
                continue
            earlier = by_view.get(identity, [])
            if earlier:
                if i > 0 and any(k in sets[i - 1] for k in earlier):
                    held += 1
                else:
                    after += 1
                    reopen[key] = earlier[-1]
            by_view[identity].append(key)
    sized = [r.bytes / r.count for r in ok if r.count]
    return Prepared(ok, submitted, sets, dropped, kind, miss, first, position, reopen, after, held, sum(sized) / len(sized) if sized else 0.0)


def calibration(prepared: list[Prepared], t_img: float) -> float:
    """k = measured uncached / position-modelled uncached over the runs' own rewrite events."""
    measured = modelled = 0.0
    for p in prepared:
        for i, request in enumerate(p.ok):
            if p.dropped[i]:
                measured += request.input
                modelled += max(0.0, request.tot - min(p.position[k] for k in p.dropped[i]))
    return measured / modelled if modelled else 1.0


def simulate(p: Prepared, t_img: float, k_cal: float, budget: int, retire: bool, rho: float, adjust: bool):
    held: list[str] = []
    gone: set[str] = set()
    skipped: set[str] = set()
    delivered: set[str] = set()
    position: dict[str, float] = {}
    uncached = cached = 0.0
    rewrites = evicted = 0
    extra = bonus = pending = 0.0
    prev_tot = 0.0
    for i, request in enumerate(p.ok):
        rewritten: list[str] = []
        live = lambda: [k for k in held if k not in gone and k not in skipped]
        if retire and i > 0 and p.submitted[i]:
            for key in live():
                if key in delivered:
                    gone.add(key)
                    rewritten.append(key)
        arriving = [key for key in request.keys if p.first.get(key) == i]
        skipped_now = 0
        for key in arriving:
            held.append(key)
            position[key] = prev_tot if i else p.position[key]
            earlier = p.after_drop_reopen.get(key)
            if adjust and earlier is not None and earlier in held and earlier not in gone and earlier not in skipped:
                skipped.add(key)
                skipped_now += 1
        current = live()
        if len(current) > budget or len(current) * p.avg_bytes > BYTE_BUDGET:
            batch: list[str] = []
            for key in current:
                if key not in delivered:
                    continue
                remaining = len(current) - len(batch)
                if remaining <= budget // 2 and remaining * p.avg_bytes <= BYTE_BUDGET // 2:
                    break
                batch.append(key)
            for key in batch:
                gone.add(key)
            rewritten += batch
            evicted += len(batch)
            if adjust:
                expected = rho * sum(1 for key in batch if key in p.sets[i])
                extra += expected
                bonus += expected
                pending += expected
        current = live()
        tot = request.tot + t_img * (len(current) - request.count + bonus)
        if rewritten:
            rewrites += 1
            u = k_cal * max(0.0, tot - min(position.get(key, 0.0) for key in rewritten))
        elif p.dropped[i]:
            u = request.input - p.miss[i]
        else:
            # A provider-side miss recomputes from its matched prefix on: a held image the run did not hold lies in that
            # region when it arrived after the prefix the provider matched.
            u = request.input + (t_img * sum(1 for key in current if key not in p.sets[i] and p.position[key] >= request.cache_read)
                                 if p.miss[i] > 0 else 0.0)
        u -= t_img * skipped_now
        if pending and not rewritten:
            u += t_img * pending
            pending = 0.0
        u = min(max(u, 0.0), tot)
        uncached += u
        cached += tot - u
        delivered.update(current)
        prev_tot = tot
    return uncached, cached, rewrites, evicted, extra, len(skipped)


BUDGETS = (4, 8, 12, 24)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", default=DEFAULT_HOME)
    parser.add_argument("--since", default="2026-10-02")
    parser.add_argument("--grok-ratio", type=float, default=0.25)
    parser.add_argument("--min-runs", type=int, default=30)
    args = parser.parse_args(argv)
    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).timestamp()
    runs = collect(args.home, since)
    groups: dict[tuple[str, str], list[Run]] = defaultdict(list)
    for run in runs:
        groups[(run.provider, run.model)].append(run)
    print(f"home {args.home}, since {args.since}: {len(runs)} runs in scope ({dict(Counter(r.role for r in runs))})")
    for (provider, model), members in sorted(groups.items(), key=lambda item: -len(item[1])):
        if len(members) < args.min_runs:
            continue
        priced = price_ratio(members)
        ratio = round(priced, 3) if priced is not None else args.grok_ratio
        coefficients = fit_image_tokens(members)
        t_img = coefficients[0]
        print(f"\n== {provider}/{model}: {len(members)} runs; tokens/image {t_img:.0f} (per char {coefficients[1]:.3f},"
              f" per previous output {coefficients[2]:.2f}, constant {coefficients[3]:.0f}); cached price ratio {ratio}"
              f" ({'usage cost fields' if priced is not None else 'no cost reported: --grok-ratio'})")
        for role in ("author", "review"):
            subset = [prepare(r, t_img) for r in members if r.role == role]
            if not subset:
                continue
            k_cal = calibration(subset, t_img)
            misses, events, drops = Counter(), Counter(), Counter()
            for p in subset:
                for i in range(1, len(p.ok)):
                    if p.kind[i]:
                        misses[p.kind[i]] += p.miss[i]
                        events[p.kind[i]] += 1
                        drops[p.kind[i]] += len(p.dropped[i])
                    else:
                        misses["provider"] += p.miss[i]
            after = sum(p.reopens_after_drop for p in subset)
            rho = after / max(1, sum(drops.values()))
            u0 = sum(r.input for p in subset for r in p.ok)
            c0 = sum(r.cache_read for p in subset for r in p.ok)
            base = u0 + ratio * c0
            print(f"  [{role}] {len(subset)} runs, {sum(len(p.ok) for p in subset)} requests; measured uncached {u0/1e6:.2f}M cached {c0/1e6:.2f}M"
                  f" (hit {c0/(u0+c0)*100:.1f}%); rewrite misses: window {misses['window']/1e6:.2f}M / {events['window']} events / {drops['window']} images,"
                  f" retirement {misses['retire']/1e6:.2f}M / {events['retire']} events / {drops['retire']} images; provider-side {misses['provider']/1e6:.2f}M;"
                  f" reopens after a drop {after} (rate {rho:.3f}/dropped image), re-views while held {sum(p.reopens_while_held for p in subset)};"
                  f" position calibration k {k_cal:.2f}")
            print(f"    {'policy':<22} {'reopens':<8} {'uncached':>9} {'cached':>9} {'rewrites':>8} {'evicted':>7} {'reopen+':>7} {'reopen-':>7} {'cost':>8} {'vs now':>7}")
            print(f"    {'now: window 4 + retire':<22} {'measured':<8} {u0/1e6:8.2f}M {c0/1e6:8.2f}M {sum(events.values()):8d} {sum(drops.values()):7d} {0:7.1f} {0:7d} {base/1e6:7.2f}M {0:+6.1f}%")
            for budget in BUDGETS:
                for retire in (True, False):
                    for adjust in (False, True):
                        u = c = rw = ev = ex = av = 0.0
                        for p in subset:
                            su, sc, srw, sev, sex, sav = simulate(p, t_img, k_cal, budget, retire, rho, adjust)
                            u, c, rw, ev, ex, av = u + su, c + sc, rw + srw, ev + sev, ex + sex, av + sav
                        cost = u + ratio * c
                        name = f"batch {budget} + {'retire' if retire else 'keep'}"
                        print(f"    {name:<22} {'adjusted' if adjust else 'fixed':<8} {u/1e6:8.2f}M {c/1e6:8.2f}M {int(rw):8d} {int(ev):7d} {ex:7.1f} {int(av):7d}"
                              f" {cost/1e6:7.2f}M {(cost/base-1)*100:+6.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
