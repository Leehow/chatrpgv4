# Physical document content and visibility

## Approved intent and acceptance

Owner request, 2026-10-07: integrate readable/writable carried documents with
fictional actions, NPC inspection or peeking, and later continuity. The owner
explicitly chose sidebar deletion as an actual in-fiction erasure/rewrite, subject
to the scene, available tools, time and witnesses. It is not a free state override.

- A declared read/write uses the persistent carrier's current text, and settled
  writing appears in the same sidebar document.
- A request to inspect is not a successful observation. NPCs receive only writing
  actually observed through a supported access path; private unopened contents do
  not enter their view. Partial observation cannot reveal the entire document.
- Sidebar save/reset submits a physical edit request to the normal Keeper turn.
  Text changes only through canonical settlement, retaining player wording and
  version/custody guards. Unsupported means or an interrupted turn retain drafts.
- Later reads see settled current writing. Prior writing events and NPC knowledge
  remain historical facts. Physical traces follow the actual chosen edit method.
- Exercise the above through focused kernel/UI/host tests and genuine live play
  with the ordinary driver. No scripted Keeper or fabricated play evidence.

## State and preservation

- Latest line: `0.9.7a`, HEAD `d32ec026c` at intake.
- Previous background-equipment changes are task-owned and uncommitted; preserve
  them. `docs/active-plans/blood-road-jev-two-chapter-playtest.md` belongs to another
  task and is outside this work.
- Current production kernel is `kernel-ts/`; no retired Python implementation.
- No global narration review, new provider/dependency, bulk content repair,
  unrelated NPC behavior, alternate package, or evidence deletion is authorized.

## Findings

- Canonical object `document.write/append` already persists current text.
- `mods.document.apply` currently mutates that text directly between turns;
  this conflicts with the owner's newly selected physical-edit interpretation.
- NPC perspective supplies attributed knowledge, but no canonical document-reading
  observations. Keeper-owned object projection includes current text, so explicit
  NPC access and observation provenance must be added rather than copying it to NPCs.
- `own` carries card/history words rather than authoritative document content;
  historical words must not reconstruct text that was subsequently removed.

## Ready work

1. Finish the small document interface and amend the owning RPC contract.
2. Implement physical edit requests, canonical publication and content/trace reads.
3. Wire sidebar actions through the ordinary live turn; retain explicit pending,
   refused, interrupted and draft states.
4. Record bounded, source-bound NPC observations and project them to that person.
5. Run focused tests, real play, and the canonical package/GUI checks as applicable.

## External comparison

- Inform's actor-relative scope confirms that possession/visibility differs by
  observer; it does not decide this game's semantic viewing conditions:
  https://ganelson.github.io/inform/CommandParserKit/prsr.html
- Foundry separates limited/observer/owner access rather than exposing all document
  contents; its account permissions are not this game's NPC knowledge:
  https://foundryvtt.com/article/users/
- Microsoft's event-sourcing discussion supports preserving past events while
  representing later changes. This project retains its existing store and log;
  no event-store migration is proposed:
  https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

## Validation and remaining work

Core operations, observation projections and edit requests are implemented.
Six focused real-kernel interface tests pass, including failed queue dispatch,
stranding, and refusal of a direct-write bypass of the selected editor body.
Kernel type checking passes; 72 focused UI tests and 14 host wiring tests pass.
Host submission tests observe the cold-kernel boundary with contract replies;
physical persistence is verified independently through the actual TS kernel.
Caption seeds were projected by a tool-enabled Pi task, and the section index tests pass.

The documented Grok Build 4.7 default was not discovered in the source Pi home;
the App has an authenticated dynamic catalog that the isolated source home lacked.
The owner changed the acceptance default to grok-build/grok-4.5. That model is now
registered using the existing App login, and driver daemon evidence confirms it.
Failed startup/relay runs are preserved and are not accepted evidence.

