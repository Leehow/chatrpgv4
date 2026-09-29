/**
 * Materialize the case board's map pixels at the player-host boundary (contract §39.4).
 *
 * The pack answers the board through the host bridge, whose body is capped at 4 MiB, so it hands each
 * rendered map over by the path of the PNG it stored under the campaign's `map-views/`, never inline.
 * Only a regular file inside that directory, after realpath, with a PNG signature and within the size
 * cap, becomes pixels; anything else leaves the row without them (`document: "none"`). No path reaches
 * the panel.
 */
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, join, relative, sep} from 'node:path';

type Row = Record<string, any>;
export type MapBinding = {home: string; campaign: string};

/** The renderer never stores more than this (`extensions/kernel/map-view.ts`); a larger file is not one of its cards. */
const MAX_MAP_BYTES = 8 * 1024 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const segment = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const inside = (base: string, file: string) => {
	const part = relative(base, file);
	return !!part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
};

/** The data URL for one stored map PNG of this campaign, or undefined when it is not one. */
export function mapImage(path: unknown, binding?: MapBinding): string | undefined {
	if (!binding || typeof binding.home !== 'string' || !isAbsolute(binding.home) || !segment(binding.campaign)
		|| typeof path !== 'string' || !isAbsolute(path)) return;
	try {
		const views = realpathSync(join(binding.home, '.coc', 'campaigns', binding.campaign, 'map-views'));
		const file = realpathSync(path), stat = statSync(file);
		if (!inside(views, file) || !stat.isFile() || stat.size > MAX_MAP_BYTES) return;
		const bytes = readFileSync(file);
		if (!bytes.subarray(0, 8).equals(PNG)) return;
		return `data:image/png;base64,${bytes.toString('base64')}`;
	} catch { return; }
}

/** The board's map rows with each stored picture read back, and every host path removed. */
export function withMapImages(maps: unknown, binding?: MapBinding): unknown {
	if (!Array.isArray(maps)) return maps;
	return maps.map((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		// A row that arrives with bytes of its own is not trusted to carry them: only the stored file is.
		const {image: _forged, image_path, level_images, ...row} = value as Row;
		const image = mapImage(image_path, binding);
		const levels = Array.isArray(level_images) ? level_images.flatMap((level: Row) => {
			const picture = level && typeof level.level === 'string' ? mapImage(level.image_path, binding) : undefined;
			return picture ? [{level: level.level, image: picture}] : [];
		}) : [];
		if (!image) return {...row, document: 'none'};
		return {...row, image, ...(levels.length ? {level_images: levels} : {})};
	});
}
