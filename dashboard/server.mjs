import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlans, openSubagents, parseEvents, parseProgress, parseReadme, parseSpec, fixRounds } from './lib/parse.mjs';
import { addApproval, addComment, readReview, resolveComment, reviewSummary } from './lib/review-store.mjs';

const BIND = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// ---- flags and environment ----
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const token = process.env.TASKIFY_DASHBOARD_TOKEN;
if (!token) {
  console.error('TASKIFY_DASHBOARD_TOKEN is not set');
  process.exit(2);
}
const root = path.resolve(flag('root') ?? process.cwd());
const idleMs = Number(flag('idle-minutes') ?? 240) * 60000;
const infoPath = path.join(root, '.taskify', 'dashboard.json');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// ---- last-good cache: keyed by path, invalidated by mtime and size ----
const cache = new Map();
function readCached(file, parse, ok = () => true) {
  const hit = cache.get(file);
  let st;
  try { st = fs.statSync(file); } catch { return hit ? hit.value : null; }
  const key = `${st.mtimeMs}:${st.size}`;
  if (hit && hit.key === key) return hit.value;
  let value;
  try { value = parse(fs.readFileSync(file, 'utf8')); } catch { return hit ? hit.value : null; }
  if (hit && !ok(value) && ok(hit.value)) value = hit.value;
  cache.set(file, { key, value });
  return value;
}
const specOk = (s) => s.id && s.status;
const progressOk = (p) => p.run_state;

// ---- plan data ----
const rel = (dir, file) => path.relative(dir, file).split(path.sep).join('/');
const mtimeOf = (file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };
const names = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };
const specFiles = (dir) => names(path.join(dir, 'specs', 'tasks')).filter((n) => /^T.*\.md$/.test(n));

