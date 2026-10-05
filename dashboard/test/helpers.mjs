import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Copies fixtures/<name> to <tmp>/docs/<name>/ and returns the temp root.
export function copyFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-'));
  fs.cpSync(path.join(here, 'fixtures', name), path.join(root, 'docs', name), { recursive: true });
  return root;
}

// Starts dashboard/server.mjs on a free port with a fresh token; resolves once dashboard.json exists.
export async function startServer(root, { idleMinutes, portStart } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const argv = [path.join(here, '..', 'server.mjs'), '--root', root];
  argv.push(...(portStart ? ['--port-start', String(portStart)] : ['--port', '0']));
  if (idleMinutes !== undefined) argv.push('--idle-minutes', String(idleMinutes));
  const child = spawn(process.execPath, argv, {
    env: { ...process.env, TASKIFY_DASHBOARD_TOKEN: token }, stdio: 'ignore', windowsHide: true,
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const infoPath = path.join(root, '.taskify', 'dashboard.json');
  for (let i = 0; i < 100; i++) {
    try {
      const { port } = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      return {
        port, token, url: `http://127.0.0.1:${port}`, child, exited,
        stop: async () => { child.kill(); await exited; },
      };
    } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  child.kill();
  throw new Error('server did not write dashboard.json');
}

const request = (method) => (url, { token, cookie, headers = {}, body } = {}) => fetch(url, {
  method,
  redirect: 'manual',
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const get = request('GET');
export const post = request('POST');
