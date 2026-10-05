import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '../lib/parse.mjs';
import { copyFixture } from './helpers.mjs';

const root = copyFixture('plan-basic');
after(() => fs.rmSync(root, { recursive: true, force: true }));
const plan = path.join(root, 'docs', 'plan-basic');
const read = (rel) => fs.readFileSync(path.join(plan, rel), 'utf8');

test('parseSpec counts ACs and verdict', () => {
  const got = ['T1.01-alpha', 'T1.02-beta', 'T2.01-gamma', 'T2.02-delta'].map((f) => {
    const s = p.parseSpec(read(`specs/tasks/${f}.md`));
    return [s.id, s.status, s.ac_verified, s.ac_total, s.verdict];
  });
  assert.deepEqual(got, [
    ['T1.01', 'done', 3, 3, 'approved'],
    ['T1.02', 'in_review', 2, 3, 'pending'],
    ['T2.01', 'changes_requested', 0, 2, 'changes_requested'],
    ['T2.02', 'pending', 0, 2, 'pending'],
  ]);
  const s = p.parseSpec(read('specs/tasks/T1.02-beta.md'));
  assert.deepEqual(s.depends_on, ['T1.01']);
  assert.deepEqual(s.touches, ['src/beta.js']);
  assert.deepEqual(s.acs.map((a) => [a.id, a.type, a.verified]), [['AC1', 'structural', true], ['AC2', 'behavioural', true], ['AC-REG', 'behavioural', false]]);
  assert.equal(s.acs[0].name, 'File exists');
});

test('parseFrontmatter handles inline and block lists and nested maps', () => {
  const { data, body } = p.parseFrontmatter('---\nid: T1.01\nstatus: pending   # c\ndepends_on: [T0.01, T0.02]\nparallel_with: []\ntouches:\n  - a/b.js\n  - c.js\nimplementer:\n  agent: general-purpose\n  model: sonnet\n---\n# Body\n');
  assert.deepEqual(data, {
    id: 'T1.01', status: 'pending', depends_on: ['T0.01', 'T0.02'], parallel_with: [],
    touches: ['a/b.js', 'c.js'], implementer: { agent: 'general-purpose', model: 'sonnet' },
  });
  assert.equal(body, '# Body\n');
});

test('parseReadme reads index and waves', () => {
  const r = p.parseReadme(read('specs/tasks/README.md'));
  assert.deepEqual(r.waves, [{ wave: 1, tasks: ['T1.01', 'T1.02'] }, { wave: 2, tasks: ['T2.01', 'T2.02'] }]);
  assert.equal(r.index.length, 4);
  assert.deepEqual(r.index[1], { id: 'T1.02', phase: 1, title: 'Beta does the second thing', status: 'in_review', review: 'pending', depends_on: ['T1.01'] });
  assert.deepEqual(r.index[0].depends_on, []);
});

test('parseProgress reads fields and log', () => {
  const g = p.parseProgress(read('specs/tasks/PROGRESS.md'));
  assert.equal(g.run_state, 'running');
  assert.equal(g.current_task, 'T1.02');
  assert.equal(g.current_step, 'review');
  assert.equal(g.last_updated, '2026-10-05 10:32');
  assert.equal(g.log.length, 6);
  assert.deepEqual(g.log[2], { time: '2026-10-05 10:15', task: 'T2.01', event: 'changes_requested', note: 'AC1 evidence too weak' });
});

test('parseEvents skips a half-written last line', () => {
  const text = fs.readFileSync(path.join(plan, '.taskify', 'events.jsonl'), 'utf8');
  const ev = p.parseEvents(text);
  assert.equal(ev.length, 5);
  assert.equal(ev[4].ev, 'SubagentStop');
  assert.equal(p.parseEvents(text, 2).length, 2);
});

const evLine = (t, ev, aid, extra = {}) => JSON.stringify({ t, ev, aid, atype: `type-${aid}`, tool: '', sum: '', ...extra });

test('open subagents survive beyond 200 events', () => {
  const lines = [evLine(1, 'SubagentStart', 'a1')];
  for (let i = 0; i < 250; i++) lines.push(evLine(2 + i, 'PreToolUse', 'a1', { tool: 'Bash', sum: `cmd ${i}` }));
  const open = p.openSubagents(lines.join('\n'));
  assert.equal(open.length, 1);
  assert.deepEqual(open[0], { aid: 'a1', atype: 'type-a1', started: 1, last_tool: 'Bash', last_sum: 'cmd 249' });
});

test('stop before start in file order still closes', () => {
  const text = [
    evLine(1, 'SubagentStop', 'a2'),
    evLine(2, 'SubagentStart', 'a1'),
    evLine(3, 'SubagentStart', 'a2'),
    evLine(4, 'SubagentStart', 'a3'),
  ].join('\n');
  assert.deepEqual(p.openSubagents(text).map((a) => a.aid), ['a1', 'a3']);
  assert.deepEqual(p.openSubagents(''), []);
});

test('non-string aid is ignored', () => {
  const text = [
    evLine(1, 'SubagentStart', 'a1'),
    evLine(2, 'SubagentStart', 7),
    evLine(3, 'SubagentStart', ''),
    evLine(4, 'SubagentStart', null),
    evLine(5, 'SubagentStop', { x: 1 }),
    'not json',
    evLine(6, 'PreToolUse', 'a1', { tool: 'Read', sum: 'f.md' }),
    evLine('2026-10-05T10:00:07.000Z', 'PreToolUse', 'a1', { tool: 'Bash', sum: '' }),
  ].join('\n');
  const open = p.openSubagents(text);
  assert.deepEqual(open.map((a) => a.aid), ['a1']);
  assert.equal(open[0].last_tool, 'Read');
  assert.equal(open[0].last_sum, 'f.md');
});

test('fixRounds counts changes_requested rows', () => {
  const { log } = p.parseProgress(read('specs/tasks/PROGRESS.md'));
  assert.equal(p.fixRounds(log, 'T2.01'), 2);
  assert.equal(p.fixRounds(log, 'T1.01'), 0);
});

test('findPlans finds the fixture and skips node_modules', () => {
  fs.mkdirSync(path.join(root, 'node_modules', 'x', 'specs', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'specs', 'tasks', 'README.md'), '# no\n');
  const plans = p.findPlans(root);
  assert.deepEqual(plans, [{ id: 'docs/plan-basic', dir: plan }]);
});

test('parsers never throw on garbage', () => {
  const inputs = ['', '---\n:::\n', crypto.randomBytes(10240).toString('utf8')];
  for (const fn of [p.parseFrontmatter, p.parseSpec, p.parseReadme, p.parseProgress, p.parseEvents]) {
    for (const input of inputs) assert.doesNotThrow(() => fn(input));
  }
  assert.doesNotThrow(() => p.fixRounds(null, 'T1.01'));
  assert.deepEqual(p.findPlans(path.join(root, 'does-not-exist')), []);
});
