# PipiCOC mods implementation and acceptance

## Intent and status

Approved on 2026-09-08: preserve gameplay improvements as independently versioned
Mods behind a stable game interface, add the right-sidebar Mods tab, and deliver
Natural NPC and Enhanced Items with working mechanics and persistent ownership.
A manifest or parameter card without observable behavior and executable use is
not acceptance.

Implementation, source integration, required checks, browser management and one
genuine Grok campaign are complete. Native App packaging/replacement was not run.
The task-owned worktree is terminal; its exact final cleanup classification is
recorded by the `pipicoc-mods` worktree lifecycle manifest, not inferred here.

## Delivered boundary

- `docs/kernel-rpc.md` section 26 defines `pipicoc.game.v1`. Packages contribute
  decisions, prompts, presets, settings and namespace migrations as JSON/Markdown.
  They never import the current kernel, Pi or Electron implementation objects.
- The adapter retains the seven Keeper verbs. The kernel owns arithmetic,
  identities, transactions, receipts, definitions, instances and supported effects.
  New active mechanics require an explicit capability implementation.
- Folder/ZIP install, immutable package digests, compatibility/dependency/conflict
  checks, per-campaign version locks, new-campaign defaults, safe-boundary pending
  changes and explicit upgrades all use the same loader for built-ins/local Mods.
- Natural NPC 1.0.0 preserves public max(APP, Credit Rating) first impressions,
  pair reuse, old reaction tiers and legacy hidden receipts. The Keeper realizes
  the result while retaining each NPC's motives and boundaries.
- Enhanced Items 1.0.2 uses a tool-enabled Pi creator and pre-delivery semantic
  audit. Accepted definitions are captured before commit and reused. Instances
  preserve identity, owner, ammunition, charges and condition across transfers,
  restarts and generator upgrades/disablement. Public inventory projections expose
  only declared known properties. Weapons, typed spell/consumable effects and
  repair execute through existing rules; passive traits inform ordinary actions.
- Management works before a Keeper or campaign exists and throughout onboarding.
  Bound campaign mutations use the selected UI session's actual binding.

The external design check compared Factorio's package/lifecycle conventions and
VS Code contribution points. Explicit versions and contribution interfaces fit;
model outputs additionally need captured results and deterministic acceptance.

## Integrated source

Base: `8e3b87d1`. Owned branch/worktree: `codex/pipicoc-mods` at
`/Users/haoli/leehow/code/chatrpgv4-wt-mods`; lifecycle task `pipicoc-mods`.
Source was fast-forward integrated into `0.9.0a` without altering the old tree or
discarding concurrent onboarding, transcript and inventory work.

Implementation commits: `e53dfa4c`, `c2bce6d6`, `71edc2f7`, `c68938c8`, `5d3b1f9e`.
Integration commits: `72c2d46f`, `7f562f0d`. Final checks also include the independent
source-guidance change `cd45f6d0`. No remote push was performed.

## Verification

- Kernel/play suite at `5d3b1f9e`: **1140 passed, 1 skipped**, 241.68 seconds.
  The subsequent integrated change does not change Python source.
- Extension suite at `cd45f6d0`: **137 passed**.
- Focused Mod panel/cold host/UI checks: **28 passed**.
- Copied Electron suite: baseline matches **197 known failures**, no new failures
  and no flaky exemptions. This is not an all-green upstream suite.
- Browser build at `cd45f6d0` passed. Installed current UI assets in the main
  checkout with `bash pipicoc/install`.
- Deterministic interface tests cover NPC firing then transfer of remaining ammo,
  player/NPC generated spell use, learning, consumables, repair, migrations,
  invalid archives, atomic rejection, disabled-generator usability and explicit
  worldline conflicts. These do not stand in for actual play evidence.

Test logs are retained under
`.coc/playtests/mods-correction-sep08/checks/` in the main checkout.

## Real browser and campaign evidence

Browser management was exercised on an isolated UI home/server. Both Mods listed
without starting Pi; a default toggle survived refresh; folder installation exposed
two versions. An observer was then bound with the real setup `coc-session` event.
GUI upgrade to Enhanced Items 1.0.1, disablement and reenabling preserved definitions,
instances and first impressions byte-for-byte. Screenshots and comparison input:
`output/playwright/mods-20260908/`. The owned browser and server were stopped.