Real play, campaign physical-doc-build45-20261007: story writing reached the real
notebook. Initial display turns did not record NPC reading and are invalid for that
acceptance item. Enhanced Items 1.3.3 makes carrier instructions resident. Run
physical-doc-build45c recorded exactly the first exposed line for Steven Knott,
without the hidden private line. A later editor target was written through the
ordinary write path and became stale: that turn is invalid for sidebar settlement.
The kernel now refuses that exact bypass. Run physical-doc-build45d exposed a false
stale result at question delivery; versions now bind stable custody identity and
turn completion reads committed world state. Seven real-kernel tests pass.
Run physical-doc-build45e settled the editor request as applied, with empty current
writing, a one-minute time receipt and an illegible physical mark. The next natural
read described only the strike-through/abrasion and no restored private sentence.
Knott's canonical observation retained only the first exposed commission line;
his impatient refusal to repeat it did not grant him the hidden private reminder.
This is focused feature verification, not a completed Haunting campaign playthrough.
Editor controls are submitted through the same canonical request
API and then the genuine driver; this is not installed-button GUI acceptance.

Remaining: canonical package/GUI checks. System Settings confirms tomo3d. Existing runtime archives and
all 247 applicable production tarballs are cached locally (69.9 MB compressed).
The package script gives npm a fresh empty cache. The owner chose to keep that
script and explicitly authorized approximately 70 MB of production dependency
downloads for this packaging run. Node, Git and source archives use existing caches.
No offline-cache feature is authorized or being added. Package downloads have not
yet started at that approval checkpoint. The authorized package is now running,
with explicit local Node/Git archive paths and the normal npm installation.

## Delivered, 2026-10-07

- Canonical arm64 App installed at /Applications/PipiCOC.app, package receipt
  created 2026-10-07T10:45:54.382Z. Stable PipiUI Dev designated requirement is
  unchanged; the back-link resolves to this bundle and staging is empty.
- LaunchServices and Spotlight each resolve only this canonical bundle. The
  running executable is /Applications/PipiCOC.app/Contents/MacOS/PipiCOC.
- Through the installed Mod panel, the owner's existing Blood Road game adopted
  Enhanced Items 1.3.3. Its clock/turn remain 13:25/9, awaiting player.
- The installed notebook editor reached an editable native textarea, the projected
  physical-action hint, and Request edit button. It was opened and closed without
  submitting or changing that game's writing. Native button submission remains
  covered by UI/host wiring checks and the source-driver request/settlement proof,
  rather than a write into the owner's real campaign.
- Final focused checks: seven physical-document kernel tests, 72 UI tests, 14 host
  wiring tests, 12 section-index tests, kernel typing, system-language/UI seed
  guards, full Electron workspace build and canonical package/signature checks.
  No full regression suite or completed scenario playthrough is claimed.
- Direct state checks after the next natural read retain empty current writing,
  applied request status, and only Knott's prior exposed-line observation. Evidence:
  .coc/playtests/physical-doc-build45e-20261007/physical-document-check.json.

## Follow-up: focused long-document reading, 2026-10-07

Owner approved implementing reliable lookup of particular content in long notes.
Success is actual current-writing evidence for middle/end entries, semantic
questions and absence, without restoring deleted text. Preview-only answers or
fixture results presented as play acceptance are insufficient.

- Contract §179.3b adds bounded literal location and overlapping page reads to
  existing look object, with revision-bound continuations and original ranges.
- Literal scans examine the complete current readable body, but never classify
  meaning. The real Keeper judges semantic relevance from bounded pages. No model
  lane, search dependency, language table or semantic keyword classifier is added.
- The host reports pages actually supplied this player turn. A last-page read or
  literal fragments alone do not support full semantic absence. History, original
  acquisition text and unseen NPC observations are outside the searched surface.
- Enhanced Items 1.3.4 keeps the focused-reading procedure resident. Older package
  bytes remain frozen; existing games use their normal version update control.
- Initial checks pass: 10 real-kernel physical/read tests and two host coverage
  tests, plus kernel typing. Remaining: real Keeper use, relevant regression
  checks and canonical package/GUI delivery. The currently installed App is 1.3.3.
