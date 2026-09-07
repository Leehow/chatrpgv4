# __NAME__

A **product pack**: an ordinary PipiUI extension that composes the base into one
product form. Two manifest fields do the whole job.

- `dependencies.required` — the capability extensions this form needs. Enabling
  the pack enables them transitively; disabling it releases whatever nothing
  else still requires and the user never enabled by hand. `optional` entries are
  listed as part of the form but stay the user's own call.
- `app.ui.layout` — the workbench this form presents. Declaring it is the only
  thing that makes an extension a form. Slots hold Workbench container ids, from
  this package's `app.ui.viewContainers` or from any other enabled extension.

`defaultEnabled: false` keeps the pack off until someone turns it on — the user
in the Extensions pane, or the product itself via `defaultPack` in its
`product.json`.

Install it like any extension:

    {project}/.pi/agent/extensions/__ID__
    App profile pi-agent/extensions/__ID__
    Bundled runtime extensions/__ID__   (maintainers)
