import type { Weapon } from "./types";

export function weaponTitleText(weapon: Weapon): string {
  return weapon.label?.trim() || weapon.title_fallback_label?.trim() || "";
}

export function weaponMechanicsLine(weapon: Weapon): string {
  if (weaponMechanicsUnresolved(weapon)) {
    return "";
  }
  return [
    weapon.damage,
    weapon.skill_label,
    weapon.range !== undefined &&
    weapon.range !== null &&
    weapon.range !== "" &&
    weapon.range_label?.trim()
      ? `${weapon.range_label.trim()} ${weapon.range}`
      : "",
    weapon.ammo !== undefined &&
    weapon.ammo !== null &&
    weapon.ammo !== "" &&
    weapon.ammo_label?.trim()
      ? `${weapon.ammo_label.trim()} ${weapon.ammo}`
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

export function weaponMechanicsText(weapon: Weapon): string {
  return weaponMechanicsUnresolved(weapon)
    ? weapon.mechanics_status_label?.trim() ?? ""
    : weaponMechanicsLine(weapon);
}
