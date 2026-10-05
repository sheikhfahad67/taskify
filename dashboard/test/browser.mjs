// Headless Edge/Chrome driven over the DevTools protocol. Node built-ins and the global WebSocket only.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const COMMAND_TIMEOUT_MS = 30000;
const sleep =(ms) => new Promise((r) => setTimeout(r, ms));

function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
      const full = path.join(dir, name + ext);
      if (dir && fs.existsSync(full)) return full;
    }
  }
  return null;
}

// TASKIFY_BROWSER, else the Edge path, else google-chrome / chromium on PATH; null when none exists.
export function findBrowser() {
  const env = process.env.TASKIFY_BROWSER;
  if (env && fs.existsSync(env)) return env;
  if (fs.existsSync(EDGE)) return EDGE;
  return onPath('google-chrome') ?? onPath('chromium') ?? null;
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('devtools websocket failed')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const failAll = (why) => {
    for (const { reject } of pending.values()) reject(new Error(why));
    pending.clear();
  };
  ws.addEventListener('close', () => failAll('devtools websocket closed'));
  ws.addEventListener('error', () => failAll('devtools websocket error'));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`devtools command timed out: ${method}`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pending.get(id)?.reject(e); pending.delete(id); }
    }),
    on: (fn) => listeners.push(fn),
    close: () => { try { ws.close(); } catch { /* already closed */ } },
  };
}

export async function launch() {
  const exe = findBrowser();
  if (!exe) throw new Error('no browser found');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-browser-'));
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const conns = [];

  const close = async () => {
    conns.forEach((c) => c.close());
    if (child.exitCode === null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else child.kill('SIGKILL');
      } catch { /* already gone */ }
      await Promise.race([exited, sleep(10000)]);
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  };

  try {
    let port = null;
    for (let i = 0; i < 300 && port === null; i++) {
      let n = NaN;
      try { n = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not written yet */ }
      if (Number.isInteger(n) && n > 0) port = n; else await sleep(100);
    }
    if (!port) throw new Error('browser did not start');

    async function page(url) {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      const target = await res.json();
      const cdp = await connect(target.webSocketDebuggerUrl);
      conns.push(cdp);
      const seen = [];
      cdp.on((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          seen.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else if (msg.method === 'Runtime.exceptionThrown') {
          seen.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
          seen.push(`${msg.params.entry.source}: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
        }
      });
      await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Log.enable')]);

      const evaluate = async (expression) => {
        const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
      const p = {
        goto: (to) => cdp.send('Page.navigate', { url: to }),
        evaluate,
        async waitFor(selector, ms = 15000) {
          const end = Date.now() + ms;
          while (Date.now() < end) {
            try { if (await evaluate(`!!${q(selector)}`)) return; } catch { /* page navigating */ }
            await sleep(50);
          }
          throw new Error(`timed out waiting for ${selector}`);
        },
        click: (selector) => evaluate(`(() => { const e = ${q(selector)}; if (!e) throw new Error('no element'); e.click(); return true; })()`),
        type: (selector, text) => evaluate(`(() => {
          const e = ${q(selector)}; if (!e) throw new Error('no element');
          e.focus(); e.value = ${JSON.stringify(text)};
          e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`),
        viewport: (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
        errors: () => [...seen],
      };
      await p.goto(url);
      return p;
    }
    return { page, close };
  } catch (err) {
    await close();
    throw err;
  }
}
