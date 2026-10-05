import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFixture, startServer } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'cli.mjs');
const fake = path.join(here, 'fixtures', 'fake-tunnel.mjs');
const roots = [];

function run(cmd, root, env, ...extra) {
  const r = spawnSync(process.execPath, [cli, cmd, '--root', root, ...extra], { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}
function freshRoot() {
  const root = copyFixture('plan-basic');
  roots.push(root);
  return root;
}
const fakeEnv = { ...process.env, TASKIFY_TUNNEL_CMD: JSON.stringify([process.execPath, fake]) };
const infoOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.taskify', 'dashboard.json'), 'utf8'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

after(() => { for (const root of roots) run('stop', root, fakeEnv); });

test('public start with fake tunnel records public url', () => {
  const root = freshRoot();
  const { code, out, stderr } = run('start', root, fakeEnv, '--public');
  assert.equal(code, 0);
  assert.match(out.public_url, /^https:\/\/fake-tunnel-123\.trycloudflare\.com\/\?t=[A-Za-z0-9_-]{43}$/);
  assert.ok(stderr.includes('WARNING: Anyone with this link can read these plan docs and the live activity log (including the start of each command), and can add comments or approve the plan.'), stderr);
  assert.ok(stderr.includes('A new cloudflared link can take about a minute to start working. If it does not load yet, wait a minute and reload.'), stderr);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, '.taskify', 'dashboard.json')).mode & 0o077, 0);
  const { tunnel } = infoOf(root);
  assert.equal(tunnel.url, 'https://fake-tunnel-123.trycloudflare.com');
  assert.equal(tunnel.cmd, 'node');
  assert.ok(alive(tunnel.pid));
  assert.equal(run('status', root, fakeEnv).out.public_url, out.public_url);
  assert.equal(run('url', root, fakeEnv).out.public_url, out.public_url);
  assert.equal(run('start', root, fakeEnv).out.public_url, out.public_url);
});

test('stop kills the tunnel process', async () => {
  const root = freshRoot();
  run('start', root, fakeEnv, '--public');
  const { tunnel, pid } = infoOf(root);
  assert.ok(alive(tunnel.pid));
  assert.deepEqual(run('stop', root, fakeEnv).out, { stopped: true });
  for (let i = 0; i < 50 && (alive(tunnel.pid) || alive(pid)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(tunnel.pid), false);
  assert.equal(alive(pid), false);
});

test('no tunnel tool prints hint and keeps local server', () => {
  const root = freshRoot();
  const env = { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-emptypath-')) };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const { code, out, stderr } = run('start', root, env, '--public');
  assert.equal(code, 0);
  assert.equal(out.public_url, null);
  assert.match(stderr, /No tunnel tool found\. Install cloudflared:/);
  assert.match(stderr, /winget install --id Cloudflare\.cloudflared/);
  assert.match(stderr, /ngrok config add-authtoken <your token>/);
  assert.ok(alive(out.pid));
  assert.equal(infoOf(root).tunnel, null);
});

test('stop does not kill a process whose name does not match the recorded cmd', () => {
  const root = freshRoot();
  run('start', root, fakeEnv, '--public');
  const info = infoOf(root);
  const infoPath = path.join(root, '.taskify', 'dashboard.json');
  fs.writeFileSync(infoPath, JSON.stringify({ ...info, tunnel: { ...info.tunnel, cmd: 'cloudflared' } }));
  run('stop', root, fakeEnv);
  try { assert.ok(alive(info.tunnel.pid)); } finally { try { process.kill(info.tunnel.pid); } catch { /* gone */ } }
});

test('ngrok JSON log line gives the public url', () => {
  const root = freshRoot();
  const { out, stderr } = run('start', root, { ...fakeEnv, FAKE_TUNNEL_MODE: 'ngrok' }, '--public');
  assert.match(out.public_url, /^https:\/\/x\.ngrok-free\.app\/\?t=/);
  assert.ok(!stderr.includes('A new cloudflared link can take about a minute'), stderr);
  assert.equal(infoOf(root).tunnel.url, 'https://x.ngrok-free.app');
});

test('tool that prints the cloudflared API url and exits is a failure', () => {
  const root = freshRoot();
  const { code, out, stderr } = run('start', root, { ...fakeEnv, FAKE_TUNNEL_MODE: 'error' }, '--public');
  assert.equal(code, 0);
  assert.equal(out.public_url, null);
  assert.doesNotMatch(stderr, /WARNING/);
  assert.match(stderr, /tunnel\.log/);
  assert.equal(infoOf(root).tunnel, null);
});

test('idle exit kills the recorded tunnel', async () => {
  const root = freshRoot();
  const s = await startServer(root, { idleMinutes: 0.03 });
  const tunnel = spawn(process.execPath, [fake], { stdio: 'ignore', windowsHide: true });
  try {
    const infoPath = path.join(root, '.taskify', 'dashboard.json');
    fs.writeFileSync(infoPath, JSON.stringify({ ...infoOf(root), tunnel: { pid: tunnel.pid, cmd: 'node', url: null } }));
    assert.ok(alive(tunnel.pid));
    await Promise.race([s.exited, new Promise((r) => setTimeout(r, 10000))]);
    for (let i = 0; i < 50 && alive(tunnel.pid); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(tunnel.pid), false);
    assert.equal(fs.existsSync(infoPath), false);
  } finally {
    try { process.kill(tunnel.pid); } catch { /* already gone */ }
    await s.stop();
  }
});

test('ngrok is spawned with its request inspector off', () => {
  const src = fs.readFileSync(cli, 'utf8');
  assert.match(src, /provider: 'ngrok'.*'--inspect=false'/);
});
