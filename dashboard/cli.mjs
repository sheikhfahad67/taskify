#!/usr/bin/env node
// CLI: start | stop | status | url | review | resolve | run-start | run-end. Prints one JSON object per command.
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReview, resolveComment, reviewSummary } from './lib/review-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);

function usage(msg) {
  console.error(`${msg}\nusage: cli.mjs start [--root <dir>] [--port <n>] [--public] | stop|status|url [--root <dir>]`
    + ' | review --plan <dir> | resolve --plan <dir> --id <cid> [--note <text>] [--by <name>]'
    + ' | run-start --plan <dir> [--root <dir>] [--session <id>] | run-end [--root <dir>]');
  process.exit(2);
}

const valueOptions = ['root', 'port', 'plan', 'id', 'note', 'by', 'session'];
const opts = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) usage(`unexpected argument: ${rest[i]}`);
  const name = rest[i].slice(2);
  if (name === 'public') opts.public = true;
  else if (valueOptions.includes(name)) {
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) usage(`--${name} needs a value`);
    opts[name] = rest[++i];
  } else usage(`unknown option: --${name}`);
}
if (command !== 'start' && (opts.port !== undefined || opts.public)) usage('--port and --public apply only to start');
if (opts.port !== undefined) {
  const p = Number(opts.port);
  // The server tries 10 ports from the start port, so the last start port is 65526.
  if (!Number.isInteger(p) || p < 1 || p > 65526) usage('--port must be an integer 1-65526');
}

const root = path.resolve(opts.root ?? process.cwd());
const infoPath = path.join(root, '.taskify', 'dashboard.json');
const print = (obj) => console.log(JSON.stringify(obj));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readInfo() {
  try { return JSON.parse(fs.readFileSync(infoPath, 'utf8')); } catch { return null; }
}

// Proof that the recorded server is alive: /api/health answers with the recorded pid.
async function healthy(info) {
  if (!info || !info.port || !info.token) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
      headers: { Authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    return (await res.json()).pid === info.pid;
  } catch { return false; }
}

const urlOf = (info) => `http://127.0.0.1:${info.port}/?t=${info.token}`;
const removeInfo = () => fs.rmSync(infoPath, { force: true });

// ---- public tunnel: cloudflared, then ngrok; TASKIFY_TUNNEL_CMD (JSON array) replaces detection in tests ----
const NO_TOOL_HINT = [
  'No tunnel tool found. Install cloudflared:',
  '  Windows: winget install --id Cloudflare.cloudflared',
  '  macOS:   brew install cloudflared',
  '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  'Or install ngrok and run: ngrok config add-authtoken <your token>',
];
const WAIT_NOTE = 'A new cloudflared link can take about a minute to start working. If it does not load yet, wait a minute and reload.';
const PUBLIC_WARNING = 'WARNING: Anyone with this link can read these plan docs and the live activity log (including the start of each command), and can add comments or approve the plan.';

function detectTunnel(port) {
  const target = `http://127.0.0.1:${port}`;
  if (process.env.TASKIFY_TUNNEL_CMD) {
    const cmd = JSON.parse(process.env.TASKIFY_TUNNEL_CMD);
    return { provider: 'custom', exe: cmd[0], args: cmd.slice(1) };
  }
  const tools = [
    { provider: 'cloudflared', version: ['--version'], args: ['tunnel', '--url', target] },
    { provider: 'ngrok', version: ['version'], args: ['http', `127.0.0.1:${port}`, '--log', 'stdout', '--log-format', 'json', '--inspect=false'] },
  ];
  for (const t of tools) {
    try {
      execFileSync(t.provider, t.version, { stdio: 'ignore', windowsHide: true });
      return { provider: t.provider, exe: t.provider, args: t.args };
    } catch { /* not installed */ }
  }
  return null;
}

// First public URL in the tunnel log: a trycloudflare.com address, or the "url" of an ngrok JSON line.
function tunnelUrlIn(text) {
  const cf = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(text);
  if (cf) return cf[0];
  for (const line of text.split('\n')) {
    try {
      const u = JSON.parse(line).url;
      if (typeof u === 'string' && u.startsWith('https://')) return u;
    } catch { /* not a JSON line */ }
  }
  return null;
}

