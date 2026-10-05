import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { copyFixture, startServer, get, post } from './helpers.mjs';

const stoppers = [];
after(async () => { for (const stop of stoppers) await stop(); });

async function setup() {
  const root = copyFixture('plan-basic');
  const s = await startServer(root);
  stoppers.push(s.stop);
  return { root, ...s };
}
const PLAN = 'docs/plan-basic';
const reviewFile = (root) => path.join(root, PLAN, '.taskify', 'review.json');
const readReviewFile = (root) => JSON.parse(fs.readFileSync(reviewFile(root), 'utf8'));
const comment = { plan: PLAN, file: '00-overview.md', anchor: 'Goal', text: 'hello', author: 'tester' };

test('post comment returns 201 and persists', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/comments`, { token: s.token, body: comment });
  assert.equal(res.status, 201);
  const made = await res.json();
  assert.match(made.id, /^c_[0-9a-f]{8}$/);
  assert.equal(made.text, 'hello');
  assert.equal(made.author, 'tester');
  assert.ok(readReviewFile(s.root).comments.some((c) => c.id === made.id));
  const plan = await (await get(`${s.url}/api/plan?plan=${PLAN}`, { token: s.token })).json();
  assert.ok(plan.review.comments.some((c) => c.id === made.id));
  const blank = await post(`${s.url}/api/comments`, { token: s.token, body: { ...comment, author: '' } });
  assert.equal((await blank.json()).author, 'browser');
});

test('resolve marks comment resolved', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/comments/c_00000001/resolve`, { token: s.token, body: { plan: PLAN, note: 'done' } });
  assert.equal(res.status, 200);
  const c = await res.json();
  assert.equal(c.resolved, true);
  assert.equal(c.resolution_note, 'done');
  assert.equal(c.resolved_by, 'browser');
  assert.equal(readReviewFile(s.root).comments.find((x) => x.id === 'c_00000001').resolved, true);
});

test('resolve unknown id is 404', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/comments/c_ffffffff/resolve`, { token: s.token, body: { plan: PLAN } });
  assert.equal(res.status, 404);
});

test('approve returns 201 and plan reads approved', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/approve`, { token: s.token, body: { plan: PLAN, note: 'ship it', author: 'lead' } });
  assert.equal(res.status, 201);
  const a = await res.json();
  assert.equal(a.by, 'lead');
  assert.equal(a.note, 'ship it');
  const plan = await (await get(`${s.url}/api/plan?plan=${PLAN}`, { token: s.token })).json();
  assert.equal(plan.review.summary.approved, true);
});

test('post without token is 401', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/comments`, { body: comment });
  assert.equal(res.status, 401);
  assert.equal(readReviewFile(s.root).comments.length, 2);
});

test('post without json content type is 415', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/approve`, {
    token: s.token, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: { plan: PLAN },
  });
  assert.equal(res.status, 415);
  assert.equal(readReviewFile(s.root).approvals.length, 0);
});

test('post with foreign origin is 403', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/approve`, {
    token: s.token, headers: { Origin: 'https://evil.example' }, body: { plan: PLAN },
  });
  assert.equal(res.status, 403);
  assert.equal(readReviewFile(s.root).approvals.length, 0);
  const same = await post(`${s.url}/api/approve`, { token: s.token, headers: { Origin: s.url }, body: { plan: PLAN } });
  assert.equal(same.status, 201);
});

test('post over 64KB is 413', async () => {
  const s = await setup();
  const res = await post(`${s.url}/api/comments`, { token: s.token, body: { ...comment, text: 'x'.repeat(70 * 1024) } });
  assert.equal(res.status, 413);
  assert.equal(readReviewFile(s.root).comments.length, 2);
});

test('invalid fields are 400', async () => {
  const s = await setup();
  const url = `${s.url}/api/comments`;
  const bad = [
    { ...comment, text: '' },
    { ...comment, file: '../escape.md' },
    { ...comment, file: 'missing.md' },
    { ...comment, author: 'a'.repeat(61) },
  ];
  for (const body of bad) assert.equal((await post(url, { token: s.token, body })).status, 400, JSON.stringify(body).slice(0, 80));
  const notJson = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: '{nope',
  });
  assert.equal(notJson.status, 400);
  assert.equal((await post(url, { token: s.token, body: { ...comment, plan: 'docs/other' } })).status, 404);
  assert.equal(readReviewFile(s.root).comments.length, 2);
});

test('writes touch only review.json', async () => {
  const s = await setup();
  const skip = new Set(['.taskify/review.json', '.taskify/review.json.lock', '.taskify/dashboard.json']);
  const hashAll = () => {
    const out = {};
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const key = path.relative(s.root, full).split(path.sep).join('/');
        if (e.isDirectory()) walk(full);
        else if (!skip.has(key.replace(`${PLAN}/`, ''))) out[key] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    };
    walk(s.root);
    return out;
  };
  const before = hashAll();
  const c = await (await post(`${s.url}/api/comments`, { token: s.token, body: comment })).json();
  assert.equal((await post(`${s.url}/api/comments/${c.id}/resolve`, { token: s.token, body: { plan: PLAN } })).status, 200);
  assert.equal((await post(`${s.url}/api/approve`, { token: s.token, body: { plan: PLAN } })).status, 201);
  assert.deepEqual(hashAll(), before);
});

test('500 body has no error detail', async () => {
  const s = await setup();
  fs.rmSync(path.join(s.root, PLAN, '.taskify'), { recursive: true, force: true });
  fs.writeFileSync(path.join(s.root, PLAN, '.taskify'), 'not a directory');
  const res = await post(`${s.url}/api/comments`, { token: s.token, body: comment });
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: 'internal error' });
  assert.doesNotMatch(text, /ENOTDIR|EEXIST|taskify|mkdir/i);
});
