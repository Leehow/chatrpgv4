# Vendored Pi — upstream snapshot

Consumed under [ADR-0006](../../docs/adr/0006-pi-native-single-loop.md) (this file is the ADR's `UPSTREAM.md`).
Built by `scripts/build-pi.mjs` (run by `npm run build:runtime`) into `build/node_modules/@earendil-works/`,
the only copy of `pi-agent-core` and `pi-coding-agent` the product loads. Patches are listed in
[`PATCHES.md`](PATCHES.md) and kept as an ordered series under `patches/`.

| item | value |
| --- | --- |
| Upstream repository | https://github.com/earendil-works/pi |
| Tag | `v0.87.0` (lightweight) |
| Commit | `16787ad5b2dc748047f314ca1bfe7708f30f54f3` ("Release v0.87.0") |
| Packages | `packages/agent` → `@earendil-works/pi-agent-core` 0.87.0; `packages/coding-agent` → `@earendil-works/pi-coding-agent` 0.87.0 |
| Not vendored | `pi-ai`, `pi-tui`, `chord`, `pi-telemetry` and every third-party dependency: the installed 0.87.0 packages are used unchanged and are the only copies (they resolve through the repository's `node_modules`) |
| License | MIT, `LICENSE` (upstream root `LICENSE`, copied verbatim); each package's `package.json` states `"license": "MIT"` |
| Imported | 2026-09-23, SL-01 (`claude/sl01-run-driver-20260923`) |

## What was copied

From the tag's tree, verbatim: the root `LICENSE` and `tsconfig.base.json`; for each of the two packages
`src/` (whole directory), `package.json`, `README.md`, `CHANGELOG.md` and `tsconfig.build.json`. Not copied:
`test/`, `docs/`, `examples/`, `benchmark/`, `scripts/`, the vitest configs, `npm-shrinkwrap.json`,
`install-lock` (none is read at run time by the product; `docs/`/`examples/` only feed Pi's own default coding
prompt, which the product replaces with `--system-prompt`). `src/client`, `src/experimental` and
`src/cli/experimental` of coding-agent are copied but, as upstream, not built.

## How the snapshot was obtained and verified (2026-09-23)

1. `git ls-remote --tags https://github.com/earendil-works/pi 'v0.87*'` → `v0.87.0` = `16787ad5b2dc748047f314ca1bfe7708f30f54f3`
   (and `v0.87.1` = `f07218c4…`, not taken).
2. `git fetch --depth 1 --filter=blob:none origin refs/tags/v0.87.0`, sparse checkout of `packages/agent`,
   `packages/coding-agent` and the root files; `HEAD is now at 16787ad Release v0.87.0`.
3. **Byte-for-byte check against what npm shipped:** every `dist/**/*.js.map` of the installed
   `@earendil-works/pi-agent-core@0.87.0` (116 maps) and `@earendil-works/pi-coding-agent@0.87.0` (216 maps, the
   `dist/bundle` excluded) embeds its TypeScript source in `sourcesContent`. All 116 + 216 embedded sources are
   byte-identical to the files at those paths in the tag's tree (0 differ, 0 absent). The installed packages are
   the ones pinned in `package-lock.json` (integrity in `docs/specs/pi-native-single-loop-tickets/baseline-SL-00.md` §2).
4. **The build reproduces the published JavaScript:** `scripts/build-pi.mjs` compiles the vendored sources with
   the upstream compiler options (TypeScript 5.9.3, the repository's pinned compiler; upstream uses `tsgo`). All
   116 + 219 emitted `.js` modules are byte-identical to the published `dist/*.js` apart from the trailing
   `//# sourceMappingURL` comment. One option is set to what shipped rather than what the config says: tsgo emits
   ES2022 class fields with define semantics although `tsconfig.base.json` has `useDefineForClassFields: false`,
   so the build sets it to `true` (without that, 95 modules differ in class-field emit).
5. Steps 3 and 4 are re-run on every `npm run test:ext` by `tests/extension/vendored-pi.test.mjs` against the
   installed packages, for every file the patch series does not touch; the files it touches must be listed in
   `PATCHES.md` and must actually differ.

Type checking under this repository's toolchain reports 11 errors in the unpatched coding-agent tree, all from
type packages upstream installs as devDependencies and the product does not (`@types/semver`,
`@types/proper-lockfile`, `@types/cross-spawn`, `@types/hosted-git-info`, a newer `@types/node`). Emit is type
erasure (`erasableSyntaxOnly`), so they change nothing emitted; `scripts/build-pi.mjs` tolerates exactly those
and fails on any other error, so a patch that does not type-check stops the build.

## Build output

`build/node_modules/@earendil-works/pi-agent-core` and `…/pi-coding-agent`: `dist/` (JS, `.d.ts`, maps), the
upstream copy-assets (themes, the export-html templates and vendor scripts, the interactive assets),
`README.md`, `CHANGELOG.md` and a `package.json` that differs from upstream only in: `bin.pi` →
`dist/cli.js` and `exports["./rpc-entry"]` → `dist/rpc-entry.js` (upstream points both into a bundle this build
does not make; the product has always started the unbundled `dist/cli.js` in the compiled layout), the
source-only `./client` / `./experimental/plugin` exports, `scripts` and `devDependencies` removed, and a
`piCoc` field `{vendored, base, patchSeriesDigest}` the startup record reads.

## Upgrade

Per ADR-0006: import the new tag's tree over this one, pass steps 3–4 against that version's published `dist`,
rebase the series in `patches/` (`git am` against the new tag), rebuild, then the host contract §7 checks and the
single-loop architecture assertions.

## Files

<details><summary>411 vendored files under <code>packages/</code></summary>

```
agent/CHANGELOG.md
agent/README.md
agent/package.json
agent/src/agent-loop.ts
agent/src/agent.ts
agent/src/harness/agent-harness.ts
agent/src/harness/compaction/branch-summarization.ts
agent/src/harness/compaction/compaction.ts
agent/src/harness/compaction/utils.ts
agent/src/harness/config.ts
agent/src/harness/context.ts
agent/src/harness/env/nodejs.ts
agent/src/harness/events.ts
agent/src/harness/execution/assistant.ts
agent/src/harness/execution/effect-gate.ts
agent/src/harness/execution/tools.ts
agent/src/harness/hooks.ts
agent/src/harness/messages.ts
agent/src/harness/pico3/bash.ts
agent/src/harness/pico3/bounded.ts
agent/src/harness/pico3/chord.ts
agent/src/harness/pico3/context.ts
agent/src/harness/pico3/harness.ts
agent/src/harness/pico3/hooks.ts
agent/src/harness/pico3/index.ts
agent/src/harness/pico3/jsonl.ts
agent/src/harness/pico3/kinds/collapse.ts
agent/src/harness/pico3/kinds/entries.ts
agent/src/harness/pico3/kinds/frames.ts
agent/src/harness/pico3/kinds/generation.ts
agent/src/harness/pico3/kinds/job.ts
agent/src/harness/pico3/kinds/plugin.ts
agent/src/harness/pico3/kinds/post-tools.ts
agent/src/harness/pico3/kinds/task-api.ts
agent/src/harness/pico3/kinds/tool.ts
agent/src/harness/pico3/membrane.ts
agent/src/harness/pico3/memory.ts
agent/src/harness/pico3/scheduler.ts
agent/src/harness/pico3/session.ts
agent/src/harness/pico3/system.ts
agent/src/harness/pico3/types.ts
agent/src/harness/pico3/view.ts
agent/src/harness/prompt-templates.ts
agent/src/harness/result.ts
agent/src/harness/runtime/drive.ts
agent/src/harness/runtime/drive/boundary.ts
agent/src/harness/runtime/drive/checkpoint.ts
agent/src/harness/runtime/drive/deferred.ts
agent/src/harness/runtime/drive/generation.ts
agent/src/harness/runtime/drive/reconcile.ts
agent/src/harness/runtime/drive/recovery.ts
agent/src/harness/runtime/drive/response.ts
agent/src/harness/runtime/drive/retry.ts
agent/src/harness/runtime/drive/structural.ts
agent/src/harness/runtime/drive/terminal.ts
agent/src/harness/runtime/drive/tool-placement.ts
agent/src/harness/runtime/drive/tools.ts
agent/src/harness/runtime/harness.ts
agent/src/harness/runtime/index.ts
agent/src/harness/runtime/lane.ts
agent/src/harness/runtime/progress.ts
agent/src/harness/runtime/reducer.ts
agent/src/harness/runtime/restore.ts
agent/src/harness/runtime/transcript.ts
agent/src/harness/runtime/types.ts
agent/src/harness/session/commit.ts
agent/src/harness/session/context.ts
agent/src/harness/session/fork-policy.ts
agent/src/harness/session/fork.ts
agent/src/harness/session/in-memory-storage-state.ts
agent/src/harness/session/index.ts
agent/src/harness/session/jsonl/codec.ts
agent/src/harness/session/jsonl/fork.ts
agent/src/harness/session/jsonl/index.ts
agent/src/harness/session/jsonl/io.ts
agent/src/harness/session/jsonl/legacy-v3.ts
agent/src/harness/session/jsonl/repo.ts
agent/src/harness/session/jsonl/storage.ts
agent/src/harness/session/jsonl/types.ts
agent/src/harness/session/memory.ts
agent/src/harness/session/mutation-line.ts
agent/src/harness/session/session.ts
agent/src/harness/session/testing/benchmark/datasets.ts
agent/src/harness/session/testing/benchmark/session-repo.ts
agent/src/harness/session/testing/benchmark/storage.ts
agent/src/harness/session/testing/conformance/session-repo.ts
agent/src/harness/session/testing/conformance/storage.ts
agent/src/harness/session/testing/gating-storage.ts
agent/src/harness/session/testing/index.ts
agent/src/harness/session/testing/instrumented-storage.ts
agent/src/harness/session/testing/storage-decorator.ts
agent/src/harness/session/testing/types.ts
agent/src/harness/session/types.ts
agent/src/harness/session/values.ts
agent/src/harness/skills.ts
agent/src/harness/system-prompt.ts
agent/src/harness/telemetry.ts
agent/src/harness/tools/bash.ts
agent/src/harness/tools/edit-diff.ts
agent/src/harness/tools/edit.ts
agent/src/harness/tools/file-mutation-queue.ts
agent/src/harness/tools/image.ts
agent/src/harness/tools/index.ts
agent/src/harness/tools/path-utils.ts
agent/src/harness/tools/read.ts
agent/src/harness/tools/tool-context.ts
agent/src/harness/tools/write.ts
agent/src/harness/types.ts
agent/src/harness/utils/adaptive-publisher.ts
agent/src/harness/utils/output-capture.ts
agent/src/harness/utils/shell-output.ts
agent/src/harness/utils/truncate.ts
agent/src/harness/utils/usage.ts
agent/src/index.ts
agent/src/node.ts
agent/src/proxy.ts
agent/src/search/index.ts
agent/src/stream-fn.ts
agent/src/types.ts
agent/tsconfig.build.json
coding-agent/CHANGELOG.md
coding-agent/README.md
coding-agent/package.json
coding-agent/src/bun/cli.ts
coding-agent/src/bun/restore-sandbox-env.ts
coding-agent/src/bun/runtime-setup.ts
coding-agent/src/bun/sandbox-env-setup.ts
coding-agent/src/cli.ts
coding-agent/src/cli/args.ts
coding-agent/src/cli/auth-check.ts
coding-agent/src/cli/auth-command.ts
coding-agent/src/cli/config-selector.ts
coding-agent/src/cli/credential-print.ts
coding-agent/src/cli/experimental/cli.ts
coding-agent/src/cli/experimental/command-options.ts
coding-agent/src/cli/experimental/command.ts
coding-agent/src/cli/experimental/commands/client.ts
coding-agent/src/cli/experimental/commands/server.ts
coding-agent/src/cli/file-processor.ts
coding-agent/src/cli/initial-message.ts
coding-agent/src/cli/list-models.ts
coding-agent/src/cli/project-trust.ts
coding-agent/src/cli/session-picker.ts
coding-agent/src/cli/setup.ts
coding-agent/src/cli/startup-ui.ts
coding-agent/src/client/index.ts
coding-agent/src/config.ts
coding-agent/src/core/agent-session-runtime.ts
coding-agent/src/core/agent-session-services.ts
coding-agent/src/core/agent-session.ts
coding-agent/src/core/auth-guidance.ts
coding-agent/src/core/auth-storage.ts
coding-agent/src/core/bash-executor.ts
coding-agent/src/core/bug-report-upload.ts
coding-agent/src/core/bug-report.ts
coding-agent/src/core/cache-stats.ts
coding-agent/src/core/cache-warmer.ts
coding-agent/src/core/compaction/branch-summarization.ts
coding-agent/src/core/compaction/compaction.ts
coding-agent/src/core/compaction/index.ts
coding-agent/src/core/compaction/utils.ts
coding-agent/src/core/crash-log.ts
coding-agent/src/core/defaults.ts
coding-agent/src/core/diagnostics.ts
coding-agent/src/core/event-bus.ts
coding-agent/src/core/exec.ts
coding-agent/src/core/experimental.ts
coding-agent/src/core/export-html/ansi-to-html.ts
coding-agent/src/core/export-html/index.ts
coding-agent/src/core/export-html/template.css
coding-agent/src/core/export-html/template.html
coding-agent/src/core/export-html/template.js
coding-agent/src/core/export-html/tool-renderer.ts
coding-agent/src/core/export-html/vendor/highlight.min.js
coding-agent/src/core/export-html/vendor/marked.min.js
coding-agent/src/core/extensions/index.ts
coding-agent/src/core/extensions/jiti-loader.ts
coding-agent/src/core/extensions/jiti-static-loader.ts
coding-agent/src/core/extensions/loader.ts
coding-agent/src/core/extensions/runner.ts
coding-agent/src/core/extensions/types.ts
coding-agent/src/core/extensions/virtual-modules.ts
coding-agent/src/core/extensions/wrapper.ts
coding-agent/src/core/footer-data-provider.ts
coding-agent/src/core/http-dispatcher.ts
coding-agent/src/core/index.ts
coding-agent/src/core/keybindings.ts
coding-agent/src/core/messages.ts
coding-agent/src/core/model-config.ts
coding-agent/src/core/model-registry.ts
coding-agent/src/core/model-resolver.ts
coding-agent/src/core/model-runtime.ts
coding-agent/src/core/models-store.ts
coding-agent/src/core/output-guard.ts
coding-agent/src/core/package-manager.ts
coding-agent/src/core/pi-manifest.ts
coding-agent/src/core/project-trust.ts
coding-agent/src/core/prompt-templates.ts
coding-agent/src/core/provider-attribution.ts
coding-agent/src/core/provider-composer.ts
coding-agent/src/core/radius.ts
coding-agent/src/core/remote-catalog-provider.ts
coding-agent/src/core/resolve-config-value.ts
coding-agent/src/core/resource-loader.ts
coding-agent/src/core/runtime-credentials.ts
coding-agent/src/core/sdk.ts
coding-agent/src/core/session-cwd.ts
coding-agent/src/core/session-export.ts
coding-agent/src/core/session-manager.ts
coding-agent/src/core/settings-diagnostics.ts
coding-agent/src/core/settings-manager.ts
coding-agent/src/core/skills.ts
coding-agent/src/core/slash-commands.ts
coding-agent/src/core/source-info.ts
coding-agent/src/core/system-prompt.ts
coding-agent/src/core/telemetry.ts
coding-agent/src/core/timings.ts
coding-agent/src/core/tools/bash.ts
coding-agent/src/core/tools/edit-diff.ts
coding-agent/src/core/tools/edit.ts
coding-agent/src/core/tools/file-mutation-queue.ts
coding-agent/src/core/tools/find.ts
coding-agent/src/core/tools/grep.ts
coding-agent/src/core/tools/index.ts
coding-agent/src/core/tools/ls.ts
coding-agent/src/core/tools/output-accumulator.ts
coding-agent/src/core/tools/path-utils.ts
coding-agent/src/core/tools/powershell.ts
coding-agent/src/core/tools/read.ts
coding-agent/src/core/tools/render-utils.ts
coding-agent/src/core/tools/renderers/bash.ts
coding-agent/src/core/tools/renderers/edit.ts
coding-agent/src/core/tools/renderers/find.ts
coding-agent/src/core/tools/renderers/grep.ts
coding-agent/src/core/tools/renderers/index.ts
coding-agent/src/core/tools/renderers/ls.ts
coding-agent/src/core/tools/renderers/read.ts
coding-agent/src/core/tools/renderers/write.ts
coding-agent/src/core/tools/tool-definition-wrapper.ts
coding-agent/src/core/tools/truncate.ts
coding-agent/src/core/tools/write.ts
coding-agent/src/core/trust-manager.ts
coding-agent/src/core/usage-totals.ts
coding-agent/src/experimental/cli.ts
coding-agent/src/experimental/client-runtime.ts
coding-agent/src/experimental/client-tui-chat.ts
coding-agent/src/experimental/client-tui.ts
coding-agent/src/experimental/client.ts
coding-agent/src/experimental/commands.ts
coding-agent/src/experimental/coordinator-entry.ts
coding-agent/src/experimental/coordinator.ts
coding-agent/src/experimental/micro/README.md
coding-agent/src/experimental/micro/api.ts
coding-agent/src/experimental/micro/main.ts
coding-agent/src/experimental/micro/models.ts
coding-agent/src/experimental/micro/runtime.ts
coding-agent/src/experimental/micro/sessions.ts
coding-agent/src/experimental/micro/tools.ts
coding-agent/src/experimental/micro/tui.ts
coding-agent/src/experimental/mini/README.md
coding-agent/src/experimental/mini/main.ts
coding-agent/src/experimental/mini/server/entry.ts
coding-agent/src/experimental/mini/server/run.ts
coding-agent/src/experimental/mini/shared/protocol.ts
coding-agent/src/experimental/mini/shared/rpc.ts
coding-agent/src/experimental/mini/shared/transport.ts
coding-agent/src/experimental/mini/tui/run.ts
coding-agent/src/experimental/mini/tui/session.ts
coding-agent/src/experimental/mini/tui/view.ts
coding-agent/src/experimental/mini/worker/entry.ts
coding-agent/src/experimental/mini/worker/lane-service.ts
coding-agent/src/experimental/mini/worker/models-service.ts
coding-agent/src/experimental/mini/worker/run.ts
coding-agent/src/experimental/plugin.ts
coding-agent/src/experimental/plugins/bundled.ts
coding-agent/src/experimental/plugins/package.ts
coding-agent/src/experimental/process.ts
coding-agent/src/experimental/radius-auth.ts
coding-agent/src/experimental/radius-relay.ts
coding-agent/src/experimental/server.ts
coding-agent/src/experimental/services/README.md
coding-agent/src/experimental/services/agent-controller-provider.ts
coding-agent/src/experimental/services/agent-controller.ts
coding-agent/src/experimental/services/connection.ts
coding-agent/src/experimental/services/models-provider.ts
coding-agent/src/experimental/services/models.ts
coding-agent/src/experimental/services/plugins.ts
coding-agent/src/experimental/services/presentation-ui.ts
coding-agent/src/experimental/services/server.ts
coding-agent/src/experimental/services/sessions.ts
coding-agent/src/experimental/services/slash-commands-provider.ts
coding-agent/src/experimental/services/slash-commands.ts
coding-agent/src/experimental/services/transcript-provider.ts
coding-agent/src/experimental/services/transcript.ts
coding-agent/src/experimental/services/worker.ts
coding-agent/src/experimental/session-worker-manager.ts
coding-agent/src/experimental/session-worker.ts
coding-agent/src/experimental/source-resolver.ts
coding-agent/src/extensions/index.ts
coding-agent/src/extensions/llama/client.ts
coding-agent/src/extensions/llama/huggingface.ts
coding-agent/src/extensions/llama/index.ts
coding-agent/src/extensions/llama/provider.ts
coding-agent/src/extensions/llama/ui.ts
coding-agent/src/index.ts
coding-agent/src/main.ts
coding-agent/src/migrations.ts
coding-agent/src/modes/index.ts
coding-agent/src/modes/interactive/assets/clankolas.png
coding-agent/src/modes/interactive/bug-report.ts
coding-agent/src/modes/interactive/chat-viewport.ts
coding-agent/src/modes/interactive/components/armin.ts
coding-agent/src/modes/interactive/components/assistant-message.ts
coding-agent/src/modes/interactive/components/bash-execution.ts
coding-agent/src/modes/interactive/components/bordered-loader.ts
coding-agent/src/modes/interactive/components/branch-summary-message.ts
coding-agent/src/modes/interactive/components/compaction-summary-message.ts
coding-agent/src/modes/interactive/components/config-selector.ts
coding-agent/src/modes/interactive/components/countdown-timer.ts
coding-agent/src/modes/interactive/components/custom-editor.ts
coding-agent/src/modes/interactive/components/custom-entry.ts
coding-agent/src/modes/interactive/components/custom-message.ts
coding-agent/src/modes/interactive/components/daxnuts.ts
coding-agent/src/modes/interactive/components/diff.ts
coding-agent/src/modes/interactive/components/dynamic-border.ts
coding-agent/src/modes/interactive/components/earendil-announcement.ts
coding-agent/src/modes/interactive/components/extension-editor.ts
coding-agent/src/modes/interactive/components/extension-input.ts
coding-agent/src/modes/interactive/components/extension-selector.ts
coding-agent/src/modes/interactive/components/first-time-setup.ts
coding-agent/src/modes/interactive/components/footer.ts
coding-agent/src/modes/interactive/components/index.ts
coding-agent/src/modes/interactive/components/keybinding-hints.ts
coding-agent/src/modes/interactive/components/login-dialog.ts
coding-agent/src/modes/interactive/components/markdown-transform.ts
coding-agent/src/modes/interactive/components/mermaid.ts
coding-agent/src/modes/interactive/components/model-selector.ts
coding-agent/src/modes/interactive/components/oauth-selector.ts
coding-agent/src/modes/interactive/components/scoped-models-selector.ts
coding-agent/src/modes/interactive/components/session-selector-search.ts
coding-agent/src/modes/interactive/components/session-selector.ts
coding-agent/src/modes/interactive/components/settings-selector.ts
coding-agent/src/modes/interactive/components/settings-submenu.ts
coding-agent/src/modes/interactive/components/show-images-selector.ts
coding-agent/src/modes/interactive/components/skill-invocation-message.ts
coding-agent/src/modes/interactive/components/status-indicator.ts
coding-agent/src/modes/interactive/components/theme-selector.ts
coding-agent/src/modes/interactive/components/thinking-selector.ts
coding-agent/src/modes/interactive/components/tool-execution.ts
coding-agent/src/modes/interactive/components/tree-selector.ts
coding-agent/src/modes/interactive/components/trust-selector.ts
coding-agent/src/modes/interactive/components/user-message-selector.ts
coding-agent/src/modes/interactive/components/user-message.ts
coding-agent/src/modes/interactive/components/visual-truncate.ts
coding-agent/src/modes/interactive/external-editor.ts
coding-agent/src/modes/interactive/interactive-mode.ts
coding-agent/src/modes/interactive/model-catalog-refresh.ts
coding-agent/src/modes/interactive/model-search.ts
coding-agent/src/modes/interactive/session-share.ts
coding-agent/src/modes/interactive/theme/dark.json
coding-agent/src/modes/interactive/theme/light.json
coding-agent/src/modes/interactive/theme/theme-controller.ts
coding-agent/src/modes/interactive/theme/theme-json.ts
coding-agent/src/modes/interactive/theme/theme-schema.json
coding-agent/src/modes/interactive/theme/theme.ts
coding-agent/src/modes/interactive/tui-renderer.ts
coding-agent/src/modes/json-event.ts
coding-agent/src/modes/print-mode.ts
coding-agent/src/modes/rpc/jsonl.ts
coding-agent/src/modes/rpc/rpc-client.ts
coding-agent/src/modes/rpc/rpc-mode.ts
coding-agent/src/modes/rpc/rpc-types.ts
coding-agent/src/package-manager-cli.ts
coding-agent/src/rpc-entry.ts
coding-agent/src/utils/abort.ts
coding-agent/src/utils/ansi.ts
coding-agent/src/utils/changelog.ts
coding-agent/src/utils/child-process.ts
coding-agent/src/utils/clipboard-command.ts
coding-agent/src/utils/clipboard-image.ts
coding-agent/src/utils/clipboard.ts
coding-agent/src/utils/deprecation.ts
coding-agent/src/utils/exif-orientation.ts
coding-agent/src/utils/frontmatter.ts
coding-agent/src/utils/fs-watch.ts
coding-agent/src/utils/git.ts
coding-agent/src/utils/highlight-js.d.ts
coding-agent/src/utils/html.ts
coding-agent/src/utils/image-convert.ts
coding-agent/src/utils/image-process.ts
coding-agent/src/utils/image-resize-core.ts
coding-agent/src/utils/image-resize-worker.ts
coding-agent/src/utils/image-resize.ts
coding-agent/src/utils/json.ts
coding-agent/src/utils/management-http.ts
coding-agent/src/utils/mime.ts
coding-agent/src/utils/open-browser.ts
coding-agent/src/utils/paths.ts
coding-agent/src/utils/photon.ts
coding-agent/src/utils/pi-user-agent.ts
coding-agent/src/utils/shell.ts
coding-agent/src/utils/sleep.ts
coding-agent/src/utils/syntax-highlight.ts
coding-agent/src/utils/text.ts
coding-agent/src/utils/tool-result-images.ts
coding-agent/src/utils/tools-manager.ts
coding-agent/src/utils/version-check.ts
coding-agent/src/utils/windows-self-update.ts
coding-agent/src/utils/wsl.ts
coding-agent/src/utils/zip.ts
coding-agent/tsconfig.build.json
```

</details>
