// Progress view: run header, waves, status board, live subagent activity, log. Read-only.
const STATUSES = ['pending', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'done', 'skipped'];
const RECENT_EVENTS = 30;

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

const str = (v) => (typeof v === 'string' ? v : '');

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

  const header = el('section', { class: 'run-header', id: 'run-header' });
  const waves = el('section', { class: 'waves', id: 'waves' });
  const board = el('section', { class: 'board', id: 'board' });
  const activity = el('section', { class: 'activity', id: 'activity' });
  const log = el('section', { class: 'run-log', id: 'run-log' });
  root.replaceChildren(header, waves, board, activity, log);

  function renderHeader(progress) {
    if (!progress) {
      header.replaceChildren(el('p', { class: 'empty' }, 'No run yet'));
      return;
    }
    const field = (label, value) => el('div', { class: 'run-field' },
      el('span', { class: 'run-label' }, label), el('span', { class: 'run-value' }, str(value) || '—'));
    header.replaceChildren(
      field('Run state', progress.run_state), field('Current task', progress.current_task),
      field('Current step', progress.current_step), field('Last updated', progress.last_updated),
      field('Resume note', progress.resume_note));
  }

  function renderWaves(data, byId) {
    const list = Array.isArray(data.waves) ? data.waves : [];
    waves.replaceChildren(...list.map((w) => {
      const row = el('div', { class: 'wave' }, el('span', { class: 'wave-label' }, `Wave ${str(String(w.wave))}`));
      for (const id of Array.isArray(w.tasks) ? w.tasks : []) {
        const s = byId.get(id)?.status;
        const cls = STATUSES.includes(s) ? s : 'other';
        row.append(el('span', { class: `chip status-${cls}` }, str(id)));
      }
      return row;
    }));
  }

  function renderBoard(tasks) {
    const groups = groupByStatus(tasks);
    board.replaceChildren(...Object.entries(groups).map(([status, list]) => {
      const col = el('div', { class: 'column', 'data-status': status },
        el('h3', {}, `${status} (${list.length})`));
      for (const t of list) {
        const card = el('div', { class: 'card', 'data-id': str(t.id) },
          el('div', { class: 'card-id' }, str(t.id)),
          el('div', { class: 'card-title' }, str(t.title)),
          el('div', { class: 'card-meta' }, `AC ${Number(t.ac_verified) || 0}/${Number(t.ac_total) || 0}`));
        if (str(t.verdict)) card.lastChild.append(` · ${t.verdict}`);
        if (t.fix_rounds > 0) card.lastChild.append(` · fix ${t.fix_rounds}`);
        col.append(card);
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
    renderHeader(data.progress ?? null);
    renderWaves(data, new Map(tasks.map((t) => [t.id, t])));
    renderBoard(tasks);
    renderActivity(data.events, data.open_subagents);
    renderLog(data.progress ?? null);
  }

  await refresh();
  onPoll(refresh);
}
