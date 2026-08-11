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
    bar._span = sp;              // read by the hover handler to build a rich tooltip
    bar._laneClass = laneClass;  // effective color class (subagent's agent span → subagent)
    track.appendChild(bar);
  }
}

// Rich hover tooltip for a single span bar (tool, subagent, agent or user). The
// swatch reuses the bar's own lane class so CSS is the single source of colour.
function barTipHtml(sp, span, laneClass) {
  const sw = `<i class="tipsw ${laneClass || sp.lane}"></i>`;
  const time = `${fmt(sp.start, span)} → ${fmt(sp.end, span)} · ${dur(sp.end - sp.start)}`;
  let head, kind = '', target = '';
  if (sp.lane === 'tool' || sp.lane === 'subagent') {
    head = escapeHtml(sp.tool || sp.label || sp.lane);
    kind = sp.lane;
    target = (sp.tool && sp.label) ? sp.label.slice(sp.tool.length).trim() : '';
  } else if (sp.lane === 'agent') {
    head = 'agent working';
  } else {
    // 'reading' / 'typing' — labels emitted by gapSpans/leadInSpans in lib/user-activity.mjs
    head = sp.label === 'typing' ? 'user typing' : 'user reading';
    kind = 'estimated';
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
  // Fixed 5-minute averaging window, independent of zoom: the hovered value reads
  // as "how many agents worked on average over the surrounding 5 minutes" at any scale.
  const W = 5 * 60e3;
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
  // Round the Y-axis top up to a whole agent count so the gridlines land on integers.
  const niceMax = Math.max(1, Math.ceil(maxY));
  const avgY = span > 0 ? prof.integ[prof.integ.length - 1] / span : 0;
  const x = (k) => ((k / N) * WIDTH).toFixed(1);
  const y = (v) => (H - (v / niceMax) * (H - 4) - 2).toFixed(1);
  let area = `M 0 ${H} `, line = '';
  for (let k = 0; k <= N; k++) { area += `L ${x(k)} ${y(vals[k])} `; line += `${k ? 'L' : 'M'} ${x(k)} ${y(vals[k])} `; }
  area += `L ${WIDTH} ${H} Z`;
  const nowX = (now >= tMin && now <= tMax) ? (pct(now, tMin, tMax) / 100) * WIDTH : null;
  const nowMark = nowX !== null ? `<line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="${H}" stroke="var(--now)" stroke-width="2"/>` : '';
  // Horizontal reference gridlines at whole agent-count levels (thinned to ~4);
  // the exact peak stays in the label. No numeric labels — lines only.
  const step = Math.ceil(niceMax / 4);
  const levels = [];
  for (let k = step; k <= niceMax; k += step) levels.push(k);
  const grid = levels.map((k) => `<line x1="0" y1="${y(k)}" x2="${WIDTH}" y2="${y(k)}" stroke="var(--grid)" stroke-width="0.75"/>`).join('');
  box.innerHTML =
    `<div class="chart-row">` +
      `<div class="label-col"><span class="t">avg ${avgY.toFixed(2)} · peak ${maxY.toFixed(maxY >= 10 ? 0 : 1)}</span><span class="s">window ${dur(W)}</span></div>` +
      `<div class="track chart"><svg viewBox="0 0 ${WIDTH} ${H}" preserveAspectRatio="none">` +
        `<path d="${area}" fill="var(--agent)" opacity="0.28"/>` + grid +
        `<path d="${line}" fill="none" stroke="var(--agent)" stroke-width="1.5"/>` + nowMark +
      `</svg></div>` +
    `</div>`;
}

function selectionRange() {
  return selection ? [Math.min(selection.start, selection.end), Math.max(selection.start, selection.end)] : null;
}
// Sessions feeding the stats bar: only from directories left checked in the
// filter (folding a group is a pure-UI fold and does NOT drop it here). Clipped
// to [a,b].
function statsSessions(a, b) {
  const out = [];
  for (const g of data.groups) {
    if (hiddenDirs.has(g.cwd)) continue;
    for (const s of g.sessions) if (s.lastTs >= a && s.firstTs <= b) out.push(s);
  }
  return out;
}
// Plain-language "how is this computed" note for each stat, shown as a hover
// popup (see the data-tip handler in interactions.js). Keyed by the pill label.
const STAT_HELP = {
  window: 'The time range every stat below covers — the current visible window. Drag across the timeline to scope them to a selection instead.',
  selection: 'Stats cover just this drag-selected range. Click the timeline to clear it and go back to the whole window.',
  sessions: 'Count of sessions with any activity inside the range, across the directories ticked in the filter.',
  directories: 'Distinct working directories among those sessions (ticked in the directory filter).',
  'max parallel': 'The most sessions with an agent working at the very same instant, anywhere in the range.',
  'avg parallel': 'Time-weighted mean number of agents working at once = agent-hours ÷ range length, so idle time pulls it down.',
  'avg while active': 'Mean agents working at once, counting only the time at least one was active = agent-hours ÷ any-agent-active.',
  'any-agent active': 'Wall-clock time at least one agent was working — the union across sessions, so overlapping work counts once.',
  'agent-hours': 'Agent working time summed over sessions; work running in parallel counts once per session, so this can exceed the range.',
  'user-hours': 'Estimated reading + typing time (Claude Code logs no keystrokes), de-overlapped so parallel sessions never double-count one person.',
  'work-hours': `Approx. wall-clock actually spent working with agents: agent-active time and user reading/typing merged, with gaps under ${dur(WORK_BRIDGE_MS)} counted as part of the same sitting and longer ones splitting it.`,
  'working now': 'Sessions whose agent is working right now (live status = working).',
};

function refreshStats() {
  const sel = selectionRange();
  const [a, b] = sel || [view.tMin, view.tMax];
  const sess = statsSessions(a, b);
  const dirs = new Set(sess.map((s) => s.cwd || 'unknown')).size;
  const { max, avg, union } = concurrency(sess, a, b);
  const busy = sess.filter((s) => statusInfo(s).on).length;
  const agentHours = sess.reduce((sum, s) => sum + activeIntervals(s, a, b).reduce((x, [p, q]) => x + (q - p), 0), 0);
  // User (reading/typing) time, clipped to the window. applyUserAttention already
  // de-overlaps these across concurrent sessions, so summing them doesn't double-count.
  const userHours = sess.reduce((sum, s) => sum + s.spans.reduce((x, sp) =>
    sp.lane === 'user' ? x + Math.max(0, Math.min(sp.end, b) - Math.max(sp.start, a)) : x, 0), 0);
  const activeAvg = union > 0 ? agentHours / union : 0;
  // Approx. wall-clock the user is actively working with agents: agent-active ∪
  // user time, with sub-15-min gaps counted as part of the sitting.
  const workHours = sumIntervals(workIntervals(sess, a, b));
  const pills = [
    ['sessions', sess.length], ['directories', dirs],
    ['max parallel', max], ['avg parallel', avg.toFixed(2)], ['avg while active', activeAvg.toFixed(2)],
    ['any-agent active', dur(union)], ['agent-hours', dur(agentHours)], ['user-hours', dur(userHours)],
    ['work-hours', dur(workHours)],
    ['working now', busy],
  ];
  const pill = (k, v) => {
    const help = STAT_HELP[k];
    const cls = 'pill' + (k === 'work-hours' ? ' work' : '');   // work-hours is the headline metric — highlighted
    return `<span class="${cls}"${help ? ` data-tip="${attrTip(help)}"` : ''}>${k}: <b>${v}</b></span>`;
  };
  const range = sel
    ? `<span class="pill sel" data-tip="${attrTip(STAT_HELP.selection)}">selection: <b>${dur(b - a)}</b> · click to clear</span>`
    : `<span class="pill" data-tip="${attrTip(STAT_HELP.window)}">window: <b>${dur(b - a)}</b></span>`;
  $('#stats').innerHTML = range + pills.map(([k, v]) => pill(k, v)).join('');
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

  let shown = 0;                 // enabled directories with in-window sessions actually rendered
  const chartSessions = [];      // every enabled in-window session — feeds the chart (fold is visual only)
  for (const g of data.groups) {
    if (hiddenDirs.has(g.cwd)) continue;   // unchecked in the filter → not shown, charted or counted
    const sessions = g.sessions.filter((s) => s.lastTs >= tMin && s.firstTs <= tMax);
    if (!sessions.length) continue;
    shown++;
    chartSessions.push(...sessions);
    const collapsed = collapsedGroups.has(g.cwd);
    const conc = concurrency(sessions, tMin, tMax);
    const gh = document.createElement('div');
    gh.className = 'group-header';
    gh.innerHTML =
      `<span class="gtoggle">${collapsed ? '▸' : '▾'}</span><span>${escapeHtml(g.cwd)}</span>` +
      `<span class="count">${sessions.length} session${sessions.length > 1 ? 's' : ''}</span>` +
      `<span class="gstat" data-tip="${attrTip('For this directory over the window: max ∥ — most agents working at the same instant; avg ∥ — time-weighted mean agents working at once.')}">max ∥ ${conc.max} · avg ∥ ${conc.avg.toFixed(2)}</span>`;
    gh.onclick = () => { collapsed ? collapsedGroups.delete(g.cwd) : collapsedGroups.add(g.cwd); draw(); };
    board.appendChild(gh);
    if (collapsed) continue;
    for (const s of sessions) {
      board.appendChild(sessionRow(s, g.cwd, tMin, tMax, span, now));
      if (expanded.has(s.sessionId)) for (const sa of s.subagents) board.appendChild(subagentRow(sa, tMin, tMax, span, now));
    }
  }

  renderChart(chartSessions, tMin, tMax, now);
  refreshStats();
  if (!shown) {
    const allHidden = data.groups.length > 0 && data.groups.every((g) => hiddenDirs.has(g.cwd));
    board.innerHTML = `<div class="empty">${allHidden
      ? 'No directories selected — check one in the filter above.'
      : 'No session activity in this window.'}</div>`;
  }
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
    (s.model ? `model: ${prettyModel(s.model)}\n` : '') +
    `active span: ${dur(s.lastTs - s.firstTs)} (${new Date(s.firstTs).toLocaleString()} → ${new Date(s.lastTs).toLocaleString()})\n` +
    `agent working: ${dur(s.agentMs || 0)} · user (approx): ${dur(s.userMs || 0)}\n` +
    `${s.prompts.length} prompts${hasSubs ? ' · ' + s.subagents.length + ' subagents' : ''}`;
  const lrow = document.createElement('div'); lrow.className = 'lrow';
  lrow.appendChild(toggle);
  lrow.insertAdjacentHTML('beforeend',
    `<span class="dot ${si.on ? 'on' : ''}" style="background:${si.color}"></span><span class="name">${escapeHtml(s.name)}</span>`);
  label.appendChild(lrow);
  const metaHelp =
    'active — wall-clock from the first to the last event in this session.<br>' +
    'agent — total agent working time; a gap over 5 min splits a turn.<br>' +
    'user — estimated reading + typing between turns (no keystrokes are logged).' +
    (s.model ? '<br>model — the model that produced the most turns in this session.' : '');
  label.insertAdjacentHTML('beforeend',
    `<div class="meta" title="" data-tip="${attrTip(metaHelp)}">active ${dur(s.lastTs - s.firstTs)} · agent ${dur(s.agentMs || 0)} · user ${dur(s.userMs || 0)}${s.model ? ` · <span class="model">${escapeHtml(prettyModel(s.model))}</span>` : ''}</div>`);
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
