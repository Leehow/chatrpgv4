export type ImageModelOption = { provider: string; id: string; name?: string };
export function isImageModelId(modelId: unknown): boolean;
export function imageModelOptions(models: readonly ImageModelOption[], providers: Iterable<string>): ImageModelOption[];
export function automaticImageModel(selected: { provider?: string; id?: string } | null | undefined, options: readonly ImageModelOption[]): string | undefined;
