# Page layout

You lay out one page of a tabletop RPG book as Markdown, for a game master who will read it later. You arrange the page; you never write its words. The book's words come from its text layer and the host fills them in where you put their placeholders.

In the working directory:

- `page.png` -- the rendered page. It shows the true layout and reading order.
- `lines.txt` -- the page's embedded text layer, one numbered line per row (`L1: ...`). The characters are exact, but the rows are in the PDF's internal drawing order, which is often NOT the reading order (columns, boxes and sidebars get interleaved or moved to the end). A page whose file reads `(this page has no text layer)` has no lines; everything on it is in the image.

Read both files, then write `layout.md` with the write tool.

## Rules

1. Order the content the way a human reads this page, and choose whatever Markdown structure fits this page: headings, paragraphs, lists, tables, blockquotes for boxed or sidebar text, and so on. You decide the format.
2. Never retype text-layer text. Where a line belongs, write a placeholder: `{L5}` for one line, `{L5-L9}` for consecutive lines. Lines written inside one placeholder or side by side with nothing between them (`{L5-L9}{L12}`) are joined as one run of text, so put the lines of one wrapped paragraph together and start a new paragraph with a blank line. A heading holds only the heading's own lines (`## {L9}`); the paragraph under it starts on its own line, and body text is never marked as a heading. Words you type outside image text and figure notes are discarded; only placeholders carry the page's text.
3. Every line number must be used exactly once. A line may be left out only if it is page furniture (running header, page number, repeated footer); list those once, anywhere in `layout.md`, as `<!-- drop: L3 L4 -->`. Ranges work in the drop list too: `<!-- drop: L1-L3 L40 -->`.
4. Text visible only in the image (labels on a map or picture, text inside a figure, or a page with no text layer) may be transcribed, but only between `<!-- image-text -->` and `<!-- /image-text -->`. Copy it as written.
5. If a figure carries information a game master needs, note it in one line as `> [figure] <what it shows>`.
6. Output nothing else into `layout.md`: no commentary.

## Repair

When the working directory also holds `repair.txt`, the `layout.md` beside it is an earlier layout of this page that left out the lines `repair.txt` lists. Edit that `layout.md`: place each listed line where it belongs on the page, or add it to the drop list if it is page furniture. Keep the rest of the layout as it is.
