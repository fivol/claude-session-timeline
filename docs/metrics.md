# Metrics

[← README](../README.md) · [Usage](usage.md) · [Install](install.md) · [How it works](architecture.md)

Every figure covers the **current window**, or the **drag-selected range** if there is one, and
only the directories left ticked in the [directory filter](usage.md#directory-filter).

## The stats bar

| Stat | What it means |
| --- | --- |
| **window** / **selection** | the range every other number covers |
| **sessions** | sessions with any activity inside the range |
| **directories** | distinct working directories among them |
| **max parallel** | most agents working at the very same instant |
| **avg parallel** | time-weighted mean agents at once = agent-hours ÷ range length (idle time drags it down) |
| **avg while active** | same, but only over time when ≥1 agent worked = agent-hours ÷ any-agent-active |
| **any-agent active** | wall-clock time at least one agent worked — the union, so overlap counts once |
| **agent-hours** | agent time summed per session, so parallel work counts once *per session* and the total can exceed the range |
| **user-hours** | estimated reading + typing time, de-overlapped across sessions |
| **work-hours** | approximate wall-clock actually spent working with agents (below) |
| **working now** | sessions whose agent is running right now |

Two of these read together tell you the most: **agent-hours ÷ work-hours** is roughly how much
machine work you got out of each hour at the desk. **max parallel** vs **avg while active** says
whether that came from steady multi-tasking or from a couple of short bursts.

## work-hours

The headline number, highlighted in the bar. It's the union of every session's **agent-working**
and **user reading/typing** spans, with gaps shorter than **15 min** bridged over.

Agent-active time alone undercounts a day — it skips the reading and typing between turns and
shatters into fragments. Bridging short gaps keeps a pause to think, a quick read, or a glance
away inside the same sitting, while a longer "away from the desk" gap still splits it. The result
is close to how long you were genuinely working *with* agents.

## Concurrency chart

Above the timeline, the chart plots concurrency over time as a sliding-window average over a
**fixed 5-minute window**, independent of zoom — so the value under the crosshair always reads as
"agents working, averaged over the surrounding 5 minutes". Horizontal gridlines mark whole
agent-count levels for height reference; the exact peak is in the label on the left.

Concurrency is computed from each session's merged agent-working intervals, so "parallel" means
*actually running at the same time*, not merely open.

## How activity is derived

Spans come from the transcript's event timestamps, with an **idle threshold** (`IDLE_MS`, 5 min,
in [`lib/parse.mjs`](../lib/parse.mjs)):

- **agent working** — from a prompt through the agent's messages and tool calls, split wherever
  there's a gap longer than the threshold.
- **tool / subagent** — exact, from each `tool_use` to its `tool_result`. Tools that block on a
  human (currently `AskUserQuestion`) are capped at **1 min**, so waiting on your answer isn't
  drawn as tool work.
- **user reading / typing** — *estimated*; see below.

## Estimating user time

The transcript records when each prompt was submitted and every agent event, but nothing about
what the human did in between — no keystrokes, no focus, no "typing" flag.
[`lib/user-activity.mjs`](../lib/user-activity.mjs) models the gap between the agent finishing and
the next prompt as **reading → idle → typing** (a person does one thing at a time, so the two
never overlap):

- **typing** — a prompt is sent the instant Enter is pressed, so submission is the *end* of
  typing. We walk back from it by an estimate from the prompt's length (~40 wpm), **capped at
  4 min** because a very long prompt was almost certainly pasted rather than typed. Typing is
  anchored to a real event and takes precedence over reading.
- **reading** — right after the agent stops, sized by how much text it produced (~200 wpm) and
  **capped at 2 min**, so a long pause isn't drawn as active reading.
- **idle** — whatever is left in the middle stays blank. "Thinking at the keyboard" and "away from
  the desk" are indistinguishable in the logs, so nothing is invented there.

A person also attends to **one session at a time**, yet each transcript is modelled on its own —
so estimates from parallel sessions would otherwise claim the same person twice. A final pass
(`resolveUserAttention`) lays every user span on one shared attention timeline and trims the
collisions: typing outranks estimated reading, an earlier span keeps its window while a later one
is pushed into free time, and a reading span can be split when a quick prompt to another session
lands in its middle. Agent and tool spans are left alone — agents genuinely do run at once.

The speed and cap constants live together at the top of `lib/user-activity.mjs`; the bridge gap
(`WORK_BRIDGE_MS`) is at the top of [`public/js/metrics.js`](../public/js/metrics.js).

**These spans are estimates, not measurements.** Treat user-hours and work-hours as a good
approximation of your day, not as a timesheet.

## What it can't show

Passive viewing — scrolling a session, switching chats without acting — leaves no trace. Claude
Code records no TUI focus or navigation events anywhere (even its internal telemetry has none),
so no tool can reconstruct them. Idle time between turns is left blank rather than guessed at.
