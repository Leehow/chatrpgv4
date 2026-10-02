# Vendored Pi — upstream snapshot

Consumed under [ADR-0006](../../docs/adr/0006-pi-native-single-loop.md).
Built by scripts/build-pi.mjs into the only pi-agent-core and pi-coding-agent
packages the product loads. The ordered series is listed in PATCHES.md.

| Item | Value |
| --- | --- |
| Repository | https://github.com/earendil-works/pi |
| Tag | v1.0.0 |
| Commit | a13d35a742c6ef8462812a28fbe1d8c8b7431c32 |
| Imported | 2026-10-02, Pi 1.0 compatibility upgrade |
| Packages | packages/agent and packages/coding-agent, version 1.0.0 |
| License | MIT; upstream LICENSE copied verbatim |

## Snapshot and build boundary

The two packages' src directories, manifests, README, CHANGELOG and build configs
are copied verbatim before replaying the four patches. The upstream root LICENSE
and tsconfig.base.json are included. The coding-agent docs directory is included
and copied into the built package because builtin tool descriptions reference it.
Tests, examples, benchmarks, scripts and shrinkwrap are not vendored. The
source-only client, experimental and CLI experimental directories are excluded
from compilation by upstream's build config. The snapshot contains 371 package files.

pi-ai, pi-tui, chord, pi-codemode and pi-mcp remain installed upstream 1.0.0
packages. The upstream coding-agent direct dependencies have root production pins because
its published shrinkwrap keeps dependencies nested; bare imports in the vendored
build resolve from the product root. These pins also prevent stale top-level 0.87
Pi dependencies. The QuickJS
runtime is pinned to upstream's 3.6.2 requirement. No codemode or MCP capability
is activated by these dependency pins.

## Admission and patch replay

Every published unbundled JS source map is compared with this snapshot, except
files explicitly listed in PATCHES.md. The emitted unpatched modules must match
the published JavaScript byte for byte apart from source-map comments. The
patch series is replayed from the pristine tag and checked against the final
vendored sources; its digest is stamped into the build and startup telemetry.
The build uses the published define semantics for class fields.

The 1.0 agent-core intentionally removes its experimental harness; it is not a
production dependency and this upgrade does not add pi-durable. Rebased patches
retain upstream's native tool errors and tool-update callback shape.

## Build output and upgrades

The output package removes source-only exports and devDependencies, points the
CLI and RPC entry at unbundled dist files, and adds the piCoc provenance field.
Every Keeper, reader and host in-process import uses these emitted packages.
Upgrade the pinned graphs together, import the exact new tag, replay and review
each patch, pass admission, then run host contract section 7 and single-loop gates.
Packaging and installed-App acceptance remain separate.

## Historical evidence

The initial SL-01 import was upstream v0.87.0, commit
16787ad5b2dc748047f314ca1bfe7708f30f54f3, on 2026-09-23. It compared
116 agent-core and 216 coding-agent published source maps, and reproduced
116 and 219 JS modules; its original gates remain recorded in ADR-0006 and
docs/specs/pi-native-single-loop-tickets/baseline-SL-00.md. These are historical
counts, not the 1.0 admission target.
