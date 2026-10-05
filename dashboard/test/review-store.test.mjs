import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as store from '../lib/review-store.mjs';
import { copyFixture } from './helpers.mjs';

const storeUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/review-store.mjs')).href;
const roots = [];
function freshPlan() {
  const root = copyFixture('plan-basic');
  roots.push(root);
  return path.join(root, 'docs', 'plan-basic');
}
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
const reviewFile = (plan) => path.join(plan, '.taskify', 'review.json');

test('readReview returns empty shape for missing or broken file', () => {
  const empty = { version: 1, comments: [], approvals: [] };
  const plan = freshPlan();
  fs.rmSync(path.join(plan, '.taskify'), { recursive: true });
  assert.deepEqual(store.readReview(plan), empty);
  fs.mkdirSync(path.join(plan, '.taskify'));
  fs.writeFileSync(reviewFile(plan), '');
  assert.deepEqual(store.readReview(plan), empty);
  fs.writeFileSync(reviewFile(plan), '{not json');
  assert.deepEqual(store.readReview(plan), empty);
  fs.writeFileSync(reviewFile(plan), '{"comments":5}');
  assert.deepEqual(store.readReview(plan), empty);
});

test('addComment validates and appends', () => {
  const plan = freshPlan();
  const c = store.addComment(plan, { file: 'specs/tasks/T1.01-alpha.md', anchor: null, text: 'hi', author: 'me' });
  assert.match(c.id, /^c_[0-9a-f]{8}$/);
  assert.equal(c.resolved, false);
  assert.equal(c.anchor, null);
  const review = store.readReview(plan);
  assert.equal(review.comments.length, 3);
  assert.deepEqual(review.comments[2], c);
  for (const bad of [{ text: '' }, { text: 'x'.repeat(4001) }, { author: 'a'.repeat(61) }]) {
    assert.throws(() => store.addComment(plan, { file: '00-overview.md', text: 'ok', author: '', ...bad }), { code: 'EINVAL' });
  }
  assert.equal(store.readReview(plan).comments.length, 3);
});

test('addComment rejects path escape and non-md', () => {
  const plan = freshPlan();
  for (const file of ['../x.md', 'specs/../../x.md', '/etc/passwd.md', 'C:/x.md', 'specs\\tasks\\T1.01-alpha.md',
    '00-overview.txt', 'missing.md', 'specs', '', undefined]) {
    assert.throws(() => store.addComment(plan, { file, text: 'x', author: '' }), { code: 'EINVAL' }, String(file));
  }
});

test('resolveComment sets resolved fields', () => {
  const plan = freshPlan();
  const c = store.resolveComment(plan, 'c_00000001', { note: 'done', by: 'browser' });
  assert.equal(c.resolved, true);
  assert.equal(c.resolved_by, 'browser');
  assert.equal(c.resolution_note, 'done');
  assert.ok(!Number.isNaN(Date.parse(c.resolved_at)));
  assert.deepEqual(store.readReview(plan).comments[0], c);
});

test('resolveComment unknown id throws ENOENT', () => {
  const plan = freshPlan();
  assert.throws(() => store.resolveComment(plan, 'c_ffffffff', { note: '', by: '' }), { code: 'ENOENT' });
});

test('addApproval and reviewSummary', () => {
  const plan = freshPlan();
  let s = store.reviewSummary(plan);
  assert.deepEqual(s, { approved: false, approved_at: null, docs_changed_since_approval: [], open_comments: 1, resolved_count: 1 });
  const a = store.addApproval(plan, { note: 'ok', by: 'me' });
  assert.equal(a.by, 'me');
  const past = new Date(Date.now() - 60000);
  for (const f of fs.readdirSync(plan).filter((n) => n.endsWith('.md'))) fs.utimesSync(path.join(plan, f), past, past);
  s = store.reviewSummary(plan);
  assert.equal(s.approved, true);
  assert.equal(s.approved_at, a.at);
  assert.deepEqual(s.docs_changed_since_approval, []);
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(plan, '00-overview.md'), future, future);
  assert.deepEqual(store.reviewSummary(plan).docs_changed_since_approval, ['00-overview.md']);
});

test('stale lock is removed', () => {
  const plan = freshPlan();
  const lock = path.join(plan, '.taskify', 'review.json.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 10000);
  fs.utimesSync(lock, old, old);
  store.addComment(plan, { file: '00-overview.md', text: 'x', author: '' });
  assert.equal(fs.existsSync(lock), false);
  assert.equal(store.readReview(plan).comments.length, 3);
});

test('write over corrupt review.json throws ECORRUPT and leaves it untouched', () => {
  const plan = freshPlan();
  fs.writeFileSync(reviewFile(plan), '{not json');
  assert.throws(() => store.addComment(plan, { file: '00-overview.md', text: 'x', author: '' }), { code: 'ECORRUPT' });
  assert.equal(fs.readFileSync(reviewFile(plan), 'utf8'), '{not json');
  assert.equal(fs.existsSync(path.join(plan, '.taskify', 'review.json.lock')), false);
});

test('two processes writing at once lose nothing', async () => {
  const plan = freshPlan();
  fs.rmSync(reviewFile(plan));
  const N = 20;
  const code = `import(${JSON.stringify(storeUrl)}).then((s) => { for (let i = 0; i < ${N}; i++) s.addComment(${JSON.stringify(plan)}, { file: '00-overview.md', text: 'n' + i, author: 'p' + process.pid }); });`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`child exited ${c}`))));
  });
  await Promise.all([run(), run()]);
  const review = JSON.parse(fs.readFileSync(reviewFile(plan), 'utf8'));
  assert.equal(review.comments.length, 2 * N);
  assert.equal(new Set(review.comments.map((c) => c.id)).size, 2 * N);
});
