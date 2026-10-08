# A turn that lacks material says so, and looks

Status: integration-in-progress (worker WIP copied into `codex/handoff-20261008-integration`; contract `docs/kernel-rpc.md` §205; deterministic and live verification pending)

Lead decision (2026-10-08, on TR-F2 T11–T14): contract §205 "A turn that lacks material says so, and looks", this spec.

## Today

- The capsule head, carried by every Keeper request, says "Do not look/lookup for what is already here". The Keeper
  (openai-codex/gpt-6-luna) reads it as a ban: 0–2 lookups per table since 10-02, against 3–12 for grok-4.5.
- When the supplied material lacks what the turn needs, the Keeper invents or answers emptily. TR-F2 run 2:
  - **T11, the body exam.** The book's p21 §6.2 (Medicine and Spot Hidden, the faint teeth marks on the neck) was never
    supplied; the Keeper wrote 「遗体没有给你一个明确答案」.
  - **T12–T14, Galena's family and the illness.** The Keeper invented a husband named Pyotr, then answered 「不知道」.
- §196.7 (PU-05) now supplies the book's paragraphs, measured on 8–10 of 12 lines. A turn can still lack what it needs,
  and nothing says so. The packet's one coverage signal is a whole-request choice (`assessment.coverage`). On the PU-05
  replays it answered `missing` on 10 of 26 turns, including turns whose materials held the answer (TR-F line 11): it
  cannot say which part is missing.

## The change

1. **The needs.** A turn's needs are the parts of the player's line, cut at sentence boundaries (Unicode, any script). This
   is a cut, not a judgement. The book entries are the entities the locate found.
2. **One closed question per need, asked where the prescreen already asks.** Every decision of the evidence loop also
   asks, per need: does this part stand in the supplied materials (`held`), does it need something nothing supplied
   states (`missing`), or does it need nothing a book holds (`none`); and which located entry it is about.
   - The latest answers hold when the materials they judged are the final ones, so no call is added.
   - Otherwise one closing decision asks only these questions.
   - A one-sentence line whose last whole-request answer is `missing` is that need: the prescreen's existing answer,
     used first only when its materials digest still matches. Relevance rank never fills an unjudged entry identity.
3. **The host looks first, the Keeper by name.**
   - For each unmet need the host judges the located passages it was offered but did not supply, against that need
     alone, and supplies the found ones.
   - What the host cannot supply is named in the packet: `missing`, with the player's words for the part, the entry it
     is about, and the lookup to make before narrating.
   - The order is chosen by measured latency (§205.3).
4. **The head is conditional.** "Do not look/lookup" holds for what is present, never for a need named missing. The
   packet's note says the same whenever it names one.
5. **Never told not to look for what is not there.** A reused packet whose materials must be reassessed drops its
   `missing` with its assessment.

## Out of scope

- The Keeper's lookup itself: the source answer path (§22.4.3), its allowance and its pending and held answers are
  unchanged.
- The graph defect behind T12–T13 (the extraction made Vasili dead). That is pipeline pollution, recorded in the TR-F2
  run 2 log, not a material gap.
- The 24-action per-input budget. A host lookup spends from it like any decision.

## Tests

- `tests/extension/material-gap.test.mjs`, pure:
  - the sentence cut;
  - the question shapes;
  - verdicts and the gate;
  - the Keeper's row and the packet note;
  - the loop's extra questions, scripted.
- `tests/extension/prescreen-material-gap.test.mjs`, through `prepareKeeperSupport` with the real kernel, a real PDF and
  the real transcript store:
  - the conditional head;
  - a host-supplied need;
  - a named need;
  - a covered turn;
  - the closing decision;
  - the coverage fallback;
  - reuse.
