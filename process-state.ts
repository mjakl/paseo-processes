export type ProcessStatus =
  | "running"
  | "terminating"
  | "terminate_timeout"
  | "exited"
  | "killed";

export interface ProcessPreview {
  id: string;
  name: string;
  pid: number;
  command: string;
  startTime: number;
  endTime: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  success: boolean | null;
}

export interface CapturedOutput {
  stdout: string[];
  stderr: string[];
  capturedAt: string;
}

export interface ReadinessState {
  pattern: string;
  timeoutSeconds?: number;
  result?: "ready" | "timeout" | "exited_before_ready";
  line?: string;
  stream?: "stdout" | "stderr";
}

export interface ProcessRecord extends Omit<ProcessPreview, "startTime"> {
  startTime: number | null;
  logFiles?: {
    stdoutFile: string;
    stderrFile: string;
    combinedFile: string;
  };
  lastOutput?: CapturedOutput;
  readiness?: ReadinessState;
  updatedAt: string;
  runtimeText?: string;
}

export interface TimelineRecord {
  key: string;
  epoch: string;
  timestamp: string;
  order?: number;
  item: unknown;
}

export interface DerivedProcesses {
  processes: ProcessRecord[];
  recognizedEntries: number;
}

interface ProcessesDetails {
  action: string;
  success: boolean;
  message: string;
  process?: ProcessPreview;
  processes?: ProcessPreview[];
  output?: { stdout: string[]; stderr: string[]; status: string };
  logFiles?: {
    stdoutFile: string;
    stderrFile: string;
    combinedFile: string;
  };
  totalProcesses?: number;
}

