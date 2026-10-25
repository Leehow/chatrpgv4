/**
 * §269.2: the papers within reach this turn and who holds each, so a Keeper showing or handing one over reads where it
 * is instead of inferring it (1025c Dust to Dust T15: a letter shown to an officer was refused out of reach three times).
 */
import { rootObjectOwner } from "./object-owner.js";
import { array, row, string, type Row } from "./values.js";

export function documentsInReach(world: Row, presentHandles: readonly string[]): Row[] {
    const instances = Object.values(row(row(world.objects).instances)).map(row), surfaces = row(world.document_surfaces);
    const rows: Row[] = [];
    for (const item of instances) {
        if (!item.document || typeof item.name !== "string") continue;
        let root: Row;
        try { root = rootObjectOwner(world, item); } catch { continue; }
        const reach = root.kind === "investigator" ? "investigator"
            : root.kind === "scene" && root.id === world.active_scene ? "here"
            : root.kind === "npc" && presentHandles.includes(string(root.id)) ? "present_person" : null;
        if (!reach) continue;
        const surface = row(surfaces[string(item.id)]);
        rows.push({ name: item.name, holder: string(row(item.owner).name || root.id), reach,
            ...(surface.open === true ? { open: true } : {}), ...(array(surface.shown_to).length ? { shown_to: array(surface.shown_to).length } : {}) });
    }
    return rows.slice(-12);
}
