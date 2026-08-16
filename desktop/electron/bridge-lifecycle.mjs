/**
 * Desktop bridge pid bookkeeping.
 *
 * Electron spawn()s the Node web bridge detached so a clean quit can SIGTERM
 * the whole process group. A force-quit / crash leaves that group alive on
 * the same workspace. Startup reaps only processes whose command line binds
 * this exact workspace to server-node/server.mjs or rpc_server.py.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PID_FILE_NAME = "bridge.pid.json";

export function pidFilePath(userData) {
  return path.join(userData, PID_FILE_NAME);
}

export function readPidRecord(userData) {
  const file = pidFilePath(userData);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const pid = Number(raw.pid);
    const workspace = typeof raw.workspace === "string" ? raw.workspace : "";
    if (!Number.isInteger(pid) || pid <= 0 || !workspace) return null;
    return {
      schema_version: 1,
      workspace,
      pid,
      port: Number.isInteger(Number(raw.port)) ? Number(raw.port) : 0,
    };
  } catch {
    return null;
  }
}

export function writePidRecord(userData, { workspace, pid, port }) {
  const record = {
    schema_version: 1,
    workspace: String(workspace),
    pid: Number(pid),
    port: Number(port) || 0,
    started_at: new Date().toISOString(),
  };
  fs.writeFileSync(pidFilePath(userData), JSON.stringify(record, null, 2) + "\n");
  return record;
}

export function clearPidRecord(userData) {
  try {
    fs.unlinkSync(pidFilePath(userData));
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

export function parseProcessTable(psOutput) {
  const rows = [];
  for (const line of String(psOutput).split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), command: match[2] });
  }
  return rows;
}

export function commandOwnsWorkspace(command, workspace) {
  if (!command || !workspace) return false;
  const ws = String(workspace);
  return (
    command.includes(`--workspace ${ws}`) ||
    command.includes(`--workspace=${ws}`)
  );
}

export function isStaleBridgeCommand(command, workspace) {
  if (!commandOwnsWorkspace(command, workspace)) return false;
  return (
    /server-node[/\\]server\.mjs\b/.test(command) ||
    /rpc_server\.py\b/.test(command)
  );
}

export function selectStaleBridgeRows({ processes, workspace, keepPids = [] }) {
  const keep = new Set(keepPids.map(Number));
  const servers = [];
  const others = [];
  for (const row of processes) {
    if (keep.has(row.pid)) continue;
    if (!isStaleBridgeCommand(row.command, workspace)) continue;
    if (/server-node[/\\]server\.mjs\b/.test(row.command)) servers.push(row);
    else others.push(row);
  }
  return [...servers, ...others];
}

export function defaultListProcesses() {
  const output = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  return parseProcessTable(output);
}

export function defaultKill(pid, groupLeader) {
  try {
    if (groupLeader) process.kill(-pid, "SIGTERM");
    else process.kill(pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

export function reapStaleBridges({
  userData,
  workspace,
  listProcesses = defaultListProcesses,
  kill = defaultKill,
  log,
  keepPids = [],
} = {}) {
  const processes = listProcesses();
  const record = readPidRecord(userData);
  const extra = [];
  if (
    record &&
    record.workspace === workspace &&
    !keepPids.map(Number).includes(record.pid)
  ) {
    extra.push({
      pid: record.pid,
      command: "server-node/server.mjs --workspace " + workspace,
    });
  }
  const rows = selectStaleBridgeRows({
    processes: [...extra, ...processes],
    workspace,
    keepPids,
  });
  const killed = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    const groupLeader = /server-node[/\\]server\.mjs\b/.test(row.command);
    kill(row.pid, groupLeader);
    killed.push(row.pid);
    log?.(`[bootstrap] reaped stale bridge pid=${row.pid} group=${groupLeader}`);
  }
  clearPidRecord(userData);
  return { killed };
}
