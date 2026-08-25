# Pi-Coc concurrent-development architecture

Status: **Proposed**

Implementation track: **ACTIVE_IMPLEMENTATION_TRACK=pi-coc**

Baseline reviewed: **affeedc3a78ac6da82e0c47ce5dafa95bf12d7fd**

Ownership manifest:
[pi-coc-module-ownership.json](pi-coc-module-ownership.json)

Related acceptance:
[Pi-Coc system regressions and repository health](pi-coc-system-regressions-and-repository-health.md)
R7 / A16.

## 1. Authority and scope

The user selected the Pi-Coc track and explicitly excluded Codex-host
implementation from this program. Codex-host adapters, prompts, launchers,
tests, and documentation are off-limits.

This document and its ownership manifest are design artifacts. They authorize
no implementation edit by themselves. The Python toolbox, operation policy,
MCP archive, and canonical plugin tests are shared files under repository law.
Before implementation starts, the exact shared paths in section 9 require
explicit user authorization.

The primary checkout may continue receiving unrelated Pi-Coc work. This
program runs from a task-owned worktree and integrates only committed
0.6.1a history. It never restores, stashes, commits, or deletes unknown dirty
work from the primary checkout.

## 2. User job, success, and hollow delivery

The user is trying to make ordinary Pi-Coc development safely parallelizable:
two agents working on unrelated product modules should not repeatedly edit the
same toolbox, policy mirror, generated archive, or giant test file.

Success looks like:

- coc_toolbox.py becomes a thin host facade over one canonical operation
  registry and deep operation modules;
- every operation has one normalized descriptor containing execution and
  policy facts;
- MCP JSON and Pi TypeScript policy facts are deterministic projections of
  that descriptor;
- generated projections are integration-owned, so worker branches do not
  produce competing machine diffs;
- each migrated operation module owns its handlers and behavior tests through
  one small interface;
- Pi continuation logic is split at proven state-ownership seams while
  OpeningTerminalContinuationGate preserves its existing public interface;
- a machine-readable manifest supplies owned paths, off-limits paths,
  operation identities, dependencies, and validation commands to agent
  prompts;
- two agents from one base can change two migrated modules and both merge
  orders validate without manual conflict resolution.

Hollow delivery would be:

- moving all 101 post-handler helper dependencies into a second monolith named
  kernel;
- splitting files by line count or operation-name prefix while preserving
  shared state and shared tests;
- committing generated JSON or TypeScript from every worker branch;
- relying on a local-only Git merge driver as the correctness mechanism;
- leaving domain tests in test_toolbox.py after their handlers move;
- adding an ownership document that no test or prompt generator consumes;
- claiming concurrency from separate worktrees while every branch still edits
  the same facade, generated files, or integration tests;
- changing Keeper behavior, state semantics, operation envelopes, or player
  output during a behavior-preserving extraction.

## 3. Verified baseline

All source metrics below were measured from the exact baseline commit, not the
dirty primary checkout.

| Surface | Baseline evidence |
| --- | --- |
| Python toolbox | 32,588 lines; 125 decorated handlers across 25 operation namespaces; first handler at line 8,391 |
| Handler implementation | 12,559 handler-body lines, average 100.5; the often quoted 193.6 average is the entire post-handler region divided by handler count |
| Pre-handler dependencies | 185 top-level definitions; handlers directly reference 91; all post-handler code references 101 |
| Helper fan-out | 67 of 91 directly referenced helpers serve one namespace; only Ctx and tool reach all 25, while ToolError reaches 19 |
| Existing domain files | nine namespaces have an exact coc_<namespace>.py module; other namespaces have related implementation modules but no mechanical one-to-one destination |
| Recent contention | in the last 300 repository commits: toolbox 81 touches, archive JSON 30, test_toolbox.py 30, test_pi_package.py 24, Pi policy TS 12, typed-tools.ts 4 |
| Toolbox tests | 20,629 lines, 347 test functions, approximately 122 tests mentioning multiple operation namespaces |
| Pi continuation gate | 5,436 lines, 137 methods; observeOpeningSetupInvocation alone spans 1,276 lines |
| Pi method coupling | current-dependency has no outgoing cross-cluster method call; output calls dependency; background calls opening 17 times and opening calls background three times |

These measurements establish two different problems:

1. The current toolbox is not a composition root; business adapters and
   transaction behavior live inside it.
