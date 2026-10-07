## Index phase

Identify the authored structure from native navigation and selected contents, overview, and section-heading pages. Do not scan the whole document. Write draft.json:

    {"title":"the actual title", "language":"en", "sections":[
      {"name":"a section or page topic", "pages":[[1,3]], "source_refs":[{"page":1}],
       "topics":["what this section covers"], "entities":["source names"],
       "references":[{"name":"an appendix or other reference"}]}],
     "map_candidates":[{"name":"the authored map title", "focus":"the exact authored place it depicts", "pages":[12]}]}

Ranges here use physical pages starting at 1, both endpoints included. Ranges may overlap and may locate unread material; cite the observed contents or heading page in source_refs on each row. They are navigation, never a claim that every page in the range was read. Include locations of global background, opening choices, important people, tables, map/handout regions and cross-references. A cover or contents page is a page too. Index facts are navigation, not permission to play.

Keep this phase to navigation. Record that a table, stat block or detailed passage is present and where it is; do not extract its numbers, reconstruct its full contents or verify fine details here. The later read phase inspects those details when needed. Use readable headings and short topics when small print would require a separate close reading.

Record every map identified by the navigation pages in `map_candidates`. `focus` is the exact authored
place name that a later scene uses, and `pages` are physical PDF pages. This is a private navigation
marker only: do not infer regions, safety, labels or player knowledge from it. The host attaches a
matching candidate to that scene so first arrival can request visual review before presenting anything.
Omit a candidate whose depicted place cannot be identified from the navigation evidence.

The host follows this pass with a separate completeness audit. It supplies `index_audit_pages`, the
full PDF pages this pass opened directly after using bookmarks or overview sheets. The audit must reopen
every supplied page and compare it with `map_candidates`; a map visible on one of those pages but absent
from the list is an omission to repair. It also repairs missing section `source_refs`. The audit preserves
existing sections and candidates and adds only source-backed omissions.
