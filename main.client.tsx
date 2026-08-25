import { type PluginAgentPanelProps, usePaseo } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  deriveProcesses,
  isLiveStatus,
  isRelevantTimelineItem,
  type ProcessRecord,
  type TimelineRecord,
} from "./process-state";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function historyRecord(value: unknown, epoch: string): TimelineRecord | undefined {
  if (
    !isObject(value) ||
    typeof value.timestamp !== "string" ||
    typeof value.seqStart !== "number" ||
    !("item" in value)
  ) {
    return undefined;
  }
  const seqEnd = typeof value.seqEnd === "number" ? value.seqEnd : value.seqStart;
  if (!isRelevantTimelineItem(value.item)) return undefined;
  return {
    key: `${epoch}:${value.seqStart}:${seqEnd}`,
    epoch,
    timestamp: value.timestamp,
    order: value.seqStart,
    item: value.item,
  };
}

function liveRecord(value: unknown, fallbackEpoch: string | null): TimelineRecord | undefined {
  if (!isObject(value) || !isObject(value.event) || value.event.type !== "timeline") return undefined;
  if (typeof value.timestamp !== "string" || !isRelevantTimelineItem(value.event.item)) return undefined;
  const epoch = typeof value.epoch === "string" ? value.epoch : fallbackEpoch;
  if (!epoch) return undefined;
  const seq = typeof value.seq === "number" ? String(value.seq) : value.timestamp;
  return {
    key: `${epoch}:${seq}:${seq}`,
    epoch,
    timestamp: value.timestamp,
    order: typeof value.seq === "number" ? value.seq : undefined,
    item: value.event.item,
  };
}

function mergeRecords(
  earlier: readonly TimelineRecord[],
  later: readonly TimelineRecord[],
): TimelineRecord[] {
  const records = new Map<string, TimelineRecord>();
  for (const record of earlier) records.set(record.key, record);
  for (const record of later) records.set(record.key, record);
  return [...records.values()];
}

function formatTime(value: number | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function runtime(process: ProcessRecord, now: number): string {
  if (process.runtimeText) return process.runtimeText;
  if (process.startTime === null) return "Runtime unavailable";
  const end = process.endTime ?? now;
  return formatDuration(end - process.startTime);
}

function statusPresentation(process: ProcessRecord): {
  symbol: string;
  label: string;
  tone: "accent" | "danger" | "muted";
} {
  if (isLiveStatus(process.status)) {
    return { symbol: "●", label: process.status.replace("_", " "), tone: "accent" };
  }
  if (process.success === true) return { symbol: "✓", label: "completed", tone: "muted" };
  if (process.status === "killed") return { symbol: "■", label: "terminated", tone: "muted" };
  if (process.success === false) return { symbol: "!", label: "failed", tone: "danger" };
  return { symbol: "○", label: "exited", tone: "muted" };
}

function DetailLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color, fontSize: 11, fontWeight: "600", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text selectable style={{ color, fontSize: 13, lineHeight: 18 }}>
        {value}
      </Text>
    </View>
  );
}

