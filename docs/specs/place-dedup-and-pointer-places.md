# A place the book knows only from the pointer index cannot be matched at registration

Status: needs-triage

Evidence: `kp-translate-only/place-binding-p1-1101.md` (the P1 report; section 1 table and section 4 item 4). Related change on this branch: Enhanced Locations additions now default `within` to the active scene (§278) and start the §204.4 source binding like a mint.

**Intent.** When the Keeper registers a place the book already describes (a room, house or street the book names), the table
should reuse that book place instead of minting a second, table-only twin. Hollow: a name-matching list; a patch that
handles only the places seen in one campaign; a binding that attaches pages to a duplicate and leaves the duplicate in
place.

## 1. Known issue

1. **The pre-commit same/inside judge never sees `kind: place` additions.** `scene-placement` (the lane that judges whether a
   new destination is the same place as a candidate, or inside one) skips `kind: place` additions
   (`extensions/kernel/scene-placement.ts:33`). It runs for the ordinary `kind: move` + `establish` mint only, so the two registration routes
   differ: a move-mint is judged against existing places, an Enhanced Locations addition is registered as new.
2. **Its candidates come only from graph nodes.** `placementCandidates` (`kernel-ts/runtime/apply-operation.ts:57-74`)
   lists graph scenes and locations (the active scene, its containers, its exits, and book places citing pages in the
   reading window). Lean forks hold few places in the graph; a book place known only from the pointer index (never
   materialised as a node) is not a candidate, so even the move route cannot match it.
3. **The post-commit binding does not repair this.** The §204.4 binding attaches the book's pages to the new table
   place afterwards; it neither merges the duplicate nor removes it.

## 2. Candidate directions (not decided)

- Materialise pointer places as graph nodes on demand, so the placement lane's candidates include them.
- Or give a table node a source identity (the pointer entry it stands for), so a later reference or binding resolves to
  one place.
- Either way the judge must also run for `kind: place` additions, as a model judgment of same/inside (never a hard-coded
  name list); the candidate-set bound and the latency budget of the lane stay as they are.

## 3. Open questions

- Does the same/inside judge belong before commit for additions, given that a registration moves nobody and may be one of
  several in a batch?
- What happens to a place already registered as a table twin when its book twin is found later (merge, alias, or leave)?
