// Time-window presets and the Live toggle.
function globalMin() {
  let min = Date.now();
  for (const g of data.groups) for (const s of g.sessions) if (s.firstTs < min) min = s.firstTs;
  return min;
}

function applyPreset(key) {
  activePreset = key;
  daySel = null;
  const now = Date.now();
  const p = PRESETS.find((x) => x.key === key);
  view = { tMin: p.ms ? now - p.ms : globalMin(), tMax: now, follow: true };
  buildWindows(); renderHeat(); draw();
}

function goLive() {
  const span = view.tMax - view.tMin;
  view = { tMin: Date.now() - span, tMax: Date.now(), follow: true };
  activePreset = null; daySel = null;
  buildWindows(); renderHeat(); draw();
}

function buildWindows() {
  const box = $('#windows');
  box.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.className = p.key === activePreset ? 'active' : '';
    b.onclick = () => applyPreset(p.key);
    box.appendChild(b);
  }
  const live = document.createElement('button');
  live.textContent = '⟳ Live';
  live.className = 'live ' + (view && view.follow ? 'active' : '');
  live.onclick = goLive;
  box.appendChild(live);
}
