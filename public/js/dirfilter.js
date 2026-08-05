// Directory filter: a checkbox list in the top bar. Unchecking a directory drops
// it from the stats, the concurrency chart, the calendar heatmap and the timeline
// (folding a group in the board is separate — that only hides its rows). All
// directories start checked; new ones appear checked.

const dirBasename = (cwd) => {
  if (!cwd || cwd === 'unknown') return cwd || 'unknown';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
};

// Recompute everything that depends on the filter: day aggregates → heatmap → board.
function applyDirFilter() { enrich(); renderHeat(); draw(); }

function renderDirFilter() {
  const box = $('#dirfilter');
  if (!box) return;
  const cwds = data.groups.map((g) => g.cwd);
  const total = cwds.length;
  const onCount = () => cwds.filter((c) => !hiddenDirs.has(c)).length;

  // Preserve the list's scroll position across re-renders (SSE updates, toggles).
  const prev = box.querySelector('.dirlist');
  const scrollTop = prev ? prev.scrollTop : 0;

  const items = data.groups.map((g, i) => {
    const off = hiddenDirs.has(g.cwd);
    const n = g.sessions.length;
    return `<label class="diritem${off ? ' off' : ''}" data-i="${i}" title="${attrTip(g.cwd)}">` +
      `<input type="checkbox"${off ? '' : ' checked'}>` +
      `<span class="dtext">` +
        `<span class="dtitle">${escapeHtml(dirBasename(g.cwd))}</span>` +
        `<span class="dpath">${escapeHtml(g.cwd)}</span>` +
      `</span>` +
      `<span class="dcount">${n}</span></label>`;
  }).join('');

  box.innerHTML =
    `<div class="dirhead">` +
      `<label class="dirall" title="Select or clear all directories">` +
        `<input type="checkbox" id="dirall"><span>Directories</span>` +
      `</label>` +
      `<span class="dircount" id="dircount">${onCount()}/${total}</span>` +
    `</div>` +
    `<div class="dirlist">${items || '<div class="dirempty">no directories yet</div>'}</div>`;

  const listEl = box.querySelector('.dirlist');
  listEl.scrollTop = scrollTop;
  const countEl = box.querySelector('#dircount');
  const master = box.querySelector('#dirall');

  const syncMaster = () => {
    const on = onCount();
    countEl.textContent = `${on}/${total}`;
    master.checked = total > 0 && on === total;
    master.indeterminate = on > 0 && on < total;
  };
  syncMaster();

  // Master toggle: native tri-state. Clicking an indeterminate/unchecked box
  // selects all; clicking a fully-checked box clears all → everything goes blank.
  master.onchange = () => {
    if (master.checked) hiddenDirs.clear();
    else for (const c of cwds) hiddenDirs.add(c);
    renderDirFilter();
    applyDirFilter();
  };

  box.querySelectorAll('.diritem').forEach((label) => {
    const cwd = cwds[Number(label.dataset.i)];
    const cb = label.querySelector('input');
    cb.onchange = () => {
      if (cb.checked) hiddenDirs.delete(cwd); else hiddenDirs.add(cwd);
      label.classList.toggle('off', !cb.checked);
      syncMaster();
      applyDirFilter();
    };
  });
}
