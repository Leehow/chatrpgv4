#!/usr/bin/env node
/**
 * Structured access contract for the path-restricted canonical skill-doc
 * `read` (plugins/coc-keeper/pi/lib/skill-doc-read.ts). Proves the live
 * Pi-Coc KP can actually load role SKILL.md bodies and routed references,
 * and that everything else — setup-only skills under the play role,
 * arbitrary repository/campaign paths, scripts, and symlink escapes —
 * fails closed. This is a gate test, not a prose-behavior test.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(process.cwd());
const modUrl = pathToFileURL(
  path.join(root, "plugins/coc-keeper/pi/lib/skill-doc-read.ts"),
).href;
const ENV = "COC_PI_SESSION_ROLE";
const PROFILE_ENV = "COC_PI_ACCEPTANCE_PROFILE";

async function loadMod() {
  return import(`${modUrl}?t=${Date.now()}-${Math.random()}`);
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

const PLAY_SKILL_MD = path.join(
  root, "plugins/coc-keeper/skills/coc-keeper-play/SKILL.md",
);
const PLAY_STYLE_REFERENCE = path.join(
  root, "plugins/coc-keeper/skills/coc-keeper-play/references/style-scene-craft.md",
);
const SETUP_ONLY_SKILL_MD = path.join(
  root, "plugins/coc-keeper/rulesets/coc7/skills/coc-character/SKILL.md",
);
const MAIN_SKILL_MD = path.join(
  root, "plugins/coc-keeper/skills/coc-main/SKILL.md",
);
const DIRECTOR_SKILL_MD = path.join(
  root, "plugins/coc-keeper/skills/coc-story-director/SKILL.md",
);
const RULES_SKILL_MD = path.join(
  root, "plugins/coc-keeper/rulesets/coc7/skills/coc-rules-engine/SKILL.md",
);
const COMBAT_SKILL_MD = path.join(
  root, "plugins/coc-keeper/rulesets/coc7/skills/coc-combat/SKILL.md",
);
const EXPORT_SCRIPT = path.join(
  root, "plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py",
);

async function readWithRole(role, params) {
  const mod = await loadMod();
  const allowedRoots = mod.skillDocAllowedRoots(role);
  return mod.executeSkillDocRead(params, { allowedRoots, cwd: root });
}

test("play role can read the play SKILL.md body", async () => {
  await withRole("play", async () => {
    const out = await readWithRole("play", { path: PLAY_SKILL_MD });
    const text = out.content[0].text;
    assert.match(text, /name: coc-keeper-play/);
    assert.match(text, /# COC Keeper Play/);
  });
});

test("play role can read the routed style-scene-craft.md reference (absolute and skill-relative)", async () => {
  await withRole("play", async () => {
    const absolute = await readWithRole("play", { path: PLAY_STYLE_REFERENCE });
    assert.match(absolute.content[0].text, /Scene Craft/);
    const relative = await readWithRole("play", {
      path: "references/style-scene-craft.md",
    });
    assert.match(relative.content[0].text, /Scene Craft/);
  });
});

test("setup-only skill document is denied under the play role", async () => {
  await withRole("play", async () => {
    await assert.rejects(
      () => readWithRole("play", { path: SETUP_ONLY_SKILL_MD }),
      /access denied/,
    );
  });
});

test("rules-director profile exposes only its focused play skill roots", async () => {
  const prior = process.env[PROFILE_ENV];
  process.env[PROFILE_ENV] = "rules-director-single-draft";
  try {
    await withRole("play", async () => {
      for (const allowed of [PLAY_SKILL_MD, DIRECTOR_SKILL_MD, RULES_SKILL_MD]) {
        const out = await readWithRole("play", { path: allowed });
        assert.ok(out.content[0].text.length > 0, allowed);
      }
      for (const denied of [MAIN_SKILL_MD, COMBAT_SKILL_MD]) {
        await assert.rejects(
          () => readWithRole("play", { path: denied }),
          /access denied/,
          denied,
        );
      }
    });
  } finally {
    if (prior === undefined) delete process.env[PROFILE_ENV];
    else process.env[PROFILE_ENV] = prior;
  }
});

test("arbitrary repository and campaign paths are denied", async () => {
  await withRole("play", async () => {
    for (const denied of [
      path.join(root, "package.json"),
      path.join(root, "AGENTS.md"),
      path.join(root, "plugins/coc-keeper/pi/session-roles.json"),
    ]) {
      await assert.rejects(
        () => readWithRole("play", { path: denied }),
        /access denied/,
        denied,
      );
    }
    const workspace = mkdtempSync(path.join(tmpdir(), "skill-doc-read-campaign-"));
    try {
      const campaignFile = path.join(
        workspace, ".coc", "campaigns", "gate-probe", "campaign.json",
      );
      mkdirSync(path.dirname(campaignFile), { recursive: true });
      writeFileSync(campaignFile, "{}\n");
      await assert.rejects(
        () => readWithRole("play", { path: campaignFile }),
        /access denied/,
      );
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

test("script files under an allowed skill directory stay denied", async () => {
  await withRole("play", async () => {
    await assert.rejects(
      () => readWithRole("play", { path: EXPORT_SCRIPT }),
      /not regular text documentation/,
    );
  });
});

test("symlink escape out of an allowed root is denied", async () => {
  const mod = await loadMod();
  const allowedRoot = mkdtempSync(path.join(tmpdir(), "skill-doc-read-root-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "skill-doc-read-out-"));
  try {
    mkdirSync(path.join(allowedRoot, "references"), { recursive: true });
    const inside = path.join(allowedRoot, "references", "inside.md");
    writeFileSync(inside, "# inside\n");
    const secret = path.join(outsideRoot, "secret.md");
    writeFileSync(secret, "# secret\n");
    const escape = path.join(allowedRoot, "references", "escape.md");
    symlinkSync(secret, escape);
    const opts = { allowedRoots: [allowedRoot], cwd: allowedRoot };
    const ok = await mod.executeSkillDocRead({ path: inside }, opts);
    assert.match(ok.content[0].text, /# inside/);
    await assert.rejects(
      () => mod.executeSkillDocRead({ path: escape }, opts),
      /access denied/,
    );
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(allowedRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("offset and limit bound the output with continuation guidance", async () => {
  await withRole("play", async () => {
    const limited = await readWithRole("play", {
      path: PLAY_SKILL_MD, offset: 1, limit: 5,
    });
    const body = limited.content[0].text.split("\n\n[")[0];
    assert.equal(body.split("\n").length, 5);
    assert.doesNotMatch(body, /# COC Keeper Play/);
    assert.match(limited.content[0].text, /more lines in file\. Use offset=6 to continue\./);
    assert.ok(limited.details && limited.details.truncation);
    const continued = await readWithRole("play", {
      path: PLAY_SKILL_MD, offset: 6, limit: 2,
    });
    assert.match(continued.content[0].text, /# COC Keeper Play/);
    await assert.rejects(
      () => readWithRole("play", { path: PLAY_SKILL_MD, offset: 100000 }),
      /beyond end of file/,
    );
  });
});

test("registration never overrides an existing active read and is shape-compatible with Pi read", async () => {
  const mod = await loadMod();
  const registered = [];
  const registeringPi = {
    getActiveTools: () => [],
    registerTool: (tool) => registered.push(tool),
  };
  assert.equal(mod.registerSkillDocRead(registeringPi), true);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "read");
  assert.equal(registered[0].parameters.properties.path.type, "string");
  assert.equal(registered[0].parameters.properties.offset.type, "number");
  assert.equal(registered[0].parameters.properties.limit.type, "number");
  assert.deepEqual(registered[0].parameters.required, ["path"]);
  assert.ok(registered[0].promptSnippet.length > 0);
  assert.ok(registered[0].promptGuidelines.length >= 2);
  const builtinPi = {
    getActiveTools: () => ["read", "bash", "edit", "write"],
    registerTool: (tool) => registered.push(tool),
  };
  assert.equal(mod.registerSkillDocRead(builtinPi), false);
  assert.equal(registered.length, 1);
  const unboundPi = {
    getActiveTools: () => {
      throw new Error("Extension runtime not initialized");
    },
    registerTool: (tool) => registered.push(tool),
  };
  assert.equal(mod.registerSkillDocRead(unboundPi), false);
  assert.equal(registered.length, 1);
});