function ProcessRow({
  process,
  expanded,
  onToggle,
  now,
  compact,
  colors,
}: {
  process: ProcessRecord;
  expanded: boolean;
  onToggle: () => void;
  now: number;
  compact: boolean;
  colors: PluginAgentPanelProps["theme"]["colors"];
}) {
  const status = statusPresentation(process);
  const statusColor =
    status.tone === "accent"
      ? colors.accent
      : status.tone === "danger"
        ? colors.statusDanger
        : colors.foregroundMuted;
  const readiness = process.readiness
    ? [
        `Pattern: ${process.readiness.pattern}`,
        process.readiness.timeoutSeconds ? `Timeout: ${process.readiness.timeoutSeconds}s` : undefined,
        process.readiness.result ? `Result: ${process.readiness.result.replaceAll("_", " ")}` : "Pending",
        process.readiness.stream && process.readiness.line
          ? `${process.readiness.stream}: ${process.readiness.line}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const capturedOutput = process.lastOutput
    ? [
        ...process.lastOutput.stdout.map((line) => `stdout: ${line}`),
        ...process.lastOutput.stderr.map((line) => `stderr: ${line}`),
      ].join("\n") || "No lines were returned by the last output capture."
    : undefined;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.foregroundMuted }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${process.name}, ${status.label}, ${expanded ? "collapse" : "expand"} details`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => ({
          opacity: pressed ? 0.72 : 1,
          paddingHorizontal: compact ? 12 : 16,
          paddingVertical: 12,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Text style={{ color: statusColor, fontSize: 15, width: 14 }}>{status.symbol}</Text>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 2 : 8 }}>
            <Text
              numberOfLines={1}
              style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}
            >
              {process.name}
            </Text>
            <Text style={{ color: statusColor, fontSize: 12, textTransform: "capitalize" }}>
              {status.label}
            </Text>
          </View>
          <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {process.command}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 12 }}>{runtime(process, now)}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{expanded ? "Hide" : "Details"}</Text>
        </View>
      </View>
      </Pressable>

      {expanded ? (
        <View
          style={{
            marginLeft: 24,
            gap: 12,
            paddingHorizontal: compact ? 12 : 16,
            paddingBottom: 14,
          }}
        >
          <View style={{ flexDirection: compact ? "column" : "row", gap: 12 }}>
            <View style={{ flex: 1, gap: 12 }}>
              <DetailLine label="Command" value={process.command} color={colors.foreground} />
              <DetailLine label="Process ID" value={process.id} color={colors.foregroundMuted} />
              <DetailLine
                label="PID"
                value={process.pid > 0 ? String(process.pid) : "Unavailable from transcript"}
                color={colors.foregroundMuted}
              />
            </View>
            <View style={{ flex: 1, gap: 12 }}>
              <DetailLine label="Started" value={formatTime(process.startTime)} color={colors.foregroundMuted} />
              <DetailLine label="Finished" value={formatTime(process.endTime)} color={colors.foregroundMuted} />
              <DetailLine
                label="Exit result"
                value={
                  process.exitCode !== null
                    ? `Exit code ${process.exitCode}`
                    : isLiveStatus(process.status)
                      ? "Still running"
                      : process.success === null
                        ? "Result unavailable"
                        : status.label
                }
                color={statusColor}
              />
            </View>
          </View>
          {readiness ? <DetailLine label="Readiness request" value={readiness} color={colors.foregroundMuted} /> : null}
          {process.logFiles ? (
            <DetailLine
              label="Log paths"
              value={`stdout: ${process.logFiles.stdoutFile}\nstderr: ${process.logFiles.stderrFile}\ncombined: ${process.logFiles.combinedFile}`}
              color={colors.foregroundMuted}
            />
          ) : null}
          {capturedOutput ? (
            <DetailLine
              label={`Last captured output · ${new Date(process.lastOutput?.capturedAt ?? "").toLocaleString()}`}
              value={capturedOutput}
              color={colors.foreground}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ProcessesPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const [records, setRecords] = useState<TimelineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    let activeEpoch: string | null = null;
    let fetchVersion = 0;
    const agent = paseo.agents.ref(agentId);

    const loadHistory = async (expectedEpoch?: string) => {
      const version = ++fetchVersion;
      if (active) {
        setLoading(true);
        setError(null);
      }
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const firstPage = await agent.timeline.refetch({
            direction: "tail",
            limit: 200,
            projection: "canonical",
          });
          if (!active || version !== fetchVersion) return;
          if (firstPage.error) throw new Error(firstPage.error);
          if (expectedEpoch && firstPage.epoch !== expectedEpoch) continue;
          if (firstPage.gap || firstPage.staleCursor) continue;

          const epoch = firstPage.epoch;
          activeEpoch = epoch;
          if (firstPage.reset) setRecords([]);
          const history: TimelineRecord[] = firstPage.entries
            .map((entry: unknown) => historyRecord(entry, epoch))
            .filter((entry: TimelineRecord | undefined): entry is TimelineRecord => entry !== undefined);
          let page = firstPage;
          let restart = false;

          while (page.hasOlder && page.startCursor) {
            page = await agent.timeline.refetch({
              direction: "before",
              cursor: page.startCursor,
              limit: 200,
              projection: "canonical",
            });
            if (!active || version !== fetchVersion) return;
            if (page.error) throw new Error(page.error);
            if (page.epoch !== epoch || page.reset || page.gap || page.staleCursor) {
              restart = true;
              break;
            }
            history.push(
              ...page.entries
                .map((entry: unknown) => historyRecord(entry, epoch))
                .filter((entry: TimelineRecord | undefined): entry is TimelineRecord => entry !== undefined),
            );
          }

          if (restart) continue;
          setRecords((live) => mergeRecords(history, live.filter((record) => record.epoch === epoch)));
          setLoading(false);
          return;
        }
        throw new Error("The agent timeline changed while process history was loading.");
      } catch (reason) {
        if (active && version === fetchVersion) {
          setError(reason instanceof Error ? reason.message : "The agent timeline is unavailable.");
          setLoading(false);
        }
      }
    };

    const unsubscribe = agent.timeline.subscribe((event: unknown) => {
      if (!active) return;
      const eventEpoch = isObject(event) && typeof event.epoch === "string" ? event.epoch : null;
      if (eventEpoch && activeEpoch && eventEpoch !== activeEpoch) {
        activeEpoch = eventEpoch;
        setRecords([]);
        void loadHistory(eventEpoch);
      } else if (eventEpoch && !activeEpoch) {
        activeEpoch = eventEpoch;
        void loadHistory(eventEpoch);
      }
      const record = liveRecord(event, activeEpoch);
      if (record) setRecords((current) => mergeRecords(current, [record]));
    });

    void loadHistory();

    return () => {
      active = false;
      fetchVersion += 1;
      unsubscribe();
    };
  }, [agentId, paseo]);

  const derived = useMemo(() => deriveProcesses(records), [records]);
  const processes = useMemo(
    () =>
      [...derived.processes].sort((left, right) => {
        const liveDifference = Number(isLiveStatus(right.status)) - Number(isLiveStatus(left.status));
        if (liveDifference !== 0) return liveDifference;
        return (right.endTime ?? right.startTime ?? 0) - (left.endTime ?? left.startTime ?? 0);
      }),
    [derived.processes],
  );
  const runningProcesses = processes.filter((process) => isLiveStatus(process.status));
  const finishedProcesses = processes.filter((process) => !isLiveStatus(process.status));
  const runningCount = runningProcesses.length;

  useEffect(() => {
    if (runningCount === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningCount]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = `${runningCount} running · ${finishedProcesses.length} finished`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          paddingHorizontal: layout.compact ? 12 : 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.foregroundMuted,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{summary}</Text>
      </View>

      {loading && records.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={{ color: theme.colors.foregroundMuted }}>Reading process history…</Text>
        </View>
      ) : error && records.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 8, padding: 24 }}>
          <Text style={{ color: theme.colors.statusDanger, fontWeight: "600" }}>Process history unavailable</Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>{error}</Text>
        </View>
      ) : processes.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 8, padding: 24 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>No background processes</Text>
          <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 19 }}>
            {derived.recognizedEntries === 0
              ? "No pi-processes activity was found in this agent’s canonical timeline."
              : "The latest process state is empty."}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: layout.compact ? 12 : 20 }}>
          {error ? (
            <Text style={{ color: theme.colors.statusDanger, paddingHorizontal: 16, paddingVertical: 8 }}>
              History may be incomplete: {error}
            </Text>
          ) : null}
          {runningProcesses.length > 0 ? (
            <>
              <Text
                style={{
                  color: theme.colors.accent,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  paddingHorizontal: layout.compact ? 12 : 16,
                  paddingBottom: 6,
                  paddingTop: 12,
                }}
              >
                RUNNING
              </Text>
              {runningProcesses.map((process) => (
                <ProcessRow
                  key={process.id}
                  process={process}
                  expanded={expanded.has(process.id)}
                  onToggle={() => toggle(process.id)}
                  now={now}
                  compact={layout.compact}
                  colors={theme.colors}
                />
              ))}
            </>
          ) : null}
          {finishedProcesses.length > 0 ? (
            <>
              <Text
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  paddingHorizontal: layout.compact ? 12 : 16,
                  paddingBottom: 6,
                  paddingTop: 16,
                }}
              >
                RECENTLY FINISHED
              </Text>
              {finishedProcesses.map((process) => (
                <ProcessRow
                  key={process.id}
                  process={process}
                  expanded={expanded.has(process.id)}
                  onToggle={() => toggle(process.id)}
                  now={now}
                  compact={layout.compact}
                  colors={theme.colors}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
