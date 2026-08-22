import type { Weapon } from "./types";

interface WeaponChrome {
  range: string;
  ammo: string;
}

const WEAPON_CHROME: Record<string, WeaponChrome> = {
  "zh-Hans": { range: "射程", ammo: "弹药" },
  zh: { range: "射程", ammo: "弹药" },
  "ja-JP": { range: "射程", ammo: "弾薬" },
  "en-US": { range: "Range", ammo: "Ammo" },
  en: { range: "Range", ammo: "Ammo" },
};

function weaponChrome(playLanguage?: string | null): WeaponChrome {
  return WEAPON_CHROME[playLanguage || "zh-Hans"] ?? WEAPON_CHROME["en-US"];
}

export function weaponMechanicsLine(
  weapon: Weapon,
  playLanguage?: string | null,
): string {
  if (weaponMechanicsUnresolved(weapon)) {
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
    ? weapon.mechanics_status_label?.trim() ?? ""
    : weaponMechanicsLine(weapon, playLanguage);
}
