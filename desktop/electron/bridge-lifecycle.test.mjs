import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearPidRecord,
  commandOwnsWorkspace,
  isStaleBridgeCommand,
  parseProcessTable,
  pidFilePath,
  readPidRecord,
  reapStaleBridges,
  selectStaleBridgeRows,
  writePidRecord,
} from "./bridge-lifecycle.mjs";

const WORKSPACE =
  "/Users/haoli/Library/Application Support/coc-keeper-desktop/coc-workspace";

describe("parseProcessTable", () => {
  it("reads pid and command from ps -ax -o pid=,command=", () => {
    const rows = parseProcessTable(
      [
        "  61884 node /repo/web/server-node/server.mjs --workspace " + WORKSPACE + " --port 60904",
        "61899 uv run --project /repo --frozen python /repo/runtime/sdk/rpc_server.py --workspace " + WORKSPACE,
        "not-a-row",
      ].join("\n"),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].pid, 61884);
    assert.match(rows[0].command, /server\.mjs/);
    assert.equal(rows[1].pid, 61899);
  });
});

describe("workspace command matching", () => {
  it("binds only the exact --workspace path", () => {
    const command =
      "node /repo/web/server-node/server.mjs --workspace " + WORKSPACE + " --port 1";
    assert.equal(commandOwnsWorkspace(command, WORKSPACE), true);
    assert.equal(commandOwnsWorkspace(command, WORKSPACE + "-other"), false);
    assert.equal(
      isStaleBridgeCommand(
        "node /repo/web/server-node/server.mjs --workspace /other --port 1",
        WORKSPACE,
      ),
      false,
    );
    assert.equal(isStaleBridgeCommand(command, WORKSPACE), true);
    assert.equal(
      isStaleBridgeCommand(
        "uv run python /repo/runtime/sdk/rpc_server.py --workspace " + WORKSPACE,
        WORKSPACE,
      ),
      true,
    );
    assert.equal(
      isStaleBridgeCommand("node /repo/unrelated.js --workspace " + WORKSPACE, WORKSPACE),
      false,
    );
  });
});

describe("selectStaleBridgeRows", () => {
  it("kills server.mjs first and skips keepPids", () => {
    const rows = selectStaleBridgeRows({
      workspace: WORKSPACE,
      keepPids: [99],
      processes: [
        {
          pid: 2,
          command: "python /repo/runtime/sdk/rpc_server.py --workspace " + WORKSPACE,
        },
        {
          pid: 1,
          command: "node /repo/web/server-node/server.mjs --workspace " + WORKSPACE,
        },
        {
          pid: 99,
          command: "node /repo/web/server-node/server.mjs --workspace " + WORKSPACE,
        },
        { pid: 3, command: "pi --workspace " + WORKSPACE },
      ],
    });
    assert.deepEqual(rows.map((row) => row.pid), [1, 2]);
  });
});

describe("pid record and reap", () => {
  it("round-trips a pid file and reaps matching leftovers", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "coc-bridge-"));
    try {
      writePidRecord(userData, { workspace: WORKSPACE, pid: 61884, port: 60904 });
      assert.equal(readPidRecord(userData).pid, 61884);
      assert.equal(pidFilePath(userData).endsWith("bridge.pid.json"), true);

      const killed = [];
      const result = reapStaleBridges({
        userData,
        workspace: WORKSPACE,
        listProcesses: () => [
          {
            pid: 61884,
            command: "node /repo/web/server-node/server.mjs --workspace " + WORKSPACE,
          },
          {
            pid: 61900,
            command: "python /repo/runtime/sdk/rpc_server.py --workspace " + WORKSPACE,
          },
        ],
        kill: (pid, groupLeader) => {
          killed.push({ pid, groupLeader });
        },
      });
      assert.deepEqual(result.killed, [61884, 61900]);
      assert.deepEqual(killed, [
        { pid: 61884, groupLeader: true },
        { pid: 61900, groupLeader: false },
      ]);
      assert.equal(readPidRecord(userData), null);
    } finally {
      clearPidRecord(userData);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
