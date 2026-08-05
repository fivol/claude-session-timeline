// Fetch the timeline data, derive per-session and per-day aggregates, keep it live.

// Split [a,b] into local-day segments, calling cb(dayKey, ms) for each.
const eachDaySegment = (a, b, cb) => {
  let t = a;
  while (t < b) {
    const de = new Date(t); de.setHours(24, 0, 0, 0);
    const end = Math.min(b, de.getTime());
    cb(dayKey(t), end - t);
    t = end;
  }
};

function enrich() {
  dayInfo = {};
  const bump = (k) => (dayInfo[k] || (dayInfo[k] = { agentMs: 0, userMs: 0, workMs: 0, sessions: new Set(), dirs: new Set(), prompts: 0 }));
  const enabled = [];   // sessions in checked directories — feed the per-day work-hours union
  for (const g of data.groups) {
    const hidden = hiddenDirs.has(g.cwd);   // unchecked in the filter → excluded from the calendar too
    for (const s of g.sessions) {
      let a = 0, u = 0;
      for (const sp of s.spans) {
        const len = sp.end - sp.start;
        if (sp.lane === 'agent') {
          a += len;
          if (!hidden) eachDaySegment(sp.start, sp.end, (k, ms) => { const di = bump(k); di.agentMs += ms; di.sessions.add(s.sessionId); di.dirs.add(s.cwd || '?'); });
        } else if (sp.lane === 'user') {
          u += len;
          if (!hidden) eachDaySegment(sp.start, sp.end, (k, ms) => { const di = bump(k); di.userMs += ms; di.sessions.add(s.sessionId); di.dirs.add(s.cwd || '?'); });
        }
      }
      if (!hidden) { for (const pr of s.prompts) bump(dayKey(pr.ts)).prompts++; enabled.push(s); }
      s.agentMs = a; s.userMs = u;   // per-session totals stay independent of the filter
    }
  }
  // Per-day work-hours: the global agent∪user union (with sub-15-min gaps bridged)
  // across enabled sessions, split by local day — the same metric the stats bar shows.
  for (const [a, b] of workIntervals(enabled, -Infinity, Infinity)) {
    eachDaySegment(a, b, (k, ms) => { bump(k).workMs += ms; });
  }
}

async function fetchData() {
  try {
    const r = await fetch('/api/data');
    data = await r.json();
    enrich(); renderDirFilter(); renderHeat(); draw();
  } catch { $('#livetext').textContent = 'server offline'; }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#livedot').className = 'dot on'; $('#livetext').textContent = 'live'; };
  es.addEventListener('update', fetchData);
  es.onerror = () => { $('#livedot').className = 'dot'; $('#livetext').textContent = 'reconnecting…'; };
}
