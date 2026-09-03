# Vendored: pi's shipped `subagent` example extension

Copied verbatim from
`@earendil-works/pi-coding-agent@0.84.2`
`examples/extensions/subagent/` on 2026-09-02.

## Why this is here rather than referenced in place

`subagent` is not a Pi builtin, and `pi-coc` launches with
`--no-builtin-tools`. Without this extension the tool does not exist, and the
opening source coordinator — the only thing that advances
`opening_source_review_required` — cannot be dispatched at all. Pointing an
agent-home `extensions` entry at the copy inside `node_modules/.../examples/`
works exactly once: the path is absolute, untracked, worktree-specific, and
`npm ci` deletes it.

The repository already owns Pi extensions it depends on
(`web/server-node/pi-extensions/*`, passed with `--extension`). This follows
that pattern.

## What it does NOT honour

This is the important part. The example reads four agent frontmatter fields:

    name, model, tools, systemPrompt

The agent definitions in this repository declare far more. The Pi stewards
(`plugins/coc-keeper/pi/agents/steward-*.md`) add `inheritProjectContext`,
`inheritSkills` and `maxSubagentDepth`; the Codex-side coordinators
(`plugins/coc-keeper/agents/*.md`) add `capabilityMode`, `permissionMode`,
`injectDefaultTools`, `disallowedTools`, `mcpInheritance`, `turnBudget`,
`agents_md`, `discoverSkills`, `skills`, `async`, `effort` and more.

**Every one of those is silently ignored here.** A subagent spawned through
this extension runs on defaults, not on what its definition claims. That is a
declared-guarantee-with-no-consumer, the same shape as the projection gaps
this branch has been fixing, and it matters most for the permission and
capability fields.

Two honest ways forward, neither taken here:

- grow this vendored copy to honour the fields the repository's own agents
  declare, or
- delete the fields that nothing enforces, so no definition claims a
  guarantee that does not exist.

Note also that the coordinators under `plugins/coc-keeper/agents/` describe
themselves as Codex-only (`adapter_mode: codex_context_free_inline_source`,
`CODEX_HOME`). Whether dispatching them through Pi's subagent is right at all
is a design question, not a packaging one.
