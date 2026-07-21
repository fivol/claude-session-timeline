// Timeline rendering: ruler, rows, subagents, the avg-parallel chart, stats bar.

// "Nice" ruler steps, aligned to round clock times (…, 15m, 30m, 1h, …).
const RULER_STEPS = [
  60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3, 30 * 60e3,
  60 * 60e3, 2 * 60 * 60e3, 3 * 60 * 60e3, 6 * 60 * 60e3, 12 * 60 * 60e3,
  24 * 3600e3, 2 * 24 * 3600e3, 7 * 24 * 3600e3, 14 * 24 * 3600e3,
];
function rulerStep(span, target) {
  for (const s of RULER_STEPS) if (span / s <= target) return s;
  return RULER_STEPS[RULER_STEPS.length - 1];
}
const localMidnight = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

function ruler(tMin, tMax) {
  const track = document.createElement('div');
  track.className = 'track ruler';
  const span = tMax - tMin;
  const step = rulerStep(span, 9);
  // Align ticks to the local-midnight grid so they land on round clock times.
  const base = localMidnight(tMin);
  for (let t = base + Math.ceil((tMin - base) / step) * step; t <= tMax; t += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = pct(t, tMin, tMax) + '%';
    const s = document.createElement('span');
    s.textContent = fmt(t, span);
    tick.appendChild(s);
    track.appendChild(tick);
  }
  return track;
}

function statusInfo(s) {
  const st = (s.status || '').toLowerCase();
  if (st === 'busy' || s.tempo === 'working') return { color: 'var(--busy)', on: true, text: 'working' };
  if (st === 'waiting') return { color: 'var(--waiting)', on: false, text: 'awaiting input' };
  return { color: 'var(--idle)', on: false, text: st || 'idle' };
}

function addBars(track, spans, tMin, tMax, span, isSub) {
  for (const sp of spans) {
    if (sp.end < tMin || sp.start > tMax) continue;
    const left = pct(sp.start, tMin, tMax), right = pct(sp.end, tMin, tMax);
    const isTurn = sp.lane === 'agent' || sp.lane === 'user';
    const laneClass = (isSub && sp.lane === 'agent') ? 'subagent' : sp.lane;
    const bar = document.createElement('div');
    bar.className = `bar ${isTurn ? 'turn' : 'sub'} ${laneClass}${sp.isError ? ' err' : ''}`;
    bar.style.left = left + '%';
    bar.style.width = Math.max(0.3, right - left) + '%';
    bar._span = sp; // read by the hover handler to build a rich tooltip
    track.appendChild(bar);
  }
}

// Rich hover tooltip for a single span bar (tool, subagent, agent or user).
const LANE_COLOR = { tool: 'var(--tool)', subagent: 'var(--subagent)', agent: 'var(--agent)', user: 'var(--user)' };
function barTipHtml(sp, span) {
  const sw = `<i class="tipsw" style="background:${LANE_COLOR[sp.lane] || 'var(--muted)'}"></i>`;
  const time = `${fmt(sp.start, span)} → ${fmt(sp.end, span)} · ${dur(sp.end - sp.start)}`;
  let head, kind = '', target = '';
  if (sp.lane === 'tool' || sp.lane === 'subagent') {
    head = escapeHtml(sp.tool || sp.label || sp.lane);
    kind = sp.lane === 'subagent' ? 'subagent' : 'tool';
    target = (sp.tool && sp.label) ? sp.label.slice(sp.tool.length).trim() : '';
  } else if (sp.lane === 'agent') {
    head = 'agent working';
  } else {
    head = sp.label === 'typing' ? 'user typing' : 'user reading';
    if (sp.label) kind = 'estimated';
  }
  let html = `${sw}<strong>${head}</strong>`;
  if (kind) html += ` <span class="tipkind">${kind}</span>`;
  if (target) html += `<br>${escapeHtml(target)}`;
  html += `<br>${time}`;
  if (sp.isError) html += ` · <span class="tipwarn">error</span>`;
  if (sp.open) html += ' · running…';
  return html;
}

function nowLine(track, now, tMin, tMax) {
  if (now < tMin || now > tMax) return;
  const nl = document.createElement('div');
  nl.className = 'nowline';
  nl.style.left = pct(now, tMin, tMax) + '%';
  track.appendChild(nl);
}

