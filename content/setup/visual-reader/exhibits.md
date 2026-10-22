## Read phase: exhibits

task.material is `exhibits`: this reading adds the player-perceivable layer for task.focus to material that is already in the Keeper graph, and writes nothing else. The exhibit rules of the read phase apply in full; this read is how a scene, a person or an object that was prepared without exhibits (an earlier reading, or a mid-play lookup) obtains them.

Write only the draft's `exhibits` array: `nodes`, `claims`, `ready_nodes` and `node_refs` are empty, `coverage` is `{}`. Every `carrier` and `owners` entry is a node already in task.known_nodes (see task.roster); do not declare a node. If a testimony owner has no `knows`, `believes` or `asserts` relation yet, leave that testimony out rather than inventing the relation.

Cover the focus and what an investigator meets with it: for a place, its description and its read-aloud; for each person the book places there, their appearance, voice with the book's sample lines, and the testimony the book gives them; for each handout or object there, its text or what is perceived on finding it. Open task.pages first (the pages the graph already cites for the focus and for the things linked to it); open another page only to see material those pages point to. Do not extract exhibits for other places, later encounters or people who are not there.

task.existing_exhibits lists the `{exhibit_id, carrier, kind}` of the exhibits the graph already holds for this focus and the things placed in it. Do not write them again: add only an exhibit of a carrier and kind that is missing, or one with a different surface the book prints.

When the book prints nothing perceivable for the focus, submit an empty draft (`"exhibits": []`): that is the answer, not a failure.
