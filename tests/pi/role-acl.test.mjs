#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.cwd());
const ENV = "COC_PI_SESSION_ROLE";
const domainUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
).href;

async function loadDomain() {
  return import(`${domainUrl}?t=${Date.now()}-${Math.random()}`);
}

function withRole(role, fn) {
  const prev = process.env[ENV];
  if (role === undefined) delete process.env[ENV];
  else process.env[ENV] = role;
  const restore = () => {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  };
  return Promise.resolve()
    .then(fn)
    .finally(restore);
}

test("setup role rejects turn.finalize", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    const denied = mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "pending_finalization",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "role_forbidden");
  });
});

test("play role rejects setup.complete", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const denied = mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation: "setup.complete",
      phase: "opening",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "role_forbidden");
  });
});

test("play role allows session.resume", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation: "session.resume",
      phase: "live_turn",
    });
    assert.equal(allowed.ok, true);
  });
});

test("play role ends before journal and then exposes ending closure tools", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_state",
      operation: "state.end_session",
      phase: "live_turn",
    });
    assert.equal(allowed.ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_state",
      operation: "state.end_session",
      phase: "pending_finalization",
    }).ok, false);
    assert.ok(
      mod.activeToolsForPhase("live_turn", "play").includes("coc_state_end_session"),
    );
  });
});

test("a settled ending cannot start another end_session", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const denied = mod.evaluateExecuteAcl({
      toolName: "coc_state",
      operation: "state.end_session",
      phase: "ending",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "phase_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "ending",
    }).ok, false);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "state.journal",
      phase: "ending",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.output_context",
      phase: "ending",
    }).ok, false);
  });
});

test("setup role allows chargen rules.roll_dice", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll_dice",
      phase: "cold_start",
    });
    assert.equal(allowed.ok, true);
  });
});

test("play role still allows rules.roll_dice", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll_dice",
      phase: "live_turn",
    });
    assert.equal(allowed.ok, true);
  });
});

test("setup role does not gain recovery closure rights", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    for (const operation of ["turn.output_context", "state.journal", "turn.finalize"]) {
      const denied = mod.evaluateExecuteAcl({
        toolName: "coc_turn",
        operation,
        phase: "recovery",
      });
      assert.equal(denied.ok, false, operation);
      assert.equal(denied.code, "role_forbidden", operation);
    }
    const resume = mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation: "session.resume",
      phase: "recovery",
    });
    assert.equal(resume.ok, true);
  });
});

test("play role may close an open recovery turn but not reroll", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    for (const operation of ["turn.output_context", "state.journal", "turn.finalize"]) {
      const allowed = mod.evaluateExecuteAcl({
        toolName: "coc_turn",
        operation,
        phase: "recovery",
      });
      assert.equal(allowed.ok, true, operation);
    }
    const roll = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll",
      phase: "recovery",
    });
    assert.equal(roll.ok, false);
    assert.equal(roll.code, "phase_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll",
      phase: "live_turn",
    }).ok, true);
  });
});

test("play role allows social_adjudicate only after live_turn", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const opening = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.social_adjudicate",
      phase: "opening",
    });
    assert.equal(opening.ok, false);
    assert.equal(opening.code, "phase_forbidden");
    const live = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.social_adjudicate",
      phase: "live_turn",
    });
    assert.equal(live.ok, true);
    assert.equal(live.wrapper, "coc_rules");
  });
});

test("setup role still rejects live-turn social_adjudicate", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    const denied = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.social_adjudicate",
      phase: "live_turn",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "role_forbidden");
  });
});

test("setup role startup union does not grant play-only execute rights", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    const tools = mod.activeToolsForStartupResumePending({
      workspaceRoot: root,
      campaignId: "setup-no-expansion",
      fallbackPhase: "live_turn",
      role: "setup",
    });
    assert.ok(tools.includes("coc_session_resume"));
    assert.ok(tools.includes("coc_chargen_delegate"));
    assert.ok(!tools.includes("coc_setup"));
    assert.ok(!tools.includes("coc_npc"));
    assert.ok(!tools.includes("coc_npc_reaction"));
    assert.ok(!tools.includes("coc_subsystem"));
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "live_turn",
    }).code, "phase_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll",
      phase: "live_turn",
    }).code, "role_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "state.journal",
      phase: "live_turn",
    }).code, "role_forbidden");
  });
});

test("play role startup union keeps live tools and pending non-resume is forbidden", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const tools = mod.activeToolsForStartupResumePending({
      workspaceRoot: root,
      campaignId: "play-startup-union",
      fallbackPhase: "live_turn",
      role: "play",
    });
    assert.ok(tools.includes("coc_session_resume"));
    assert.ok(tools.includes("coc_rules_roll"));
    assert.ok(tools.includes("coc_turn_finalize"));
    assert.ok(tools.includes("coc_state_journal"));
    assert.ok(!tools.includes("coc_rules"));
    assert.ok(!tools.includes("coc_chargen_delegate"));
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll",
      phase: "recovery",
    }).code, "phase_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.roll",
      phase: "live_turn",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "live_turn",
    }).ok, false);
  });
});

test("setup role rejects turn.finalize and combat.resolve", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    const finalize = mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "pending_finalization",
    });
    assert.equal(finalize.ok, false);
    assert.equal(finalize.code, "role_forbidden");
    const combat = mod.evaluateExecuteAcl({
      toolName: "coc_subsystem",
      operation: "combat.resolve",
      phase: "live_turn",
    });
    assert.equal(combat.ok, false);
    assert.equal(combat.code, "role_forbidden");
  });
});

test("unset role env is legacy allow-all (phase still applies)", async () => {
  await withRole(undefined, async () => {
    const mod = await loadDomain();
    assert.equal(mod.sessionRoleFromEnv(), null);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "pending_finalization",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation: "setup.complete",
      phase: "opening",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_setup",
      operation: "session.resume",
      phase: "live_turn",
    }).ok, true);
  });
});

test("invalid role env is treated as unset and warns", () => {
  const script = `
    process.env.${ENV} = "kp";
    const mod = await import(${JSON.stringify(domainUrl)});
    if (mod.sessionRoleFromEnv() !== null) {
      console.error("expected null role");
      process.exit(2);
    }
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "pending_finalization",
    });
    if (!allowed.ok) {
      console.error("expected legacy allow");
      process.exit(3);
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8", cwd: root, env: { ...process.env, [ENV]: "kp" } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /COC_PI_SESSION_ROLE/);
  assert.match(result.stderr, /legacy/);
});

test("setup and unset role expose coc_chargen_delegate; play does not", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    assert.ok(
      mod.activeToolsForPhase("recovery", "setup").includes("coc_chargen_delegate"),
    );
    assert.ok(
      mod.activeToolsForPhase("opening", null).includes("coc_chargen_delegate"),
    );
    assert.ok(
      !mod.activeToolsForPhase("live_turn", "play").includes("coc_chargen_delegate"),
    );
  });
});
