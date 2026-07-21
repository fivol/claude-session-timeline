# Claude Code — Session Timeline

A live, browser-based Gantt of your **Claude Code** sessions, grouped by working directory
and read straight from the local transcripts in `~/.claude/`. No hooks, no config changes,
zero dependencies.

It shows, on one shared time axis, when each session's **agent was working**, when **you were
reading / typing**, every **tool call** and **subagent (Task)** run, plus live status, a
concurrency chart, a per-day activity heatmap, and drag-selectable stats.

![Session timeline dashboard](docs/screenshots/overview.png)

## Why not hooks?

Claude Code already writes every event — user prompts, assistant turns, tool calls and
results — with ISO timestamps into `~/.claude/projects/<dir>/<sessionId>.jsonl`, *live* as a
session runs. This server tails those files, so there is nothing to install into your Claude
Code config.

### What it can and cannot show

- **Shown:** agent working, user reading / typing (the gap between turns), each tool call,
  subagent (Task) runs, session start/end, live status (working / awaiting input / idle),
  and — because every session logs separately — which directory/task was active when.
- **Not shown:** pure passive viewing/scrolling and switching chats in FleetView *without
  acting*. Claude Code records no TUI focus/navigation events anywhere (confirmed: even its
  internal telemetry has none), so no tool can reconstruct it. Idle time between turns is
  therefore left blank rather than guessed at.

## Run

```bash
cd ~/Documents/Projects/claude-session-timeline
npm start                 # or: node server.mjs
# open http://localhost:4177
```

Change the port with `PORT=5000 npm start`.

### Autostart (macOS)

Run the server at login and keep it alive (restart on crash) via a LaunchAgent:

```bash
./scripts/install-launchagent.sh            # installs & loads com.claude-session-timeline
PORT=5000 ./scripts/install-launchagent.sh  # custom port
./scripts/uninstall-launchagent.sh          # stop & remove
```

The agent bakes the absolute path of your current `node` into the plist — re-run the
installer after switching Node versions (e.g. via nvm). Output goes to `server.log`.

## Controls

- **Time window:** `1h / 2h / 4h / 6h / 8h / 24h / 7d / All` presets, plus **⟳ Live** (the
  right edge follows *now*; any zoom/pan turns it off).
- **Zoom:** trackpad **pinch**, or **⌥ (Alt) + wheel** for a mouse — zooms around the cursor.
- **Pan:** **two-finger horizontal** scroll. (Plain vertical scroll moves the list.)
- **Select a range:** **drag** across the timeline — the stats bar recomputes for just that
  range (highlighted band). **Click anywhere** clears the selection.
- **Time-axis cursor:** hover anywhere over the timeline for a crosshair + tooltip with the
  time, **instant** parallel count and **avg** parallel at that point (session name too when
  hovering a row).
- **Day heatmap** (always visible under the header): one square per day of the month,
  brighter = more agent-active time. **Hover** a day for its stats (sessions, dirs,
  agent-hours, user time, prompts); **click** to open that day; **drag across days** to open
  a range. Page months with `‹ ›` (no paging into the future); *reset* returns to 24h.
- **Collapse a directory:** click a group header to fold/unfold its sessions.
- **Subagents:** a session with `Task` runs shows a `▸` toggle; expand it to see each
  subagent as its own row (labeled with its `agentType` and description).
- **Per-session totals:** a line under each session name reads
  `active <span> · agent <time> · user <time>`.

## Stats bar & concurrency chart

The stats bar (recomputed for the visible window or the drag-selected range) shows: session
count, directories, **max parallel** and **avg parallel**, **any-agent active** (wall-clock
time when ≥1 agent worked — the union), **agent-hours** (that time summed across sessions),
and how many are working right now. Above the timeline, the **avg-parallel chart** plots
concurrency over time as a sliding-window average (window scales with zoom).

## How activity is computed

Spans come from the transcript's event timestamps, with an **idle threshold** (`IDLE_MS`,
5 min in `lib/parse.mjs`):

- **agent working** — from a prompt through the agent's messages/tool calls, split wherever
  there is a gap longer than the threshold.
- **user reading / typing** — the gap between the agent finishing and the next prompt,
  **capped** at the threshold; longer gaps are idle and left blank.
- **tool / subagent** — exact, from each `tool_use` to its `tool_result`.

Concurrency metrics use each session's merged agent-working intervals, so "parallel" means
*actually running at the same time*, not merely open.

## Project structure

```
claude-session-timeline/
├── server.mjs              # zero-dep HTTP server: static + /api/data + /api/stream (SSE); fs.watch
├── lib/
│   ├── parse.mjs           # one transcript .jsonl → span lanes (agent / user / tool / subagent)
│   └── scan.mjs            # scan sessions + subagents, overlay live status, group by cwd (mtime-cached)
├── public/
│   ├── index.html          # markup only
│   ├── styles.css
│   └── js/
│       ├── format.js       # tiny pure helpers (dates, durations, escaping)
│       ├── state.js        # shared app state + presets
│       ├── metrics.js      # concurrency profile / intervals math
│       ├── heatmap.js      # month calendar heatmap
│       ├── controls.js     # window presets + Live
│       ├── render.js       # ruler, rows, subagents, chart, stats
│       ├── interactions.js # zoom / pan / range-select / hover
│       ├── data.js         # fetch + enrich (per-session & per-day) + live SSE
│       └── main.js         # entry point
├── scripts/
│   ├── install-launchagent.sh
│   └── uninstall-launchagent.sh
└── docs/screenshots/
```

Data flow: `server.mjs` watches `~/.claude/{projects,sessions,jobs}` and pushes an SSE
`update` on any change; the browser refetches `/api/data`, derives per-session and per-day
aggregates, and redraws.

## Notes

- `fs.watch({recursive:true})` (macOS/Windows) drives live updates. On Linux swap in a
  polling watcher or `chokidar`.
- Timestamps are UTC in the logs and rendered in your local time.
- Append `?nostream` to the URL to load a static snapshot without the live SSE connection.