function renderChart(sessions, tMin, tMax, now) {
  const box = $('#chart');
  if (!sessions.length) { box.innerHTML = ''; chartState = null; return; }
  const span = tMax - tMin;
  const W = clamp(span / 20, 60e3, span);
  const prof = concurrencyProfile(sessions, tMin, tMax);
  chartState = { prof, W, tMin, tMax };
  const N = 240, H = 64, WIDTH = 1000;
  const vals = [];
  let maxY = 0;
  for (let k = 0; k <= N; k++) {
    const t = tMin + (span * k) / N;
    const v = avgOver(prof, Math.max(tMin, t - W / 2), Math.min(tMax, t + W / 2));
    vals.push(v); if (v > maxY) maxY = v;
  }
  maxY = Math.max(maxY, 1);
  const x = (k) => ((k / N) * WIDTH).toFixed(1);
  const y = (v) => (H - (v / maxY) * (H - 4) - 2).toFixed(1);
  let area = `M 0 ${H} `, line = '';
  for (let k = 0; k <= N; k++) { area += `L ${x(k)} ${y(vals[k])} `; line += `${k ? 'L' : 'M'} ${x(k)} ${y(vals[k])} `; }
  area += `L ${WIDTH} ${H} Z`;
  const nowX = (now >= tMin && now <= tMax) ? (pct(now, tMin, tMax) / 100) * WIDTH : null;
  const nowMark = nowX !== null ? `<line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="${H}" stroke="var(--now)" stroke-width="2"/>` : '';
  box.innerHTML =
    `<div class="chart-row">` +
      `<div class="label-col"><span class="t">avg ∥ · peak ${maxY.toFixed(maxY >= 10 ? 0 : 1)}</span><span class="s">window ${dur(W)}</span></div>` +
      `<div class="track chart"><svg viewBox="0 0 ${WIDTH} ${H}" preserveAspectRatio="none">` +
        `<path d="${area}" fill="var(--agent)" opacity="0.28"/>` +
        `<path d="${line}" fill="none" stroke="var(--agent)" stroke-width="1.5"/>` + nowMark +
      `</svg></div>` +
    `</div>`;
}

function selectionRange() {
  return selection ? [Math.min(selection.start, selection.end), Math.max(selection.start, selection.end)] : null;
}
function statsSessions(a, b) {
  const out = [];
  for (const g of data.groups) for (const s of g.sessions) if (s.lastTs >= a && s.firstTs <= b) out.push(s);
  return out;
}
function refreshStats() {
  const sel = selectionRange();
  const [a, b] = sel || [view.tMin, view.tMax];
  const sess = statsSessions(a, b);
  const dirs = new Set(sess.map((s) => s.cwd || 'unknown')).size;
  const { max, avg, union } = concurrency(sess, a, b);
  const busy = sess.filter((s) => statusInfo(s).on).length;
  const agentHours = sess.reduce((sum, s) => sum + activeIntervals(s, a, b).reduce((x, [p, q]) => x + (q - p), 0), 0);
  const pills = [
    ['sessions', sess.length], ['directories', dirs],
    ['max parallel', max], ['avg parallel', avg.toFixed(2)],
    ['any-agent active', dur(union)], ['agent-hours', dur(agentHours)],
    ['working now', busy],
  ];
  const range = sel
    ? `<span class="pill sel">selection: <b>${dur(b - a)}</b> · click to clear</span>`
    : `<span class="pill">window: <b>${dur(b - a)}</b></span>`;
  $('#stats').innerHTML = range + pills.map(([k, v]) => `<span class="pill">${k}: <b>${v}</b></span>`).join('');
  positionSelBand();
}

function draw() {
  if (!view) return;
  const { tMin, tMax } = view;
  const now = Date.now();
  const span = tMax - tMin;
  const board = $('#board');
  board.innerHTML = '';

  const rulerRow = document.createElement('div');
  rulerRow.className = 'ruler-row';
  const rl = document.createElement('div'); rl.className = 'label-col'; rl.textContent = 'directory / session';
  rulerRow.appendChild(rl);
  rulerTrackEl = ruler(tMin, tMax);
  rulerRow.appendChild(rulerTrackEl);
  board.appendChild(rulerRow);

  const visibleSessions = [];
  for (const g of data.groups) {
    const sessions = g.sessions.filter((s) => s.lastTs >= tMin && s.firstTs <= tMax);
    if (!sessions.length) continue;
    visibleSessions.push(...sessions);
    const collapsed = collapsedGroups.has(g.cwd);
    const conc = concurrency(sessions, tMin, tMax);
    const gh = document.createElement('div');
    gh.className = 'group-header';
    gh.innerHTML =
      `<span class="gtoggle">${collapsed ? '▸' : '▾'}</span><span>${escapeHtml(g.cwd)}</span>` +
      `<span class="count">${sessions.length} session${sessions.length > 1 ? 's' : ''}</span>` +
      `<span class="gstat">max ∥ ${conc.max} · avg ∥ ${conc.avg.toFixed(2)}</span>`;
    gh.onclick = () => { collapsed ? collapsedGroups.delete(g.cwd) : collapsedGroups.add(g.cwd); draw(); };
    board.appendChild(gh);
    if (collapsed) continue;
    for (const s of sessions) {
      board.appendChild(sessionRow(s, g.cwd, tMin, tMax, span, now));
      if (expanded.has(s.sessionId)) for (const sa of s.subagents) board.appendChild(subagentRow(sa, tMin, tMax, span, now));
    }
  }

  renderChart(visibleSessions, tMin, tMax, now);
  refreshStats();
  if (!visibleSessions.length) board.innerHTML = '<div class="empty">No session activity in this window.</div>';
}

