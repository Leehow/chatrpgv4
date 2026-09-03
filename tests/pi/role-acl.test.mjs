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

// RuleGraph cutover: the Keeper ends a session by settling
// decision:coc7:development:end-session through rules.settle; the old
// state.end_session write is host-private and must never surface.
const END_SESSION = "decision:coc7:development:end-session";
const RETIRED_TO_HOST = [
  ["coc_state", "state.end_session"],
  ["coc_rules", "rules.social_adjudicate"],
  ["coc_rules", "rules.roll"],
  ["coc_subsystem", "combat.resolve"],
];

test("play role ends before journal and then exposes ending closure tools", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const allowed = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "live_turn",
    });
    assert.equal(allowed.ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "pending_finalization",
    }).ok, false);
    assert.ok(
      mod.activeToolsForPhase("live_turn", "play").includes("coc_rules_settle"),
    );
    assert.ok(
      !mod.activeToolsForPhase("live_turn", "play").includes("coc_state_end_session"),
    );
    const ending = mod.inferPhaseFromEnvelope(
      "rules.settle",
      { ok: true, data: { decision_ref: END_SESSION, status: "settled", session_ending: true } },
      "live_turn",
    );
    assert.equal(ending, "ending");
    for (const tool of ["coc_state_journal", "coc_turn_finalize"]) {
      assert.ok(mod.activeToolsForPhase(ending, "play").includes(tool), tool);
    }
  });
});

test("retired legacy operations are host-private for every role", async () => {
  for (const role of ["setup", "play", undefined]) {
    await withRole(role, async () => {
      const mod = await loadDomain();
      for (const [toolName, operation] of RETIRED_TO_HOST) {
        const denied = mod.evaluateExecuteAcl({ toolName, operation, phase: "live_turn" });
        assert.equal(denied.ok, false, `${role} ${operation}`);
        assert.equal(denied.code, "host_private_operation", `${role} ${operation}`);
      }
    });
  }
});

test("a settled ending cannot start another end_session", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const denied = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "ending",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "phase_forbidden");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "ending",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "state.journal",
      phase: "ending",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.output_context",
      phase: "ending",
    }).ok, true);
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

test("play role requires a verified pre-journal binding before recovered acting", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    for (const operation of ["turn.output_context", "state.journal", "turn.finalize"]) {
      const denied = mod.evaluateExecuteAcl({
        toolName: "coc_turn",
        operation,
        phase: "recovery",
      });
      assert.equal(denied.ok, false, operation);
      assert.equal(denied.code, "recovery_authorization_required", operation);
    }
    const authorization = {
      kind: "open_turn_pre_journal",
      stage: "acting",
    };
    for (const operation of ["rules.context", "rules.settle"]) {
      const roll = mod.evaluateExecuteAcl({
        toolName: "coc_rules",
        operation,
        phase: "recovery",
        role: "play",
        recoveryAuthorization: authorization,
      });
      assert.equal(roll.ok, true, operation);
    }
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "state.journal",
      phase: "recovery",
      role: "play",
      recoveryAuthorization: authorization,
    }).ok, true);
    for (const operation of ["turn.output_context", "turn.finalize"]) {
      const denied = mod.evaluateExecuteAcl({
        toolName: "coc_turn",
        operation,
        phase: "recovery",
        role: "play",
        recoveryAuthorization: authorization,
      });
      assert.equal(denied.ok, false, operation);
      assert.equal(denied.code, "stage_forbidden", operation);
    }
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "live_turn",
    }).ok, true);
  });
});

test("play role allows rules.settle only after live_turn", async () => {
  await withRole("play", async () => {
    const mod = await loadDomain();
    const opening = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "opening",
    });
    assert.equal(opening.ok, false);
    assert.equal(opening.code, "phase_forbidden");
    const live = mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "live_turn",
    });
    assert.equal(live.ok, true);
    assert.equal(live.wrapper, "coc_rules");
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
    assert.ok(tools.includes("coc_rules_settle"));
    assert.ok(tools.includes("coc_rules_context"));
    assert.ok(!tools.includes("coc_rules_roll"));
    assert.ok(tools.includes("coc_turn_finalize"));
    assert.ok(tools.includes("coc_state_journal"));
    assert.ok(!tools.includes("coc_rules"));
    assert.ok(!tools.includes("coc_chargen_delegate"));
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "recovery",
    }).code, "recovery_authorization_required");
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_rules",
      operation: "rules.settle",
      phase: "live_turn",
    }).ok, true);
    assert.equal(mod.evaluateExecuteAcl({
      toolName: "coc_turn",
      operation: "turn.finalize",
      phase: "live_turn",
    }).ok, true);
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

test("a stale setup role in the environment is refused, not honoured", () => {
  // Onboarding is `pi-coc-setup`, its own process. A `setup` left in the
  // environment must not put the table back under the opening machine, so it
  // is treated as legacy-unset and says so.
  const probe = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "-e",
    [
      "const m = await import(process.argv[1]);",
      "console.log(JSON.stringify(m.sessionRoleFromEnv({ COC_PI_SESSION_ROLE: 'setup' })));",
    ].join("\n"),
    path.join(root, "plugins/coc-keeper/pi/lib/domain-tools.ts"),
  ], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), "null");
  assert.match(probe.stderr, /COC_PI_SESSION_ROLE=setup is retired/);
  assert.match(probe.stderr, /pi-coc-setup/);
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

test("restricted canonical skill-doc read stays active for every role", async () => {
  await withRole("setup", async () => {
    const mod = await loadDomain();
    for (const phase of [
      "cold_start", "opening", "live_turn", "recovery", "ending",
      "pending_finalization",
    ]) {
      assert.ok(
        mod.activeToolsForPhase(phase, "setup").includes("read"),
        `setup/${phase} must keep the restricted skill-doc read active`,
      );
    }
    // Only the path-restricted skill-doc read joins the surface; unrestricted
    // builtin filesystem tools stay out.
    const setupTools = mod.activeToolsForPhase("opening", "setup");
    assert.ok(!setupTools.includes("bash"));
    assert.ok(!setupTools.includes("edit"));
    assert.ok(!setupTools.includes("write"));
  });
  await withRole("play", async () => {
    const mod = await loadDomain();
    for (const phase of [
      "cold_start", "opening", "live_turn", "recovery", "ending",
      "pending_finalization",
    ]) {
      assert.ok(
        mod.activeToolsForPhase(phase, "play").includes("read"),
        `play/${phase} must keep the restricted skill-doc read active`,
      );
    }
    const playTools = mod.activeToolsForPhase("live_turn", "play");
    assert.ok(!playTools.includes("bash"));
    assert.ok(!playTools.includes("edit"));
    assert.ok(!playTools.includes("write"));
    // The startup-resume projection keeps it through the pending boundary.
    const startup = mod.activeToolsForStartupResumePending({
      workspaceRoot: root,
      campaignId: "skill-doc-read-startup",
      fallbackPhase: "live_turn",
      role: "play",
    });
    assert.ok(startup.includes("read"));
  });
});
