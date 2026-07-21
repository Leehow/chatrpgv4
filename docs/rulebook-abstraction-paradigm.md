# Rulebook Abstraction Paradigm

How a tabletop rulebook becomes something an LLM Keeper can *load and run*:
a three-layer split of rule authority, plus the audit contract that keeps
every layer honest. This document formalizes the paradigm the COC Keeper
plugin already implements; it is descriptive of current practice first and
prescriptive for future rulebooks second.

Scope: this paradigm covers **rules authority** (what the numbers are, when
a rule fires, what its constraints are). It does not cover — and must never
absorb — Keeper craft: player intent, scene framing, NPC agency, pacing, and
final table prose. See *Authority boundaries* below.

## The three layers

### L1 — Hard rules: params JSON + formulas in code

Anything that is pure arithmetic or a fixed table lookup lives in a JSON
parameter table, and the formula that consumes it lives in deterministic
code. The LLM never computes, adjusts, or invents these numbers.

- Data: `plugins/coc-keeper/rulesets/coc7/rules-json/*.json` — e.g.
  `percentile-check.json`, `difficulty-levels.json` (regular/hard/extreme
  divisors 1/2/5), `roll-modifiers.json` (bonus/penalty dice cancellation),
  `skills.json` (base chances, with special tokens like `half_DEX` and `EDU`
  for computed bases), `damage-bonus-build.json`, `sanity.json`,
  `chase.json`, `combat.json`, `spells.json`, `monsters.json`.
- Execution: `scripts/coc_rules.py`, `scripts/coc_roll.py`,
  `scripts/coc_hazards.py`, and the toolbox `rules.*` family
  (`rules.roll`, `rules.opposed`, `rules.push`, `rules.sanity_check`,
  `rules.damage`, `rules.dying_check`, `rules.first_aid`, `rules.medicine`,
  `rules.weekly_recovery`, `rules.luck_spend`, ...).
- Contract: this is one of the four hard rules of the Keeper Toolbox
  Architecture — dice and HP/SAN/skill arithmetic are deterministic; the
  Keeper's output must quote these results faithfully and may not recompute
  or contradict them.

Data-shape conventions: ASCII English keys; integer percents for chances;
string tokens only where a value is genuinely computed from another
characteristic; a `source_note` (or equivalent anchor) on every table
extracted from a book.

### L2 — Behavioral rules: structured trigger + text logic + page anchor

Rules that say *when* something happens and *what constraints apply* — but
whose application requires judgment — are stored as text logic with
structured metadata. The LLM interprets them semantically; code does not
execute them.

Current incarnation: `checks/coC7_rule_checklist.md` (sections A–L, 118
rules) where each entry carries a rule name, a printed-page + PDF-index
anchor, a pseudo-code predicate, and a verbatim source quote; plus the
behavioral chapters of the skill docs (`coc-rules-engine`,
`coc-combat`, `coc-chase`, `coc-sanity`, `coc-magic`, `coc-development`)
which tell the Keeper how to *run* those rules at the table.

Hard constraints on this layer:

- **Triggers and conditions must be structured** — enums, IDs, tags,
  booleans, thresholds over named fields (`MOV >= 8`, `Build <= -2`,
  `delivery_kind: skill_check`). Never keyword hits or regex over free
  prose (Semantic Matcher Constitution). When a condition is genuinely
  semantic ("failure would close this approach"), it is explicitly the
  Keeper's judgment, stated as such — not a disguised string match.
- **Every entry carries a page anchor** (printed page + zero-based PDF
  index) so it can be audited against source.
- **The layer advises, it does not gate.** L2 entries inform Keeper
  judgment; they must not become executable code that allows, denies,
  reorders, or suppresses player actions, and must not hardcode a fixed
  turn pipeline.

A future JSON form of L2 (replacing checklist Markdown where useful) adds
exactly three things: a stable rule `id`, structured `when` fields using
the enum/threshold vocabulary above, and a `then` field holding the text
logic plus its authority boundary (advisory vs deterministic-follow-up).
It must not grow into a rule engine.

### L3 — Index and retrieval

The LLM finds the right rule by structured lookup, not by scanning prose
and not by embedding search.

