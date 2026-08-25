# Paseo Processes

Paseo Processes adds a read-only, agent-scoped **Processes** panel to Paseo. It derives background process state from the agent’s canonical timeline and does not communicate with `pi-processes` directly.

The panel lists running processes first, followed by recently finished processes. Expand a row to inspect the command, IDs, timestamps, exit result, readiness request, retained log paths, and the last output captured by an agent tool call.

## Install

Plugins are disabled by default in Paseo. Enable plugins explicitly in the Paseo daemon configuration before installation; local plugins are trusted, unsandboxed code.

```bash
cd /absolute/path/to/paseo-processes
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-processes
```

Open an agent, then choose **Open background processes** in the Command Center. The panel opens in the explorer.

After changing the source, check and reload it:

```bash
npm run typecheck
paseo plugin reload paseo-processes
```

## Limitations

- State is reconstructed from transcript history, so it can be incomplete if history is missing or truncated.
- Automatic process completion uses the stable `pi-processes` notification prose as a fallback because Paseo drops custom message details during normalization.
- Output is a prior capture, not a live stream. The panel labels it **Last captured output**.
- Paseo does not provide a plugin API for a panel badge, so the explorer entry has no running-process count.
- The panel is read-only. Use the agent and `pi-processes` tools to manage processes.
