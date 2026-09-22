# Shared Jev authentication

Open **Settings > Jev**, paste the TypeSafe API key, and select **Save**.
The extension uses the existing encrypted app vault. **Clear** removes the key;
disabling the extension prevents delivery to new sessions and preparation workers.
An active turn finishes normally; existing sessions refresh at their next idle
restart boundary. Reopen a table to pick up a change immediately.

Every Jev consumer reads through `agent/config.js`. The host supplies
`EXT_JEV_APIKEY` for the enabled extension; managed sessions never fall back to
an inherited CLI credential. Source CLI and measurement processes may supply
`TYPESAFE_API_KEY` through the same reader for compatibility.

`/jev:status` reports presence only and sends no provider request. Saving a key
does not enable a Jev domain: existing feature flags and fallback rules still apply.
The model, endpoint, deadlines and budgets remain owned by the existing adapters.
