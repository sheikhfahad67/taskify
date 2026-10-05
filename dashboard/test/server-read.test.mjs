import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { copyFixture, startServer, get } from './helpers.mjs';

const stoppers = [];
after(async () => { for (const stop of stoppers) await stop(); });

async function setup(opts) {
  const root = copyFixture('plan-basic');
  const s = await startServer(root, opts);
  stoppers.push(s.stop);
  return { root, ...s };
}
const planUrl = (s) => `${s.url}/api/plan?plan=docs/plan-basic`;

test('rejects requests without token', async () => {
  const s = await setup();
  for (const p of ['/', '/api/health', '/api/plans', '/static/app.css']) {
    assert.equal((await get(s.url + p)).status, 401, p);
  }
});

test('query token sets cookie and redirects', async () => {
  const s = await setup();
  const res = await get(`${s.url}/?t=${s.token}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  assert.equal(res.headers.get('set-cookie'), `taskify_t_${s.port}=${s.token}; HttpOnly; SameSite=Strict; Path=/`);
  assert.equal((await get(`${s.url}/?t=wrong`)).status, 401);
  const https = await get(`${s.url}/?t=${s.token}`, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(https.headers.get('set-cookie'), /; Secure$/);
});

test('bearer and cookie both authenticate', async () => {
  const s = await setup();
  assert.equal((await get(s.url + '/api/plans', { token: s.token })).status, 200);
  assert.equal((await get(s.url + '/api/plans', { cookie: `taskify_t_${s.port}=${s.token}` })).status, 200);
  const page = await get(s.url + '/', { cookie: `taskify_t_${s.port}=${s.token}` });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Taskify Dashboard<\/title>/);
});

test('wrong token of a different length is 401', async () => {
  const s = await setup();
  assert.equal((await get(s.url + '/api/plans', { token: 'x' })).status, 401);
  assert.equal((await get(s.url + '/api/plans', { token: s.token + 'extra' })).status, 401);
  assert.equal((await get(s.url + '/api/plans', { cookie: `taskify_t_${s.port}=` })).status, 401);
});

test('cookie is scoped to the server port', async () => {
  const a = await setup();
  const b = await setup();
  assert.notEqual(a.port, b.port);
  const stray = `taskify_t_${b.port}=${a.token}; taskify_t=${a.token}`;
  assert.equal((await get(a.url + '/api/plans', { cookie: stray })).status, 401);
  assert.equal((await get(a.url + '/api/plans', { cookie: `taskify_t_${b.port}=${b.token}; taskify_t_${a.port}=${a.token}` })).status, 200);
  const res = await get(`${a.url}/?t=${a.token}`);
  assert.match(res.headers.get('set-cookie'), new RegExp(`^taskify_t_${a.port}=`));
});

test('health reports 127.0.0.1 bind', async () => {
  const s = await setup();
  const h = await (await get(s.url + '/api/health', { token: s.token })).json();
  assert.equal(h.ok, true);
  assert.equal(h.bind, '127.0.0.1');
  assert.equal(h.port, s.port);
  assert.equal(h.pid, s.child.pid);
  assert.equal(h.root, s.root);
});

test('plans lists the fixture', async () => {
  const s = await setup();
  const plans = await (await get(s.url + '/api/plans', { token: s.token })).json();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, 'docs/plan-basic');
  assert.equal(plans[0].title, 'Fixture Plan — Overview');
  assert.equal(plans[0].tasks_total, 4);
  assert.equal(plans[0].tasks_done, 1);
  assert.equal(plans[0].run_state, 'running');
});

test('plan returns derived task data', async () => {
  const s = await setup();
  const plan = await (await get(planUrl(s), { token: s.token })).json();
  assert.deepEqual(plan.tasks.map((t) => t.id), ['T1.01', 'T1.02', 'T2.01', 'T2.02']);
  const t = plan.tasks.find((x) => x.id === 'T1.02');
  assert.equal(t.status, 'in_review');
  assert.equal(t.ac_total, 3);
  assert.equal(t.ac_verified, 2);
  assert.equal(t.verdict, 'pending');
  assert.equal(plan.tasks.find((x) => x.id === 'T2.01').fix_rounds, 2);
  assert.deepEqual(plan.waves.map((w) => w.wave), [1, 2]);
  assert.equal(plan.progress.run_state, 'running');
  assert.ok(plan.events.length > 0);
  assert.ok(plan.docs.some((d) => d.path === '00-overview.md' && d.kind === 'plan'));
  assert.equal(plan.review.summary.approved, false);
  assert.ok(Array.isArray(plan.review.comments));
});

test('plan includes open_subagents', async () => {
  const s = await setup();
  const plan = await (await get(planUrl(s), { token: s.token })).json();
  assert.equal(plan.open_subagents.length, 1);
  const a = plan.open_subagents[0];
  assert.equal(a.aid, 'a1');
  assert.equal(a.atype, 'general-purpose');
  assert.equal(a.last_tool, 'Bash');
  assert.equal(a.last_sum, 'node --test');
  assert.ok(a.started);
});

test('file serves markdown inside the plan', async () => {
  const s = await setup();
  const res = await get(`${s.url}/api/file?plan=docs/plan-basic&path=00-overview.md`, { token: s.token });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(await res.text(), /# Fixture Plan/);
});

test('file rejects traversal absolute non-md and link escape', async () => {
  const s = await setup();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-outside-'));
  stoppers.push(async () => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.symlinkSync(outside, path.join(s.root, 'docs', 'plan-basic', 'link'), 'junction');
  const paths = ['../../../etc/passwd.md', '..\\..\\00-overview.md', path.join(outside, 'secret.md'), '00-overview.txt', 'link/secret.md', 'nope.md'];
  for (const p of paths) {
    const res = await get(`${s.url}/api/file?plan=docs/plan-basic&path=${encodeURIComponent(p)}`, { token: s.token });
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /secret/);
  }
});

test('file rejects UNC paths without touching the disk', async () => {
  const s = await setup();
  const paths = ['\\\\127.0.0.2\\share\\x.md', '//127.0.0.2/share/x.md', '\\\\?\\C:\\Windows\\x.md', '../../../etc/passwd.md'];
  for (const p of paths) {
    const t0 = Date.now();
    const res = await get(`${s.url}/api/file?plan=docs/plan-basic&path=${encodeURIComponent(p)}`, { token: s.token });
    assert.equal(res.status, 404, p);
    assert.ok(Date.now() - t0 < 1000, `${p} took ${Date.now() - t0} ms`);
  }
  // A junction outside the plan that points back into it: lexically outside, so 404 even
  // though realpath would land inside the plan (only the lexical check rejects it).
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-back-'));
  try {
    fs.symlinkSync(path.join(s.root, 'docs', 'plan-basic'), path.join(outside, 'back'), 'junction');
    const p = path.join(outside, 'back', '00-overview.md');
    const res = await get(`${s.url}/api/file?plan=docs/plan-basic&path=${encodeURIComponent(p)}`, { token: s.token });
    assert.equal(res.status, 404, p);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('unknown plan is 404', async () => {
  const s = await setup();
  for (const p of ['/api/plan?plan=docs/nope', '/api/plan', '/api/plan?plan=../docs/plan-basic', '/api/file?plan=x&path=a.md']) {
    assert.equal((await get(s.url + p, { token: s.token })).status, 404, p);
  }
});

test('security headers on every response', async () => {
  const s = await setup();
  const urls = [['/api/plans', s.token], ['/api/plans', null], ['/nope', s.token], ['/', s.token], ['/api/file?plan=x&path=y.md', s.token]];
  for (const [p, token] of urls) {
    const res = await get(s.url + p, { token });
    assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    if (p.startsWith('/api/')) assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('half-written spec keeps last good parse', async () => {
  const s = await setup();
  const status = async () => (await (await get(planUrl(s), { token: s.token })).json()).tasks.find((t) => t.id === 'T1.02').status;
  assert.equal(await status(), 'in_review');
  const file = path.join(s.root, 'docs', 'plan-basic', 'specs', 'tasks', 'T1.02-beta.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').slice(0, 3).join('\n'));
  assert.equal(await status(), 'in_review');
});

test('port-start falls back when the port is taken', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  stoppers.push(() => new Promise((r) => blocker.close(r)));
  const taken = blocker.address().port;
  const s = await setup({ portStart: taken });
  assert.ok(s.port > taken && s.port <= taken + 9);
  assert.equal((await get(s.url + '/api/health', { token: s.token })).status, 200);
});

test('idle exit removes dashboard.json', async () => {
  const s = await setup({ idleMinutes: 0.02 });
  const infoPath = path.join(s.root, '.taskify', 'dashboard.json');
  assert.ok(fs.existsSync(infoPath));
  const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('timeout'), 10000))]);
  assert.equal(code, 0);
  assert.equal(fs.existsSync(infoPath), false);
});

test('unauthenticated requests do not reset idle timer', async () => {
  const s = await setup({ idleMinutes: 0.03 });
  let exited = false;
  s.exited.then(() => { exited = true; });
  const deadline = Date.now() + 8000;
  while (!exited && Date.now() < deadline) {
    await get(s.url + '/api/plans').catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(exited, true, 'server kept running while only 401 requests arrived');
  assert.equal(fs.existsSync(path.join(s.root, '.taskify', 'dashboard.json')), false);
});

test('dashboard.json is owner-only on POSIX', async () => {
  const s = await setup();
  const infoPath = path.join(s.root, '.taskify', 'dashboard.json');
  assert.ok(fs.existsSync(infoPath));
  if (process.platform === 'win32') return;
  assert.equal(fs.statSync(infoPath).mode & 0o077, 0);
});

test('idle exit leaves a foreign dashboard.json alone', async () => {
  const s = await setup({ idleMinutes: 0.03 });
  const infoPath = path.join(s.root, '.taskify', 'dashboard.json');
  const foreign = JSON.stringify({ pid: s.child.pid + 100000, port: 1, token: 'x', root: s.root, tunnel: null });
  fs.writeFileSync(infoPath, foreign);
  const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('timeout'), 10000))]);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(infoPath, 'utf8'), foreign);
});
