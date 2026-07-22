// Modelling "user time" in a Claude Code session.
//
// A transcript records *when* things happened but not what the human was doing
// between turns. Claude Code logs the exact timestamp a prompt is submitted and
// every agent event (assistant messages, tool results) — but nothing about the
// keyboard: no keystrokes, no focus, no "user is typing" signal. So the time
// between the agent finishing and the next prompt has to be *estimated*.
//
// We split that gap into three parts and only draw the two we can defend:
//
//     agent done                                        next prompt sent
//         │                                                     │
//         ▼                                                     ▼
//         ├──────────────┬───────────────────────┬─────────────┤
//         │   reading    │        idle           │   typing    │
//         └──────────────┴───────────────────────┴─────────────┘
//          sized by the        left blank —        sized by the
//          agent's output      we can't tell       next prompt's
//          (≤ READ_CAP_MS)     "thinking at the    length
//                              keyboard" from
//                              "away from it"
//
//   • typing  — a prompt is submitted the instant the user hits enter, so the
//               submission timestamp is the *end* of typing. We walk backwards
//               from it by an estimate derived from the prompt's length. Typing
//               is anchored to the prompt and takes precedence over reading.
//   • reading — right after the agent stops, the user reads the reply. Sized by
//               how much text the agent produced, capped at READ_CAP_MS so a
//               multi-hour pause is never shown as active reading.
//   • idle    — the remainder. We deliberately leave it blank instead of
//               guessing: thinking-at-the-keyboard and away-from-desk are
//               indistinguishable from the logs.
//
// The two spans never overlap — a person does one thing at a time. When the gap
// is too short to hold both, typing wins (it's the better-grounded signal) and
// reading is squeezed, or dropped entirely.
//
// Speed assumptions (rough, deliberately conservative; tune here in one place):
//   • Typing ≈ 40 wpm. At the standard 5 characters/word that's ~200 chars/min
//     → 300 ms per character. This is an average-adult rate; it over-estimates
//     pasted text, but such spans are clamped to the available gap anyway.
//   • Reading ≈ 200 wpm (~1000 chars/min → 60 ms/char). Silent prose reading
//     averages ~238 wpm (Brysbaert 2019); agent output is often code/technical
//     and read more slowly, so we round down.

// ── tunable constants (module-internal knobs; edit here) ───────────────────
const TYPE_MS_PER_CHAR = 60_000 / 200;   // ~40 wpm
const READ_MS_PER_CHAR = 60_000 / 1000;  // ~200 wpm
const READ_CAP_MS = 2 * 60_000;          // reading never shown longer than this

// Tools that block on the human: their result can arrive long after the agent
// stopped working, so the span is really "waiting for a person", not activity.
const WAIT_CAP_MS = 60_000;
const WAIT_TOOLS = new Set(['AskUserQuestion']);

// ── estimators ─────────────────────────────────────────────────────────────
const typingMs = (text) => Math.round((text ? text.length : 0) * TYPE_MS_PER_CHAR);
const readingMs = (chars) => Math.min(READ_CAP_MS, Math.round((chars || 0) * READ_MS_PER_CHAR));

/**
 * Cap the end of a "waits for the human" tool span (e.g. AskUserQuestion) so the
 * time spent waiting for the user's answer doesn't inflate the tool's duration.
 * Other tools are returned unchanged.
 */
export const capToolEnd = (name, startTs, end) =>
  (WAIT_TOOLS.has(name) ? Math.min(end, startTs + WAIT_CAP_MS) : end);

/**
 * User spans for the gap between the agent finishing (`gapStart`) and the next
 * prompt being submitted (`gapEnd`): a `reading` span then a `typing` span, with
 * idle time left blank between them. The two never overlap.
 *
 * @param {number} gapStart  ms — when the agent's last activity ended
 * @param {number} gapEnd    ms — when the next prompt was submitted
 * @param {object} ctx
 * @param {string} ctx.promptText  the next prompt's text (sizes `typing`)
 * @param {number} ctx.readChars   chars the agent produced this turn (sizes `reading`)
 * @returns {Array<{lane:'user', label:'reading'|'typing', start:number, end:number}>}
 */
export function gapSpans(gapStart, gapEnd, { promptText = '', readChars = 0 } = {}) {
  const out = [];
  if (gapEnd <= gapStart) return out;
  // Typing is anchored to the prompt and clamped to the gap; it wins over reading.
  const typeStart = Math.max(gapStart, gapEnd - typingMs(promptText));
  // Reading fills the front of the gap up to where typing begins, capped.
  const readEnd = Math.min(gapStart + readingMs(readChars), typeStart);
  if (readEnd > gapStart) out.push({ lane: 'user', label: 'reading', start: gapStart, end: readEnd });
  if (gapEnd > typeStart) out.push({ lane: 'user', label: 'typing', start: typeStart, end: gapEnd });
  return out;
}

