import fs from 'node:fs';

// Fields we probe, in priority order, to describe what a tool call acted on.
const TOOL_TARGET_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'prompt'];

// Gaps longer than this with no events are treated as idle, not as activity:
// a user is not "reading/typing" for hours, and the agent is not "working"
// across a multi-hour pause. Idle time is left blank (grid shows through).
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
 *   user     — the gap after the agent finishes until the next prompt, CAPPED at IDLE_MS
 *   tool     — a single tool call, from its tool_use to the matching tool_result
 *   subagent — same, but for Task/Agent tool calls
 */
export function parseTranscript(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let sessionId = null, cwd = null, version = null, gitBranch = null;
  const prompts = [];          // { ts, text }
  const agentActivity = [];    // number[] — assistant + tool_result timestamps
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
                end: t,
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
      for (const b of content) {
        if (b && b.type === 'tool_use' && t != null) {
          const isTask = b.name === 'Task' || b.name === 'Agent';
          toolStart.set(b.id, { name: b.name, target: toolTarget(b.input), ts: t, isTask });
        }
      }
    }
  }

  // Tool calls with no result yet (in-flight at capture time) stay open to lastTs.
  for (const [, st] of toolStart) {
    toolSpans.push({
      lane: st.isTask ? 'subagent' : 'tool',
      label: `${st.name} ${st.target}`.trim(),
      tool: st.name,
      start: st.ts,
      end: lastTs || st.ts,
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

    // User reading/typing: from the agent's last activity to the next prompt, capped.
    const agentEnd = prev;
    if (pNext !== null) {
      const uEnd = Math.min(pNext, agentEnd + IDLE_MS);
      if (uEnd > agentEnd) turns.push({ lane: 'user', label: 'reading / typing', start: agentEnd, end: uEnd });
    }
  }

  return {
    sessionId,
    cwd,
    version,
    gitBranch,
    firstTs,
    lastTs,
    prompts: prompts.map((p) => ({ ts: p.ts, head: p.text.slice(0, 80) })),
    spans: [...turns, ...toolSpans].sort((a, b) => a.start - b.start),
  };
}
