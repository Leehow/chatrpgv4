# Patch series over upstream v0.87.0

Every upstream file this tree changes or adds, in the order of the series under `patches/`. One line each: what
the change is for and why a port (an option, a hook, an injected dependency) could not do it. Files not listed
here are byte-identical to the tag (checked by `tests/extension/vendored-pi.test.mjs`). The series digest
(`scripts/build-pi.mjs` `patchSeriesDigest`) is stamped into the built packages and the startup record.

| file | change | stage | why a port could not do it |
| --- | --- | --- | --- |
| `packages/agent/src/run-driver.ts` | added | SL-01 (0001) | The RunDriver itself (StepRequest, RunView, ObservationView, RunPolicy, the ports, run/step/scope/operation/delivery events, the loop of design §4.3). It is the loop, so it cannot be injected into the loop; it is a new file so no upstream line changes. |
| `packages/agent/src/agent-loop.ts` | modified | SL-01 (0001) | `export` added to `streamAssistantResponse`, `declareToolChanges` and the tool pipeline (`prepareToolCall`, `executePreparedToolCall`, `finalizeExecutedToolCall`, result/refusal helpers); no line of logic changes. An infer step must use the same provider path and a model call the same tool pipeline as the model-first loop, and these are module-private. |
| `packages/agent/src/agent.ts` | modified | SL-01 (0001) | `Agent.runDriven`: one driven run under the agent's own lifecycle (active run, abort signal, busy state, awaited listeners, request/turn hooks), with no synthetic assistant message on failure. The lifecycle and the loop config are private to `Agent`; no option or hook can start a run that is not `runLoop`. |
| `packages/agent/src/types.ts` | modified | SL-01 (0001) | `AgentEvent` also carries `RunEvent`, so run/step events travel the same `subscribe` → session → RPC path as today's events instead of a second channel every consumer would have to add. |
| `packages/agent/src/index.ts` | modified | SL-01 (0001) | Exports the RunDriver module from the package root. |
