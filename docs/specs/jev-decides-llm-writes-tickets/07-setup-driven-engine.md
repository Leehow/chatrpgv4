Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-E · Contract §150.6
Load the `typesafe-jev` skill first.

# 07 — Setup runs on the driven engine

Scope E1–E6: engine selection for setup; `coc-setup-v1` policy and setup ports (read / decide / operate / infer / finish) on the vendored RunDriver, launched like `pi-hybrid` but never using the play policy; `setup-input-route` and `setup-card-fields` families; direct execution through the existing setup step executor; narrowed bind tool; compose without tools; adjudicate with today's full `setup` tool; outage/budget/refusal fallback; telemetry; inventory entries. Confirm is never Jev's.

Tests at the setup seams (fake decision adapter, fake model steps): a stated catalog occupation binds without a model call; a trade outside the catalog binds the closest catalog occupation and copies the player's words to `occupation_stated`; named skills bind by Noul; unstated numbers use kernel defaults; open fields go through the narrowed bind tool, which refuses closed keys; a question routes to adjudicate with the full tool; a Jev outage runs today's legacy-equivalent path; `setup.confirm` is never issued by the policy.

## Comments
