Status: ready-for-agent
Stage: SL-28 (product path; independent of the loop tickets)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A built-in starter reads the same book a PDF module does")

# SL-28 — The built-in starter is bound to its book through the PDF path

## Evidence
- `content/starters/the-haunting/module-graph.json`: `source_refs` cite `pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting` indices 446–462 and a `source-document` node describes "the visually reviewed source window at PDF indices 446 through 462".
- Long live gate (campaign longgate-haunting-0624): five `lookup kind=source` calls answered `no_source_document`; SL-27 measured 5 of 18 looks were book lookups on this starter; the carried head now says the module has no document.
- The owner's copy: `/Users/haoli/Documents/TRPG/coc英文/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf` (465 pages, 51 MB).

## Scope
1. Read §14.2 (PDF material packs and `module.bind`), §20 (from PDF to playable), §22 (visual reading, demand-driven graph), §61, §90.5, and how an imported module's source store, reading lane and `lookup kind=source` are wired (kernel-ts reading/source modules; extensions/table/prescreen.ts `sourceCandidates`; the App's PDF import path). Establish what a PDF module has that the starter lacks (source store, page images/text, reading index) and where the campaign's `reading` capsule section comes from.
2. Contract first (a §14.2/§20 amendment or a new subsection): a starter with a source window declares it (`source_binding: {source_id, pdf_sha256?, pages: [446, 462]}`); registering the book (the same registration an import uses, pointed at the owner's PDF) binds the starter's campaigns to that window only; the reading lane, prescreen source candidates and `lookup kind=source` then behave as for an imported module; a campaign created without the book behaves as today and says so; the repository ships no page text or images.
3. Implement: the binding, the page window extraction into the source store (reuse the import pipeline's extraction for indices 446–462 only), the capsule's `reading` section for the starter, SL-27's carried head reading the truth. Tests through the real entry (a small fixture PDF of a few pages stands in for the rulebook in the suite; the owner's PDF is used only in a manual check you run and report).
4. Manual check on this machine: register the owner's rulebook, create a fresh haunting campaign, open a driver table, and show `lookup kind=source` answering with the Haunting's pages and the prescreen locating source cards; report bytes and timings. Do not run the table until told "go" (the Mac is busy with a live gate).

## Comments
