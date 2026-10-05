import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFixture } from './helpers.mjs';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
const roots = [];

function run(cmd, root, ...extra) {
  const r = spawnSync(process.execPath, [cli, cmd, '--root', root, ...extra], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
function freshRoot() {
  const root = copyFixture('plan-basic');
  roots.push(root);
  return root;
}
const infoFile = (root) => path.join(root, '.taskify', 'dashboard.json');
const health = (info) => fetch(`http://127.0.0.1:${info.port}/api/health`, {
  headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(2000),
}).then((r) => r.json(), () => null);

after(() => { for (const root of roots) run('stop', root); });

test('start returns a tokenized local url', () => {
  const root = freshRoot();
  const { code, out } = run('start', root);
  assert.equal(code, 0);
  assert.equal(out.reused, false);
  assert.match(out.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]{43}$/);
  assert.equal(out.public_url, null);
  assert.equal(out.pid, JSON.parse(fs.readFileSync(infoFile(root), 'utf8')).pid);
});

test('server survives the cli exiting', async () => {
  const root = freshRoot();
  const { out } = run('start', root); // the cli process has exited by now
  const info = JSON.parse(fs.readFileSync(infoFile(root), 'utf8'));
  await new Promise((r) => setTimeout(r, 300));
  const h = await health(info);
  assert.equal(h.ok, true);
  assert.equal(h.pid, out.pid);
});

test('second start reuses the server', () => {
  const root = freshRoot();
  const first = run('start', root).out;
  const second = run('start', root).out;
  assert.equal(second.reused, true);
  assert.equal(second.pid, first.pid);
  assert.equal(second.url, first.url);
});

test('status and url report the running server', () => {
  const root = freshRoot();
  const started = run('start', root).out;
  const status = run('status', root).out;
  assert.equal(status.running, true);
  assert.equal(status.pid, started.pid);
  assert.equal(status.url, started.url);
  assert.deepEqual(run('url', root).out, { url: started.url, public_url: null });
  run('stop', root);
  assert.equal(run('status', root).out.running, false);
  assert.equal(run('url', root).out.running, false);
});

test('stop ends the server and removes dashboard.json', async () => {
  const root = freshRoot();
  run('start', root);
  const info = JSON.parse(fs.readFileSync(infoFile(root), 'utf8'));
  assert.equal(run('stop', root).out.stopped, true);
  assert.equal(fs.existsSync(infoFile(root)), false);
  assert.equal(await health(info), null);
});

test('stale dashboard.json is replaced', async () => {
  const root = freshRoot();
  fs.mkdirSync(path.dirname(infoFile(root)), { recursive: true });
  fs.writeFileSync(infoFile(root), JSON.stringify({ pid: 2147483646, port: 1, token: 'dead', root }));
  const { out } = run('start', root);
  assert.equal(out.reused, false);
  assert.notEqual(out.pid, 2147483646);
  const h = await health(JSON.parse(fs.readFileSync(infoFile(root), 'utf8')));
  assert.equal(h.pid, out.pid);
});

test('start reports early server exit quickly', async () => {
  const root = freshRoot();
  const base = 47100;
  const blockers = [];
  try {
    for (let p = base; p < base + 10; p++) {
      const s = net.createServer();
      await new Promise((resolve, reject) => { s.once('error', reject); s.listen(p, '127.0.0.1', resolve); });
      blockers.push(s);
    }
    const t0 = Date.now();
    const r = await new Promise((resolve) => {
      execFile(process.execPath, [cli, 'start', '--root', root, '--port', String(base)], { windowsHide: true, timeout: 15000 },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr }));
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /exited early/);
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  } finally {
    await Promise.all(blockers.map((s) => new Promise((r) => s.close(r))));
  }
});

test('unknown command exits 2', () => {
  const r = spawnSync(process.execPath, [cli, 'bogus'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 2);
});

const planOf = (root) => path.join(root, 'docs', 'plan-basic');
function runEnv(env, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
const cmd = (...args) => runEnv({}, ...args);

test('review summarizes open comments and approval', () => {
  const root = freshRoot();
  const { code, out } = cmd('review', '--plan', planOf(root));
  assert.equal(code, 0);
  assert.equal(out.approved, false);
  assert.equal(out.approved_at, null);
  assert.deepEqual(out.docs_changed_since_approval, []);
  assert.equal(out.open_comments.length, 1);
  assert.equal(out.open_comments[0].id, 'c_00000001');
});

test('resolve marks a comment and review reflects it', () => {
  const root = freshRoot();
  const plan = planOf(root);
  const before = cmd('review', '--plan', plan).out;
  const { code, out } = cmd('resolve', '--plan', plan, '--id', 'c_00000001', '--note', 'done in T1.02', '--by', 'taskify-implementer');
  assert.equal(code, 0);
  assert.equal(out.resolved, true);
  assert.equal(out.resolved_by, 'taskify-implementer');
  assert.equal(out.resolution_note, 'done in T1.02');
  const after = cmd('review', '--plan', plan).out;
  assert.deepEqual(after.open_comments, []);
  assert.equal(after.resolved_count, before.resolved_count + 1);
  assert.equal(cmd('resolve', '--plan', plan, '--id', 'c_00000001').out.resolved_by, 'claude');
});

test('resolve unknown id exits 1', () => {
  const root = freshRoot();
  const r = cmd('resolve', '--plan', planOf(root), '--id', 'c_ffffffff');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /c_ffffffff/);
  assert.equal(r.out, null);
});

test('run-start writes marker with session from env and empties events', () => {
  const root = freshRoot();
  const plan = planOf(root);
  fs.mkdirSync(path.join(plan, '.taskify'), { recursive: true });
  fs.writeFileSync(path.join(plan, '.taskify', 'events.jsonl'), '{"ev":"old"}\n');
  const r = runEnv({ CLAUDE_CODE_SESSION_ID: 'sess-test' }, 'run-start', '--root', root, '--plan', plan);
  assert.equal(r.code, 0);
  const marker = JSON.parse(fs.readFileSync(path.join(root, '.taskify', 'active-run.json'), 'utf8'));
  assert.equal(marker.session_id, 'sess-test');
  assert.equal(marker.plan, path.resolve(plan));
  assert.ok(!Number.isNaN(Date.parse(marker.started_at)));
  assert.equal(fs.readFileSync(path.join(plan, '.taskify', 'events.jsonl'), 'utf8'), '');
  runEnv({ CLAUDE_CODE_SESSION_ID: 'sess-test' }, 'run-start', '--root', root, '--plan', plan, '--session', 'explicit');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.taskify', 'active-run.json'), 'utf8')).session_id, 'explicit');
});

test('run-start rejects a folder that is not a plan', () => {
  const root = freshRoot();
  const r = cmd('run-start', '--root', root, '--plan', root);
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(path.join(root, '.taskify', 'active-run.json')), false);
});

test('run-end removes marker and tolerates absence', () => {
  const root = freshRoot();
  cmd('run-start', '--root', root, '--plan', planOf(root));
  const marker = path.join(root, '.taskify', 'active-run.json');
  assert.equal(fs.existsSync(marker), true);
  assert.equal(cmd('run-end', '--root', root).code, 0);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(cmd('run-end', '--root', root).code, 0);
});