/**
 * Typing lead-in for the very first prompt of a session — there's no agent turn
 * before it, so it gets only an estimated `typing` span ending at submission.
 */
export function leadInSpans(promptTs, promptText) {
  const t = typingMs(promptText);
  return t > 0 ? [{ lane: 'user', label: 'typing', start: promptTs - t, end: promptTs }] : [];
}

// A single human attends to one session at a time, but each transcript is
// modelled on its own — so estimated reading/typing from sessions running in
// parallel can overlap in wall-clock time, which is impossible. `resolveUserAttention`
// lays every user span from every session on one shared "attention" timeline and
// resolves the collisions: higher-confidence spans claim their time first and the
// lower-confidence overlap is trimmed away (a span may be split if a briefer, more
// certain one lands in its middle — glance away, fire off a prompt, glance back).
//
// Confidence order (claims time first):
//   1. typing before reading — typing ends at a real prompt submission; reading is
//      a pure estimate with no hard anchor.
//   2. earlier end before later — the demand that resolved first owns its window;
//      a later one is pushed into whatever time is still free.

const MIN_ATTENTION_MS = 250; // drop trimming slivers shorter than this

// Sub-intervals of [start,end] not already covered by `occupied` (sorted, merged).
function freeParts(start, end, occupied) {
  const parts = [];
  let cur = start;
  for (const [s, e] of occupied) {
    if (e <= cur) continue;
    if (s >= end) break;
    if (s > cur) parts.push([cur, s]);
    cur = Math.max(cur, e);
    if (cur >= end) break;
  }
  if (cur < end) parts.push([cur, end]);
  return parts;
}

// Insert [start,end] into `occupied` (sorted, non-overlapping), merging neighbours.
function addInterval(occupied, start, end) {
  let i = 0;
  while (i < occupied.length && occupied[i][1] < start) i++;
  let s = start, e = end, j = i;
  while (j < occupied.length && occupied[j][0] <= e) {
    s = Math.min(s, occupied[j][0]);
    e = Math.max(e, occupied[j][1]);
    j++;
  }
  occupied.splice(i, j - i, [s, e]);
}

/**
 * Make user spans mutually exclusive in wall-clock time across sessions. Input is
 * every user span (each carrying whatever owner field the caller needs, e.g. a
 * session id); output is the trimmed set, preserving those extra fields. Spans of
 * other lanes (agent/tool/subagent) are the caller's concern — agents really do
 * run in parallel, so only user time is made exclusive.
 */
function resolveUserAttention(spans) {
  const priority = (sp) => (sp.label === 'typing' ? 0 : 1);
  const ordered = spans
    .map((sp, i) => ({ sp, i }))
    .sort((a, b) => priority(a.sp) - priority(b.sp) || a.sp.end - b.sp.end || a.i - b.i);
  const occupied = [];
  const kept = [];
  for (const { sp } of ordered) {
    for (const [s, e] of freeParts(sp.start, sp.end, occupied)) {
      if (e - s >= MIN_ATTENTION_MS) kept.push({ ...sp, start: s, end: e });
    }
    addInterval(occupied, sp.start, sp.end); // the whole demand claims the time
  }
  return kept;
}

/**
 * Make every session's user spans mutually exclusive in wall-clock time, in place.
 * Collects the user spans from all sessions onto one attention timeline, resolves the
 * collisions, then rewrites each session's `spans` with its resolved share. Non-user
 * spans (agent/tool/subagent) are left untouched — only new arrays are assigned, so
 * any shared/cached source span arrays stay intact.
 */
export function applyUserAttention(sessions) {
  const spans = [];
  const hadUser = new Set();
  for (const s of sessions) {
    for (const sp of s.spans) {
      if (sp.lane === 'user') { spans.push({ ...sp, sid: s.sessionId }); hadUser.add(s.sessionId); }
    }
  }
  if (!spans.length) return;
  const bySid = new Map();
  for (const sp of resolveUserAttention(spans)) {
    const { sid, ...rest } = sp;
    if (!bySid.has(sid)) bySid.set(sid, []);
    bySid.get(sid).push(rest);
  }
  for (const s of sessions) {
    if (!hadUser.has(s.sessionId)) continue;
    const others = s.spans.filter((sp) => sp.lane !== 'user');
    s.spans = [...others, ...(bySid.get(s.sessionId) || [])].sort((a, b) => a.start - b.start);
  }
}
