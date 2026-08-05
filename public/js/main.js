// Entry point: create overlays, keep the sticky-offset in sync, start the app.

// Overlay elements kept outside the redrawn board.
for (const id of ['selband', 'tip', 'axiscursor']) {
  const el = document.createElement('div');
  el.id = id;
  el.style.display = 'none';
  document.body.appendChild(el);
}

// The ruler sticks below the (variable-height) sticky top bar.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--topbar-h', document.getElementById('topbar').offsetHeight + 'px');
}).observe(document.getElementById('topbar'));
window.addEventListener('resize', positionSelBand);

// Block browser back/forward (accidental trackpad swipes while panning).
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => history.pushState(null, '', location.href));

// Keep the "now" edge moving while following live.
setInterval(() => {
  if (view && activePreset === 'today') { view.tMin = localMidnight(Date.now()); view.tMax = Date.now(); }
  else if (view && view.follow) { const span = view.tMax - view.tMin; view.tMax = Date.now(); view.tMin = view.tMax - span; }
  draw();
}, 5000);

renderHeat();
applyPreset('24h');
fetchData();
// `?nostream` skips the live SSE connection (used for static rendering / screenshots).
if (!location.search.includes('nostream')) connect();
