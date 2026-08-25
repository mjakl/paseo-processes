# Paseo Processes

Paseo Processes is a companion plugin for [pi-processes](https://github.com/mjakl/pi-processes). It brings the background processes started by your Pi agent into Paseo, so you can see what is still running without returning to Pi's terminal interface.

The **Processes** panel shows running and recently finished processes. Open a process to see its command, runtime, exit result, readiness state, log paths, and the last output captured by the agent.

The panel is read-only. Continue to start, inspect, and stop processes by asking your Pi agent as usual.

## Before you install

Install and configure [pi-processes](https://github.com/mjakl/pi-processes) for Pi first.

Paseo plugins run on the machine hosting the Paseo daemon. Clone and install this repository on that machine, not on a separate computer that only runs the Paseo UI. Local Paseo plugins are trusted, unsandboxed code, and Paseo keeps plugin support disabled until you enable it.

## Install

1. In Paseo, open **Settings → Plugins** for the daemon host and turn on **Enable plugins**.
2. On the daemon host, clone and install the plugin:

```bash
git clone https://github.com/mjakl/paseo-processes.git
cd paseo-processes
npm install
paseo plugin install "$(pwd)"
```

Paseo requires an absolute plugin path, which is why the command uses `$(pwd)` instead of `.`.

Check that the plugin is running:

```bash
paseo plugin ls
```

If Paseo reports an error, inspect the plugin log:

```bash
paseo plugin logs paseo-processes
```

## Use the panel

1. Open a Paseo workspace and focus a Pi agent conversation.
2. Open the Command Center with **Cmd+K** on macOS or **Ctrl+K** on Linux and Windows.
3. Select **Open background processes**.

Paseo opens the **Processes** panel in the Explorer side pane. You can leave it open beside the conversation and expand any process for more detail.

The panel follows process activity in the latest 500 conversation entries. Older processes and activity removed by a conversation rewind may not appear. Output shown in the panel is the last output captured by the agent, not a live log stream.

## Update

On the daemon host:

```bash
cd /path/to/paseo-processes
git pull
npm install
paseo plugin reload paseo-processes
```

## Remove

```bash
paseo plugin remove paseo-processes
```
