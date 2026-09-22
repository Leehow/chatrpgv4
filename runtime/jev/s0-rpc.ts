/** Public Pi SDK/RPC factory for the opt-in source-only S0 probe. Legacy CLI remains default. */
import { readFileSync, realpathSync } from 'node:fs';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { createS0HostAdapter } from './host-session-adapter.ts';
import { createS0Decider } from './s0-decision.ts';
import { createTaskHostAdapter, taskDeadlineMs } from './task-host-session.ts';
import { createDecisionAdapter } from './decision-adapter.ts';
import { readJevApiKey } from '../../extensions/jev/agent/config.js';

interface S0Launch { cwd: string; args: string[]; env: Record<string, string | undefined> }
export async function startS0Rpc(launch: S0Launch): Promise<never> {
  if (launch.env.PI_COC_LAYOUT !== 'source' || launch.env.PI_COC_MODE !== 'play')
    throw new Error('S0 is restricted to source-mode play RPC');
  const { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, runRpcMode,
    SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const args = launch.args.slice(1);
  const extensions: string[] = [];
  let promptFile: string | undefined, noSession = false, sessionFile: string | undefined, sessionId: string | undefined, rpc = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--no-builtin-tools', '--no-context-files', '--no-extensions'].includes(arg)) continue;
    if (arg === '--no-session') { noSession = true; continue; }
    if (['--system-prompt', '--extension', '-e', '--session', '--session-id', '--mode'].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`S0 missing value for ${arg}`);
      if (arg === '--system-prompt') promptFile = value;
      else if (arg === '--extension' || arg === '-e') extensions.push(value);
      else if (arg === '--session') sessionFile = value;
      else if (arg === '--session-id') sessionId = value;
      else if (arg === '--mode') rpc = value === 'rpc';
      continue;
    }
    throw new Error(`S0 does not support launcher option ${arg}`);
  }
  if (!rpc || !promptFile) throw new Error('S0 requires the existing RPC launcher and Keeper prompt');
  const agentDir = launch.env.PI_CODING_AGENT_DIR;
  if (!agentDir) throw new Error('S0 requires the project-bound Pi home');
  // The extension code uses the same captured source launch environment as the stock subprocess.
  for (const key of ['PI_COC_HOME', 'PI_CODING_AGENT_DIR', 'PI_COC_CAMPAIGN', 'PI_COC_MODE', 'PI_GROK_BUILD_IMAGE_TOOLS', 'PI_COC_JEV_MEMORY']) {
    if (launch.env[key] !== undefined) process.env[key] = launch.env[key];
  }
  const decide = createS0Decider(readJevApiKey(launch.env) ?? '');
  const taskMode = launch.env.PI_COC_TASK_RUNTIME === '1';
  const fixedPrompt = readFileSync(promptFile, 'utf8');
  const canonicalCwd = realpathSync(launch.cwd);
  // Let the public SessionManager retain Pi's encoded per-workspace directory by default.
  const sessionDir = SettingsManager.create(launch.cwd, agentDir).getSessionDir();
  if (sessionId && sessionFile) throw new Error('S0 cannot combine --session and --session-id');
  const existing = !noSession && sessionId ? (await SessionManager.list(launch.cwd, sessionDir)).find(row => row.id === sessionId) : undefined;
  const initialManager = noSession ? SessionManager.inMemory(launch.cwd, { id: sessionId })
    : sessionFile || existing ? SessionManager.open(sessionFile ?? existing!.path, sessionDir)
    : SessionManager.create(launch.cwd, sessionDir, { id: sessionId });
  if (realpathSync(initialManager.getCwd()) !== canonicalCwd) throw new Error('S0 cannot open a session outside its captured source workspace');
  const host = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
    if (realpathSync(cwd) !== canonicalCwd) throw new Error('S0 cannot rebind outside its captured source workspace');
    let session: AgentSession;
    let decisionTrace: (event: unknown) => void = () => {};
    const adapter = taskMode ? createTaskHostAdapter(() => session, createDecisionAdapter({ env: launch.env,
      retryPolicies: Object.fromEntries(['table-evidence', 'ordinary-resolve', 'ordinary-apply', 'promise-fulfillment', 'source-consultation', 'memory-read', 'memory-write-retain', 'memory-write-kinds', 'memory-write-annotations', 'memory-write-story'].map(family => [family, { maxRetries: 1, backoffInitialMs: 100, backoffMaxMs: 1_000, attemptTimeoutMs: 10_000 }])),
      trace: event => decisionTrace(event),
    }), {deadlineMs: taskDeadlineMs(launch.env.PI_COC_TASK_DEADLINE_MS), sourceEnabled: launch.env.PI_COC_JEV_SOURCE === '1', memoryEnabled: launch.env.PI_COC_JEV_MEMORY === '1', memoryReadEnabled: launch.env.PI_COC_JEV_MEMORY_READ === '1', resolveEnabled: launch.env.PI_COC_JEV_RESOLVE === '1', applyEnabled: launch.env.PI_COC_JEV_APPLY === '1'}) : createS0HostAdapter(() => session, decide);
    if ('recordDecision' in adapter) decisionTrace = adapter.recordDecision;
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const services = await createAgentSessionServices({ cwd, agentDir, settingsManager,
      resourceLoaderOptions: { additionalExtensionPaths: extensions,
        extensionFactories: [{ name: taskMode ? 'jev-task-private-role' : 'jev-s0-private-role', factory: adapter.extension }],
        noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, systemPrompt: fixedPrompt } });
    const provider = settingsManager.getDefaultProvider(), id = settingsManager.getDefaultModel();
    if (!provider || !id) throw new Error('S0 requires a configured explicit Keeper provider and model');
    const model = services.modelRuntime.getModel(provider, id);
    if (!model) throw new Error('S0 configured Keeper model is unavailable');
    const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
      model, thinkingLevel: settingsManager.getDefaultThinkingLevel(), noTools: 'builtin' });
    session = result.session;
    if (session.model?.provider !== provider || session.model?.id !== id) throw new Error('S0 Keeper model mismatch');
    return { ...result, services, diagnostics: services.diagnostics };
  }, { cwd: launch.cwd, agentDir, sessionManager: initialManager });
  return runRpcMode(host);
}
