Status: wontfix

# Known issue: a handover told in the prose without its transaction

Owner decision 2026-10-31 (through the project coordinator): recorded as a known issue, not fixed.

## What happens

The Keeper sometimes tells an object being handed over, taken, returned or shown, or a page written, in the published turn
without the `apply` that records it (no object transfer, document write or cash receipt). The turn still reads as done; the
state does not change. Live rounds 1030g/h (report `.tmp/codex-play/report-1030gh.md` of the frozen 68712017f snapshot):
0 to 5 turns per arm per round of 45, with or without ready answers, prefetch and the complete field index; the field index
lists the apply route and the gap stays.

## Why it is not fixed

- Catching it would need the host to judge from the prose that a handover happened, an open semantic question; the project
  does not settle those with keyword lists or by reading the prose for meaning on the host.
- It is occasional (0-5 turns per arm per round) and within the noise of 45-turn rounds; by the owner's rule an occasional
  gap is not chased with repeated patches.
- The earlier design that would have caught it from a Keeper-declared plan (`kp-translate-only/action-coverage-design-1030.md`)
  was turned down.

## If it is taken up again

Start from a structural signal the Keeper already gives (a packet field naming the transaction), never from the prose.

## Comments
