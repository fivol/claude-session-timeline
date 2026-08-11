# Install & autostart

[← README](../README.md) · [Usage](usage.md) · [Metrics](metrics.md) · [How it works](architecture.md)

**Requirements:** Node 18+ and a `~/.claude/` directory with transcripts in it. There are no
dependencies, so there is nothing to install.

## Run

```bash
npm start
```

(or `node server.mjs` — same thing). The URL is printed on start.

## Ports

The server binds **5555** by default, or the next free port the OS hands out if 5555 is taken —
so starting a second instance next to an autostarted one never collides.

```bash
PORT=5000 npm start
```

An explicit `PORT` is treated as a hard requirement: if it's busy the server exits instead of
falling back, so you always know where it is.

## Autostart on macOS

Run the server at login and keep it alive (restart on crash) via a LaunchAgent:

```bash
./scripts/install-launchagent.sh
```

```bash
PORT=5000 ./scripts/install-launchagent.sh
```

```bash
./scripts/uninstall-launchagent.sh
```

The installer bakes the absolute path of your current `node` into the plist — re-run it after
switching Node versions (e.g. via nvm). Output goes to `server.log` in the project directory.

The LaunchAgent always pins its port explicitly, so it never drifts to a random one: if that port
is taken it exits and says so in `server.log`.

## Options

- `PORT=<n>` — bind an exact port (see above).
- `?nostream` — append to the URL to load a static snapshot without the live SSE connection.

## Linux

Live updates rely on `fs.watch({recursive: true})`, which Node supports on macOS and Windows. On
Linux the watcher silently won't fire; swap in a polling watcher or `chokidar` in
[`server.mjs`](../server.mjs), or just reload the page. Everything else works unchanged.
