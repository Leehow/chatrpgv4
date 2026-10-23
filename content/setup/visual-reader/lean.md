## Lean reading bounds

This is a lean detail reading (contract §262.3). Your input is already in context: `source_blocks` holds the native
text of your pages as layout blocks (`id`, `page`, `text`, and `continues` when a block carries on from the previous
column's last block), `roster` lists the published nodes on these pages (id, kind, name, aliases), and
`cross_references` lists passages from other parts of the book that name people, places or events on your pages, with
their own pages and text. task.json holds the same task plus the full published records; read it only when you must
see an existing node's or claim's full record.

You have at most ten model requests. Work in this order:

1. View all of `pages` with one pdf call, to see layout, maps, pictures and boxed Keeper text.
2. Write the whole draft.json with one write, with every top-level field the check requires (`nodes`, `claims`,
   `exhibits`, `node_refs`, `ready_nodes`, `coverage`, `dependencies`, `critical`, `source_needs`), empty arrays where
   there is nothing.
3. Call submit_reading. If it refuses, repair exactly what it names with edit and call submit_reading again.

Read the blocks as the book's text. A Keeper box belongs to the entry it is printed under; a block marked `continues`
completes the sentence of the block it names. Keep a condition exactly as the book states it: "unless X, Y is
required" is an exception (Y applies when X is absent), never "X and Y". Use a cross reference only for what it says
about an entity of your pages, cite its own page, and read that page with pdf before citing it. Do not cite a page you
did not view.