Fresh campaign `mods-acceptance-sep08` used canonical RPC launchers, Grok 4.6 low,
and this main session as the sole player, one natural reply at a time. No seeded
rolls, scripted player, synthetic settlement or replacement Keeper was used.

| Run | Player replies | Driver wall seconds |
| --- | ---: | ---: |
| `mods-setup-sep08` | 2 | 106.999 |
| `mods-live-sep08` | 3 | 185.842 |
| `mods-resume-sep08` | 8 | 265.001 |
| `mods-correction-sep08` | 22 | 1027.567 |

Driver wall time totals 1585.409 seconds, excluding automatic opening and operator
waits. The 33 gameplay replies have a median of 33.197 seconds. Tool time is part
of wall time; the remainder is not a pure model/reasoning measurement.

The campaign is `completed`, with `development:end-session` and an explicit
campaign-ending receipt. The investigator obtained the generated ritual dagger,
successfully fought back with its 1D6 profile, and the Keeper applied the authored
own-dagger ending after the hit. The dagger remains owned by the investigator;
returning the keys moved their existing instance to Steven Knott. Eight definitions
and eight instances remain. Knott's opening 57 vs APP 45 guarded impression and
Corbitt's later 13 vs 45 favorable impression each retain one pair record.

The live run exposed and repaired two Mod gaps:

- Enhanced Items 1.0.1 / `weapons.profile.v2`: new melee definitions explicitly
  retain damage bonus and permit null non-applicable range/malfunction fields;
  player descriptions follow the campaign language. Old accepted definitions stay.
- Enhanced Items 1.0.2 / `objects.state.v2`: same-owner state changes record damage
  without fabricating a transfer. The semantic audit checks narration against that
  state. The original rejected turn remains; the Keeper corrected the broken hammer
  and damaged flashlight through normal `apply` in the next real turn.

KPI counted 34 campaign turns including opening, all finalized, 29 reaching rules,
and 19 recoverable kernel rejections. Errors were retained, not removed from the
record. Unsupported spontaneous NPC creation and ambiguous calls were recovered
within the normal Keeper loop; no claim of zero-error play is made.

Actual NPC firing of a generated weapon, generated spells and consumables were
not encountered in this campaign; their coverage is deterministic. Real play did
verify generation, use, transfer, combat, damage persistence, upgrade/restart and
an ending. All four owned drivers are stopped. Campaign, job, transcript, telemetry
and playtest evidence remain in the main checkout. The derived evidence index is
`.coc/playtests/mods-correction-sep08/mods-acceptance-summary.json`.

## Initial-equipment repair (2026-09-08)

The reported boning knife was an ordinary initial equipment string, with no weapon
row or object instance despite Enhanced Items 1.0.2 being active. The original
acceptance exercised newly introduced items and missed setup's inventory path.

Enhanced Items 1.0.3 and `objects.adopt.v1` connect structurally unregistered gear
to opening/turn context and the existing semantic audit. The normal apply batch
adopts a uniquely matched owned row, preserving quantity and recorded physical
state, with no acquisition, transfer, money or time. Existing executable weapon
profiles remain unchanged. A same-name grant without adoption is rejected.

Validation: 24 focused kernel tests passed; full kernel/play suite **1143 passed,
1 skipped** in 366.27 seconds; extension suite **137 passed**. The independent
glossary change `d9dc1017` is retained. No new Electron implementation was required.

Genuine fresh Grok 4.6 acceptance uses campaign `mods-initial-sep08`. Two natural
setup replies produced exactly the reported shape: a leather-sheathed boning knife
among five equipment strings and an empty weapons list. Before any player gameplay
reply or request to use the knife, the opening generated definitions and adopted
all five existing items. The knife acquired Fighting (Brawl), 1D4+2 damage, damage
bonus, one use per round and impale, grounded in the medium-knife preset by the
tool-enabled creator. A pre-closure comparison found every character field outside
equipment/weapons unchanged and inventory cardinality still five. No manual weapon
parameters or fabricated game settlement were used. One subsequent natural reply
declined the commission and ended the adventure; the Keeper finalized the campaign.
Both owned drivers are stopped. Original and test campaign evidence are retained.

Evidence: `.coc/playtests/mods-initial-setup-sep08/` and
`.coc/playtests/mods-initial-live-sep08/initial-equipment-acceptance.json`, with logs
under that run's `checks/`, all in the main checkout. The repair is isolated on
`codex/mods-initial-equipment` pending safe integration with concurrent main changes.
Existing saves retain explicit version locks; upgrading to 1.0.3 activates
reconciliation on their next normal Keeper turn, without manufacturing player input.