// True only if the pid is alive and its process name contains the recorded tool name.
function isTunnelProcess(tunnel) {
  if (!tunnel || !tunnel.pid || !tunnel.cmd) return false;
  try {
    const out = process.platform === 'win32'
      ? execFileSync('tasklist', ['/FI', `PID eq ${tunnel.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      : execFileSync('ps', ['-p', String(tunnel.pid), '-o', 'comm='], { encoding: 'utf8' });
    return out.toLowerCase().includes(tunnel.cmd.toLowerCase());
  } catch { return false; }
}

function killTunnel(tunnel) {
  if (isTunnelProcess(tunnel)) {
    try { process.kill(tunnel.pid); } catch { /* already gone */ }
  }
}

function recordTunnel(tunnel) {
  const tmp = `${infoPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...readInfo(), tunnel }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, infoPath);
}

// Public link of the recorded tunnel (with the token) when its process is alive and has a url; else null.
const publicUrlOf = (info) => (info.tunnel?.url && isTunnelProcess(info.tunnel) ? `${info.tunnel.url}/?t=${info.token}` : null);

// Returns the tunnel's public URL (without the token), or null when there is none.
async function ensureTunnel(info) {
  if (info.tunnel?.url && isTunnelProcess(info.tunnel)) return info.tunnel.url;
  killTunnel(info.tunnel); // a live tunnel that never got a url is a leftover
  let tool;
  try { tool = detectTunnel(info.port); } catch (err) {
    console.error(`TASKIFY_TUNNEL_CMD is not a JSON array: ${err.message}`);
    return null;
  }
  if (!tool) {
    console.error(NO_TOOL_HINT.join('\n'));
    return null;
  }
  const logPath = path.join(root, '.taskify', 'tunnel.log');
  const fd = fs.openSync(logPath, 'w');
  let failed = null;
  const child = spawn(tool.exe, tool.args, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.once('error', (err) => { failed = err.message; });
  child.once('exit', (code) => { failed = `${tool.provider} exited early (code ${code})`; });
  child.unref();
  fs.closeSync(fd);
  // Record at once so a CLI killed mid-poll still leaves a tunnel that `stop` can find.
  const tunnel = { provider: tool.provider, pid: child.pid, url: null, cmd: path.basename(tool.exe, '.exe') };
  if (child.pid) recordTunnel(tunnel);

  let found = null;
  for (let i = 0; i < 100 && !found && !failed; i++) {
    await sleep(200);
    try { found = tunnelUrlIn(fs.readFileSync(logPath, 'utf8')); } catch { /* log not readable yet */ }
  }
  if (found && !failed) await sleep(500); // grace: a tool that prints a URL-like error and exits is a failure
  if (!found || failed) {
    if (!failed) try { process.kill(child.pid); } catch { /* already gone */ }
    recordTunnel(null);
    console.error(`Tunnel gave no public URL (${failed ?? 'timed out after 20 s'}); see ${logPath}`);
    return null;
  }
  recordTunnel({ ...tunnel, url: found });
  return found;
}

async function ready(info, reused) {
  const out = { url: urlOf(info), public_url: publicUrlOf(info), pid: info.pid, port: info.port, reused };
  if (opts.public) {
    const tunnelUrl = await ensureTunnel(info);
    out.public_url = tunnelUrl ? `${tunnelUrl}/?t=${info.token}` : null;
    if (tunnelUrl) {
      console.error(PUBLIC_WARNING);
      if (/^https:\/\/[^/?#]+\.trycloudflare\.com(?:[/?#]|$)/.test(tunnelUrl)) console.error(WAIT_NOTE);
    }
  }
  print(out);
}

async function start() {
  const existing = readInfo();
  if (await healthy(existing)) return ready(existing, true);
  removeInfo(); // stale or unreadable record

  const portStart = opts.port !== undefined ? Number(opts.port) : 4317;
  const token = crypto.randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [path.join(here, 'server.mjs'), '--root', root, '--port-start', String(portStart)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, TASKIFY_DASHBOARD_TOKEN: token },
  });
  child.unref();
  let early = null;
  child.once('exit', (code) => { early = `server exited early (code ${code}); ports ${portStart}-${portStart + 9} may all be busy`; });
  child.once('error', (err) => { early = `server failed to start: ${err.message}`; });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const info = readInfo();
    if (info && info.pid === child.pid && await healthy(info)) {
      return ready(info, false);
    }
    if (early) {
      console.error(early);
      process.exit(1);
    }
    await sleep(100);
  }
  try { process.kill(child.pid); } catch { /* already gone */ }
  console.error('server did not become ready within 5 s');
  process.exit(1);
}

async function stop() {
  const info = readInfo();
  let stopped = false;
  if (info) killTunnel(info.tunnel);
  if (await healthy(info)) {
    try { process.kill(info.pid); } catch { /* already gone */ }
    for (let i = 0; i < 50 && await healthy(info); i++) await sleep(100);
    stopped = true;
  }
  removeInfo();
  print({ stopped });
}

async function status() {
  const info = readInfo();
  if (!(await healthy(info))) return print({ running: false, url: null, public_url: null, pid: null, port: null });
  print({ running: true, url: urlOf(info), public_url: publicUrlOf(info), pid: info.pid, port: info.port });
}

async function url() {
  const info = readInfo();
  if (!(await healthy(info))) return print({ running: false, url: null, public_url: null });
  print({ url: urlOf(info), public_url: publicUrlOf(info) });
}

function needPlan() {
  if (opts.plan === undefined) usage(`${command} needs --plan <dir>`);
  return path.resolve(opts.plan);
}

// Store errors (ECORRUPT, ELOCKED, EINVAL, unknown id) are reported on stderr with exit 1.
function storeCall(fn) {
  try { return fn(); } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function review() {
  const planDir = needPlan();
  // The summary carries a count; skills need the open comments themselves.
  const summary = storeCall(() => ({ ...reviewSummary(planDir), open_comments: readReview(planDir).comments.filter((c) => !c.resolved) }));
  print(summary);
}

function resolve() {
  const planDir = needPlan();
  if (opts.id === undefined) usage('resolve needs --id <cid>');
  print(storeCall(() => resolveComment(planDir, opts.id, { note: opts.note, by: opts.by ?? 'claude' })));
}

function runStart() {
  const planDir = needPlan();
  if (!fs.existsSync(path.join(planDir, 'specs', 'tasks', 'README.md'))) usage(`not a taskify plan folder: ${planDir}`);
  const marker = { plan: planDir, session_id: opts.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? null, started_at: new Date().toISOString() };
  const markerPath = path.join(root, '.taskify', 'active-run.json');
  const tmp = `${markerPath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.mkdirSync(path.join(planDir, '.taskify'), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2));
  fs.renameSync(tmp, markerPath);
  fs.writeFileSync(path.join(planDir, '.taskify', 'events.jsonl'), '');
  print(marker);
}

function runEnd() {
  fs.rmSync(path.join(root, '.taskify', 'active-run.json'), { force: true });
  print({ ended: true });
}

const commands = {
  start, stop, status, url,
  'review': review,
  'resolve': resolve,
  'run-start': runStart,
  'run-end': runEnd,
};
if (!commands[command]) usage(command ? `unknown command: ${command}` : 'missing command');
await commands[command]();