const STATUSES = new Set<ProcessStatus>([
  "running",
  "terminating",
  "terminate_timeout",
  "exited",
  "killed",
]);
const LIVE_STATUSES = new Set<ProcessStatus>([
  "running",
  "terminating",
  "terminate_timeout",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseProcess(value: unknown): ProcessPreview | undefined {
  if (!isObject(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.pid !== "number" ||
    typeof value.command !== "string" ||
    typeof value.startTime !== "number" ||
    !(typeof value.endTime === "number" || value.endTime === null) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as ProcessStatus) ||
    !(typeof value.exitCode === "number" || value.exitCode === null) ||
    !(typeof value.success === "boolean" || value.success === null)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    pid: value.pid,
    command: value.command,
    startTime: value.startTime,
    endTime: value.endTime,
    status: value.status as ProcessStatus,
    exitCode: value.exitCode,
    success: value.success,
  };
}

function parseDetails(value: unknown): ProcessesDetails | undefined {
  if (
    !isObject(value) ||
    typeof value.action !== "string" ||
    typeof value.success !== "boolean" ||
    typeof value.message !== "string"
  ) {
    return undefined;
  }
  const result: ProcessesDetails = {
    action: value.action,
    success: value.success,
    message: value.message,
  };
  const process = parseProcess(value.process);
  if (process) result.process = process;
  if (Array.isArray(value.processes)) {
    const processes = value.processes.map(parseProcess);
    if (processes.every((item): item is ProcessPreview => item !== undefined)) {
      result.processes = processes;
    }
  }
  if (
    isObject(value.output) &&
    stringArray(value.output.stdout) &&
    stringArray(value.output.stderr) &&
    typeof value.output.status === "string"
  ) {
    result.output = {
      stdout: value.output.stdout,
      stderr: value.output.stderr,
      status: value.output.status,
    };
  }
  if (
    isObject(value.logFiles) &&
    typeof value.logFiles.stdoutFile === "string" &&
    typeof value.logFiles.stderrFile === "string" &&
    typeof value.logFiles.combinedFile === "string"
  ) {
    result.logFiles = {
      stdoutFile: value.logFiles.stdoutFile,
      stderrFile: value.logFiles.stderrFile,
      combinedFile: value.logFiles.combinedFile,
    };
  }
  if (typeof value.totalProcesses === "number") result.totalProcesses = value.totalProcesses;
  return result;
}

function processToolEntry(item: unknown): {
  details: ProcessesDetails;
  input: Record<string, unknown>;
} | undefined {
  if (
    !isObject(item) ||
    item.type !== "tool_call" ||
    item.name !== "process" ||
    item.status !== "completed" ||
    !isObject(item.detail) ||
    item.detail.type !== "unknown" ||
    !isObject(item.detail.output)
  ) {
    return undefined;
  }
  const details = parseDetails(item.detail.output.details);
  if (!details) return undefined;
  return {
    details,
    input: isObject(item.detail.input) ? item.detail.input : {},
  };
}

function resolveProcessId(
  processes: ReadonlyMap<string, ProcessRecord>,
  requested: unknown,
): string | undefined {
  if (typeof requested !== "string") return undefined;
  if (processes.has(requested)) return requested;
  const matches = [...processes.values()].filter(
    (process) => process.id.startsWith(requested) || process.name === requested,
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function upsert(
  processes: Map<string, ProcessRecord>,
  preview: Omit<ProcessPreview, "startTime"> & { startTime: number | null },
  timestamp: string,
  enrichment?: Partial<ProcessRecord>,
) {
  const previous = processes.get(preview.id);
  processes.set(preview.id, {
    ...previous,
    ...preview,
    ...enrichment,
    updatedAt: timestamp,
  });
}

const END_MARKER =
  "This is the automatic process-end notification, so the process is finished;";
const END_PATTERN =
  /^Process "([^"\n]+)" \(([^)\n]+)\) (completed successfully|crashed with exit code ([^ ]+)|was terminated) after ([^.\n]+)\./;
const READY_MARKER = "This is the automatic process-readiness notification;";

export function isRelevantTimelineItem(item: unknown): boolean {
  if (processToolEntry(item)) return true;
  if (!isObject(item) || item.type !== "assistant_message" || typeof item.text !== "string") {
    return false;
  }
  return (
    (item.text.includes(END_MARKER) && END_PATTERN.test(item.text)) ||
    (item.text.includes(READY_MARKER) &&
      (/^Process "[^"\n]+" \([^)\n]+\) matched its readiness marker after /.test(item.text) ||
        /^Process "[^"\n]+" \([^)\n]+\) did not print "[^"]+" within \d+s;/.test(item.text)))
  );
}

function applyCompletionMessage(
  processes: Map<string, ProcessRecord>,
  text: string,
  timestamp: string,
): boolean {
  if (!text.includes(END_MARKER)) return false;
  const match = END_PATTERN.exec(text);
  if (!match) return false;
  const [, name, id, result, exitCodeText, runtimeText] = match;
  if (!name || !id || !result || !runtimeText) return false;
  const previous = processes.get(id);
  const timestampMs = Date.parse(timestamp);
  const success = result === "completed successfully";
  const killed = result === "was terminated";
  const parsedExitCode = exitCodeText && exitCodeText !== "?" ? Number(exitCodeText) : null;
  const command = previous?.command ?? /^Command: (.+)$/m.exec(text)?.[1] ?? "Unknown command";
  const readinessPattern = /It exited before the readiness pattern "([^"]+)" appeared\./.exec(text)?.[1];
  const outputLines = text.split("\n");
  const outputStart = outputLines.indexOf("Recent output:");
  const stdout: string[] = [];
  const stderr: string[] = [];
  if (outputStart >= 0) {
    for (const line of outputLines.slice(outputStart + 1)) {
      if (!line) break;
      if (line.startsWith("stdout: ")) stdout.push(line.slice(8));
      if (line.startsWith("stderr: ")) stderr.push(line.slice(8));
    }
  }
  upsert(
    processes,
    {
      id,
      name,
      pid: previous?.pid ?? 0,
      command,
      startTime: previous?.startTime ?? null,
      endTime: Number.isFinite(timestampMs) ? timestampMs : previous?.endTime ?? null,
      status: killed ? "killed" : "exited",
      exitCode: success ? 0 : parsedExitCode,
      success,
    },
    timestamp,
    {
      runtimeText,
      ...(stdout.length || stderr.length
        ? { lastOutput: { stdout, stderr, capturedAt: timestamp } }
        : {}),
      ...(readinessPattern
        ? {
            readiness: {
              ...previous?.readiness,
              pattern: readinessPattern,
              result: "exited_before_ready" as const,
            },
          }
        : {}),
    },
  );
  return true;
}

