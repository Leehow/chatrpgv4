export type RuntimeLayout = 'source' | 'compiled';
export interface RuntimeEntrypoints {
  readonly kernel: string; readonly kernelCheck: string; readonly host: string; readonly preparation: string;
  readonly check: string; readonly launch: string; readonly sourceWorker: string; readonly source: string;
  readonly onboardingWorker: string; readonly rpc: string; readonly agent: string; readonly readerContext: string;
  readonly readerPdf: string; readonly readerSubmit: string; readonly deepseek: string; readonly imageGen: string; readonly grokBuild: string;
  readonly characterGuidance: string; readonly characterPresentation: string; readonly documentPresentation: string;
  readonly extensions: readonly string[]; readonly hostAssets: string; readonly pi: string;
}
export interface RuntimeDeployment {
  readonly layout: 'compiled'; readonly backend: 'typescript'; readonly resourceRoot: string;
  readonly node: string; readonly git: string; readonly gitExec: string; readonly gitTemplates: string;
  readonly entrypoints: RuntimeEntrypoints;
}
export const COMPILED_ENTRIES: Readonly<Record<string, string>>;
export const HOST_MOUNTS: Readonly<Record<string, string>>;
export function resourcePath(root: string, value: string, kind?: 'file' | 'directory' | 'executable'): string;
export function assertWritableLocation(root: string, path: string): string;
export function resourceRootFrom(moduleUrl: string, env?: NodeJS.ProcessEnv): string;
export function runtimeEntrypoints(root: string, layout?: RuntimeLayout): RuntimeEntrypoints;
export function runtimeEntryUrl(name: keyof RuntimeEntrypoints, moduleUrl: string, env?: NodeJS.ProcessEnv): string;
export function readDeployment(root: string): RuntimeDeployment;
export function standaloneRuntime(resourcesPath: string): RuntimeDeployment;
export function compiledEnvironment(deployment: RuntimeDeployment, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