2. The desired end state is still a thin composition facade. It becomes
   stable only after handlers, domain helpers, and domain tests have moved.

## 4. Target module design

### 4.1 Canonical operation kernel

Create one deep Python module at
plugins/coc-keeper/scripts/coc_operation_kernel.py.

Its external interface is limited to:

- the immutable OperationSpec and normalized OperationPolicy data models;
- an explicit OperationRegistry instance and operation registration;
- Ctx and ToolError, or compatibility aliases with the same observable
  behavior;
- registry describe/list/query;
- the existing run operation seam used by the CLI, MCP adapter, and tests.

The kernel owns only genuinely cross-domain infrastructure: registration,
context construction, parameter validation, locking/retry orchestration,
envelope formation, logging/audit attachment, and execution dispatch.

The registry is not a process-global singleton. coc_toolbox.py creates one
registry for its own loaded module instance and passes it to every operation
module. This preserves isolated tests that load coc_toolbox.py under different
module names and prevents temporary test registrations from leaking between
registries.

It must not absorb a helper merely because the current monolith defines that
helper before the first handler. Helper placement uses these rules:

- one operation module: move beside that module;
- several modules sharing a real domain concept: deepen the existing domain
  implementation module;
- cross-domain execution infrastructure: kernel;
- generic time/hash/path helpers: existing utility module or a small utility
  module only when at least two callers justify the seam.

coc_toolbox.py remains the compatibility facade and CLI entrypoint. It imports
the operation modules deterministically, exposes the existing registry and
envelopes, and contains no ordinary product handler after migration.

### 4.2 One operation descriptor

Every registered operation resolves to one complete OperationSpec:

- name and summary;
- parameter contract;
- campaign requirement;
- access/read/write/recovery domains;
- response and audit mode;
- strict-read-only flag;
- execution class;
- audience, phases, contract, advisory, and KP surface;
- handler reference.

Domain defaults may reduce repetition inside one operation module, but the
registry stores the fully normalized result. coc_operation_policy.py may retain
enum validation and query helpers; it stops assigning operation-specific
policy after migration.

### 4.3 Generated projections

Extend coc_mcp_contract_archive.py into the one deterministic projection
command. It produces:

1. references/mcp-operation-contracts.json;
2. pi/lib/operation-policy.generated.ts.

pi/lib/operation-policy.ts becomes a handwritten adapter over the generated
facts. Session-role rules and helper functions remain handwritten.
typed-tools.ts remains the generic consumer and is not edited for an ordinary
operation addition.

The generator must support an explicit output path or temporary output
directory. Worker validation generates outside tracked paths. Only the
integration owner updates committed generated projections after source commits
have been integrated.

CI runs a check mode that regenerates in a temporary location and byte-compares
both projections. A custom merge driver is optional local convenience at most;
it is never an acceptance dependency.