function planSummary(plan) {
  const tasks = specFiles(plan.dir).map((n) => readCached(path.join(plan.dir, 'specs', 'tasks', n), parseSpec, specOk));
  const progress = readCached(path.join(plan.dir, 'specs', 'tasks', 'PROGRESS.md'), parseProgress, progressOk);
  const first = names(plan.dir).find((n) => /^\d.*\.md$/.test(n));
  const heading = first && readCached(path.join(plan.dir, first), (t) => (t.match(/^# (.+)$/m) ?? [])[1] ?? null);
  const latest = Math.max(...['README.md', 'PROGRESS.md'].map((n) => mtimeOf(path.join(plan.dir, 'specs', 'tasks', n))));
  return {
    id: plan.id,
    title: heading || plan.id,
    tasks_total: tasks.length,
    tasks_done: tasks.filter((t) => t && t.status === 'done').length,
    run_state: (progress && progress.run_state) || null,
    mtime: new Date(latest).toISOString(),
  };
}

function planDetail(plan) {
  const tasksDir = path.join(plan.dir, 'specs', 'tasks');
  const progress = readCached(path.join(tasksDir, 'PROGRESS.md'), parseProgress, progressOk);
  const readme = readCached(path.join(tasksDir, 'README.md'), parseReadme) ?? { waves: [] };
  const docs = [];
  for (const n of names(plan.dir)) if (n.endsWith('.md')) docs.push({ path: n, kind: 'plan' });
  docs.push({ path: 'specs/tasks/README.md', kind: 'index' });
  if (progress) docs.push({ path: 'specs/tasks/PROGRESS.md', kind: 'progress' });
  const tasks = [];
  for (const n of specFiles(plan.dir)) {
    const file = path.join(tasksDir, n);
    const spec = readCached(file, parseSpec, specOk);
    if (!spec) continue;
    const id = spec.id ?? (n.match(/^T\d+\.\d+[a-z]?/) ?? [n])[0];
    const { acs, ...fields } = spec;
    tasks.push({ ...fields, id, file: rel(plan.dir, file), fix_rounds: fixRounds(progress?.log, id) });
    docs.push({ path: rel(plan.dir, file), kind: 'spec' });
  }
  let events = [];
  try { events = parseEvents(fs.readFileSync(path.join(plan.dir, '.taskify', 'events.jsonl'), 'utf8'), 200); } catch { /* no events yet */ }
  const open_subagents = readCached(path.join(plan.dir, '.taskify', 'events.jsonl'), openSubagents) ?? [];
  return {
    id: plan.id,
    title: planSummary(plan).title,
    docs,
    tasks,
    waves: readme.waves,
    progress,
    events,
    open_subagents,
    review: { ...readReview(plan.dir), summary: reviewSummary(plan.dir) },
  };
}

function readPlanFile(plan, p) {
  if (typeof p !== 'string' || !p.endsWith('.md')) return null;
  const target = path.resolve(plan.dir, p);
  if (!target.startsWith(path.resolve(plan.dir) + path.sep)) return null;
  try {
    const base = fs.realpathSync.native(plan.dir);
    const real = fs.realpathSync.native(target);
    return real.startsWith(base + path.sep) && real.endsWith('.md') ? fs.readFileSync(real, 'utf8') : null;
  } catch {
    return null;
  }
}

// ---- http ----
function send(res, status, body = '', type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

function authed(req, port) {
  const m = new RegExp(`(?:^|;\\s*)taskify_t_${port}=([^;]*)`).exec(req.headers.cookie ?? '');
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  const given = m ? m[1] : bearer ? bearer[1] : '';
  return crypto.timingSafeEqual(sha(given), sha(token));
}

// ---- writes (POST): only ever call review-store, which only writes review.json ----
const MAX_BODY = 64 * 1024;
const STORE_STATUS = { EINVAL: 400, ENOENT: 404, ELOCKED: 503, ECORRUPT: 409 };
const msg = (res, status, error) => json(res, status, { error });

// Routes: POST /api/comments, POST /api/comments/<cid>/resolve, POST /api/approve.
function handleWrite(req, res, route) {
  const resolve = /^\/api\/comments\/([^/]+)\/resolve$/.exec(route);
  if (route !== '/api/comments' && route !== '/api/approve' && !resolve) return send(res, 404);
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return msg(res, 415, 'Content-Type must be application/json');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* malformed origin is refused */ }
    if (host === null || host !== req.headers.host) return msg(res, 403, 'foreign origin');
  }
  const chunks = [];
  let size = 0;
  let over = false;
  req.on('data', (chunk) => {
    if (over) return;
    size += chunk.length;
    if (size > MAX_BODY) {
      over = true;
      res.setHeader('Connection', 'close');
      msg(res, 413, 'body over 64 KB');
    } else chunks.push(chunk);
  });
  req.on('end', () => {
    if (over) return;
    try {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return msg(res, 400, 'invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return msg(res, 400, 'body must be a JSON object');
      const plan = typeof body.plan === 'string' && findPlans(root).find((p) => p.id === body.plan);
      if (!plan) return msg(res, 404, 'unknown plan');
      const who = (v) => v || 'browser';
      try {
        if (route === '/api/comments') return json(res, 201, addComment(plan.dir, { ...body, author: who(body.author) }));
        if (route === '/api/approve') return json(res, 201, addApproval(plan.dir, { note: body.note, by: who(body.author) }));
        return json(res, 200, resolveComment(plan.dir, decodeURIComponent(resolve[1]), { note: body.note, by: who(body.by) }));
      } catch (err) {
        const status = STORE_STATUS[err.code];
        return msg(res, status ?? 500, status ? err.message : 'internal error');
      }
    } catch {
      if (!res.headersSent) send(res, 500);
    }
  });
}

function handle(req, res, port) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, `http://${BIND}`);
  const route = url.pathname;
  if (route.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return authed(req, port) ? send(res, 405) : send(res, 401);

  if (req.method === 'GET' && route === '/' && url.searchParams.has('t')) {
    if (!crypto.timingSafeEqual(sha(url.searchParams.get('t')), sha(token))) return send(res, 401);
    resetIdle();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 302, '', 'text/plain; charset=utf-8', {
      Location: '/', 'Set-Cookie': `taskify_t_${port}=${token}; HttpOnly; SameSite=Strict; Path=/${secure}`,
    });
  }
  if (!authed(req, port)) return send(res, 401);
  resetIdle();
  if (req.method === 'POST') return handleWrite(req, res, route);

  if (route === '/') return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')), TYPES['.html']);
  if (route.startsWith('/static/')) {
    const file = path.resolve(PUBLIC_DIR, decodeURIComponent(route.slice(8)));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404);
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  }
  if (route === '/api/health') return json(res, 200, { ok: true, pid: process.pid, port, root, bind: BIND });
  if (route === '/api/plans') return json(res, 200, findPlans(root).map(planSummary));
  if (route === '/api/plan' || route === '/api/file') {
    const plan = findPlans(root).find((p) => p.id === url.searchParams.get('plan'));
    if (!plan) return send(res, 404);
    if (route === '/api/plan') return json(res, 200, planDetail(plan));
    const text = readPlanFile(plan, url.searchParams.get('path'));
    return text === null ? send(res, 404) : send(res, 200, text, 'text/markdown; charset=utf-8');
  }
  return send(res, 404);
}

// ---- startup, idle exit ----
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try {
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      if (info.pid === process.pid) {
        const t = info.tunnel;
        if (t && t.pid && t.cmd) {
          const out = process.platform === 'win32'
            ? execFileSync('tasklist', ['/FI', `PID eq ${t.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
            : execFileSync('ps', ['-p', String(t.pid), '-o', 'comm='], { encoding: 'utf8' });
          if (out.toLowerCase().includes(t.cmd.toLowerCase())) process.kill(t.pid);
        }
        fs.rmSync(infoPath, { force: true });
      }
    } catch { /* no file or tunnel already gone */ }
    process.exit(0);
  }, idleMs);
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res, server.address().port);
  } catch (err) {
    if (!res.headersSent) send(res, 500);
    else res.end();
  }
});

const exact = flag('port');
const start = Number(exact ?? flag('port-start') ?? 4317);
const last = exact !== undefined ? start : start + 9;
function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < last) return listen(port + 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, BIND, () => {
    server.removeAllListeners('error');
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify({
      pid: process.pid, port: server.address().port, token, root, started_at: new Date().toISOString(), tunnel: null,
    }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(infoPath, 0o600); } catch { /* best effort; no-op on Windows */ }
    resetIdle();
  });
}
listen(start);
