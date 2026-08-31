import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type DebugExperimentHostContext = {
  workspaceRoot: string;
  campaignId: string;
  role: "setup" | "play";
  hostIsIdle: boolean;
  provider: string;
  model: string;
  thinking: string;
  agentHome: string;
};

export type DebugExperimentReceipt = {
  status: string;
  experiment_id?: string;
  message?: string;
  [key: string]: unknown;
};

export class DebugExperimentHostError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DebugExperimentHostError";
    this.code = code;
  }
}

type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunCommand = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<RunCommandResult>;

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    "USER", "LOGNAME", "SHELL", "SSL_CERT_FILE", "UV_CACHE_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  ];
  return {
    ...Object.fromEntries(
      allowed.flatMap((key) => (
        process.env[key] === undefined ? [] : [[key, process.env[key]]]
      )),
    ),
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

const defaultRunCommand: RunCommand = (command, args, options) => (
  new Promise((resolveCommand) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      const exitCode = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
        ? Number((error as NodeJS.ErrnoException).code)
        : error === null ? 0 : 2;
      resolveCommand({ stdout, stderr, exitCode });
    });
  })
);

export type DebugExperimentHost = {
  dispatch(
    command: string,
    context: DebugExperimentHostContext,
  ): Promise<DebugExperimentReceipt>;
};

export function createDebugExperimentHost(options: {
  repoRoot?: string;
  runCommand?: RunCommand;
} = {}): DebugExperimentHost {
  const repoRoot = resolve(
    options.repoRoot
      ?? fileURLToPath(new URL("../../../../", import.meta.url)),
  );
  const runner = resolve(
    repoRoot,
    "plugins/coc-keeper/pi/bin/pi_coc_debug_experiment.py",
  );
  const runCommand = options.runCommand ?? defaultRunCommand;
  return {
    async dispatch(command, context) {
      const contextPayload = {
        workspace_root: resolve(context.workspaceRoot),
        campaign_id: context.campaignId,
        role: context.role,
        host_is_idle: context.hostIsIdle,
        provider: context.provider,
        model: context.model,
        thinking: context.thinking,
        agent_home: resolve(context.agentHome),
      };
      const result = await runCommand("uv", [
        "run", "--frozen", "--project", repoRoot, "python",
        runner,
        "dispatch",
        "--command", command,
        "--context-json", JSON.stringify(contextPayload),
      ], {
        cwd: repoRoot,
        timeoutMs: 3000,
        env: safeEnvironment(),
      });
      let envelope: unknown;
      try {
        envelope = JSON.parse(result.stdout.trim());
      } catch {
        throw new DebugExperimentHostError(
          "debug_host_protocol_error",
          result.stderr.trim() || "debug host returned invalid JSON",
        );
      }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
        throw new DebugExperimentHostError(
          "debug_host_protocol_error", "debug host returned no envelope",
        );
      }
      const value = envelope as Record<string, unknown>;
      if (value.ok !== true) {
        const error = value.error && typeof value.error === "object"
          ? value.error as Record<string, unknown>
          : {};
        throw new DebugExperimentHostError(
          typeof error.code === "string" ? error.code : "debug_host_failed",
          typeof error.message === "string" ? error.message : "debug host failed",
        );
      }
      if (!value.receipt || typeof value.receipt !== "object") {
        throw new DebugExperimentHostError(
          "debug_host_protocol_error", "debug host returned no receipt",
        );
      }
      return value.receipt as DebugExperimentReceipt;
    },
  };
}
