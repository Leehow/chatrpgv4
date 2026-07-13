# Task 1 Report: Pin Independent Runtime Model Roles

## Status

Implementation is complete for the four scoped files. The amended Luna contract
passes, including exact in-memory model identity, fail-closed template/auth
checks, exact outbound model selection, and surfaced endpoint 404 errors.

## Implementation

- Both runners create `AuthStorage` and `ModelRegistry` from the active Pi agent
  directory and pass the resolved `model` plus `modelRegistry` directly to
  `createAgentSession`.
- Player defaults to `coding-relay/gpt-5.6-luna`; narrator defaults to
  `zhipu-coding/glm-5.2`. Their environment overrides remain role-specific.
- Exact configured models are used unchanged and must have configured auth.
- When, and only when, a requested `coding-relay` ID is absent, the resolver
  finds an authenticated model from that provider and creates a detached
  in-memory clone of its request metadata. The clone's `id` and `name` are both
  the exact requested relay ID. The registry and Pi settings are not mutated.
- Unknown providers and providers without an authenticated template still fail
  with `requested model unavailable: <provider>/<model>`.
- Player provider errors recorded by Pi as assistant error messages now surface
  in the runner response, so a relay 404 is not masked by a generic no-output
  error.

## TDD Evidence

### Original role-pinning RED

Before the prior implementation, the focused command reported:

```text
2 failed, 40 passed in 4.19s
```

The two new source-contract tests failed because the explicit role environment
variables and model-registry binding were absent.

### Amended Luna RED

After adding the exact Luna, fail-closed, and endpoint/no-fallback subprocess
tests but before changing the resolver, the same focused command reported:

```text
2 failed, 44 passed in 9.86s
```

The exact Luna test failed with `requested model unavailable:
coding-relay/gpt-5.6-luna`. The local endpoint test failed for the same reason
before any HTTP request was made, proving the added resolution path was absent.

### GREEN

Command:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py \
  tests/test_narrator_adapter.py -q -p no:cacheprovider
```

Result after the detached clone and provider-error propagation:

```text
46 passed in 5.73s
```

The local 404 test observed only `model: gpt-5.6-luna` in every outbound body,
received a nonzero runner exit, and observed the 404 in the returned error.

## Live Runtime Verification

- Player default: exit 0; `model_identity={"provider":"coding-relay",
  "id":"gpt-5.6-luna"}` with tool-mode output.
- Narrator default: exit 0; `model_identity={"provider":"zhipu-coding",
  "id":"glm-5.2"}` with tool-mode output.
- Subprocess contract: unknown provider and unauthenticated coding-relay
  template both exit nonzero with the exact unavailable-role error.

## Self-review

- `git diff --check` passed.
- `node --check` passed for both modified ESM runners.
- No `setModel()`, `SettingsManager` mutation, settings write, or `~/.pi` edit
  was introduced.
- The in-memory clone retains the template's provider/API/base URL and other
  model request fields while replacing only `id` and `name`.
- The registry does not acquire the synthesized Luna ID; it remains a detached
  per-session model object.
- Narrator resolution remains an exact configured `zhipu-coding/glm-5.2`
  registry identity.
- User-owned `.tools/` and
  `docs/superpowers/plans/2026-07-13-eval-contract-grok-execution.md` were not
  touched or staged.

## Concerns

No remaining concerns within Task 1 scope.

## Review Fix: Current-Turn Provider Error Scope

An Important review finding showed that the player JSONL server reused a Pi
session while `extractAssistantError()` scanned the entire session history. A
provider error from an earlier turn therefore overrode a later successful turn.

### Fix RED

A multi-turn `--server` regression uses one relay endpoint that returns a 404
for turn one and a valid streamed prose response for turn two.

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py::test_player_server_does_not_reuse_prior_turn_provider_error \
  -q -p no:cacheprovider
```

Before the fix, the second response incorrectly reused the old provider error:

```text
FAILED tests/test_runtime_player_adapter_contract.py::test_player_server_does_not_reuse_prior_turn_provider_error
1 failed in 1.48s
```

The observed second response was `{"ok":false,"error":"404 historical test
404"}` even though the relay had streamed successful current-turn prose.

### Fix GREEN

The player runner now captures assistant errors from the current invocation's
`message_end` events, unsubscribes that listener after the prompt, and limits
the defensive prose-history fallback to messages appended by the current
prompt. It no longer scans prior assistant errors.

The targeted regression result was:

```text
1 passed in 1.45s
```

Fresh focused verification command:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py \
  tests/test_narrator_adapter.py -q -p no:cacheprovider
```

Result:

```text
47 passed in 6.45s
```

The existing single-turn 404 test remains green and still observes only
`gpt-5.6-luna` in outbound request bodies; the multi-turn test also verifies
the later successful response reports exact
`coding-relay/gpt-5.6-luna` identity.

## Second Review Fix: Retry-Then-Success Error State

A second Important review found that the current-turn event capture retained
any assistant error seen during `session.prompt`. Pi automatic retry can emit a
retryable assistant error followed by a successful assistant completion in the
same prompt, so the transient error still overrode the successful result.

### Retry Fix RED

A one-turn regression configures a 1 ms, one-attempt Pi retry and uses a local
relay that returns HTTP 500 once, then valid streamed prose. Both requests
carry the exact `gpt-5.6-luna` model ID.

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py::test_player_current_turn_retry_success_clears_transient_provider_error \
  -q -p no:cacheprovider
```

Before the fix, the successful retry was masked by the first attempt:

```text
FAILED tests/test_runtime_player_adapter_contract.py::test_player_current_turn_retry_success_clears_transient_provider_error
1 failed in 1.39s
```

The runner exited 1 with `{"ok":false,"error":"500 transient test 500"}`
despite receiving the successful second stream.

### Retry Fix GREEN

Each current-turn assistant `message_end` now replaces the captured error state:
an error completion records its message, while a later non-error completion
clears it. A terminal 404 remains the latest assistant completion and therefore
still surfaces.

Targeted result:

```text
1 passed in 1.12s
```

Focused command:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py \
  tests/test_narrator_adapter.py -q -p no:cacheprovider
```

Result:

```text
48 passed in 9.23s
```

This focused run includes the exact Luna identity test, permanent endpoint 404
test, cross-turn stale-error test, retry-then-success test, and exact GLM
narrator contract.
