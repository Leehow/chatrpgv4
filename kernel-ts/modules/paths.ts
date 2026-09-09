import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
/** Python Path.resolve(strict=False), including existing symlink parents. */
export async function resolvedPath(path: string): Promise<string> {
    const absolute = resolve(path);
    try {
        return await realpath(absolute);
    }
    catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
            throw error;
        const parent = dirname(absolute);
        if (parent === absolute)
            throw error;
        return join(await resolvedPath(parent), basename(absolute));
    }
}
export function inside(root: string, path: string): boolean {
    const tail = relative(root, path);
    return tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail);
}
/** Pathlib joins retain an absolute right operand. */
export const childPath = (root: string, path: string): string => isAbsolute(path) ? path : join(root, path);
