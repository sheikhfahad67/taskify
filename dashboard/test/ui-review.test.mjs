import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { copyFixture, startServer, post } from './helpers.mjs';
import { findBrowser, launch } from './browser.mjs';

const skip = findBrowser() ? false : 'no browser found (set TASKIFY_BROWSER)';
const PLAN_ID = 'docs/plan-basic';
let browser;

before(async () => {
  if (!skip) browser = await launch();
});
after(async () => {
  if (browser) await browser.close();
});

// Fresh fixture copy and server per test; the cookie step-in runs first, then the review route opens.
async function fresh(run) {
  const root = copyFixture('plan-basic');
  const server = await startServer(root);
  try {
    const page = await browser.page(`${server.url}/?t=${server.token}`);
    await page.waitFor('.plans a.plan-link');
    await page.evaluate(`location.hash = '#/plan/${encodeURIComponent(PLAN_ID)}/review'`);
    await page.waitFor('#doc h2');
    const reviewFile = path.join(root, PLAN_ID, '.taskify', 'review.json');
    await run({ page, server, readReview: () => JSON.parse(fs.readFileSync(reviewFile, 'utf8')) });
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);

// ---- Node-only ----
globalThis.marked = createRequire(import.meta.url)('../public/vendor/marked.umd.js');
const { renderMarkdown } = await import('../public/review.js');

test('renderMarkdown escapes raw html', () => {
  const html = renderMarkdown('hi <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))');
  assert.equal(/<script/i.test(html), false);
  assert.equal(/<img/i.test(html), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(/href="javascript:/i.test(html), false);
});

test('renderMarkdown adds heading ids and comment buttons', () => {
  const html = renderMarkdown('# Top Title\n\n## AC2 — Token & more\n\n#### Deep');
  assert.match(html, /<h1 id="top-title">/);
  assert.match(html, /<h2 id="ac2-token-more">/);
  assert.match(html, /<button type="button" class="comment-btn" data-anchor="AC2 — Token &amp; more">Comment<\/button>/);
  assert.match(html, /<h4>Deep<\/h4>/);
});

// ---- Browser ----
test('review view renders the overview and its open comment', { skip }, async () => {
  await fresh(async ({ page }) => {
    await page.waitFor('.comments .comment');
    assert.match(await text(page, '#doc h1'), /Fixture Plan/);
    assert.match(await text(page, '.comments .comment'), /Goal should name the invariant\./);
    assert.equal(await text(page, '.doc-btn[data-path="00-overview.md"] .badge'), '1');
    const order = await page.evaluate("[...document.querySelectorAll('.doc-btn')].map((b) => b.dataset.path)");
    assert.equal(order[0], '00-overview.md');
    assert.equal(order.at(-1), 'specs/tasks/PROGRESS.md');
    await new Promise((r) => setTimeout(r, 1000)); // let any late network error arrive
    assert.deepEqual(page.errors(), []);
  });
});

test('raw script in a doc is shown as text and does not run', { skip }, async () => {
  await fresh(async ({ page }) => {
    assert.equal(await page.evaluate('window.__xss === undefined'), true);
    assert.equal(await page.evaluate("document.getElementById('doc').textContent.includes('<script>window.__xss = 1</script>')"), true);
    assert.equal(await page.evaluate("document.querySelectorAll('#doc script').length"), 0);
  });
});

test('comment button anchors the form and posting adds the comment', { skip }, async () => {
  await fresh(async ({ page, readReview }) => {
    await page.click('#doc .comment-btn[data-anchor="Goal"]');
    assert.match(await text(page, '.anchor-label'), /Goal/);
    await page.type('#comment-text', 'Please add a metric.');
    await page.click('#comment-submit');
    await page.waitFor('.comments li:nth-child(2)');
    assert.match(await text(page, '.comments li:nth-child(2)'), /Please add a metric\./);
    const { comments } = readReview();
    assert.equal(comments.length, 3);
    assert.equal(comments.at(-1).anchor, 'Goal');
    assert.equal(comments.at(-1).text, 'Please add a metric.');
  });
});

test('approve button records approval and shows it', { skip }, async () => {
  await fresh(async ({ page, readReview }) => {
    assert.equal(await text(page, '.approval-text'), 'Not approved yet');
    await page.type('#author', 'tester');
    await page.click('#approve-btn');
    await page.evaluate(`new Promise((resolve) => { const t = setInterval(() => {
      if (document.querySelector('.approval-text').textContent.startsWith('Approved by')) { clearInterval(t); resolve(); } }, 50); })`);
    assert.match(await text(page, '.approval-text'), /^Approved by tester at /);
    const { approvals } = readReview();
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].by, 'tester');
    assert.equal(await page.evaluate("localStorage.getItem('taskify.author')"), 'tester');
  });
});

test('resolved comments are hidden until toggled', { skip }, async () => {
  await fresh(async ({ page }) => {
    await page.click('.doc-btn[data-path="04-execution-phases.md"]');
    await page.waitFor('.comments .empty');
    assert.equal(await page.evaluate("document.querySelectorAll('.comment.resolved').length"), 0);
    await page.click('#show-resolved');
    await page.waitFor('.comment.resolved');
    const shown = await text(page, '.comment.resolved');
    assert.match(shown, /Rename Phase 2\./);
    assert.match(shown, /Resolved by taskify-implementer: Renamed\./);
  });
});

test('polling keeps a half-typed comment', { skip }, async () => {
  await fresh(async ({ page, server }) => {
    await page.type('#comment-text', 'half typed');
    const res = await post(`${server.url}/api/comments`, {
      token: server.token,
      body: { plan: PLAN_ID, file: '00-overview.md', anchor: null, text: 'Added elsewhere.', author: 'other' },
    });
    assert.equal(res.status, 201);
    await page.waitFor('.comments li:nth-child(2)', 20000);
    assert.equal(await page.evaluate("document.getElementById('comment-text').value"), 'half typed');
  });
});
