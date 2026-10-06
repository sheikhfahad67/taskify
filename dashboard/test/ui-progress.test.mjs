import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyFixture, startServer } from './helpers.mjs';
import { findBrowser, launch } from './browser.mjs';
import { groupByStatus } from '../public/progress.js';

const skip = findBrowser() ? false : 'no browser found (set TASKIFY_BROWSER)';
const PLAN_ID = 'docs/plan-basic';
let browser;

before(async () => {
  if (!skip) browser = await launch();
});
after(async () => {
  if (browser) await browser.close();
});

// Fresh fixture copy and server per test; the cookie step-in runs first, then the progress route opens.
async function fresh(run) {
  const root = copyFixture('plan-basic');
  const server = await startServer(root);
  try {
    const page = await browser.page(`${server.url}/?t=${server.token}`);
    await page.waitFor('.plans a.plan-link');
    await page.evaluate(`location.hash = '#/plan/${encodeURIComponent(PLAN_ID)}/progress'`);
    await page.waitFor('.card');
    await run({ page, root });
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const textOf = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
const idsIn = (page, status) => page.evaluate(
  `[...document.querySelectorAll('.column[data-status="${status}"] .card')].map((c) => c.dataset.id)`);

// ---- Node-only ----
test('groupByStatus puts unknown statuses in other', () => {
  const g = groupByStatus([
    { id: 'a', status: 'done' }, { id: 'b', status: 'weird' }, { id: 'c', status: [] }, { id: 'd' },
  ]);
  assert.deepEqual(g.done.map((t) => t.id), ['a']);
  assert.deepEqual(g.other.map((t) => t.id), ['b', 'c', 'd']);
  assert.deepEqual(Object.keys(g), ['pending', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'done', 'skipped', 'other']);
});

// ---- Browser ----
test('board shows each fixture task in its status column', { skip }, async () => {
  await fresh(async ({ page }) => {
    assert.deepEqual(await idsIn(page, 'done'), ['T1.01']);
    assert.deepEqual(await idsIn(page, 'in_review'), ['T1.02']);
    assert.deepEqual(await idsIn(page, 'changes_requested'), ['T2.01']);
    assert.deepEqual(await idsIn(page, 'pending'), ['T2.02']);
    assert.equal(await page.evaluate("document.querySelectorAll('.column').length"), 8);
    assert.equal(await page.evaluate("document.querySelectorAll('.wave .chip').length"), 4);
  });
});

test('card shows AC count verdict and fix rounds', { skip }, async () => {
  await fresh(async ({ page }) => {
    const card = await textOf(page, '.card[data-id="T2.01"]');
    assert.match(card, /AC 0\/2/);
    assert.match(card, /changes_requested/);
    assert.match(card, /fix 2/);
    assert.doesNotMatch(await textOf(page, '.card[data-id="T1.01"]'), /fix/);
  });
});

test('run header shows state task and step', { skip }, async () => {
  await fresh(async ({ page }) => {
    const header = await textOf(page, '#run-header');
    assert.match(header, /running/);
    assert.match(header, /T1\.02/);
    assert.match(header, /review/);
  });
});

test('activity shows one open subagent', { skip }, async () => {
  await fresh(async ({ page }) => {
    const open = await page.evaluate("[...document.querySelectorAll('.open-subagent')].map((e) => e.textContent)");
    assert.equal(open.length, 1);
    assert.match(open[0], /general-purpose/);
    assert.match(open[0], /node --test/);
    assert.doesNotMatch(open.join('\n'), /feature-dev:code-reviewer/);
    // recent events are listed newest first (the half-written last line is dropped by the server)
    const recent = await page.evaluate("[...document.querySelectorAll('.event')].map((e) => e.textContent)");
    assert.equal(recent.length, 5);
    assert.match(recent[0], /SubagentStop/);
  });
});

test('log lists progress rows newest first', { skip }, async () => {
  await fresh(async ({ page }) => {
    const rows = await page.evaluate("[...document.querySelectorAll('.log-row')].map((e) => e.textContent)");
    assert.equal(rows.length, 6);
    assert.match(rows[0], /10:32.*T1\.02.*review started/);
    assert.match(rows[5], /10:00.*T1\.01.*implement started/);
  });
});

test('live poll moves a card when its status changes on disk', { skip }, async () => {
  await fresh(async ({ page, root }) => {
    assert.deepEqual(await idsIn(page, 'pending'), ['T2.02']);
    const spec = path.join(root, PLAN_ID, 'specs', 'tasks', 'T2.02-delta.md');
    const original = fs.readFileSync(spec, 'utf8');
    const changed = original.replace(/^status: pending/m, 'status: done');
    assert.notEqual(changed, original);
    fs.writeFileSync(spec, changed);
    const end = Date.now() + 5000;
    let moved = false;
    while (Date.now() < end && !moved) {
      moved = (await idsIn(page, 'done')).includes('T2.02');
      if (!moved) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(moved, true, 'T2.02 should appear in done within 5 s');
    assert.deepEqual(await idsIn(page, 'pending'), []);
  });
});

test('every task in a parallel batch is marked current on the wave track', { skip }, async () => {
  await fresh(async ({ page, root }) => {
    const current = () => page.evaluate("[...document.querySelectorAll('.wave .chip.current')].map((c) => c.textContent)");
    assert.deepEqual(await current(), ['T1.02']);
    const file = path.join(root, PLAN_ID, 'specs', 'tasks', 'PROGRESS.md');
    const original = fs.readFileSync(file, 'utf8');
    const changed = original.replace(/^- \*\*Current task:\*\*.*$/m, '- **Current task:** T1.02, T2.01');
    assert.notEqual(changed, original);
    fs.writeFileSync(file, changed);
    const end = Date.now() + 5000;
    let ids = [];
    while (Date.now() < end && ids.length < 2) {
      ids = await current();
      if (ids.length < 2) await new Promise((r) => setTimeout(r, 200));
    }
    assert.deepEqual(ids, ['T1.02', 'T2.01']);
  });
});

test('clicking a card opens its details dialog; full screen on a phone', { skip }, async () => {
  await fresh(async ({ page }) => {
    const isOpen = () => page.evaluate("!!document.querySelector('dialog.task-dialog')?.open");
    await page.viewport(1280, 800);
    await page.click('.card[data-id="T2.01"]');
    assert.equal(await isOpen(), true);
    const body = await textOf(page, 'dialog.task-dialog');
    assert.match(body, /Gamma does the third thing/);
    assert.match(body, /changes requested/);
    assert.match(body, /T1\.02/); // depends on
    assert.match(body, /src\/gamma\.js/); // touches
    assert.equal(await page.evaluate("document.querySelectorAll('.task-dialog .ac').length"), 2);
    assert.equal(await page.evaluate("document.querySelectorAll('.task-dialog .log-row').length"), 3);
    // the full spec loads when expanded
    await page.click('.task-dialog .spec summary');
    await page.waitFor('.task-dialog .spec .doc h1');
    assert.match(await textOf(page, '.task-dialog .spec .doc h1'), /T2\.01/);
    const wide = await page.evaluate("document.querySelector('dialog.task-dialog').getBoundingClientRect().width");
    assert.ok(wide < 1280, 'centred dialog on desktop');
    await page.click('.task-dialog .dialog-close');
    assert.equal(await isOpen(), false);

    // keyboard: Enter on a focused card opens it
    await page.evaluate(`(() => { const c = document.querySelector('.card[data-id="T1.01"]'); c.focus();
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    assert.equal(await isOpen(), true);
    assert.match(await textOf(page, 'dialog.task-dialog'), /Alpha does the first thing/);
    await page.click('.task-dialog .dialog-close');

    await page.viewport(375, 700);
    await page.click('.card[data-id="T2.02"]');
    const box = await page.evaluate("(() => { const r = document.querySelector('dialog.task-dialog').getBoundingClientRect(); return [r.width, r.height]; })()");
    assert.deepEqual(box, [375, 700]);
    assert.deepEqual(page.errors(), []);
  });
});

test('no console or CSP errors on progress', { skip }, async () => {
  await fresh(async ({ page }) => {
    await new Promise((r) => setTimeout(r, 3500)); // let one poll run
    assert.deepEqual(page.errors(), []);
  });
});
