// Progress view: wave track (with headline figures), status ring, run notes, tool usage, status board, live activity, log,
// and a task details dialog opened from a board card. Read-only.
import { renderMarkdown } from './review.js';

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

export function mount(root, opts) {
  return mountProgress(root, opts); // resolves after the first render
}

async function mountProgress(root, { planId, api, onPoll }) {
  const q = `plan=${encodeURIComponent(planId)}`;
  let lastKey = '';

  const waves = el('div', { class: 'waves', id: 'waves' });
  const figures = el('div', { class: 'figures', id: 'kpis' });
  const header = el('section', { class: 'panel-box run-header', id: 'run-header' });
  const statusChart = el('div', { class: 'donut-wrap' });
  const tools = el('ul', { class: 'bars', id: 'tools' });
  const board = el('div', { class: 'board', id: 'board' });
  const activity = el('section', { class: 'panel-box activity', id: 'activity' });
  const log = el('section', { class: 'panel-box run-log', id: 'run-log' });
  let latest = { tasks: [], backlog: [], waves: [], log: [] };

  // ---- task details dialog: centred on wide screens, full screen on phones (CSS) ----
  const dialog = el('dialog', { class: 'task-dialog', 'aria-labelledby': 'task-dialog-title' });
  let openId = null;
  dialog.addEventListener('close', () => { openId = null; });
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); }); // backdrop click

  function renderDialog(t, spec) {
    const status = STATUSES.includes(t.status) ? t.status : 'other';
    const wave = latest.waves.find((w) => Array.isArray(w.tasks) && w.tasks.includes(t.id));
    const fact = (name, value, cls = 'run-field') => el('div', { class: cls },
      el('dt', { class: 'run-label' }, name), el('dd', { class: 'run-value' }, value || '—'));
    const files = Array.isArray(t.touches) ? t.touches.map(str).filter(Boolean) : [];
    const ids = (list) => (Array.isArray(list) && list.length ? list.map(str).join(', ') : '');
    const acs = Array.isArray(t.acs) ? t.acs : [];
    const verified = acs.filter((a) => a?.verified).length;
    const backlog = t.kind === 'backlog';
    const rows = (backlog ? (Array.isArray(t.log) ? [...t.log] : []) : latest.log.filter((r) => str(r.task) === t.id)).reverse();
    const item = el('div', { class: 'doc' });
    if (backlog) item.innerHTML = renderMarkdown(str(t.item) || 'This item is not in BACKLOG.md.'); // raw HTML escaped by the renderer
    const details = backlog
      ? [el('dl', { class: 'run-fields' },
        fact('Batch', str(t.batch)), fact('Why deferred', str(t.why), 'run-field wide'), fact('Comes back when', str(t.when), 'run-field wide')),
      el('h3', {}, 'Item'), item]
      : [el('dl', { class: 'run-fields' },
        fact('Phase', t.phase == null ? '' : String(t.phase)), fact('Wave', wave ? String(wave.wave) : ''),
        fact('Review verdict', str(t.verdict)), fact('Fix rounds', String(Number(t.fix_rounds) || 0)),
        fact('Depends on', ids(t.depends_on)),
        fact('Files touched', files.length ? el('ul', { class: 'file-list' }, ...files.map((f) => el('li', {}, f))) : '', 'run-field wide')),
      el('h3', {}, `Acceptance criteria: ${verified} of ${acs.length} verified`),
      el('ul', { class: 'ac-list' }, ...(acs.length ? acs.map((a) => el('li', { class: a?.verified ? 'ac verified' : 'ac' },
        el('span', { class: 'ac-mark', 'aria-label': a?.verified ? 'verified' : 'not verified' }, a?.verified ? '✓' : '○'),
        el('span', {}, el('strong', {}, str(a?.id)), ` ${str(a?.name)}`),
        str(a?.type) ? el('span', { class: 'muted' }, a.type) : '')) : [el('li', { class: 'empty' }, 'This spec has no acceptance criteria.')]))];
    const close = el('button', { type: 'button', class: 'dialog-close' }, 'Close');
    close.addEventListener('click', () => dialog.close());
    dialog.replaceChildren(
      el('header', { class: 'dialog-head' },
        el('div', { class: 'dialog-title' },
          el('span', { class: 'card-id' }, str(t.id)),
          el('span', { class: `pill st-${status}` }, el('span', { class: 'dot' }), label(status)),
          el('h2', { id: 'task-dialog-title' }, str(t.title) || str(t.id))),
        close),
      el('div', { class: 'dialog-body' },
        ...details,
        el('h3', {}, 'Log'),
        el('ul', { class: 'log-rows' }, ...(rows.length ? rows.map((r) => el('li', { class: 'log-row' },
          el('span', { class: 'log-time' }, str(r.time)), el('span', { class: 'log-task' }, backlog && str(r.task) !== t.id ? `${str(r.task)}: ${str(r.event)}` : str(r.event)),
          el('span', { class: 'log-text' }, str(r.note) === '—' ? '' : str(r.note))))
          : [el('li', { class: 'empty' }, 'No log rows for this task yet.')])),
        spec));
  }

  // The full spec is fetched once per opening, when its section is first expanded.
  function specSection(t) {
    const body = el('div', { class: 'doc' });
    const details = el('details', { class: 'spec' }, el('summary', {}, 'Full spec'), body);
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded || !str(t.file)) return;
      loaded = true;
      body.replaceChildren(el('p', { class: 'empty' }, 'Loading…'));
      try {
        body.innerHTML = renderMarkdown(await api(`/api/file?${q}&path=${encodeURIComponent(t.file)}`)); // raw HTML escaped by the renderer
      } catch (err) {
        loaded = false;
        body.replaceChildren(el('p', { class: 'unavailable' }, `Could not load the spec: ${err.message}`));
      }
    });
    return details;
  }

  let spec = null;
  const find = (id) => latest.tasks.find((x) => x.id === id) ?? latest.backlog.find((x) => x.id === id);
  function openTask(id) {
    const t = find(id);
    if (!t) return;
    openId = id;
    spec = t.kind === 'backlog' ? '' : specSection(t);
    renderDialog(t, spec);
    if (!dialog.open) dialog.showModal();
  }

  board.addEventListener('click', (ev) => {
    const card = ev.target.closest?.('.card');
    if (card) openTask(card.dataset.id);
  });
  board.addEventListener('keydown', (ev) => {
    const card = ev.target.closest?.('.card');
    if (!card || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    openTask(card.dataset.id);
  });

  const box = (title, body, cls = '') => el('section', { class: `panel-box ${cls}`.trim() }, el('h2', {}, title), body);
  root.replaceChildren(
    el('section', { class: 'track' }, el('h2', {}, 'Wave track'), waves, figures),
    el('div', { class: 'row-3' }, box('Tasks by status', statusChart), header, box('Most used tools', tools)),
    el('section', { class: 'panel-box board-wrap' }, el('h2', {}, 'Board'), board),
    el('div', { class: 'row-2' }, activity, log), dialog);

  function renderFigures(tasks, groups, openCount, backlog) {
    const total = tasks.length;
    const done = groups.done.length;
    const acTotal = tasks.reduce((n, t) => n + (Number(t.ac_total) || 0), 0);
    const acDone = tasks.reduce((n, t) => n + (Number(t.ac_verified) || 0), 0);
    const attention = groups.changes_requested.length + groups.blocked.length;
    const figure = (value, name, cls = '') => el('div', { class: `figure ${cls}`.trim() },
      el('span', { class: 'figure-value' }, value), el('span', { class: 'figure-label' }, name));
    figures.replaceChildren(
      figure(`${done}/${total}`, 'tasks done'),
      figure(`${acDone}/${acTotal}`, 'checks verified'),
      figure(String(groups.in_progress.length + groups.in_review.length), 'in progress or review'),
      figure(String(attention), attention === 1 ? 'needs you' : 'need you', attention ? 'alert' : ''),
      figure(String(openCount), openCount === 1 ? 'subagent working' : 'subagents working'));
    if (backlog.length) figures.append(figure(`${backlog.filter((b) => b.status === 'done').length}/${backlog.length}`, 'backlog done'));
  }

  function renderHeader(progress) {
    if (!progress) {
      header.replaceChildren(el('h2', {}, 'Run'), el('p', { class: 'empty' }, 'No run yet. Start one with taskify-implementer.'));
      return;
    }
    const field = (name, value) => el('div', { class: 'run-field' },
      el('dt', { class: 'run-label' }, name), el('dd', { class: 'run-value' }, str(value) || '—'));
    const fields = el('dl', { class: 'run-fields' },
      field('State', progress.run_state), field('Task', progress.current_task),
      field('Step', progress.current_step), field('Updated', progress.last_updated));
    header.replaceChildren(el('h2', {}, 'Run'), fields);
    if (str(progress.resume_note)) header.append(el('p', { class: 'resume-note' }, progress.resume_note));
  }

  // Donut of task counts per status; each arc carries a <title> for hover.
  function renderStatus(groups, total) {
    const ring = svg('svg', { class: 'donut', viewBox: '0 0 42 42', role: 'img', 'aria-label': 'Tasks by status' },
      svg('circle', { class: 'ring-track', cx: 21, cy: 21, r: 15.915 }));
    const gap = Object.values(groups).filter((l) => l.length).length > 1 ? 1 : 0;
    let offset = 0;
    for (const [s, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const share = (list.length / total) * 100;
      const len = Math.max(share - gap, 0.5);
      ring.append(svg('circle', {
        class: `seg st-${s}`, cx: 21, cy: 21, r: 15.915,
        'stroke-dasharray': `${len} ${100 - len}`, 'stroke-dashoffset': String(25 - offset),
      }, svg('title', {}, `${label(s)}: ${list.length}`)));
      offset += share;
    }
    ring.append(
      svg('text', { class: 'donut-num', x: 21, y: 22.5, 'text-anchor': 'middle' }, `${pct(groups.done.length, total)}%`),
      svg('text', { class: 'donut-cap', x: 21, y: 27, 'text-anchor': 'middle' }, 'done'));
    const legend = el('ul', { class: 'legend' }, ...Object.entries(groups)
      .filter(([s, list]) => list.length || s !== 'other')
      .map(([s, list]) => el('li', { class: list.length ? '' : 'zero' },
        el('span', { class: `dot st-${s}` }), label(s), el('span', { class: 'n' }, String(list.length)))));
    statusChart.replaceChildren(...(total ? [ring, legend] : [el('p', { class: 'empty' }, 'No tasks in this plan yet.')]));
  }

  // One block per wave: name, done count, a stacked rail, then a tile per task. Every current task pulses.
  function renderWaves(data, byId, current) {
    const list = Array.isArray(data.waves) ? data.waves : [];
    if (!list.length) { waves.replaceChildren(el('p', { class: 'empty' }, 'This plan has no wave graph.')); return; }
    waves.replaceChildren(...list.map((w) => {
      const ids = Array.isArray(w.tasks) ? w.tasks : [];
      const statuses = ids.map((id) => {
        const s = byId.get(id)?.status;
        return STATUSES.includes(s) ? s : 'other';
      });
      const done = statuses.filter((s) => s === 'done').length;
      const rail = el('div', { class: 'stack', role: 'img', 'aria-label': `Wave ${w.wave}: ${done} of ${ids.length} done` });
      for (const s of STATUSES.concat('other')) {
        const n = statuses.filter((x) => x === s).length;
        if (!n) continue;
        const seg = el('span', { class: `st-${s}`, title: `${label(s)}: ${n}` });
        seg.style.flexGrow = String(n);
        rail.append(seg);
      }
      const chips = el('div', { class: 'chips' }, ...ids.map((id, i) => el('span', {
        class: `chip st-${statuses[i]} status-${statuses[i]}${current.has(id) ? ' current' : ''}`,
        title: `${str(byId.get(id)?.title) || id} (${label(statuses[i])})`,
      }, str(id))));
      return el('div', { class: `wave${done === ids.length && ids.length ? ' complete' : ''}` },
        el('div', { class: 'wave-head' }, el('span', { class: 'wave-label' }, `Wave ${str(String(w.wave))}`),
          el('span', { class: 'wave-count' }, `${done} of ${ids.length}`)), rail, chips);
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
    }) : [el('li', { class: 'empty' }, 'Tool calls show here once a run records events.')]));
  }

  function renderBoard(groups) {
    board.replaceChildren(...Object.entries(groups).map(([status, list]) => {
      const col = el('div', { class: `column st-${status}${list.length ? '' : ' empty-col'}`, 'data-status': status },
        el('h3', {}, el('span', { class: 'dot' }), label(status), el('span', { class: 'col-n' }, String(list.length))));
      for (const t of list) {
        const backlog = t.kind === 'backlog';
        const total = Number(t.ac_total) || 0;
        const verified = Number(t.ac_verified) || 0;
        const meta = el('div', { class: 'card-meta' }, el('span', {}, backlog ? 'backlog' : `AC ${verified}/${total}`));
        if (backlog && str(t.batch)) meta.append(el('span', {}, t.batch));
        if (str(t.verdict)) meta.append(el('span', {}, t.verdict));
        if (t.fix_rounds > 0) meta.append(el('span', { class: 'fix' }, `fix ${t.fix_rounds}`));
        col.append(el('div', {
          class: `card st-${status}${backlog ? ' backlog' : ''}`, 'data-id': str(t.id), role: 'button', tabindex: '0',
          'aria-haspopup': 'dialog', 'aria-label': `${str(t.id)} ${str(t.title)}: show details`,
        },
          el('div', { class: 'card-id' }, str(t.id)),
          el('div', { class: 'card-title' }, str(t.title)),
          meta, backlog ? '' : meter(pct(verified, total))));
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
      el('h3', {}, 'Subagents working now'),
      el('ul', { class: 'open-subagents' }, ...(open.length
        ? open.map((a) => el('li', { class: 'open-subagent', 'data-aid': str(a.aid) },
          el('strong', {}, a.atype || 'subagent'), a.sum ? el('span', {}, a.sum) : ''))
        : [el('li', { class: 'empty' }, 'None right now.')])),
      el('h3', {}, 'Recent events'),
      el('ul', { class: 'recent-events' }, ...(recent.length
        ? recent.map((e) => el('li', { class: 'event' },
          el('strong', {}, str(e.atype) || 'main'), el('span', {}, str(e.ev)),
          ...[str(e.tool), str(e.sum)].filter(Boolean).map((x) => el('span', { class: 'muted' }, x))))
        : [el('li', { class: 'empty' }, 'No events recorded yet.')])));
  }

  function renderLog(progress) {
    const rows = progress && Array.isArray(progress.log) ? [...progress.log].reverse() : [];
    log.replaceChildren(el('h2', {}, 'Log'), el('ul', { class: 'log-rows' }, ...(rows.length
      ? rows.map((r) => el('li', { class: 'log-row' },
        el('span', { class: 'log-time' }, str(r.time)), el('span', { class: 'log-task' }, str(r.task)),
        el('span', { class: 'log-text' }, [r.event, r.note].map(str).filter((x) => x && x !== '—').join(': '))))
      : [el('li', { class: 'empty' }, 'The run log is empty.')])));
  }

  async function refresh() {
    const data = await api(`/api/plan?${q}`);
    const key = JSON.stringify([data.tasks, data.waves, data.progress, data.events, data.open_subagents, data.backlog]);
    if (key === lastKey) return; // nothing changed: leave the DOM alone
    lastKey = key;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const backlog = Array.isArray(data.backlog) ? data.backlog : [];
    const groups = groupByStatus(tasks);
    // "T1.02", "T2.01, T2.03" (a parallel batch) or "T4.04 (not started)"
    const current = new Set(str(data.progress?.current_task).match(/T\d+\.\d+[a-z]?/g) ?? []);
    latest = { tasks, backlog, waves: Array.isArray(data.waves) ? data.waves : [], log: Array.isArray(data.progress?.log) ? data.progress.log : [] };
    if (openId) { // keep an open dialog live; the loaded spec section is kept as is
      const t = find(openId);
      if (t) renderDialog(t, spec); else dialog.close();
    }
    renderFigures(tasks, groups, Array.isArray(data.open_subagents) ? data.open_subagents.length : 0, backlog);
    renderHeader(data.progress ?? null);
    renderStatus(groups, tasks.length);
    renderWaves(data, new Map(tasks.map((t) => [t.id, t])), current);
    renderTools(data.events);
    renderBoard(groupByStatus([...tasks, ...backlog]));
    renderActivity(data.events, data.open_subagents);
    renderLog(data.progress ?? null);
  }

  await refresh();
  onPoll(refresh);
}