- `rulesets/coc7/rules-json/rule-index.json`: every rule record has `id`
  (dotted, namespaced by subsystem: `core.*`, `module.*`), `category`
  (`core_resolution`, `combat`, `chase`, `sanity`, `magic`,
  `character_creation`, `module_rule`, ...), `source_table`, `source_note`,
  and an optional `numeric` payload for the most-frequently-needed values.
- Play logs reference rules by id (`rule_refs` in `logs/rolls.jsonl` /
  `logs/events.jsonl`); `coc_rules.resolve_rule_refs()` validates them.
  This closes the loop: the same index that tells the Keeper which rule
  applies also makes playtest evidence auditable.
- Skill `description` fields in `SKILL.md` frontmatter and the toolbox
  `list` output serve as the retrieval surface for *capabilities* (which
  subsystem to enter); `rule-index.json` serves as the retrieval surface
  for *rules* (which entry governs).

At rulebook scale (hundreds of entries, tens of categories) this structured
id + category index is sufficient; no vector search is needed or wanted —
retrieval must be deterministic so that citations are stable and auditable.

## The audit contract

Numericalization is only trustworthy if drift from source is detectable.
Two non-overlapping audit mechanisms exist:

1. **Extraction-time OCR verification** — `scripts/cache_all_ocr.sh` builds
   the MinerU cache; `scripts/verify_*_ocr.py` re-check individual tables
   (skills, spells, weapons, occupations, tomes, monsters, monster SAN,
   bout tables, phobias/manias, poisons) against it. These need the OCR
   cache and are not part of pytest.
2. **Offline snapshot audit** — `checks/rulebook-*-ref.json` are committed
   authoritative snapshots; `scripts/gap_audit.py` (wired into
   `tests/test_rulebook_data_audit.py`) compares every covered rules-json
   parameter against them, JSON-vs-JSON, no OCR cache needed. Any drift
   fails the test. This audit must stay clean before any rule-table change
   is considered done.

Additionally, `checks/exhaustive_rulebook_validator.py` sweeps playtest
logs against the L2 checklist predicates (sections A–L) and refuses a
vacuous pass — this is how behavioral rules get verified *in play* rather
than only at extraction.

Every L1 table and every L2 entry must trace to a page anchor in the source
book. The repository never parses the PDF itself; extraction follows the
PDF Source Bundle Contract (external host PDF skill emits the versioned
source bundle; repo code validates and deterministically reformats it).
Never guess printed-page offsets.

## Authority boundaries — what must NOT be JSON-ified

The paradigm has a hard edge. The following stay with the LLM Keeper and
must never be reduced to tables, triggers, or templates:

- Player intent interpretation, world causality, scene framing, NPC agency
  and portrayal, clue presentation, pacing, personal horror, final
  narration (The KP Is The Product).
- Any meaning-bearing decision (intent, hostility, clue relevance,
  storylet fit, prose quality) — these use semantic reasoning, never
  keyword matching, and never a lookup table.
- Advisory/narrative methods (director, storylets, NPC advice, narration)
  return suggestions with reasons; the Keeper may adopt, modify, or ignore
  them. Absence of an advisory call never blocks play.

Symptom of over-numericalization to reject on sight: a "rule" whose `when`
clause scans player prose for phrases; a JSON that emits canned narration;
an index that forces a fixed call order per turn.

## How to abstract a new rulebook

1. **Chapter inventory.** List the book's chapters and classify each rule
   as L1 (arithmetic/table), L2 (behavioral), or craft (out of scope).
2. **Extract L1 tables** with page anchors into `rules-json/*.json`
   following the data-shape conventions; add source notes.
3. **Semantically compile L2 entries**: name, structured trigger fields,
   text logic, page anchor, verbatim quote. Keep authority boundaries
   explicit (what is deterministic follow-up vs Keeper judgment).
4. **Register in the index**: one `rule-index.json` record per rule, with
   the subsystem category that matches how a Keeper would look for it.
5. **Wire execution**: extend `coc_rules.py`-style helpers / `rules.*`
   tools so L1 arithmetic is code-owned; never leave formulas only in
   prose.
6. **Snapshot and audit**: commit reference snapshots for the new tables,
   extend the offline audit, and add extraction-time verifiers when a new
   OCR pass produced the data.

## Status

CoC 7e coverage against this paradigm is tracked in
`docs/coc7-rulebook-coverage-audit.md`.
