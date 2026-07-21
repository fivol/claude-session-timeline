import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTranscript } from './parse.mjs';
import { resolveUserAttention } from './user-activity.mjs';

const HOME = os.homedir();
const PROJECTS = path.join(HOME, '.claude', 'projects');
const SESSIONS = path.join(HOME, '.claude', 'sessions');
const JOBS = path.join(HOME, '.claude', 'jobs');

// Re-parse a transcript only when its mtime changes.
const cache = new Map(); // filePath -> { mtimeMs, model }

function listSessionFiles() {
  const out = [];
  if (!fs.existsSync(PROJECTS)) return out;
  for (const dir of fs.readdirSync(PROJECTS)) {
    const projDir = path.join(PROJECTS, dir);
    let st;
    try { st = fs.statSync(projDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(projDir)) {
      // Top-level session transcripts only; subagents live one level down.
      if (f.endsWith('.jsonl')) {
        out.push({ fp: path.join(projDir, f), projDir, sessionId: f.replace(/\.jsonl$/, '') });
      }
    }
  }
  return out;
}

function parseCached(fp) {
  let st;
  try { st = fs.statSync(fp); } catch { return null; }
  const c = cache.get(fp);
  if (c && c.mtimeMs === st.mtimeMs) return c.model;
  let model;
  try { model = parseTranscript(fp); } catch { return null; }
  cache.set(fp, { mtimeMs: st.mtimeMs, model });
  return model;
}

// Sub-agent (Task) runs live in <sessionId>/subagents/agent-<id>.jsonl,
// each with an agent-<id>.meta.json sidecar (agentType, description, toolUseId).
function collectSubagents(projDir, sessionId) {
  const dir = path.join(projDir, sessionId, 'subagents');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue;
    const m = parseCached(path.join(dir, f));
    if (!m || m.firstTs === null) continue;
    const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, `agent-${agentId}.meta.json`), 'utf8')); } catch { /* ok */ }
    out.push({
      agentId,
      agentType: meta.agentType || null,
      description: meta.description || (m.prompts[0]?.head || '').slice(0, 60) || agentId.slice(0, 8),
      toolUseId: meta.toolUseId || null,
      depth: meta.spawnDepth || 1,
      firstTs: m.firstTs,
      lastTs: m.lastTs,
      // A subagent has no human at the keyboard — its "prompt" comes from the
      // parent agent, so estimated reading/typing spans are meaningless here.
      spans: m.spans.filter((sp) => sp.lane !== 'user'),
    });
  }
  return out.sort((a, b) => a.firstTs - b.firstTs);
}

// Overlay live status (busy/idle/waiting) and human names from the daemon files.
function liveStatus() {
  const map = new Map();
  if (fs.existsSync(SESSIONS)) {
    for (const f of fs.readdirSync(SESSIONS)) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(SESSIONS, f), 'utf8'));
        if (d.sessionId) map.set(d.sessionId, { status: d.status, name: d.name, kind: d.kind, updatedAt: d.updatedAt });
      } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(JOBS)) {
    for (const j of fs.readdirSync(JOBS)) {
      const sp = path.join(JOBS, j, 'state.json');
      try {
        const d = JSON.parse(fs.readFileSync(sp, 'utf8'));
        if (d.sessionId) {
          const cur = map.get(d.sessionId) || {};
          map.set(d.sessionId, { ...cur, name: cur.name || d.name, jobState: d.state, tempo: d.tempo, intent: d.intent });
        }
      } catch { /* ignore */ }
    }
  }
  return map;
}

export function collectData() {
  const live = liveStatus();
  const sessions = [];
  for (const { fp, projDir, sessionId } of listSessionFiles()) {
    const m = parseCached(fp);
    if (!m || !m.sessionId || m.firstTs === null) continue;
    const l = live.get(m.sessionId) || {};
    const subagents = collectSubagents(projDir, sessionId);
    sessions.push({
      sessionId: m.sessionId,
      cwd: m.cwd || null,
      name: l.name || m.sessionId.slice(0, 8),
      status: l.status || l.jobState || 'idle',
      tempo: l.tempo || null,
      kind: l.kind || null,
      version: m.version,
      gitBranch: m.gitBranch,
      firstTs: m.firstTs,
      lastTs: m.lastTs,
      spans: m.spans,
      prompts: m.prompts,
      subagents,
    });
  }

  // A human attends to one session at a time, so the per-session user-time
  // estimates can't truly overlap — resolve them onto one shared timeline.
  // (New arrays/objects only; the mtime-cached span arrays stay untouched.)
  const userSpans = [];
  for (const s of sessions) {
    for (const sp of s.spans) if (sp.lane === 'user') userSpans.push({ ...sp, sid: s.sessionId });
  }
  const resolved = new Map(); // sessionId -> exclusive user spans
  for (const sp of resolveUserAttention(userSpans)) {
    const { sid, ...rest } = sp;
    (resolved.get(sid) || resolved.set(sid, []).get(sid)).push(rest);
  }
  for (const s of sessions) {
    if (!s.spans.some((sp) => sp.lane === 'user')) continue;
    const others = s.spans.filter((sp) => sp.lane !== 'user');
    s.spans = [...others, ...(resolved.get(s.sessionId) || [])].sort((a, b) => a.start - b.start);
  }

  const groups = new Map();
  for (const s of sessions) {
    const key = s.cwd || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const groupArr = [...groups.entries()]
    .map(([cwd, ss]) => ({
      cwd,
      sessions: ss.sort((a, b) => b.lastTs - a.lastTs),
      lastActivity: Math.max(...ss.map((s) => s.lastTs)),
    }))
    .sort((a, b) => b.lastActivity - a.lastActivity);

  return { generatedAt: Date.now(), groups: groupArr };
}
