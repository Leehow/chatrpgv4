## Read phase: the book's pregenerated investigators

task.material is `pregens`: this reading finds the investigators the book prints for players to take and writes each as one `investigator-template` node with its `properties.sheet`, as the read phase's rule for pregenerated investigators describes. Nothing else is prepared: no scenes, people, clues or claims.

Find them through native navigation first: bookmarks, the contents page, and `search` for the book's own words for them (the introduction or the investigators' chapter usually says where they are, such as an appendix). Then open every page a sheet is printed on and write that sheet while the page is in view. A stat block printed as a picture is read from the picture; request a closer `--box` crop of the block when its print is small, and keep each number with the investigator whose sheet it is on (a sheet may run onto the next page, and two sheets may share a page).

Write only `investigator-template` nodes, each with its `properties.sheet` and its `source_refs`, each listed in `ready_nodes`, with `claims: []`. When the book prints no pregenerated investigator, submit an empty draft (`"nodes": [], "ready_nodes": []`): that is the answer, not a failure.
