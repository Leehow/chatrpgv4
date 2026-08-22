import test from "node:test";
import assert from "node:assert/strict";

import {
  weaponMechanicsLine,
  weaponMechanicsText,
} from "./panel-weapons.ts";

test("unresolved weapons consume only a backend-projected localized status", () => {
  const weapon = {
    label: "铁锹",
    params_source: "unresolved",
    mechanics_available: false,
    mechanics_status_label: "武器参数未配置",
  };

  assert.equal(weaponMechanicsLine(weapon), "");
  assert.equal(weaponMechanicsText(weapon), "武器参数未配置");
  assert.equal(
    weaponMechanicsText({ ...weapon, mechanics_status_label: undefined }),
    "",
  );
});

test("authoritative weapon mechanics retain their exact display values", () => {
  assert.equal(
    weaponMechanicsLine({
      label: ".45 左轮",
      damage: "1D10+2",
      skill_label: "射击（手枪）",
      range: 15,
      range_label: "射程",
      ammo: 6,
      ammo_label: "弹药",
      params_source: "ruleset_catalog",
      mechanics_available: true,
    }),
    "1D10+2 · 射击（手枪） · 射程 15 · 弹药 6",
  );
  assert.equal(
    weaponMechanicsLine({
      label: ".45 revolver",
      damage: "1D10+2",
      skill_label: "Firearms (Handgun)",
      range: 15,
      range_label: "Range",
      ammo: 6,
      ammo_label: "Ammo",
      params_source: "ruleset_catalog",
      mechanics_available: true,
    }),
    "1D10+2 · Firearms (Handgun) · Range 15 · Ammo 6",
  );
  assert.equal(
    weaponMechanicsLine({
      label: ".45 revolver",
      damage: "1D10+2",
      skill_label: "Firearms (Handgun)",
      range: 15,
      ammo: 6,
      params_source: "ruleset_catalog",
      mechanics_available: true,
    }),
    "1D10+2 · Firearms (Handgun)",
  );
});
