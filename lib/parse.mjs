import fs from 'node:fs';
import { capToolEnd, gapSpans, leadInSpans } from './user-activity.mjs';

// Fields we probe, in priority order, to describe what a tool call acted on.
const TOOL_TARGET_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];

// Gaps longer than this with no events are treated as idle, not as activity:
// a user is not "reading/typing" for hours, and the agent is not "working"
// across a multi-hour pause. Idle time is left blank (grid shows through).
// (How the user's reading/typing time itself is modelled lives in ./user-activity.mjs.)
const IDLE_MS = 5 * 60 * 1000;

function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  for (const key of TOOL_TARGET_KEYS) {
    if (input[key]) return String(input[key]).split('\n')[0].slice(0, 80);
  }
  return '';
}

const ms = (ts) => Date.parse(ts);

/**
 * Parse one Claude Code transcript (.jsonl) into a timeline model.
 *
 * Reconstructed span lanes:
 *   agent    — active bursts within a turn (prompt → agent output/tools), split on idle gaps
 *   user     — reading then typing in the gap before the next prompt (see ./user-activity.mjs)
 *   tool     — a single tool call, from its tool_use to the matching tool_result
 *   subagent — same, but for Task/Agent tool calls
 */
export function parseTranscript(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let sessionId = null, cwd = null, version = null, gitBranch = null, title = null;
  const prompts = [];          // { ts, text }
  const agentActivity = [];    // number[] — assistant + tool_result timestamps
  const assistantChars = [];   // { ts, chars } — assistant text volume, for the reading estimate
  const toolStart = new Map(); // tool_use_id -> { name, target, ts, isTask }
  const toolSpans = [];
  let firstTs = null, lastTs = null;

  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let d;
    try { d = JSON.parse(s); } catch { continue; }

    if (!sessionId && d.sessionId) sessionId = d.sessionId;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (!version && d.version) version = d.version;
    if (!gitBranch && d.gitBranch) gitBranch = d.gitBranch;
    // The human-readable session name is persisted into the transcript itself
    // (ai-title / agent-name lines), so it survives after the live daemon/job
    // files are gone. Keep the latest — a session can be renamed over its life.
    if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle;
    else if (d.type === 'agent-name' && d.agentName) title = d.agentName;

    const t = d.timestamp ? ms(d.timestamp) : null;
    if (t != null && !Number.isNaN(t)) {
      if (firstTs === null || t < firstTs) firstTs = t;
      if (lastTs === null || t > lastTs) lastTs = t;
    }

    const content = (d.message || {}).content;

    if (d.type === 'user' && t != null) {
      let isToolResult = false, text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'tool_result') {
            isToolResult = true;
            agentActivity.push(t); // the result arriving is agent-side activity
            const st = toolStart.get(b.tool_use_id);
            if (st) {
              toolSpans.push({
                lane: st.isTask ? 'subagent' : 'tool',
                label: `${st.name} ${st.target}`.trim(),
                tool: st.name,
                start: st.ts,
                end: capToolEnd(st.name, st.ts, t),
                isError: !!b.is_error,
              });
              toolStart.delete(b.tool_use_id);
            }
          } else if (b && b.type === 'text') {
            text += b.text || '';
          }
        }
      }
      if (!isToolResult) prompts.push({ ts: t, text: text.trim() });
    } else if (d.type === 'assistant' && Array.isArray(content)) {
      if (t != null) agentActivity.push(t);
      let textChars = 0;
      for (const b of content) {
        if (b && b.type === 'text') textChars += (b.text || '').length;
        if (b && b.type === 'tool_use' && t != null) {
          const isTask = b.name === 'Task' || b.name === 'Agent';
          toolStart.set(b.id, { name: b.name, target: toolTarget(b.input), ts: t, isTask });
        }
      }
      if (t != null && textChars) assistantChars.push({ ts: t, chars: textChars });
    }
  }

  // Tool calls with no result yet (in-flight at capture time) stay open to lastTs.
  for (const [, st] of toolStart) {
    toolSpans.push({
      lane: st.isTask ? 'subagent' : 'tool',
      label: `${st.name} ${st.target}`.trim(),
      tool: st.name,
      start: st.ts,
      end: capToolEnd(st.name, st.ts, lastTs || st.ts),
      isError: false,
      open: true,
    });
  }

  prompts.sort((a, b) => a.ts - b.ts);
  agentActivity.sort((a, b) => a - b);

  const turns = [];
  for (let i = 0; i < prompts.length; i++) {
    const pStart = prompts[i].ts;
    const pNext = i + 1 < prompts.length ? prompts[i + 1].ts : null;

    // The first prompt has no preceding agent turn — give it a typing lead-in.
    if (i === 0) turns.push(...leadInSpans(pStart, prompts[i].text));

    const acts = agentActivity.filter((x) => x >= pStart && (pNext === null || x < pNext));

    // Agent-working bursts, seeded at the prompt, split whenever a gap exceeds IDLE_MS.
    let segStart = pStart, prev = pStart;
    for (const x of acts) {
      if (x - prev > IDLE_MS) {
        if (prev > segStart) turns.push({ lane: 'agent', label: 'working', start: segStart, end: prev });
        segStart = x;
      }
      prev = x;
    }
    if (prev > segStart) turns.push({ lane: 'agent', label: 'working', start: segStart, end: prev });

    // User time in the gap before the next prompt: reading (sized by this turn's
    // output volume) then typing (sized by the next prompt) — see ./user-activity.mjs.
    const agentEnd = prev;
    if (pNext !== null) {
      const readChars = assistantChars
        .filter((a) => a.ts >= pStart && a.ts < pNext)
        .reduce((sum, a) => sum + a.chars, 0);
      turns.push(...gapSpans(agentEnd, pNext, { promptText: prompts[i + 1].text, readChars }));
    }
  }

  return {
    sessionId,
    cwd,
    title,
    version,
    gitBranch,
    firstTs,
    lastTs,
    prompts: prompts.map((p) => ({ ts: p.ts, head: p.text.slice(0, 80) })),
    spans: [...turns, ...toolSpans].sort((a, b) => a.start - b.start),
  };
}