function sessionRow(s, cwd, tMin, tMax, span, now) {
  const row = document.createElement('div'); row.className = 'row';
  const label = document.createElement('div'); label.className = 'label-col';
  const si = statusInfo(s);
  const hasSubs = s.subagents && s.subagents.length;
  const toggle = document.createElement('span');
  toggle.className = 'toggle' + (hasSubs ? '' : ' placeholder');
  toggle.textContent = hasSubs ? (expanded.has(s.sessionId) ? '▾' : '▸') : '';
  if (hasSubs) toggle.onclick = () => { expanded.has(s.sessionId) ? expanded.delete(s.sessionId) : expanded.add(s.sessionId); draw(); };
  label.title = `${s.name}\n${cwd}\nstatus: ${si.text}\n` +
    `active span: ${dur(s.lastTs - s.firstTs)} (${new Date(s.firstTs).toLocaleString()} → ${new Date(s.lastTs).toLocaleString()})\n` +
    `agent working: ${dur(s.agentMs || 0)} · user (approx): ${dur(s.userMs || 0)}\n` +
    `${s.prompts.length} prompts${hasSubs ? ' · ' + s.subagents.length + ' subagents' : ''}`;
  const lrow = document.createElement('div'); lrow.className = 'lrow';
  lrow.appendChild(toggle);
  lrow.insertAdjacentHTML('beforeend',
    `<span class="dot ${si.on ? 'on' : ''}" style="background:${si.color}"></span><span class="name">${escapeHtml(s.name)}</span>`);
  label.appendChild(lrow);
  label.insertAdjacentHTML('beforeend',
    `<div class="meta">active ${dur(s.lastTs - s.firstTs)} · agent ${dur(s.agentMs || 0)} · user ${dur(s.userMs || 0)}</div>`);
  row.appendChild(label);
  const track = document.createElement('div'); track.className = 'track lanes pan';
  addBars(track, s.spans, tMin, tMax, span, false);
  nowLine(track, now, tMin, tMax);
  row.appendChild(track);
  return row;
}

function subagentRow(sa, tMin, tMax, span, now) {
  const row = document.createElement('div'); row.className = 'row subrow';
  const label = document.createElement('div'); label.className = 'label-col';
  label.title = `${sa.description}\n${sa.agentType || 'agent'} · ${new Date(sa.firstTs).toLocaleString()} → ${new Date(sa.lastTs).toLocaleString()}`;
  label.innerHTML =
    `<div class="lrow"><span class="toggle placeholder">↳</span><span class="name">${escapeHtml(sa.description)}</span>` +
    (sa.agentType ? `<span class="subtype">${escapeHtml(sa.agentType)}</span>` : '') +
    `<span class="subtype" style="border:none">${dur(sa.lastTs - sa.firstTs)}</span></div>`;
  row.appendChild(label);
  const track = document.createElement('div'); track.className = 'track lanes pan';
  addBars(track, sa.spans, tMin, tMax, span, true);
  row.appendChild(track);
  return row;
}

// x↔time geometry, shared by zoom/pan/selection/hover.
function trackGeom() {
  if (!rulerTrackEl) return null;
  const r = rulerTrackEl.getBoundingClientRect();
  return { left: r.left, width: r.width };
}

function positionSelBand() {
  const band = document.getElementById('selband');
  if (!band) return;
  const sel = selectionRange(), g = trackGeom();
  if (!sel || !g || !rulerTrackEl) { band.style.display = 'none'; return; }
  const r = rulerTrackEl.getBoundingClientRect();
  const fa = clamp((sel[0] - view.tMin) / (view.tMax - view.tMin), 0, 1);
  const fb = clamp((sel[1] - view.tMin) / (view.tMax - view.tMin), 0, 1);
  if (fb <= 0 || fa >= 1 || fb <= fa) { band.style.display = 'none'; return; }
  band.style.display = 'block';
  band.style.left = (r.left + fa * r.width) + 'px';
  band.style.width = ((fb - fa) * r.width) + 'px';
  band.style.top = r.top + 'px';
  band.style.height = (window.innerHeight - r.top) + 'px';
}
