// Dashboard shell: API helper, poll loop, hash router. Views (review.js, progress.js) are lazy-imported.
const POLL_MS = 3000;
const LIVE_KEY = 'taskify.live';

const app = document.getElementById('app');
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

// ---- api ----
let banner = null;
function showBanner(text) {
  if (!banner) {
    banner = el('p', { class: 'banner', role: 'alert' });
    app.prepend(banner);
  }
  banner.textContent = text;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if (res.status === 401) {
    showBanner('Session expired — open the link with ?t= again');
    throw new Error('401');
  }
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const type = res.headers.get('Content-Type') ?? '';
  return type.includes('json') ? res.json() : res.text();
}

// ---- live toggle and poll loop ----
function readLive() {
  try { return localStorage.getItem(LIVE_KEY) !== 'off'; } catch { return true; }
}
function writeLive(on) {
  try { localStorage.setItem(LIVE_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
}

let live = readLive();
let pollers = new Set();

// Registers fn to run every 3 s while Live is on; returns an unsubscribe function.
// All pollers are dropped when the route changes.
export function onPoll(fn) {
  pollers.add(fn);
  return () => pollers.delete(fn);
}

const busy = new Set();
setInterval(() => {
  if (!live) return;
  for (const fn of [...pollers]) {
    if (busy.has(fn)) continue; // previous run still pending
    busy.add(fn);
    Promise.resolve().then(fn)
      .catch(() => { /* a failed refresh keeps the last good view */ })
      .finally(() => busy.delete(fn));
  }
}, POLL_MS);

// ---- shell chrome ----
const topbar = el('header', { class: 'topbar' });
const content = el('div', { class: 'content' });
const homeLink = el('a', { href: '#/', class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Taskify Dashboard');
const toggle = el('input', { type: 'checkbox', id: 'live-toggle' });
toggle.checked = live;
toggle.addEventListener('change', () => {
  live = toggle.checked;
  writeLive(live);
});
topbar.append(homeLink, el('label', { class: 'live', for: 'live-toggle' }, toggle, ' Live'));
app.append(topbar, content);

// ---- routes ----
let routeSeq = 0;

// onPoll bound to one route: a registration made after the route changed is a no-op.
const scopedOnPoll = (seq) => (fn) => (seq === routeSeq ? onPoll(fn) : () => {});

function parseRoute() {
  const m = /^#\/plan\/([^/]+)\/(review|progress)$/.exec(location.hash);
  if (!m) return null;
  try { return { planId: decodeURIComponent(m[1]), view: m[2] }; } catch { return null; } // malformed % escape -> home
}

async function renderHome(seq) {
  const list = el('ul', { class: 'plans' });
  content.replaceChildren(el('h1', {}, 'Plans'), list);
  let last = null;
  let req = 0;
  async function refresh() {
    const mine = ++req;
    const plans = await api('/api/plans');
    if (seq !== routeSeq || mine !== req) return;
    const key = JSON.stringify(plans);
    if (key === last) return;
    last = key;
    if (!plans.length) {
      list.replaceChildren(el('li', { class: 'empty' }, 'No taskify plans found.'));
      return;
    }
    list.replaceChildren(...plans.map((p) => {
      const id = str(p.id);
      const state = str(p.run_state);
      const done = Number(p.tasks_done) || 0;
      const total = Number(p.tasks_total) || 0;
      const fill = el('div', { class: 'meter-fill' });
      fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`; // CSSOM: allowed by the style-src CSP
      return el('li', {},
        el('a', { class: 'plan-link', href: `#/plan/${encodeURIComponent(id)}/review` },
          el('span', { class: 'plan-title' }, str(p.title, id) || id),
          el('span', { class: 'plan-meta' }, `${p.tasks_done ?? 0}/${p.tasks_total ?? 0} done`),
          state ? el('span', { class: 'plan-state' }, state) : '',
          el('div', { class: 'meter' }, fill)));
    }));
  }
  scopedOnPoll(seq)(refresh);
  await refresh();
}

async function renderPlan(seq, { planId, view }) {
  const header = el('div', { class: 'plan-header' });
  const title = el('h1', {}, planId);
  const tabs = el('nav', { class: 'tabs' },
    ...['review', 'progress'].map((v) => el('a', {
      href: `#/plan/${encodeURIComponent(planId)}/${v}`,
      class: v === view ? 'tab active' : 'tab',
      ...(v === view ? { 'aria-current': 'page' } : {}),
    }, v === 'review' ? 'Review' : 'Progress')));
  const container = el('div', { class: 'view', id: 'view' });
  header.append(title, tabs);
  content.replaceChildren(el('p', { class: 'back' }, el('a', { href: '#/' }, '← All plans')), header, container);

  api('/api/plans').then((plans) => {
    const p = plans.find((x) => x.id === planId);
    if (p && seq === routeSeq) title.textContent = str(p.title, planId) || planId;
  }).catch(() => { /* title stays as the id */ });

  try {
    const mod = await import(`./${view}.js`);
    if (seq !== routeSeq) return;
    await mod.mount(container, { planId, api, onPoll: scopedOnPoll(seq) });
  } catch (err) {
    if (seq !== routeSeq) return;
    container.replaceChildren(el('p', { class: 'unavailable' }, 'This view is not available yet.'));
  }
}

async function route() {
  const seq = ++routeSeq;
  pollers = new Set();
  try {
    const r = parseRoute();
    if (r) await renderPlan(seq, r);
    else await renderHome(seq);
  } catch { /* api() already showed a banner for 401; other errors keep the shell */ }
}

window.addEventListener('hashchange', route);
route();
