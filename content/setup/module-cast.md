# The book's cast

You list every individual this book names, so the game can keep those names apart: a stranger the game master invents must not borrow one of them, and a name the players have not learned yet must stay hidden until the story says it. Nothing you write is shown to players.

Your working directory holds:

- `task.json`: the job. `play_language` is the language the table plays in; `page_count` is the book's length; `pages_with_text` lists the pages that have text.
- `pages/page-NNNN.txt`: the book's own text layer, one file per physical PDF page (NNNN is the page number, zero-padded to four digits). Line breaks inside a file are layout, not sentence ends. A page with no text has no file.

Write `draft.json`:

```json
{"people": [
  {"book": ["the name exactly as the book prints it", "another form the book prints"],
   "play": ["the same name as the play language writes it"],
   "pages": [12, 15]}
]}
```

## Who is listed

- Every individual the book gives a name: a full name, a first name or surname alone, a nickname, a name with a title (Dr. Brenner, Pastor Scott). Include people the book only mentions: the dead, the absent, a name on a letter or a gravestone.
- A named animal or a named being counts when the book presents it as someone, not as a kind.
- Leave out everyone the book leaves unnamed (the bartender, two drifters), groups, organisations, places, vehicles, and kinds of creature.

## Each row

- One row per individual. Put every form of their name in that one row when the book makes clear the forms are the same individual. Never join two individuals because their names look alike.
- `book`: every form of the name as the book prints it, copied character for character from the page files. Each form must stand on at least one page listed in `pages`.
- `play`: how the play language (`task.play_language`) writes each form. When the book is written in that language, repeat the printed forms. Otherwise give the rendering a translator of this book would use for that name, one for each printed form that differs.
- `pages`: the physical page numbers where you saw them named: at least one page for each form in `book`, and every page you noticed them on.

## How to work

1. Read the page files in order, several at a time if you like. You may use `bash` (for example `grep -l`) to find every page that prints a name.
2. Keep `draft.json` current as you go: rewrite it after every fifteen to twenty pages, so an interrupted run loses little.
3. When you have read every page, run `coc-read-check --kind module-cast --draft draft.json`. It refuses each row whose `book` forms it cannot find on the row's pages, and says what to add. Repair each refused row as its fix says (cite the page that prints the form, or move a form the book never prints from `book` to `play`), keep every other row as it is, and run the check again. Remove a row only if you cannot repair it.
4. Stop when the check passes. Write no other file, and read nothing outside this directory.