## Writable papers and Mod precedence

Approved scope: a paper-like inventory modal with readable/editable text, persistent
save and reset to the acquisition snapshot; semantic classification and source
protection; visible Mod ordering and actual later-provider overrides. Continue on
the already-owned `codex/mods-initial-equipment` branch so the initial-gear fix stays
included. Concurrent dirty main files remain outside this lane.

Acceptance: blank and authored text, save/reopen/reset, identity/ownership/revision
checks, no source or turn-progress changes, transfer and worldline continuity,
disabled-generator retention; alternate providers demonstrably change rules,
materialization and editor selection; manager ordering is persistent and visible.
Use the existing warm clay UI, a generated quiet paper texture and native dialog
focus behavior. Verify real browser interaction and genuine Keeper generation.

Implementation and validation are complete; final integration/lifecycle audit are
tracked by the owned branch. Enhanced Items is now 1.1.1. The first implementation
commit is `d3ec1e98`; `ec792356` preserves the 0.9.1a integration. No marketplace,
arbitrary executable payloads or unrequested scenario edits were added.

The full integrated kernel/play suite passed **1190 tests, 1 skipped, 1 xfailed**
in 285.34 seconds. UI checks passed **32 tests**. The extension suite passed **147
tests** in serial mode after one parallel-run temporary-directory cleanup race;
the failing test uses a fake kernel and the failure was in its teardown, not a
paper assertion. After rebuilding an inherited stale account-usage artifact, the
copied Electron gate matches **197 known failures**, no new failures. Browser
build passed. Final follow-up fixes retain explicit first-instance writing before
snapshot capture and show owned documents inside containers without changing the
stored inventory ownership. A 60,000-character CJK creator output is covered.

Genuine Grok 4.6 evidence: `mods-paper-setup-sep08` (three player replies, 147.7 wall
seconds), `mods-paper-live-sep08` (automatic opening), and
`mods-paper-corrected-sep08` (two player replies, 110.4 wall seconds). The first
opening exposed a duplicate-initialization refusal; its evidence remains. The
repaired run obtained Knott's newly written commission slip, then the player put
it inside the notebook, declined the job and reached an actual completed ending.
The Creator produced blank and written document values; no Keeper was substituted.

The campaign lives in the isolated persistent home
`.coc/playtests/mods-paper-home-sep08/.coc/campaigns/paper-notes-sep08` in the main
checkout, avoiding installation of new package fields into an older live runtime.
All play drivers are stopped. A UI observer uses its actual setup binding and an
actual public mechanics entry mirrored through SessionManager; it adds no player
input and does not fabricate a game record.

Actual browser verification used CUA with native Chrome after in-app localhost
access and the Chrome browser connector were unavailable. It exercised written
and blank paper editing, save/reopen/reset, unsaved-close protection and contained
papers. Four UI edits/reset operations preserved campaign, turn, character,
definitions and acquisition originals. A local UI-only renderer fixture took over
when loaded later; moving it before Enhanced Items restored the paper view while
both stayed enabled. The manager exposed both override directions.

Evidence: `output/mods-paper-20260908/paper-editor.png`, `ui-state-proof.json`,
`before-ui-edits.json` and `checks/` in the main checkout. `design-qa.md` records
the source/implementation comparison, native-dialog behavior and console findings.
The only observed console errors were the existing server-host browser-unavailable
error and an initial favicon 401. No source or turn progress changed in UI editing.

Design references: [Factorio lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html),
[OpenMW resource precedence](https://openmw.readthedocs.io/en/latest/reference/modding/paths.html),
and [MDN dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).

Final compatibility correction: 1.1.1 puts the shipped editor descriptor under
top-level `ui`, which the previous kernel can enumerate as incompatible without
failing its catalog. This was checked against the actual main-checkout old parser.
The new parser keeps unsupported future interfaces as catalog metadata and does
not execute their contributions or render unknown setting schemas. Older 1.1.0
packages remain valid. The browser-tested renderer and document behavior are
unchanged. Latest integration checks: **38 Mod kernel tests**, **33 UI tests** and
**149 extension tests** passed; the final compatibility cases are additionally
recorded in `output/mods-paper-20260908/checks/`.
