# How it works

[← README](../README.md) · [Usage](usage.md) · [Metrics](metrics.md) · [Install](install.md)

## Data flow

```
~/.claude/{projects,sessions,jobs}
        │  fs.watch (recursive, 300 ms debounce)
        ▼
   server.mjs ──► /api/data    JSON snapshot: directories → sessions → spans
        │      └─ /api/stream  SSE `update` event on any change
        ▼
    browser  ──► refetch, derive per-session & per-day aggregates, redraw
```

The server never writes to `~/.claude/`; transcripts are read, parsed, and cached by mtime.

## Layout

```
claude-session-timeline/
├── server.mjs              # zero-dep HTTP server: static + /api/data + /api/stream (SSE); fs.watch
├── lib/
│   ├── parse.mjs           # one transcript .jsonl → span lanes (agent / user / tool / subagent)
│   ├── user-activity.mjs   # estimates user reading/typing time (no keyboard signal in the logs)
│   └── scan.mjs            # scan sessions + subagents, overlay live status, group by cwd (mtime-cached)
├── public/
│   ├── index.html          # markup only
│   ├── styles.css
│   └── js/
│       ├── format.js       # tiny pure helpers (dates, durations, escaping)
│       ├── state.js        # shared app state + window presets
│       ├── metrics.js      # concurrency / interval math (incl. work-hours union + bridge)
│       ├── heatmap.js      # month calendar heatmap
│       ├── dirfilter.js    # directory checkbox filter (scopes stats / chart / heatmap / timeline)
│       ├── controls.js     # window presets + Live
│       ├── render.js       # ruler, rows, subagents, chart, stats
│       ├── interactions.js # zoom / pan / range-select / hover
│       ├── data.js         # fetch + enrich (per-session & per-day) + live SSE
│       └── main.js         # entry point
├── scripts/
│   ├── install-launchagent.sh
│   └── uninstall-launchagent.sh
└── docs/
```

The front end is plain classic scripts sharing one global scope — no build step, no bundler.
Edit a file, reload the page.

## Where the transcripts live

- `~/.claude/projects/<project-dir>/<sessionId>.jsonl` — one session transcript. Rows are grouped
  by the `cwd` recorded *inside* the transcript, not by the directory name.
- `~/.claude/projects/<project-dir>/<sessionId>/subagents/agent-<id>.jsonl` — one `Task` run, with
  an `agent-<id>.meta.json` sidecar carrying its agent type and description.
- `~/.claude/sessions` and `~/.claude/jobs` supply live status (working / awaiting input / idle)
  and the freshest session name.

## Constants worth tuning

| Constant | File | Effect |
| --- | --- | --- |
| `IDLE_MS` (5 min) | `lib/parse.mjs` | gap that splits an agent turn into separate spans |
| reading / typing speeds & caps | `lib/user-activity.mjs` | the user-time model ([details](metrics.md#estimating-user-time)) |
| `WORK_BRIDGE_MS` (15 min) | `public/js/metrics.js` | gap bridged when stitching work-hours |
| averaging window (5 min) | `public/js/render.js` | the concurrency chart's sliding window |

## Notes

- Timestamps are UTC in the logs and rendered in your local time.
- Parsing is cached per file mtime, so a redraw on a busy machine only re-reads what changed.
