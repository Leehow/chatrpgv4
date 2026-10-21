# Quick Settlement (owner 2026-10-21)

Status: ready-for-human

Contract: `docs/kernel-rpc.md` §247. Package: `mods/quick-settlement` (1.0.0, default on).

## 1. Intent

The owner's request (2026-10-21, paraphrased): a player often sends one input that chains many acts — in a café,
order a coffee, drink it, read the paper, look out of the window. Today each act can be settled on its own (a
purchase, an item gained, the item consumed, the paper's contents and the window view established as facts). But
what the player actually cares about is what the paper says and what is outside the window. If neither carries
anything module-relevant, the whole sequence should become one short description written by the author, not a
chain of settlements. The window may still be rendered immersively, grounded by historical search and model
improvisation, but as description.

- Success: the routine part costs one time charge and no per-act receipts; the player gets a short, natural
  summary; the things looked at are either delivered through the normal clue path (relevant) or described as
  period texture (not relevant), never established as new entities or leads.
- Hollow delivery: fewer tool calls but the newspaper and window come back empty ("nothing notable"), or the
  routine acts vanish from the prose, or a coffee is skipped where the rules do require settlement (a cost beyond
  Spending Level, a roll, a thing kept).

## 2. Rules basis

Routine expenses within an investigator's Spending Level are not tracked (Keeper Rulebook, Cash and Assets). The
kernel already models it: `cash` category `living` settles at zero delta (`kernel-ts/apply/purchases.ts`, §58),
and the consent policy needs no quotation for it (`CASH_CONSENT_POLICY`). Quick Settlement removes even that
receipt for routine food, drink and incidentals; anything beyond Spending Level keeps its existing path.

## 3. Design

1. **Triage is the Keeper's.** One resident instruction section (0.9 KB; the default table had only 1.2 KB of
   its 64 KiB instruction budget left) tells the Keeper to sort a chained input by
   judgement: acts that matter are settled through `resolve`/`apply`/packet as before (this refines Keeper
   Pacing's "Carrying the selected goal": routine steps are carried, not settled); routine acts get one time
   charge and are listed in the packet's `routine.acts`. No host classifier, list or regex.
2. **Relevance of what the player looks at** is checked from the capsule, and with `lookup` only when unclear.
   Relevant → normal clue/handout/observation/reveal path. Not relevant → `routine.ambient` target, optionally
   with up to three short period `notes` (for instance from a native historical search).
3. **The packet element** (`routine`, §247.3) exists only while a package requires `turn.routine-summary.v1`.
   It writes nothing; the host checks before execution that the capability is active and that the input has
   exactly one time charge (packet command, an earlier `time` receipt of this input, or the host journey).
4. **The author** receives `decision_context.routine` and the Mod's reference section *Routine summary for the
   author* in its system prompt (same mechanism as Enhanced Locations' place description, §242). That section
   makes the routine acts listed actions (so "unlisted actions did not occur" no longer drops them) and permits
   ambient description that establishes nothing.

With the Mod off: no `routine_summary` context, the issued packet schema is the previous one, and a submitted
`routine` is refused before execution.

Files: `kernel-ts/read/routine-summary.ts`, `kernel-ts/read/mods.ts` (capability, context),
`runtime/turn-packet-prototype.ts` (schema), `extensions/kernel/lean-apply.ts` (declared output tool, routine only while active),
`extensions/kernel/routine-summary.ts`, `extensions/kernel/index.ts` (issuance, validation, author context,
telemetry `lane:"routine-summary"`), `runtime/routine-author.ts`, `runtime/isolated-expression.ts`.

## 4. Sandbox evidence (2026-10-21)

Method: the real play driver (`tests/play/driver.ts`) on the default product path (hybrid-v1, native decision
packet, isolated author), `minimax-cn/MiniMax-M3.1-Flash-Preview` / medium for Keeper, author and lanes. Seed:
the retained `runtime-seams-final-single-20261020` workspace (1975 Marathon, investigator at the Marathon Cafe
counter, waitress offering food), via `--seed-home` copy-on-write views. One natural player input, identical in
every run:

> 我在柜台边坐下，跟她说不用吃的，来杯咖啡就行。等咖啡端上来，我一边喝，一边翻翻柜台上那份报纸，看看今天都登了些什么新闻，喝完再望望窗外街上的动静。

Launcher and admission record: `.coc/experiments/quick-settlement-20261021/` (`launch.mjs`, `admission.json`,
`metrics.mjs`, `metrics.json`). The seed locked four experiment packages built from uncommitted main-checkout code
(their capabilities are absent from committed code); the launcher drops those locks in the private view and relocks
the committed `narration-craft`, `natural-npc` and `zh-optimize` (npc-deliberation is not committed and stays off).
Both arms get the identical change; it is recorded per run in `workspace/quick-settlement-arm.json`.

| run | build | wall s | Keeper rounds | tool calls | mechanics | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| `qs-without-e` | no Mod | 123.2 | 3 | 3 (look, apply cash+npc, output) | cash, time | coffee settled; paper and window not described |
| `qs-without-pair2` | no Mod | 271.8 | 8 | 8 (apply ×3, place ×3, apply, output) | cash, time, clue ×2 | the final step failed admission; the player saw only the failure notice |
| `qs-with-a` | instruction-only draft | 63.5 | 1 | 1 (output) | time | all acts rendered; paper and window "nothing notable" |
| `qs-with-b` | seam v1 | 144.9 | 3 | 3 (apply, output ×2) | time, clue | news was module-relevant: clue path; `routine` refused because time came from the earlier apply (rule fixed) |
| `qs-with-c` | seam v2, long guidance | 237.9 | 3 | 4 (lookup ×2, apply, output) | time | one summary; 1975 period headlines and the street rendered as ambient |
| `qs-with-pair2` | seam v2, long guidance | 154.4 | 3 | 4 (lookup ×2, apply, output) | time | one summary; paper and window rendered as ambient |
| `qs-with-final` | 0.9 KB guidance, plain schema | 100.6 | 1 | 1 (output) | time | `routine` not filled: paper and window "nothing worth checking" (hollow) |
| `qs-with-final2` | shipped 1.0.0 | 64.9 | 1 | 2 (apply, output) | cash (living, zero delta), time | 5 acts, 2 ambient: county paper with livestock prices and notices, street in the heat |
| `qs-with-final3` | shipped 1.0.0 | 97.1 | 2 | 2 (apply, output) | time | 5 acts, 2 ambient: fair photo, classifieds, low sun on the street |

Readings:

- Instruction-only guidance was enough to stop per-act settlement (no cash receipt, one time charge), but not
  to make the author describe what the player was looking at; that needed the packet/author seam.
- With the final build the Keeper checked relevance with `lookup` and chose ambient in both runs, and in the
  `qs-with-b` run it found module-relevant news and correctly took the clue path.
- Latency on MiniMax varies by more than 2x between identical runs; two runs per arm do not establish a latency
  claim. Counts of receipts and failed settlement steps are the more stable signal.
- The Keeper still sometimes records the waitress's routine service (`apply npc` activity), against the
  guidance. It is harmless state but not yet the intended minimum.
- The shared 64 KiB instruction budget had 1.2 KB left on the default table, so the resident guidance was
  compressed to 0.9 KB. The first compressed run did not fill `routine` and gave the hollow result again; moving
  the usage rule into the `routine` field descriptions (present only while the Mod is active, outside the
  instruction budget) restored it in both following runs. One of them still settled a zero-delta living cash
  receipt for the coffee, against the guidance but without a player-visible cost.

## 5. Open questions for the owner

1. Default on is the current choice. Should it ship default on for existing campaigns too (they adopt Mods
   through the Mods panel) or only for new ones?
2. Ambient headlines are improvised by the author when no search notes are passed. Should a newspaper target
   require a historical search grounding first (slower, more accurate), or is improvisation acceptable as texture?
3. The default table's instruction budget is now within 0.3 KB of its 64 KiB ceiling. Raise the ceiling, or
   trim another package, before the next package adds resident text?
4. Should the routine summary also cover a host-settled routine journey (travel then coffee), which today keeps
   its own time and is accepted without a second charge?
