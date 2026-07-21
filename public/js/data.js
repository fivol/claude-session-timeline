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
  const bump = (k) => (dayInfo[k] || (dayInfo[k] = { agentMs: 0, userMs: 0, sessions: new Set(), dirs: new Set(), prompts: 0 }));
  for (const g of data.groups) for (const s of g.sessions) {
    let a = 0, u = 0;
    for (const sp of s.spans) {
      const len = sp.end - sp.start;
      if (sp.lane === 'agent') {
        a += len;
        eachDaySegment(sp.start, sp.end, (k, ms) => { const di = bump(k); di.agentMs += ms; di.sessions.add(s.sessionId); di.dirs.add(s.cwd || '?'); });
      } else if (sp.lane === 'user') {
        u += len;
        eachDaySegment(sp.start, sp.end, (k, ms) => { const di = bump(k); di.userMs += ms; di.sessions.add(s.sessionId); di.dirs.add(s.cwd || '?'); });
      }
    }
    for (const pr of s.prompts) bump(dayKey(pr.ts)).prompts++;
    s.agentMs = a; s.userMs = u;
  }
}

async function fetchData() {
  try {
    const r = await fetch('/api/data');
    data = await r.json();
    enrich(); renderHeat(); draw();
  } catch { $('#livetext').textContent = 'server offline'; }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('#livedot').className = 'dot on'; $('#livetext').textContent = 'live'; };
  es.addEventListener('update', fetchData);
  es.onerror = () => { $('#livedot').className = 'dot'; $('#livetext').textContent = 'reconnecting…'; };
}
