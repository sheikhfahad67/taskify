import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFixture, startServer, get } from './helpers.mjs';
import { findBrowser, launch } from './browser.mjs';

const skip = findBrowser() ? false : 'no browser found (set TASKIFY_BROWSER)';
let server;
let browser;

before(async () => {
  server = await startServer(copyFixture('plan-basic'));
  if (!skip) {
    browser = await launch();
    // First visit with ?t= sets the session cookie for every later test.
    const page = await browser.page(`${server.url}/?t=${server.token}`);
    await page.waitFor('.plans a.plan-link');
  }
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

const PLAN_ID = 'docs/plan-basic';
const open = (p = '/') => browser.page(`${server.url}${p}`);
const withToken = () => browser.page(`${server.url}/?t=${server.token}`);

test('static files have correct types and marked is vendored', async () => {
  const check = async (file, type) => {
    const res = await get(`${server.url}/static/${file}`, { token: server.token });
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), type, file);
    return Buffer.from(await res.arrayBuffer());
  };
  await check('app.js', /^text\/javascript/);
  await check('app.css', /^text\/css/);
  const marked = await check('vendor/marked.umd.js', /^text\/javascript/);
  assert.equal(marked.length, 46891);
});

test('home lists the fixture plan with progress', { skip }, async () => {
  const page = await withToken();
  await page.waitFor('.plans a.plan-link');
  const text = await page.evaluate("document.querySelector('.plans a.plan-link').textContent");
  assert.match(text, /Fixture Plan/);
  assert.match(text, /\d+\/\d+ done/);
});

test('clicking a plan routes to its review tab', { skip }, async () => {
  const page = await open();
  await page.waitFor('.plans a.plan-link');
  await page.click('.plans a.plan-link');
  await page.waitFor('.tabs .tab.active');
  assert.equal(await page.evaluate('location.hash'), `#/plan/${encodeURIComponent(PLAN_ID)}/review`);
  assert.equal(await page.evaluate("document.querySelector('.tab.active').textContent"), 'Review');
  await page.waitFor('#view .review-layout');
  await page.evaluate("[...document.querySelectorAll('.tab')].find((a) => a.textContent === 'Progress').click()");
  await page.waitFor('.tab.active[href$="/progress"]');
  assert.equal(await page.evaluate('location.hash'), `#/plan/${encodeURIComponent(PLAN_ID)}/progress`);
});

test('live toggle is on by default and persists when turned off', { skip }, async () => {
  const page = await open();
  await page.waitFor('#live-toggle');
  assert.equal(await page.evaluate("document.getElementById('live-toggle').checked"), true);
  await page.click('#live-toggle');
  assert.equal(await page.evaluate("document.getElementById('live-toggle').checked"), false);
  await page.goto(`${server.url}/`);
  await page.waitFor('#live-toggle');
  await page.waitFor('.plans a.plan-link');
  assert.equal(await page.evaluate("document.getElementById('live-toggle').checked"), false);
});

test('no console or CSP errors on home', { skip }, async () => {
  const page = await open();
  await page.waitFor('.plans a.plan-link');
  await page.viewport(375, 700);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await new Promise((r) => setTimeout(r, 1000)); // let any late network error arrive
  assert.deepEqual(page.errors(), []);
});

test('poll skips a poller while its previous run is pending', { skip }, async () => {
  const page = await open();
  await page.waitFor('#live-toggle');
  await page.evaluate("(() => { const t = document.getElementById('live-toggle'); if (!t.checked) t.click(); })()");
  // A poller that never settles: with the busy guard it runs once, without it once per 3 s tick.
  const runs = await page.evaluate(`(async () => {
    const { onPoll } = await import('/static/app.js');
    let n = 0;
    onPoll(() => { n++; return new Promise(() => {}); });
    await new Promise((r) => setTimeout(r, 7500));
    return n;
  })()`);
  assert.equal(runs, 1);
});
