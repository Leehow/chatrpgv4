"""Module storage and the three source lanes (contract §14).

`store`     the on-disk layout under `.coc/modules/<id>/`, status ladder, generation
`bundle`    byte verification of a host-produced PDF bundle (§14.2)
`plan`      measure/cut into candidate sections (§14.3)
`packet`    evidence spans, page window, skeleton, vocabulary for one section
`gates`     machine fills + the three deterministic gates (shape, grounding, coverage)
`assemble`  skeleton + accepted shards → module graph, conflicts reported
`playability` the ten invariants, the measures, opening readiness
`deepen`    the on-demand deep-read queue (§14.6)
`assets`    the handout/map/illustration registry (§14.8)
`rpc`       the `module.*` methods
`evidence`  the reader's evidence tool (`bin/coc-evidence`)
`review_cli` the reader's gate command (`bin/coc-review`)"""