- Preserve unrelated Blood Road plan changes and all existing test campaigns.
  The earlier approximately 70 MB Internet-download approval was for its completed
  packaging batch, not this new one. Any new package download needs its own scope
  confirmation if required by the tomo3d quota rule.

### Long-read verification and package decision

Source campaign long-notes-20261007 holds one 2905-character private working copy
written by the real Keeper from the main player's one natural writing declaration.
Initial writing delivery was blocked, with its real state/evidence retained.
Run long-notes-read-20261007 used the current Grok Build 4.5/low and hybrid engine:

- Middle entry at offset 1157: actual literal lookup found M-742 with original text.
- End entry at offset 2818: actual page 1/2 reads found Eleanor Frost and 62841;
  returned coverage progressed from incomplete to all pages supplied.
- A Chinese semantic question about the envelope was grounded in the English
  source passage. A missing shoe-repair concept was denied after both current
  pages were read, not merely after a literal miss.
- The normal editor request removed only the final reminder, preserving 2708
  characters and recording an illegible crossing-out with real time. A later
  read used the changed revision and did not restore name/number from memory.

The owner subsequently authorized changing the package script to persistent cache
reuse and strict offline npm installation. Implemented in scripts/package-runtime.mjs:
standard ~/.npm (optional PIPICOC_NPM_CACHE), --offline, unchanged isolated install
and credential configurations, no dependency/version change. Node/Git use existing
local archive inputs. No new Internet dependency download is authorized or needed.
Remaining: actual offline package, canonical App launch, Mod 1.3.4 update and final
source-state/package evidence. These are focused feature checks, not a full scenario
playthrough or full regression suite.

### Long-read delivery complete

- Offline package completed successfully at 2026-10-07T12:27:32.560Z. npm ran
  with --offline against the persistent cache; no repeated approximately 70 MB
  production dependency download was needed. Node/Git/source archives were local.
  Electron's cached archive predates this run (2026-10-06T16:10:11.222Z); its
  generic downloaded/extracted progress message does not mean a fresh transfer.
- Stable PipiUI Dev signature and designated requirement match the previous App.
  LaunchServices/Spotlight resolve only /Applications/PipiCOC.app; the back-link
  resolves there, staging is empty, and the running executable is canonical.
- Native Mod controls updated the owner's existing Blood Road game to Enhanced
  Items 1.3.4 with no pending version. It remains turn 9, awaiting player. The
  installed compiled kernel served the bounded document-page interface correctly.
- Focused checks pass: 10 real-kernel physical/read tests, three host coverage/
  one-use continuation tests, section-index/system-language checks, own-record
  checks, kernel typing, Electron workspace build, 28 assembly-lifetime checks,
  and the actual offline package. No full-suite or full-scenario claim is made.
- Real read evidence is saved at
  .coc/playtests/long-notes-read-20261007/document-reading-verification.json,
  including actual new look arguments, supplied page coverage and delivered prose.

## Interface decision

- Keep ordinary story writing on `apply object document.write/append`.
- Add physical document operations to that same object owner: open/close/show,
  source-bound observe, and settlement of a selected sidebar edit request. No new
  top-level Keeper verb or semantic keyword classifier.
- The sidebar submits a version/custody-bound requested body, then the existing
  player-message queue starts the ordinary live turn. The Keeper sees bounded
  change evidence, not opaque request ids; the host/kernel copy the exact requested
  body at settlement. Editing uses an actual available implement, a causal method,
  elapsed-time receipt and physical trace metadata. Missing means/choice leave the
  request and draft unsettled rather than silently succeeding.
- Preserve per-observer, version-bound observations as observed writing, not world
  truth. Open/closed state and directed showing control access; a glimpse requires
  actual proximity and Keeper-established visibility. No automatic knowledge grant
  to every person in the room.
- Existing direct `mods.document.apply` is a legacy developer/compatibility surface;
  player UI routes it and the new request method through the physical action queue.
  The model has no direct access to that low-level method.
