/** Who holds an object instance at the root of its containers: the one ownership read (§26 objects, §180.9's chain). */
import { RpcError } from "../errors.js";
import { row, type Row } from "./values.js";

export function rootObjectOwner(world: Row, item: Row): Row {
    const instances = row(row(world.objects).instances), seen = new Set<string>();
    let owner = item.owner;
    while (owner.kind === 'object') {
        if (seen.has(owner.id) || !instances[owner.id]) throw new RpcError("invalid_params", 'Document ownership is cyclic or incomplete');
        seen.add(owner.id); owner = instances[owner.id].owner;
    }
    return owner;
}
