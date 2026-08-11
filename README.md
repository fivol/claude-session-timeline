# Claude Code — Session Timeline

A live Gantt of your **Claude Code** sessions, grouped by working directory and read straight
from the local transcripts in `~/.claude/`. No hooks, no config changes, no dependencies —
just point a browser at it.

![Session timeline dashboard](docs/screenshots/overview.png)

## What it's for

Claude Code records everything it does, but never shows you the shape of your day. This turns
those transcripts into a picture you can read at a glance:

- **See your progress** — every session on one time axis: when the agent worked, what it ran,
  when you were reading or typing back.
- **Watch how loaded your agents are** — how many ran at the same time, when you were driving a
  fleet and when a single one was blocking you.
- **Count hours per project and per job** — sessions are grouped by working directory, and the
  directory filter scopes every number to one project, one client, or "work only".
- **Measure time actually spent working** — *work-hours* stitches agent time and your
  reading/typing into continuous sittings, so you get a realistic day length, not a sum of bursts.
- **Track parallelism** — max / average concurrent agents, plus a chart of concurrency over
  time: how much of your throughput comes from running things side by side.
- **Judge efficiency** — compare *agent-hours* against *work-hours* to see how much machine work
  you get out of an hour at the desk, and where a session sat waiting on you instead.
- **Spot trends** — the month heatmap shows heavy and quiet days at a glance; open any day or
  range to see what actually happened.

Everything is read locally and read-only. Nothing is written to `~/.claude/`, nothing leaves
your machine.

## Run

```bash
npm start
```

Then open the URL it prints (http://localhost:5555 when the port is free). Node 18+, no install
step — there are no dependencies.

## Docs

- [Using the board](docs/usage.md) — navigation, filters, the calendar, subagents, tooltips.
- [Metrics](docs/metrics.md) — what every number means, how activity is derived, and what the
  transcripts can't tell you.
- [Install & autostart](docs/install.md) — ports, running at login on macOS, options.
- [How it works](docs/architecture.md) — data flow, project layout, tunable constants.
