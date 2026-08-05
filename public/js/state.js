// Shared, mutable app state (classic scripts share one global scope).
const PRESETS = [
  { key: 'today', label: 'Today', ms: null },   // local midnight → now (special-cased in applyPreset)
  { key: '1h', label: '1h', ms: 3600e3 },
  { key: '2h', label: '2h', ms: 2 * 3600e3 },
  { key: '4h', label: '4h', ms: 4 * 3600e3 },
  { key: '6h', label: '6h', ms: 6 * 3600e3 },
  { key: '8h', label: '8h', ms: 8 * 3600e3 },
  { key: '24h', label: '24h', ms: 24 * 3600e3 },
  { key: '7d', label: '7d', ms: 7 * 24 * 3600e3 },
  { key: 'all', label: 'All', ms: null },
];

let activePreset = '24h';
let view = null;                    // { tMin, tMax, follow }
let data = { groups: [] };
const expanded = new Set();         // session ids with subagents shown
const collapsedGroups = new Set();  // cwd of collapsed groups (pure UI fold — does NOT filter stats)
const hiddenDirs = new Set();       // cwd unchecked in the directory filter → excluded from stats, chart, heatmap & timeline
let selection = null;               // time-range selection (drag on timeline) → stats scope
let chartState = null;              // { prof, W, tMin, tMax } for hover
let dayInfo = {};                   // 'YYYY-MM-DD' -> { agentMs, userMs, sessions:Set, dirs:Set, prompts }
let daySel = null;                  // { start, end } day keys picked on the heatmap
let heatYear = null, heatMonth = null;
let rulerTrackEl = null;            // reference to the ruler track (for x↔time geometry)
let dragSel = null;                 // in-progress timeline range drag
let heatDrag = null;                // in-progress heatmap day-range drag
let rafPending = false;
