import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTranscript } from './parse.mjs';
import { applyUserAttention } from './user-activity.mjs';

const HOME = os.homedir();
const PROJECTS = path.join(HOME, '.claude', 'projects');
const SESSIONS = path.join(HOME, '.claude', 'sessions');
const JOBS = path.join(HOME, '.claude', 'jobs');

// Re-parse a transcript only when its mtime changes.
const cache = new Map(); // filePath -> { mtimeMs, model }

// A "real" name is anything other than the short-hash placeholder that Claude
// Code uses before (or in the absence of) a generated title.
const isRealName = (name, sessionId) => !!name && name !== sessionId.slice(0, 8);

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
          // The job's state.json carries the real generated name; the session
          // daemon file often only has the short hash — so let a real job name win.
          const name = isRealName(cur.name, d.sessionId) ? cur.name : (d.name || cur.name);
          map.set(d.sessionId, { ...cur, name, jobState: d.state, tempo: d.tempo, intent: d.intent });
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
    // Prefer the freshest live name, then the durable transcript title (survives
    // job/session-file deletion), then the first real prompt, then the hash.
    const liveName = isRealName(l.name, m.sessionId) ? l.name : null;
    const promptName = (m.prompts.find((p) => {
      const h = (p.head || '').trim();
      return h && !h.startsWith('<');
    })?.head || '').trim();
    sessions.push({
      sessionId: m.sessionId,
      cwd: m.cwd || null,
      name: liveName || m.title || promptName || m.sessionId.slice(0, 8),
      model: m.model || null,
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
  applyUserAttention(sessions);

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
