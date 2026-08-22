import type { Weapon } from "./types";

interface WeaponChrome {
  unavailable: string;
  range: string;
  ammo: string;
}

const WEAPON_CHROME: Record<string, WeaponChrome> = {
  "zh-Hans": { unavailable: "武器参数未配置", range: "射程", ammo: "弹药" },
  zh: { unavailable: "武器参数未配置", range: "射程", ammo: "弹药" },
  "ja-JP": { unavailable: "武器データ未設定", range: "射程", ammo: "弾薬" },
  "en-US": { unavailable: "Weapon mechanics unavailable", range: "Range", ammo: "Ammo" },
  en: { unavailable: "Weapon mechanics unavailable", range: "Range", ammo: "Ammo" },
};

function weaponChrome(playLanguage?: string | null): WeaponChrome {
  return WEAPON_CHROME[playLanguage || "zh-Hans"] ?? WEAPON_CHROME["en-US"];
}

export function weaponMechanicsUnavailableLabel(playLanguage?: string | null): string {
  return weaponChrome(playLanguage).unavailable;
}

export function weaponMechanicsLine(
  weapon: Weapon,
  playLanguage?: string | null,
): string {
  if (
    weapon.mechanics_available === false ||
    weapon.params_source === "unresolved"
  ) {
    return "";
  }
  const chrome = weaponChrome(playLanguage);
  return [
    weapon.damage,
    weapon.skill_label,
    weapon.range !== undefined && weapon.range !== null && weapon.range !== ""
      ? `${chrome.range} ${weapon.range}`
      : "",
    weapon.ammo !== undefined && weapon.ammo !== null && weapon.ammo !== ""
      ? `${chrome.ammo} ${weapon.ammo}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function weaponMechanicsUnresolved(weapon: Weapon): boolean {
  return (
    weapon.mechanics_available === false ||
    weapon.params_source === "unresolved"
  );
}

export function weaponMechanicsText(
  weapon: Weapon,
  playLanguage?: string | null,
): string {
  return weaponMechanicsUnresolved(weapon)
    ? weaponMechanicsUnavailableLabel(playLanguage)
    : weaponMechanicsLine(weapon, playLanguage);
}
