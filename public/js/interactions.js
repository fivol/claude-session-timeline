// Wheel zoom / pan, drag-to-select a time range, heatmap day-range drag, hover tooltip.

function scheduleDraw() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); }
function pxDelta(v, mode, width) { if (mode === 1) return v * 16; if (mode === 2) return v * width; return v; }
function timeAtX(cx) {
  const g = trackGeom();
  if (!g || !g.width) return view.tMin;
  return view.tMin + clamp((cx - g.left) / g.width, 0, 1) * (view.tMax - view.tMin);
}

// pinch / ⌥-wheel = zoom; two-finger horizontal = pan; vertical = normal page scroll.
document.addEventListener('wheel', (e) => {
  if (!view) return;
  const g = trackGeom();
  if (!g || !g.width || e.clientX < g.left) return;
  const zoomGesture = e.ctrlKey || e.altKey;
  const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const span = view.tMax - view.tMin;
  if (zoomGesture) {
    e.preventDefault();
    const frac = clamp((e.clientX - g.left) / g.width, 0, 1);
    const tc = view.tMin + frac * span;
    const factor = Math.exp(pxDelta(e.deltaY, e.deltaMode, g.width) * 0.0015);
    const newSpan = clamp(span * factor, 60e3, 400 * 24 * 3600e3);
    view.tMin = tc - frac * newSpan; view.tMax = tc + (1 - frac) * newSpan;
    view.follow = false; activePreset = null; buildWindows(); scheduleDraw();
  } else if (horizontal) {
    e.preventDefault();
    const dt = (pxDelta(e.deltaX, e.deltaMode, g.width) / g.width) * span;
    view.tMin += dt; view.tMax += dt;
    view.follow = false; activePreset = null; buildWindows(); scheduleDraw();
  }
}, { passive: false });

// Drag on the timeline selects a range (stats recompute); a click clears it.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.hd')) return; // heatmap handles its own drag
  if (!view || e.button !== 0) return;
  const onTrack = !!(e.target.closest('.track.pan') || e.target.closest('.chart'));
  dragSel = { startX: e.clientX, startT: timeAtX(e.clientX), onTrack, moved: false };
  if (onTrack) e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragSel) return;
  if (Math.abs(e.clientX - dragSel.startX) > 4) dragSel.moved = true;
  if (dragSel.moved && dragSel.onTrack) { selection = { start: dragSel.startT, end: timeAtX(e.clientX) }; refreshStats(); }
});
document.addEventListener('mouseup', (e) => {
  if (!dragSel) return;
  const d = dragSel; dragSel = null;
  if (d.moved && d.onTrack) { selection = { start: d.startT, end: timeAtX(e.clientX) }; draw(); }
  else if (selection) { selection = null; draw(); }
});

// Drag across heatmap days selects a day range → opens it as the view.
document.addEventListener('mousedown', (e) => {
  const cell = e.target.closest('.hd[data-k]');
  if (!cell) return;
  heatDrag = { start: cell.dataset.k, end: cell.dataset.k };
  daySel = { start: heatDrag.start, end: heatDrag.end };
  renderHeat(); e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!heatDrag) return;
  const cell = e.target.closest('.hd[data-k]');
  if (cell) { heatDrag.end = cell.dataset.k; daySel = { start: heatDrag.start, end: heatDrag.end }; renderHeat(); }
});
document.addEventListener('mouseup', () => {
  if (!heatDrag) return;
  const [a, b] = [heatDrag.start, heatDrag.end].sort();
  heatDrag = null;
  openDayRange(a, b);
});

// Hover: heatmap day tooltip, else a time-axis crosshair + instant/avg parallel.
document.addEventListener('mousemove', (e) => {
  const tip = document.getElementById('tip');
  const cursor = document.getElementById('axiscursor');
  const cell = e.target.closest('.hd[data-k]');
  if (cell) {
    if (cursor) cursor.style.display = 'none';
    const k = cell.dataset.k, info = dayInfo[k];
    const lines = [`<b>${k}</b>`];
    if (info) {
      lines.push(`${info.sessions.size} session${info.sessions.size > 1 ? 's' : ''} · ${info.dirs.size} dir${info.dirs.size > 1 ? 's' : ''}`);
      lines.push(`agent-hours ${dur(info.agentMs)} · user ${dur(info.userMs)}`);
      lines.push(`${info.prompts} prompt${info.prompts === 1 ? '' : 's'}`);
    } else lines.push('no activity');
    tip.innerHTML = lines.join('<br>');
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 190) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
    return;
  }
  const g = trackGeom();
  if (!e.target.closest('.track') || !chartState || !view || !g || !g.width || e.clientX < g.left) {
    if (tip) tip.style.display = 'none';
    if (cursor) cursor.style.display = 'none';
    return;
  }
  const frac = clamp((e.clientX - g.left) / g.width, 0, 1);
  const { prof, W, tMin, tMax } = chartState;
  const t = tMin + frac * (tMax - tMin);
  const inst = levelAt(prof, t);
  const avg = avgOver(prof, Math.max(tMin, t - W / 2), Math.min(tMax, t + W / 2));
  const d = new Date(t);
  const rowName = e.target.closest('.row') && e.target.closest('.row').querySelector('.name');
  const prefix = rowName ? `${escapeHtml(rowName.textContent)}<br>` : '';
  tip.innerHTML = `${prefix}${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} · ∥ <b>${inst}</b> now · avg ${avg.toFixed(2)}`;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 240) + 'px';
  tip.style.top = (e.clientY + 16) + 'px';
  const chartTop = document.getElementById('chart').getBoundingClientRect().top;
  const top = Math.max(0, chartTop);
  cursor.style.display = 'block';
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = top + 'px';
  cursor.style.height = (window.innerHeight - top) + 'px';
});
