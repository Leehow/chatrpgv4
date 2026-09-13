/** Host checks for source-backed map regions at publication. Semantic geography stays with the reader and reviewer. */
import { validateBox } from "./source.ts";

type Row = Record<string, any>;

export function assetAliases(id: string): string[] {
	if (typeof id !== "string" || !id) return [];
	return id.startsWith("asset-") ? [id, id.slice("asset-".length)] : [id];
}

export function resolveDraftAsset(nodes: Row[], name: string): Row | undefined {
	if (typeof name !== "string" || !name.trim()) return undefined;
	return nodes.find(node => node.node_kind === "asset" && assetAliases(node.node_id).includes(name.trim()));
}

function boxKey(value: unknown): string {
	return JSON.stringify(validateBox(Array.isArray(value) ? value as number[] : [0, 0, 1, 1]));
}

export function privateMapSourceIds(draft: Row): Set<string> {
	const nodes: Row[] = draft.nodes ?? [];
	const ids = new Set<string>();
	for (const map of nodes) {
		for (const region of map.properties?.map_regions ?? []) {
			if (region?.safe_after_redactions !== true || !Array.isArray(region.redactions) || !region.redactions.length) continue;
			const source = resolveDraftAsset(nodes, region.source_asset);
			if (source) ids.add(source.node_id);
		}
	}
	return ids;
}

export function validateMapRegions(draft: Row): void {
	const nodes: Row[] = draft.nodes ?? [];
	for (const node of nodes) {
		const regions = node.properties?.map_regions;
		if (regions == null) continue;
		if (!["asset", "handout"].includes(node.node_kind) || !Array.isArray(regions) || !regions.length)
			throw new Error("map_regions belongs to an asset or handout and must not be empty");
		const ids = new Set<string>();
		const boxesBySource = new Map<string, Set<string>>();
		for (const region of regions) {
			const id = typeof region?.region_id === "string" ? region.region_id.trim() : "";
			if (!id || ids.has(id)) throw new Error("map regions need unique semantic region_id values");
			ids.add(id);
			if (typeof region.name !== "string" || !region.name.trim())
				throw new Error(`map region ${id} needs a name`);
			const source = resolveDraftAsset(nodes, region.source_asset);
			if (!source) throw new Error(`map region ${id} source_asset must name an asset node`);
			const sourceBox = boxKey(region.source_box);
			if (!Array.isArray(region.placement)) throw new Error(`map region ${id} needs placement`);
			validateBox(region.placement);
			for (const [index, mask] of (Array.isArray(region.redactions) ? region.redactions : []).entries())
				validateBox(mask);
			const privateSource = !["player-safe", "revealable"].includes(source.visibility);
			if (privateSource && !(region.safe_after_redactions === true && Array.isArray(region.redactions) && region.redactions.length))
				throw new Error(`map region ${id} uses a private source without reviewed redactions`);
			const seen = boxesBySource.get(source.node_id) ?? new Set<string>();
			if (seen.has(sourceBox))
				throw new Error("map regions on the same source need distinct source_box values to be independently revealable");
			seen.add(sourceBox);
			boxesBySource.set(source.node_id, seen);
		}
	}
}

export function publishableAssetNodes(draft: Row, purpose: string): Row[] {
	const nodes: Row[] = draft.nodes ?? [];
	const ready = new Set(draft.ready_nodes ?? []);
	const privateIds = privateMapSourceIds(draft);
	const neededPrivate = new Set<string>();
	for (const map of nodes) {
		if (purpose === "opening" && !ready.has(map.node_id)) continue;
		for (const region of map.properties?.map_regions ?? []) {
			const source = resolveDraftAsset(nodes, region.source_asset);
			if (source && privateIds.has(source.node_id)) neededPrivate.add(source.node_id);
		}
	}
	const published: Row[] = [];
	for (const node of nodes) {
		if (!["handout", "asset"].includes(node.node_kind)) continue;
		if (purpose === "opening" && !ready.has(node.node_id) && !neededPrivate.has(node.node_id)) continue;
		const privateMapSource = node.node_kind === "asset" && privateIds.has(node.node_id);
		if (!privateMapSource && !["player-safe", "revealable"].includes(node.visibility)) continue;
		if (!node.properties?.image_sources?.length) continue;
		published.push(node);
	}
	return published;
}

export function draftHasMapRegions(draft: Row): boolean {
	return (draft.nodes ?? []).some((node: Row) => Array.isArray(node.properties?.map_regions) && node.properties.map_regions.length);
}
