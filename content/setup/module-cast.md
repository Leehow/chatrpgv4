# The book's cast

You list every individual this book names, so the game can keep those names apart: a stranger the game master invents must not borrow one of them, and a name the players have not learned yet must stay hidden until the story says it. Nothing you write is shown to players.

The book is read in ranges of pages, one reader for each range. Your working directory holds one range:

- `task.json`: the job. `range` is the first and last page of your range; `pages_with_text` lists the pages in it that have text; `play_language` is the language the table plays in; `known_cast` lists the people earlier ranges already found, each with `book` (the forms the book prints), `play` and `notes` (their renderings); `notes_in_use`, when present, holds sentences the game's own notes already wrote about your pages, in the language of these instructions.
- `pages/page-NNNN.txt`: the book's own text layer, one file per physical PDF page of your range (NNNN is the page number, zero-padded to four digits). Line breaks inside a file are layout, not sentence ends. A page with no text has no file.

Write `draft.json`:

```json
{"people": [
  {"book": ["the name exactly as the book prints it", "another form the book prints"],
   "play": ["the same name as the play language writes it"],
   "notes": ["the same name as the language of these instructions writes it"],
   "pages": [12, 15]}
]}
```

## Who is listed

- Every individual your pages name: a full name, a first name or surname alone, a nickname, a name with a title (Dr. Brenner, Pastor Scott). Include people the book only mentions: the dead, the absent, a name on a letter or a gravestone.
- A named animal or a named being counts when the book presents it as someone, not as a kind.
- Leave out everyone the book leaves unnamed (the bartender, two drifters), groups, organisations, places, vehicles, and kinds of creature.
- Leave out real people the book mentions only as public figures of the world outside the story: a president whose portrait hangs on a wall, a singer heard on a record. List such a person when the scenario has them take part in it.

## Each row

- One row per individual. Put every form of their name in that one row when the book makes clear the forms are the same individual. Never join two individuals because their names look alike.
- `book`: every form of the name your pages print, copied character for character from the page files. Each form must stand on at least one page listed in `pages`.
- `play`: how the play language (`task.play_language`) writes each form. When the book is written in that language, repeat the printed forms. Otherwise give the rendering a translator of this book would use for that name, one for each printed form that differs.
- `notes`: how the language these instructions are written in writes each form. The game keeps its own notes about the book in that language, and they name people that way. When the book is written in it, repeat the printed forms. Otherwise give the rendering a translator of this book into that language would use; for a translated book that is the name the original edition used, when you know it. One for each printed form that differs. When a sentence of `task.notes_in_use` names an individual of your pages by a form you would not have written (another spelling, a transliteration, a short form), add that exact form to their `notes` too. Those sentences are not the book: take no `book` form and no page from them.
- `pages`: the pages of your range where you saw them named: at least one page for each form in `book` that is new, and every page in your range you noticed them on. Cite only pages of your range.
- Someone already in `known_cast`: write the row with their fullest known `book` form copied exactly (one that nobody else in `known_cast` carries), plus the forms your pages print. A known form needs no page in your range; the new forms do. This is how one individual stays one person across ranges, so do it whenever your pages make clear it is the same individual. A bare first name that two people share joins nobody.
- Two individuals may share a form (two people with the same first name). List it in both rows; each row is still one individual, kept apart by its other forms.

## How to work

1. Read the page files in order, about ten pages per call (for example `cat pages/page-0001.txt pages/page-0002.txt …` in one `bash` call), not one page per call. You may use `grep -l` to find every page that prints a name.
2. Keep `draft.json` current as you go: rewrite it after every ten to twenty pages, so an interrupted run loses little.
3. When you have read every page, run `coc-read-check --kind module-cast --draft draft.json`. It refuses each row whose new `book` forms it cannot find on the row's pages, and says what to add. Repair each refused row as its fix says (cite the page that prints the form, or move a form the book never prints from `book` to `play`), keep every other row as it is, and run the check again. Remove a row only if you cannot repair it.
4. Stop when the check passes. Write no other file, and read nothing outside this directory.