function applyReadinessMessage(
  processes: Map<string, ProcessRecord>,
  text: string,
  timestamp: string,
): boolean {
  if (!text.includes(READY_MARKER)) return false;
  const matched = /^Process "([^"\n]+)" \(([^)\n]+)\) matched its readiness marker after ([^.\n]+)\./.exec(text);
  const timedOut = /^Process "([^"\n]+)" \(([^)\n]+)\) did not print "([^"]+)" within (\d+)s;/.exec(text);
  if (!matched && !timedOut) return false;
  const id = matched?.[2] ?? timedOut?.[2];
  if (!id) return false;
  const previous = processes.get(id);
  if (!previous) return true;
  const matchedDetail = /^Matched "([^"]+)" on (stdout|stderr): (.*)$/m.exec(text);
  processes.set(id, {
    ...previous,
    updatedAt: timestamp,
    readiness: matched
      ? {
          pattern: matchedDetail?.[1] ?? previous.readiness?.pattern ?? "Readiness marker",
          timeoutSeconds: previous.readiness?.timeoutSeconds,
          result: "ready",
          stream: matchedDetail?.[2] as "stdout" | "stderr" | undefined,
          line: matchedDetail?.[3],
        }
      : {
          pattern: timedOut?.[3] ?? previous.readiness?.pattern ?? "Readiness marker",
          timeoutSeconds: timedOut?.[4] ? Number(timedOut[4]) : previous.readiness?.timeoutSeconds,
          result: "timeout",
        },
  });
  return true;
}

function applyToolEntry(
  processes: Map<string, ProcessRecord>,
  entry: ReturnType<typeof processToolEntry> & {},
  timestamp: string,
) {
  const { details, input } = entry;
  if (!details.success) return;

  if (details.action === "list" && details.processes) {
    const completeSnapshot =
      details.totalProcesses === undefined || details.totalProcesses === details.processes.length;
    const listedIds = new Set(details.processes.map((process) => process.id));
    if (completeSnapshot) {
      for (const id of processes.keys()) {
        if (!listedIds.has(id)) processes.delete(id);
      }
    }
    for (const process of details.processes) upsert(processes, process, timestamp);
    return;
  }

  if ((details.action === "start" || details.action === "kill") && details.process) {
    const readyPattern = typeof input.readyPattern === "string" ? input.readyPattern.trim() : "";
    const readyTimeout = typeof input.readyTimeoutSeconds === "number" ? input.readyTimeoutSeconds : undefined;
    upsert(
      processes,
      details.process,
      timestamp,
      readyPattern
        ? { readiness: { pattern: readyPattern, timeoutSeconds: readyTimeout } }
        : undefined,
    );
    return;
  }

  if (details.action === "clear") {
    for (const [processId, process] of processes) {
      if (!LIVE_STATUSES.has(process.status)) processes.delete(processId);
    }
    return;
  }

  const id = resolveProcessId(processes, input.id);
  if (!id) return;
  const process = processes.get(id);
  if (!process) return;
  if (
    details.action === "kill" &&
    (details.message.startsWith("Terminated ") || details.message.startsWith("Force-killed "))
  ) {
    const endTime = Date.parse(timestamp);
    processes.set(id, {
      ...process,
      status: "killed",
      success: false,
      endTime: Number.isFinite(endTime) ? endTime : process.endTime,
      updatedAt: timestamp,
    });
  } else if (details.action === "output" && details.output) {
    const status = STATUSES.has(details.output.status as ProcessStatus)
      ? (details.output.status as ProcessStatus)
      : process.status;
    const endTime = !LIVE_STATUSES.has(status) ? Date.parse(timestamp) : process.endTime;
    processes.set(id, {
      ...process,
      status,
      endTime: typeof endTime === "number" && Number.isFinite(endTime) ? endTime : process.endTime,
      updatedAt: timestamp,
      lastOutput: {
        stdout: details.output.stdout,
        stderr: details.output.stderr,
        capturedAt: timestamp,
      },
    });
  } else if (details.action === "logs" && details.logFiles) {
    processes.set(id, { ...process, logFiles: details.logFiles, updatedAt: timestamp });
  }
}

export function deriveProcesses(records: readonly TimelineRecord[]): DerivedProcesses {
  const processes = new Map<string, ProcessRecord>();
  let recognizedEntries = 0;
  const deduped = new Map(records.map((record) => [record.key, record]));
  const ordered = [...deduped.values()].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || (a.order ?? 0) - (b.order ?? 0),
  );

  for (const record of ordered) {
    const toolEntry = processToolEntry(record.item);
    if (toolEntry) {
      recognizedEntries += 1;
      applyToolEntry(processes, toolEntry, record.timestamp);
      continue;
    }
    if (!isObject(record.item) || record.item.type !== "assistant_message" || typeof record.item.text !== "string") {
      continue;
    }
    if (
      applyCompletionMessage(processes, record.item.text, record.timestamp) ||
      applyReadinessMessage(processes, record.item.text, record.timestamp)
    ) {
      recognizedEntries += 1;
    }
  }

  return { processes: [...processes.values()], recognizedEntries };
}

export function isLiveStatus(status: ProcessStatus): boolean {
  return LIVE_STATUSES.has(status);
}
