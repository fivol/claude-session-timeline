// Concurrency math over sessions' agent-working intervals.

// Merge a session's agent spans into disjoint active intervals, clipped to [tMin,tMax].
function activeIntervals(s, tMin, tMax) {
  const iv = s.spans.filter((sp) => sp.lane === 'agent')
    .map((sp) => [Math.max(sp.start, tMin), Math.min(sp.end, tMax)])
    .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

// Piecewise-constant concurrency profile + prefix integral for O(log n) queries.
function concurrencyProfile(sessions, tMin, tMax) {
  const evs = [];
  for (const s of sessions) for (const [a, b] of activeIntervals(s, tMin, tMax)) { evs.push([a, 1]); evs.push([b, -1]); }
  evs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const bt = [tMin], bl = [];
  let cur = 0;
  for (const [t, d] of evs) { const tc = Math.max(tMin, Math.min(tMax, t)); if (tc > bt[bt.length - 1]) { bl.push(cur); bt.push(tc); } cur += d; }
  bl.push(cur); bt.push(tMax);
  const integ = [0];
  for (let i = 0; i < bl.length; i++) integ.push(integ[i] + bl[i] * (bt[i + 1] - bt[i]));
  return { bt, bl, integ };
}

function integralAt(prof, t) {
  const { bt, bl, integ } = prof;
  let lo = 0, hi = bl.length - 1, i = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bt[m] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  return integ[i] + bl[i] * (t - bt[i]);
}
function levelAt(prof, t) {
  const { bt, bl } = prof;
  let lo = 0, hi = bl.length - 1, i = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bt[m] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  return bl[i];
}
const avgOver = (prof, a, b) => (b > a ? (integralAt(prof, b) - integralAt(prof, a)) / (b - a) : 0);

// max parallel, time-weighted avg parallel, and union (≥1 agent) active time.
function concurrency(sessions, tMin, tMax) {
  const prof = concurrencyProfile(sessions, tMin, tMax);
  let max = 0, union = 0;
  for (let i = 0; i < prof.bl.length; i++) { if (prof.bl[i] > max) max = prof.bl[i]; if (prof.bl[i] >= 1) union += prof.bt[i + 1] - prof.bt[i]; }
  const winDur = tMax - tMin;
  const avg = winDur > 0 ? prof.integ[prof.integ.length - 1] / winDur : 0;
  return { max, avg, union };
}
