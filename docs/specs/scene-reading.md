# Reading by the book's sections: a scene is read as a scene

Status: proposed (owner 2026-10-07, 「两个一起开 spec，按你推荐的来」; this spec records the lead's recommended design; implementation waits for the owner's word)
Date: 2026-10-07
Baseline: `claude/reading-delivery-20261006` at `8a02972ea` (0.9.7a@402a8c20a + §186 + §187). Spec branch: `claude/scene-told-specs-20261007`.
Contract: §189 of `docs/kernel-rpc.md` (written with this spec). Amends §148.3 (the reference stream), §151.4's background units, §182.3 (what the window asks first), §187.5.1 (a scene read's pages) and §187.9 (the deferred unit refactor).
Tickets: `docs/specs/scene-reading-tickets.md`.
Companion: `docs/specs/told-position.md` (§190) mints the window's place identities before they are read; this spec reads them.
Related, never approved: `docs/specs/thin-book-play.md` (2026-09-18) proposed chapter-section reads for thin books; this spec supersedes that part.

## Problem Statement

§187 fixed delivery and review cost and recorded that the job unit stayed the two-page source unit (§187.9). RD-08 measured
what that unit still costs and still fails to deliver (Blood Road, flapcode/gpt-6-luna low, `tests/play/driver.py`; control
`rc-accept-blood-01` is the table of the owner's 554-call analysis; evidence in `docs/specs/reading-delivery.md` Comments).

**Two pipelines produce overlapping things, and only the expensive one makes a scene playable.**

- *Background units are cut blind.* For a reference book (`meta.source_reference`, every PDF book read since §148)
  `referenceSourceUnits` (`kernel-ts/modules/background-source.ts`) cuts the book into ceil(N/2) two-page units
  regardless of where a scene begins or ends. An indexed book gets `backgroundSourceUnits` (≤ 6 pages inside one index
  section) only under `opening_scope: first_interaction` with a complete index. The unit's ask (`unitQuestion`,
  `kernel-ts/modules/reading.ts`) is "publish one small usable fragment from only physical pages a–b"; its coverage is
  per graph domain over those two pages. A finished unit writes a material row whose `node_ids` are its `ready_nodes`,
  which may be empty, so **a unit never makes a scene `material: ready`**.
- *Scene reads make scenes ready, and are unscoped.* `queueAdjacentReading` and the material gate ask
  `{purpose: detail, focus: <scene>}` with `pages: []`. RD-04's packet scope (§187.5.1) keys on the job's pages, so a scene
  read still receives the whole known graph; its pages are found by the Jev locate (up to 20, five facets) and the author's
  own `pdf` search. The scene playbook it is asked for is implicit ("prepare the focused entity for its current use").
- *A book place exists only when someone asks to go there.* `scene-source-place-<page>-<index>` identities are minted on
  demand for a destination (`runtime/jev/source-reference.ts`). On RD-08 the player pulled up at the Esso station on
  turn 2; the station's identity and records arrived with unit 17–18 at 05:37, three minutes after play began. The
  capsule showed the prologue with no exits and no people, and the Keeper told the player nobody was there while the book
  seats three men under the awning (§190 takes the arrival half).

**Cost by job kind** (reading uncached input, all jobs of each table):

| kind | control: share, per job, per draft node | RD-08: share, per job, per draft node |
|---|---|---|
| two-page unit | 56 %, 201K, 26K | 59 %, 136K, 20K |
| need read | 35 %, 222K, 77K | 9 %, 129K, 129K (1 job) |
| visual | 9 %, 49K, 40K | 18 %, 37K, 64K |
| scene detail | 0 | 14 %, 189K, 95K (1 job) |

Two-page units are the cheapest per record and the largest share, and they never deliver a playable scene. The one scene
read is the most expensive per record. The cost the owner wants gone is the overlap: the book's pages around a place are
read once blind and again for the scene.

**What this spec must not become.** A second semantic authority beside the graph (the graph stays the only one; the
capsule projects); a scene artifact the capsule does not read (§187.1 lists the fields it reads); a larger unit justified
by assumption — earlier measurements (`module-build-output-is-saturated`) showed bigger leaves thinned the graph under the
retired single-completion reader, so the switch is decided by a pre-registered comparison, not by this text.

## Solution

**S1 Units come from the book's own structure.** The background unit is a *section*: the flattened PDF bookmarks (every
level, which the Jev driver already reads) give ranges `[entry.page, next entry.page − 1]`; adjacent short sections merge
up to `reading.section_unit_max_pages` (data, shipped 6, today's `BACKGROUND_SOURCE_PAGES`); a longer section splits at
that bound on page boundaries. Without bookmarks, index sections (`backgroundSourceUnits`, now for every indexed book in
the window); with neither, today's two-page units. The unit key keeps its shape `[section, first, last]`.

**S2 A section that holds a book place is read as that scene.** Whether a section heading is a place is a Jev decision
(the family §190.1 adds for minting window places; never a heading list). A place section's unit carries `focus` = that
place's scene and asks the **scene playbook**: exactly the tier-2 fields §187.1's consumers read (scene summary,
`dramatic_question`, `keeper_notes`, `pressure_moves`, affordances and what they grant, exits with travel and conditions,
the people `present-in` it with the dossier keys and their `knows`/`believes`/lie claims, clues `discoverable-at` it with
skill, difficulty and unlock, `uses-rule` mechanics, assets it depicts or holds). The coverage reviewer asks "can this
scene be run from what was published" over the same list; a `missing` item names the field and the page. Completion
writes the scene's material row (the scene is `ready`) and its `scene_index` row. A non-place section keeps the fragment ask.

**S3 A scene read has pages.** A foreground or adjacent scene read whose scene has a section unit or a `scene_index` row
gets those pages as its job pages, so §187.5.1's packet scope applies and the Jev locate starts from them (it may extend,
as §187.7.1's need reads do).

**S4 The read-ahead asks in play order.** Within the §182 window: the current scene's section first, then the sections of
the places reachable from it (exits, `within`, the referenced place identities of §190.1) in book order, then the rest of
the window in book order.

**S5 The switch is data.** `reading.unit: "two_page" | "section"` in `host-budgets.json`, shipped `"two_page"` until SR-06
passes; the telemetry of each read names its unit kind.

## Success, pre-registered (SR-06)

Fresh home, Blood Road, the chapter 德克萨斯州阿巴托尔镇 (pp. 17–42), `flapcode/gpt-6-luna` low, both arms read the
chapter in the background with no table play (`module.read.ahead` driven to idle), same reviewer settings, Jev key present.
Arm A `reading.unit: two_page`, arm B `section`. Measured by code from the published graph and the work directories:

- per arm: total reading uncached input for the chapter, author calls, review children, wall time to idle;
- per book place in the chapter: `material: ready` or not, and **playbook completeness** = how many of S2's fields the
  capsule's projection of that scene carries (`table.capsule` with the scene active in a probe campaign; people counted
  through `present-in`, not `npc_presence`).

**B ships as the default only if** (a) B's ready place scenes ≥ A's and B's median completeness ≥ A's, and (b) B's total
uncached ≤ 1.1 × A's. Otherwise the result is recorded and `two_page` stays. One book is a stated limitation; the bar is
not tuned after the run.

## Out of Scope

- Any change to the evidence standard: every published record is still reviewed against original page images.
- §182's window and short-book rules, §184's library write-back, the need-read rules of §187.7.
- Making Jev a verdict on records (§186.6 stands).
- The arrival and told-position half: `docs/specs/told-position.md`.

## Comments
