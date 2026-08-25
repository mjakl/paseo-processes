import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveProcesses,
  isRelevantTimelineItem,
  type TimelineRecord,
} from "./process-state.ts";

const running = {
  id: "proc-123",
  name: "dev server",
  pid: 4321,
  command: "npm run dev",
  startTime: 1_700_000_000_000,
  endTime: null,
  status: "running",
  exitCode: null,
  success: null,
};

function tool(
  key: string,
  action: string,
  details: Record<string, unknown>,
  input: Record<string, unknown> = {},
): TimelineRecord {
  return {
    key,
    epoch: "epoch-1",
    timestamp: `2025-01-01T00:00:0${key}.000Z`,
    item: {
      type: "tool_call",
      name: "process",
      status: "completed",
      detail: { type: "unknown", input, output: { details: { action, success: true, message: "ok", ...details } } },
    },
  };
}

test("folds start and output enrichment and deduplicates timeline rows", () => {
  const start = tool("1", "start", { process: running }, { readyPattern: "Ready", readyTimeoutSeconds: 30 });
  const output = tool(
    "2",
    "output",
    { output: { stdout: ["Ready on 3000"], stderr: [], status: "running" } },
    { id: "proc" },
  );
  const result = deriveProcesses([start, start, output]);
  assert.equal(result.recognizedEntries, 2);
  assert.equal(result.processes.length, 1);
  assert.deepEqual(result.processes[0]?.readiness, { pattern: "Ready", timeoutSeconds: 30 });
  assert.deepEqual(result.processes[0]?.lastOutput?.stdout, ["Ready on 3000"]);
});

test("uses a complete list as a checkpoint and clear removes finished rows", () => {
  const finished = { ...running, id: "old", status: "exited", endTime: 1_700_000_001_000, exitCode: 0, success: true };
  const result = deriveProcesses([
    tool("1", "list", { processes: [running, finished], totalProcesses: 2 }),
    tool("2", "list", { processes: [finished], totalProcesses: 1 }),
    tool("3", "clear", { cleared: 1 }),
  ]);
  assert.deepEqual(result.processes, []);
});

test("parses only marked stable completion prose", () => {
  const completion: TimelineRecord = {
    key: "2",
    epoch: "epoch-1",
    timestamp: "2025-01-01T00:00:02.000Z",
    item: {
      type: "assistant_message",
      text: [
        'Process "dev server" (proc-123) crashed with exit code 7 after 2m 3s.',
        "Command: npm run…",
        "",
        "Recent output:",
        "stdout: booted",
        "stderr: fatal error",
        "",
        "This is the automatic process-end notification, so the process is finished; use process output or process logs only if you need more of what it printed.",
      ].join("\n"),
    },
  };
  const unmarked = { ...completion, key: "3", item: { type: "assistant_message", text: 'Process "fake" (fake) completed successfully after 1s.' } };
  const result = deriveProcesses([tool("1", "start", { process: running }), completion, unmarked]);
  assert.equal(result.processes.length, 1);
  assert.equal(result.processes[0]?.status, "exited");
  assert.equal(result.processes[0]?.exitCode, 7);
  assert.equal(result.processes[0]?.command, "npm run dev");
  assert.deepEqual(result.processes[0]?.lastOutput?.stderr, ["fatal error"]);
});

test("completion fallback does not invent a start timestamp", () => {
  const completion: TimelineRecord = {
    key: "1",
    epoch: "epoch-1",
    timestamp: "2025-01-01T00:00:01.000Z",
    item: {
      type: "assistant_message",
      text: [
        'Process "standalone" (only-prose) completed successfully after 4s.',
        "Command: short command",
        "",
        "This is the automatic process-end notification, so the process is finished; use process output or process logs only if you need more of what it printed.",
      ].join("\n"),
    },
  };
  assert.equal(deriveProcesses([completion]).processes[0]?.startTime, null);
});

test("keeps an unknown terminal output result distinct from failure", () => {
  const result = deriveProcesses([
    tool("1", "start", { process: running }),
    tool(
      "2",
      "output",
      { output: { stdout: [], stderr: [], status: "exited" } },
      { id: "proc-123" },
    ),
  ]);
  assert.equal(result.processes[0]?.status, "exited");
  assert.equal(result.processes[0]?.success, null);
  assert.notEqual(result.processes[0]?.endTime, null);
});

test("retention filter accepts only structured process calls and marked notifications", () => {
  const processCall = tool("1", "list", { processes: [] }).item;
  assert.equal(isRelevantTimelineItem(processCall), true);
  assert.equal(isRelevantTimelineItem({ type: "assistant_message", text: "ordinary answer" }), false);
  assert.equal(
    isRelevantTimelineItem({
      type: "tool_call",
      name: "read",
      status: "completed",
      detail: { type: "unknown", input: {}, output: {} },
    }),
    false,
  );
});

test("ignores malformed process details without throwing", () => {
  const malformed = tool("1", "start", { process: { id: "broken" } });
  assert.deepEqual(deriveProcesses([malformed]).processes, []);
});
