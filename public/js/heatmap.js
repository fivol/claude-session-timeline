// Always-visible month calendar, heat-shaded by per-day agent-active time.
const inDaySel = (k) => daySel && k >= (daySel.start < daySel.end ? daySel.start : daySel.end) && k <= (daySel.start < daySel.end ? daySel.end : daySel.start);

function renderHeat() {
  const el = $('#heat');
  if (heatYear === null) { const n = new Date(); heatYear = n.getFullYear(); heatMonth = n.getMonth(); }
  const now = new Date();
  const nextDisabled = heatYear > now.getFullYear() || (heatYear === now.getFullYear() && heatMonth >= now.getMonth());
  const first = new Date(heatYear, heatMonth, 1);
  const monthName = first.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const startIdx = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(heatYear, heatMonth + 1, 0).getDate();
  const keyOf = (d) => `${heatYear}-${p2(heatMonth + 1)}-${p2(d)}`;
  let maxMs = 0;
  for (let d = 1; d <= days; d++) maxMs = Math.max(maxMs, (dayInfo[keyOf(d)] || {}).agentMs || 0);
  const today = dayKey(Date.now());

  const wd = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<div class="wd">${x}</div>`).join('');
  let cells = '';
  for (let i = 0; i < startIdx; i++) cells += `<div class="hd empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = keyOf(d), v = (dayInfo[k] || {}).agentMs || 0;
    const bg = v ? `background:rgba(76,141,255,${(0.15 + 0.85 * (v / (maxMs || 1))).toFixed(2)});` : '';
    const cls = 'hd' + (inDaySel(k) ? ' sel' : '') + (k === today ? ' today' : '');
    cells += `<div class="${cls}" data-k="${k}" style="${bg}">${d}</div>`;
  }

  el.innerHTML =
    `<div class="calnav">` +
      `<button data-nav="-1">‹</button>` +
      `<span class="caltitle">${monthName}</span>` +
      `<button data-nav="1"${nextDisabled ? ' disabled' : ''}>›</button>` +
      `<a class="calreset" data-reset="1">reset</a>` +
    `</div>` +
    `<div class="calwd">${wd}</div><div class="calgrid">${cells}</div>` +
    `<div class="calhint">brighter = more agent time · click a day · drag across days to select a range</div>`;

  el.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => {
    const n = Number(b.dataset.nav);
    if (n > 0 && nextDisabled) return; // no paging into the future
    heatMonth += n;
    if (heatMonth < 0) { heatMonth = 11; heatYear--; }
    if (heatMonth > 11) { heatMonth = 0; heatYear++; }
    renderHeat();
  });
  const reset = el.querySelector('[data-reset]');
  if (reset) reset.onclick = () => applyPreset('today');
}

// Open a day (or day range) as the active view window.
function openDayRange(aKey, bKey) {
  daySel = { start: aKey, end: bKey };
  view = { tMin: keyStart(aKey), tMax: keyStart(bKey) + 24 * 3600e3, follow: false };
  activePreset = null; selection = null;
  buildWindows(); renderHeat(); draw();
}
