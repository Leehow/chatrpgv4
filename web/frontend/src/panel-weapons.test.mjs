import test from "node:test";
import assert from "node:assert/strict";

import {
  weaponMechanicsLine,
  weaponMechanicsText,
  weaponMechanicsUnavailableLabel,
} from "./panel-weapons.ts";

test("unresolved weapons render a neutral localized status instead of mechanics", () => {
  const weapon = {
    label: "铁锹",
    params_source: "unresolved",
    mechanics_available: false,
  };

  assert.equal(weaponMechanicsLine(weapon), "");
  assert.equal(weaponMechanicsUnavailableLabel("zh-Hans"), "武器参数未配置");
  assert.equal(weaponMechanicsUnavailableLabel("ja-JP"), "武器データ未設定");
  assert.equal(weaponMechanicsUnavailableLabel("en-US"), "Weapon mechanics unavailable");
  assert.equal(weaponMechanicsUnavailableLabel("de-DE"), "Weapon mechanics unavailable");
  assert.equal(weaponMechanicsText(weapon, "zh-Hans"), "武器参数未配置");
  assert.equal(weaponMechanicsText(weapon, "en-US"), "Weapon mechanics unavailable");
});

test("authoritative weapon mechanics retain their exact display values", () => {
  assert.equal(
    weaponMechanicsLine({
      label: ".45 左轮",
      damage: "1D10+2",
      skill_label: "射击（手枪）",
      range: 15,
      ammo: 6,
      params_source: "ruleset_catalog",
      mechanics_available: true,
    }),
    "1D10+2 · 射击（手枪） · 射程 15 · 弹药 6",
  );
  assert.equal(
    weaponMechanicsLine(
      {
        label: ".45 revolver",
        damage: "1D10+2",
        skill_label: "Firearms (Handgun)",
        range: 15,
        ammo: 6,
        params_source: "ruleset_catalog",
        mechanics_available: true,
      },
      "en-US",
    ),
    "1D10+2 · Firearms (Handgun) · Range 15 · Ammo 6",
  );
});
