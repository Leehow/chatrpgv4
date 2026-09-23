# Patch series over upstream v0.87.0

Every upstream file this tree changes or adds, in the order of the series under `patches/`. One line each: what
the change is for and why a port (an option, a hook, an injected dependency) could not do it. Files not listed
here are byte-identical to the tag (checked by `tests/extension/vendored-pi.test.mjs`). The series digest
(`scripts/build-pi.mjs` `patchSeriesDigest`) is stamped into the built packages and the startup record.

| file | change | stage | why a port could not do it |
| --- | --- | --- | --- |