Git defines a custom merge driver's command in local Git configuration and
passes temporary ancestor/current/other files, so a repository attribute alone
cannot guarantee a portable regenerate-after-final-merge workflow:
[Git gitattributes documentation](https://git-scm.com/docs/gitattributes).
The committed-output strategy therefore uses the explicit update/check pattern
also visible in mature generated-code repositories such as
[Kubernetes verify-codegen](https://github.com/kubernetes/kubernetes/blob/master/hack/verify-codegen.sh).

### 4.4 Operation modules and tests

The JSON manifest assigns all 125 baseline operations to cohesive modules.
Operation namespace is not module ownership: finance owns rules.cash_assets
and state.purchase; handouts owns selected clues.* and state.* operations.

Each target module uses:

- plugins/coc-keeper/scripts/coc_operation_<module>.py;
- tests/test_toolbox_<module>.py.

Operation modules are leaf registrars over operation-kernel and do not import
one another. Cross-domain behavior is carried by existing deep implementation
modules or moved behind an explicit shared implementation interface; adapter
imports must not recreate the monolith as a dependency cycle.

Each operation module exposes one external interface:
register_operations(registry). Registration happens only when the facade or a
test passes an explicit registry; importing a module has no process-global
registration side effect.

Migration has three machine states:

- planned: handler and tests still live in shared files; parallel editing is
  forbidden;
- extracting: exactly one serial migration owner may edit the shared source
  and test files;
- migrated: ordinary changes use only the module-owned adapter and tests.

Every extraction commit moves the handler, its domain-private helpers, and its
domain behavior tests together. Registry/CLI/envelope/parity tests stay
integration-owned. Tests are replaced at the new module interface rather than
duplicated on both sides.

### 4.5 Pi continuation modules

Preserve OpeningTerminalContinuationGate as the external interface exported
from pi/extensions/index.ts. Extract in this order:

1. current-dependency-machine.ts: the leaf state machine around dependency
   waits, dispatch binding, retries, and terminal receipts;
2. turn-output-gate.ts: agent epoch, finalization readiness, mechanical output,
   frozen recovery, and player delivery state;
3. opening-setup-machine.ts: opening setup plus its bidirectionally coupled
   background/dispatch ownership implementation;
4. retain lifecycle hooks and composition in index.ts.

The current-dependency module is first because it has no outgoing method call
to the other clusters. Background/dispatch does not become its own public
module unless extraction reveals a smaller interface than its current
17-to-3 bidirectional coupling with opening.

Existing tests continue constructing OpeningTerminalContinuationGate. New
focused tests may exercise an internal module seam, but that seam does not
become part of the host interface.

### 4.6 Machine-readable ownership

pi-coc-module-ownership.json is the source of truth for migration ownership.
It records:

- module id and migration state;
- exact operation ids;
- target adapter and test paths;
- implementation dependencies;
- permitted module dependencies;
- integration-only paths;
- focused validation.

The prompt generator projects only the mechanical scope stanza: active track,
base commit, owned paths, off-limits paths, operation ids, dependencies, and
validation. Task intent and acceptance remain lead-authored; the manifest is
not a second workflow engine.

Python import enforcement must understand the repository's dynamic sibling
loaders. A normal import graph misses importlib.util.spec_from_file_location
and _load_sibling/_load_dependency. The checker either recognizes these
patterns through Python AST or first converts the touched modules to normal
package imports without adding compatibility readers.

TypeScript import enforcement uses the repository's existing Node test
surface. This program does not add a linter dependency merely to enforce one
path rule.

## 5. Migration work graph

| Work | Dependency | Execution | Completion |
| --- | --- | --- | --- |
| D0 spec and manifest | none | serial docs | this document and exact 125-operation manifest validate |
| D1 canonical descriptor and generator | shared-file authorization | strong-model serial | one normalized registry; JSON and generated TS check from temp output |
| D2 minimal kernel | D1 | strong-model serial | facade/envelope/locking behavior unchanged; helper classification recorded |
| D3 finance pilot | D2 | serial extraction | finance handlers and behavior tests leave shared files; parity green |
| D4 handout pilot | D3 | serial extraction | handout handlers and behavior tests leave shared files; parity green |
| D5 remaining Python modules | D3/D4 lessons | serial extraction, then disjoint ordinary work | every operation assigned once and every migrated module owns its tests |
| D6 current dependency | stable Pi baseline | serial extraction | facade tests and focused dependency tests green |
| D7 turn output | D6 | serial extraction | finalization/mechanical/player-output tests green |
| D8 opening setup | D7 | serial extraction | opening/background tests green; facade unchanged |
| D9 concurrent acceptance | D5 and relevant D6-D8 | two disjoint agents plus serial integrator | both merge orders require no manual resolution and validate |
| D10 rebase/merge current 0.6.1a | each accepted slice and final close | serial integrator | committed upstream changes reviewed and merged without absorbing dirty work |

Finance and handout are pilots, not parallel migrations from the monolith.
Parallel implementation begins only after their interfaces and ownership tests
prove that ordinary edits no longer touch shared source.

## 6. Acceptance ledger

| ID | Requirement | Evidence |
| --- | --- | --- |
| C1 | All baseline operations occur exactly once in the ownership manifest | AST registry extraction compared with JSON |
| C2 | Every OperationSpec has one normalized policy and execution class | registry contract test |
| C3 | JSON and TS projections are deterministic and current | generator check against temporary outputs |
| C4 | Worker changes never include integration-owned generated paths | staged-range ownership guard |
| C5 | coc_toolbox.py retains list/describe/run/CLI and envelope behavior | focused compatibility tests |
| C6 | Domain behavior tests move with handlers; central tests cover only shared interfaces and vertical contracts | test ownership audit |
| C7 | Forbidden Python and TypeScript imports fail with exact module/path evidence | architecture tests |
| C8 | OpeningTerminalContinuationGate retains its current public methods and observable behavior | focused Pi gate tests |
| C9 | Two disjoint module commits merge in both orders without conflict or manual edits | disposable integration worktrees plus merge-tree evidence |
| C10 | Both integrated orders pass ownership, generation, focused, metadata, and relevant Pi tests | retained command output |
| C11 | Current committed 0.6.1a updates are semantically reviewed and integrated | range-diff/per-file review and final validation |
| C12 | Codex-host implementation remains unchanged | path diff audit |

C9 is not satisfied by two worktrees alone. Each worker starts from one exact
base, modifies only migrated module paths, and does not touch generated or
integration-owned files. The integrator validates A-then-B and B-then-A.

## 7. Validation

Baseline and every shared-kernel slice:

    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest +      tests/test_plugin_metadata.py -q -p no:cacheprovider

Operation registry and projection slices:

    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest +      tests/test_operation_policy.py tests/test_pi_package.py +      tests/test_plugin_mcp.py -q -p no:cacheprovider

    uv run --frozen python +      plugins/coc-keeper/scripts/coc_mcp_contract_archive.py check

Each module adds its focused target test. Pi extraction uses the existing
Node test files named in the ownership manifest. Full validation is serialized
and runs only after focused checks pass.

No source build or deterministic test is whole-product acceptance. Behavior-
preserving extraction does not require a fresh campaign unless a focused
replay detects changed player-visible or authoritative behavior.

## 8. Dirty checkout and integration policy

The task-owned branch starts from affeedc3a78a. The primary checkout remains
the source of later committed 0.6.1a work.

Before each integration:

1. fetch the current local 0.6.1a ref and record its exact SHA;
2. inspect range-diff and per-file overlap from the last integrated SHA;
3. stop on shared-file semantic overlap or uncommitted-only work;
4. merge committed history into the task branch;
5. regenerate integration-owned projections once;
6. rerun focused validation.

Uncommitted primary changes are never copied, stashed, restored, or committed
by this task. Existing Pi-Coc runtime processes are not stopped merely to make
Git status cleaner.

## 9. Exact shared-file implementation authorization required

The first implementation slice cannot proceed without explicit authorization
for these exact shared paths:

- plugins/coc-keeper/scripts/coc_toolbox.py — move registry/execution
  infrastructure and handlers while preserving the facade;
- plugins/coc-keeper/scripts/coc_operation_policy.py — stop assigning
  operation-specific policy and retain validation/query helpers;
- plugins/coc-keeper/scripts/coc_mcp_contract_archive.py — emit both generated
  projections and check temporary output;
- plugins/coc-keeper/references/mcp-operation-contracts.json — committed
  integration-owned projection;
- plugins/coc-keeper/pi/lib/operation-policy.ts — handwritten adapter over
  generated facts;
- plugins/coc-keeper/pi/lib/operation-policy.generated.ts — new committed
  integration-owned projection;
- plugins/coc-keeper/scripts/coc_operation_kernel.py — new canonical registry
  and execution module;
- tests/test_toolbox.py — serialized removal of migrated behavior tests;
- tests/test_operation_policy.py — canonical descriptor/policy assertions;
- tests/test_pi_package.py — generated parity and package assertions.

typed-tools.ts is deliberately excluded from the initial shared authorization.
If an operation needs a genuine model-presentation exception, that path is
named and approved separately.

Later operation adapter files and their focused tests are Pi-Coc-owned paths
listed in the manifest. Pi state-machine extraction requires a second exact
authorization slice for:

- plugins/coc-keeper/pi/extensions/index.ts;
- the three new pi/lib machine files;
- the existing focused tests listed for those machines.

## 10. Non-goals and stop conditions

Non-goals:

- no Codex-host parity work;
- no operation behavior redesign during extraction;
- no ruleset change;
- no campaign/state migration or compatibility reader;
- no PDF parser, semantic keyword classifier, or second Keeper runtime;
- no deletion of worktrees, branches, campaigns, logs, source bundles, or
  playtest evidence;
- no push, deploy, package release, or live process restart;
- no repository-wide module map outside this hotspot program.

Stop when:

- a required shared path lacks explicit authorization;
- the primary change exists only as dirty work and overlaps this branch;
- a helper cannot be classified without changing behavior;
- an extraction exposes a new product or authority decision;
- generated projections are nondeterministic;
- focused behavior changes before the structural slice is complete;
- an ownership or import check requires a new dependency rather than using the
  current Python/Node toolchain.
