// Progress view: KPI tiles, run header, status/wave/tool charts, status board, live subagent activity, log. Read-only.
const STATUSES = ['pending', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'done', 'skipped'];
const RECENT_EVENTS = 30;
const TOP_TOOLS = 6;
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

const str = (v) => (typeof v === 'string' ? v : '');
const label = (s) => s.replace(/_/g, ' ');
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// A thin progress bar; width is set through CSSOM so the strict style-src CSP allows it.
function meter(percent) {
  const fill = el('div', { class: 'meter-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  return el('div', { class: 'meter', role: 'presentation' }, fill);
}

// Known statuses keep their own column; anything else (including a non-string status) goes to other.
export function groupByStatus(tasks) {
  const groups = Object.fromEntries([...STATUSES, 'other'].map((s) => [s, []]));
  for (const t of Array.isArray(tasks) ? tasks : []) {
    groups[STATUSES.includes(t?.status) ? t.status : 'other'].push(t);
  }
  return groups;
}

// Event time as a sortable number: ISO string or epoch ms; unparseable sorts first.
const time = (e) => {
  const n = typeof e?.t === 'number' ? e.t : Date.parse(e?.t);
  return Number.isNaN(n) ? 0 : n;
};

// Events sorted by t (async hooks can write out of order), oldest first; stable for ties.
function sorted(events) {
  return (Array.isArray(events) ? events : []).map((e, i) => ({ e, i }))
    .sort((a, b) => time(a.e) - time(b.e) || a.i - b.i).map((x) => x.e);
}

const eventText = (e) => [str(e.atype) || 'main', e.ev, str(e.tool), str(e.sum)].filter(Boolean).join(' · ');

export function mount(root, opts) {
  return mountProgress(root, opts); // resolves after the first render
}

async function mountProgress(root, { planId, api, onPoll }) {
  const q = `plan=${encodeURIComponent(planId)}`;
  let lastKey = '';

  const kpis = el('section', { class: 'kpis', id: 'kpis' });
  const header = el('section', { class: 'widget run-header', id: 'run-header' });
  const statusChart = el('div', { class: 'donut-wrap' });
  const waves = el('div', { class: 'waves', id: 'waves' });
  const tools = el('ul', { class: 'bars', id: 'tools' });
  const board = el('div', { class: 'board', id: 'board' });
  const activity = el('section', { class: 'widget activity', id: 'activity' });
  const log = el('section', { class: 'widget run-log', id: 'run-log' });
  const widget = (title, sub, body) => el('section', { class: 'widget' },
    el('h2', {}, title), el('p', { class: 'widget-sub' }, sub), body);
  root.replaceChildren(
    kpis, header,
    el('div', { class: 'grid grid-3' },
      widget('Status breakdown', 'Tasks by current status', statusChart),
      widget('Waves', 'Done vs remaining per wave', waves),
      widget('Tool usage', 'Tool calls recorded in this run', tools)),
    el('section', { class: 'widget board-wrap' },
      el('h2', {}, 'Task board'), el('p', { class: 'widget-sub' }, 'Swipe sideways to see every column'), board),
    el('div', { class: 'grid grid-2' }, activity, log));

  function renderKpis(tasks, groups, openCount) {
    const total = tasks.length;
    const done = groups.done.length;
    const acTotal = tasks.reduce((n, t) => n + (Number(t.ac_total) || 0), 0);
    const acDone = tasks.reduce((n, t) => n + (Number(t.ac_verified) || 0), 0);
    const tile = (name, value, sub, bar) => el('div', { class: 'kpi' },
      el('span', { class: 'kpi-label' }, name), el('span', { class: 'kpi-value' }, String(value)),
      el('span', { class: 'kpi-sub' }, sub), ...(bar === undefined ? [] : [meter(bar)]));
    kpis.replaceChildren(
      tile('Tasks done', `${done}/${total}`, `${pct(done, total)}% complete`, pct(done, total)),
      tile('In flight', groups.in_progress.length + groups.in_review.length,
        `${groups.in_progress.length} building · ${groups.in_review.length} in review`),
      tile('Need attention', groups.changes_requested.length + groups.blocked.length,
        `${groups.changes_requested.length} changes · ${groups.blocked.length} blocked`),
      tile('Criteria verified', `${pct(acDone, acTotal)}%`, `${acDone} of ${acTotal} checks`, pct(acDone, acTotal)),
      tile('Open subagents', openCount, openCount ? 'working now' : 'idle'));
  }

  function renderHeader(progress) {
    if (!progress) {
      header.replaceChildren(el('p', { class: 'empty' }, 'No run yet'));
      return;
    }
    const field = (name, value, cls = 'run-field') => el('div', { class: cls },
      el('span', { class: 'run-label' }, name), el('span', { class: 'run-value' }, str(value) || '—'));
    const state = str(progress.run_state);
    const stateField = el('div', { class: 'run-field' }, el('span', { class: 'run-label' }, 'Run state'),
      el('span', { class: 'run-value' }, el('span', { class: 'pill' },
        el('span', { class: `dot ${/run/.test(state) ? 'st-in_progress' : /done|complete/.test(state) ? 'st-done' : 'st-pending'}` }),
        state || '—')));
    header.replaceChildren(stateField,
      field('Current task', progress.current_task), field('Current step', progress.current_step),
      field('Last updated', progress.last_updated), field('Resume note', progress.resume_note, 'run-field wide'));
  }

  // Donut of task counts per status; each arc carries a <title> for hover.
  function renderStatus(groups, total) {
    const ring = svg('svg', { class: 'donut', viewBox: '0 0 42 42', role: 'img', 'aria-label': 'Tasks by status' },
      svg('circle', { class: 'track', cx: 21, cy: 21, r: 15.915 }));
    const gap = Object.values(groups).filter((l) => l.length).length > 1 ? 1 : 0;
    let offset = 0;
    for (const [s, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const share = (list.length / total) * 100;
      ring.append(svg('circle', {
        class: `seg st-${s}`, cx: 21, cy: 21, r: 15.915,
        'stroke-dasharray': `${Math.max(share - gap, 0.5)} ${100 - Math.max(share - gap, 0.5)}`,
        'stroke-dashoffset': String(25 - offset),
      }, svg('title', {}, `${label(s)}: ${list.length}`)));
      offset += share;
    }
    const done = groups.done.length;
    ring.append(
      svg('text', { class: 'donut-num', x: 21, y: 22, 'text-anchor': 'middle' }, `${pct(done, total)}%`),
      svg('text', { class: 'donut-cap', x: 21, y: 26.5, 'text-anchor': 'middle' }, 'done'));
    const legend = el('ul', { class: 'legend' }, ...Object.entries(groups)
      .filter(([s, list]) => list.length || s !== 'other')
      .map(([s, list]) => el('li', {}, el('span', { class: `dot st-${s}` }), label(s), el('span', { class: 'n' }, String(list.length)))));
    statusChart.replaceChildren(...(total ? [ring, legend] : [el('p', { class: 'empty' }, 'No tasks.')]));
  }

  function renderWaves(data, byId) {
    const list = Array.isArray(data.waves) ? data.waves : [];
    if (!list.length) { waves.replaceChildren(el('p', { class: 'empty' }, 'No waves defined.')); return; }
    waves.replaceChildren(...list.map((w) => {
      const ids = Array.isArray(w.tasks) ? w.tasks : [];
      const statuses = ids.map((id) => {
        const s = byId.get(id)?.status;
        return STATUSES.includes(s) ? s : 'other';
      });
      const done = statuses.filter((s) => s === 'done').length;
      const stack = el('div', { class: 'stack', role: 'img', 'aria-label': `Wave ${w.wave}: ${done} of ${ids.length} done` });
      for (const s of STATUSES.concat('other')) {
        const n = statuses.filter((x) => x === s).length;
        if (!n) continue;
        const seg = el('span', { class: `st-${s}`, title: `${label(s)}: ${n}` });
        seg.style.flexGrow = String(n);
        stack.append(seg);
      }
      const row = el('div', { class: 'wave' }, el('span', { class: 'wave-label' }, `Wave ${str(String(w.wave))}`),
        el('span', { class: 'wave-count' }, `${done}/${ids.length} done`), stack);
      ids.forEach((id, i) => row.append(el('span', { class: `chip status-${statuses[i]}` }, str(id))));
      return row;
    }));
  }

  // Horizontal bars: tool calls (PreToolUse events) per tool, most used first.
  function renderTools(events) {
    const counts = new Map();
    for (const e of Array.isArray(events) ? events : []) {
      if (e?.ev === 'PreToolUse' && str(e.tool)) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP_TOOLS);
    const max = top[0]?.[1] ?? 0;
    tools.replaceChildren(...(top.length ? top.map(([name, n]) => {
      const fill = el('div', { class: 'bar-fill' });
      fill.style.width = `${pct(n, max)}%`;
      return el('li', { class: 'bar-row', title: `${name}: ${n}` },
        el('span', { class: 'bar-name' }, name), el('div', { class: 'bar-track' }, fill), el('span', { class: 'bar-n' }, String(n)));
    }) : [el('li', { class: 'empty' }, 'No tool calls recorded.')]));
  }

  function renderBoard(groups) {
    board.replaceChildren(...Object.entries(groups).map(([status, list]) => {
      const col = el('div', { class: `column st-${status}${list.length ? '' : ' empty-col'}`, 'data-status': status },
        el('h3', {}, el('span', { class: 'dot' }), `${label(status)} (${list.length})`));
      for (const t of list) {
        const total = Number(t.ac_total) || 0;
        const verified = Number(t.ac_verified) || 0;
        const meta = el('div', { class: 'card-meta' }, `AC ${verified}/${total}`);
        if (str(t.verdict)) meta.append(` · ${t.verdict}`);
        if (t.fix_rounds > 0) meta.append(` · fix ${t.fix_rounds}`);
        col.append(el('div', { class: `card st-${status}`, 'data-id': str(t.id) },
          el('div', { class: 'card-id' }, str(t.id)),
          el('div', { class: 'card-title' }, str(t.title)),
          meta, meter(pct(verified, total))));
      }
      return col;
    }));
  }

  function renderActivity(events, openList) {
    const open = (Array.isArray(openList) ? openList : []).map((a) => ({
      aid: str(a?.aid), atype: str(a?.atype),
      sum: str(a?.last_sum) ? `${str(a?.last_tool)}: ${str(a?.last_sum)}` : '',
    }));
    const recent = sorted(events).reverse().slice(0, RECENT_EVENTS);
    activity.replaceChildren(
      el('h2', {}, 'Live activity'),
      el('h3', {}, 'Open subagents'),
      el('ul', { class: 'open-subagents' }, ...(open.length
        ? open.map((a) => el('li', { class: 'open-subagent', 'data-aid': str(a.aid) },
          `${a.atype || 'subagent'}${a.sum ? ` — ${a.sum}` : ''}`))
        : [el('li', { class: 'empty' }, 'No open subagents.')])),
      el('h3', {}, 'Recent events'),
      el('ul', { class: 'recent-events' }, ...(recent.length
        ? recent.map((e) => el('li', { class: 'event' }, eventText(e)))
        : [el('li', { class: 'empty' }, 'No events recorded.')])));
  }

  function renderLog(progress) {
    const rows = progress && Array.isArray(progress.log) ? [...progress.log].reverse() : [];
    log.replaceChildren(el('h2', {}, 'Log'), el('ul', { class: 'log-rows' }, ...(rows.length
      ? rows.map((r) => el('li', { class: 'log-row' },
        [r.time, r.task, r.event, r.note].map(str).filter(Boolean).join(' · ')))
      : [el('li', { class: 'empty' }, 'No log rows.')])));
  }

  async function refresh() {
    const data = await api(`/api/plan?${q}`);
    const key = JSON.stringify([data.tasks, data.waves, data.progress, data.events, data.open_subagents]);
    if (key === lastKey) return; // nothing changed: leave the DOM alone
    lastKey = key;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const groups = groupByStatus(tasks);
    renderKpis(tasks, groups, Array.isArray(data.open_subagents) ? data.open_subagents.length : 0);
    renderHeader(data.progress ?? null);
    renderStatus(groups, tasks.length);
    renderWaves(data, new Map(tasks.map((t) => [t.id, t])));
    renderTools(data.events);
    renderBoard(groups);
    renderActivity(data.events, data.open_subagents);
    renderLog(data.progress ?? null);
  }

  await refresh();
  onPoll(refresh);
}
