import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'record-event.mjs');
const SID = 'd74fe789-4c82-47af-8c28-21c10033b858';

// Samples follow hook-facts.md "Raw samples" (trimmed to the fields the recorder reads).
const samples = {
  SubagentStart: { session_id: SID, agent_id: 'a1c0dddd7300012dd', agent_type: 'general-purpose', hook_event_name: 'SubagentStart' },
  SubagentStop: { session_id: SID, agent_id: 'a1c0dddd7300012dd', agent_type: 'general-purpose', hook_event_name: 'SubagentStop', stop_hook_active: false },
  PreToolUse: { session_id: SID, agent_id: 'a1c0dddd7300012dd', agent_type: 'general-purpose', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo sub-1', description: 'Print sub-1' } },
  PostToolUse: { session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'echo main-1' }, tool_response: { stdout: 'main-1' }, duration_ms: 1160 },
};

function setup({ marker = true, session = SID, planExists = true } = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'taskify-rec-'));
  const plan = path.join(proj, 'docs', 'plan');
  if (planExists) fs.mkdirSync(plan, { recursive: true });
  if (marker) {
    fs.mkdirSync(path.join(proj, '.taskify'));
    fs.writeFileSync(path.join(proj, '.taskify', 'active-run.json'),
      JSON.stringify({ plan, session_id: session, started_at: new Date().toISOString() }));
  }
  const events = path.join(plan, '.taskify', 'events.jsonl');
  const run = (stdin) => spawnSync(process.execPath, [script], {
    cwd: proj, env: { ...process.env, CLAUDE_PROJECT_DIR: proj }, input: stdin, encoding: 'utf8', windowsHide: true,
  });
  const lines = () => (fs.existsSync(events) ? fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { proj, plan, events, run, lines, cleanup: () => fs.rmSync(proj, { recursive: true, force: true }) };
}

test('no marker exits 0 and writes nothing', () => {
  const s = setup({ marker: false });
  try {
    const r = s.run(JSON.stringify(samples.PostToolUse));
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(s.plan, '.taskify')), false);
  } finally { s.cleanup(); }
});

test('matching session appends one line per event type', () => {
  const s = setup();
  try {
    for (const ev of Object.keys(samples)) assert.equal(s.run(JSON.stringify(samples[ev])).status, 0);
    const lines = s.lines();
    assert.deepEqual(lines.map((l) => l.ev), ['SubagentStart', 'SubagentStop', 'PreToolUse', 'PostToolUse']);
    assert.equal(lines[0].aid, 'a1c0dddd7300012dd');
    assert.equal(lines[0].atype, 'general-purpose');
    assert.equal(lines[0].sid, SID);
    assert.equal('tool' in lines[0], false);
    assert.equal(lines[2].tool, 'Bash');
    assert.equal(lines[2].sum, 'echo sub-1');
    assert.equal(lines[3].aid, null);
    assert.equal(lines[3].atype, null);
    assert.equal(lines[3].sum, 'echo main-1');
    assert.equal('ok' in lines[3], false);
    assert.ok(!Number.isNaN(Date.parse(lines[3].t)));
  } finally { s.cleanup(); }
});

test('other session writes nothing', () => {
  const s = setup({ session: 'some-other-session' });
  try {
    assert.equal(s.run(JSON.stringify(samples.PostToolUse)).status, 0);
    assert.equal(s.lines().length, 0);
  } finally { s.cleanup(); }
  const e = setup({ session: '' });
  try {
    assert.equal(e.run(JSON.stringify(samples.PostToolUse)).status, 0);
    assert.equal(e.lines().length, 0);
  } finally { e.cleanup(); }
  const n = setup({ session: null });
  try {
    n.run(JSON.stringify(samples.PostToolUse));
    assert.equal(n.lines().length, 1);
  } finally { n.cleanup(); }
});

test('malformed stdin exits 0 silently', () => {
  const s = setup();
  try {
    const r = s.run('{not json');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.equal(s.lines().length, 0);
  } finally { s.cleanup(); }
});

test('missing plan folder exits 0 silently', () => {
  const s = setup({ planExists: false });
  try {
    const r = s.run(JSON.stringify(samples.PostToolUse));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.equal(fs.existsSync(s.plan), false);
  } finally { s.cleanup(); }
});

test('long bash command is cut to 120 chars', () => {
  const s = setup();
  try {
    s.run(JSON.stringify({ ...samples.PostToolUse, tool_input: { command: 'x'.repeat(500) } }));
    assert.equal(s.lines()[0].sum.length, 120);
  } finally { s.cleanup(); }
});

test('no stdout or stderr output ever', () => {
  const s = setup();
  try {
    for (const stdin of [JSON.stringify(samples.PreToolUse), '', 'garbage']) {
      const r = s.run(stdin);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    }
  } finally { s.cleanup(); }
  const n = setup({ marker: false });
  try {
    const r = n.run(JSON.stringify(samples.PreToolUse));
    assert.equal(r.stdout + r.stderr, '');
  } finally { n.cleanup(); }
});

test('no-marker run is fast', () => {
  const s = setup({ marker: false });
  try {
    const median = (times) => {
      times = [...times].sort((a, b) => a - b);
      return (times[4] + times[5]) / 2;
    };
    const time = (fn) => {
      const t0 = process.hrtime.bigint();
      fn();
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const empty = path.join(s.proj, 'empty.mjs');
    fs.writeFileSync(empty, '');
    const runBare = () => spawnSync(process.execPath, [empty], { windowsHide: true });
    const runHook = () => s.run(JSON.stringify(samples.PostToolUse));
    // When the whole suite runs in parallel the machine is loaded and every spawn is slow, and the load
    // changes over time. So: one discarded warm-up of each, then interleave empty-.mjs and hook spawns so both
    // see the same load. Budget is 150 ms or empty-.mjs median + 50 ms, whichever is larger.
    runBare(); runHook();
    const bareTimes = [], hookTimes = [];
    for (let i = 0; i < 10; i++) {
      bareTimes.push(time(runBare));
      hookTimes.push(time(runHook));
    }
    const bare = median(bareTimes);
    const ours = median(hookTimes);
    assert.ok(ours <= Math.max(150, bare + 50), `median ${ours.toFixed(1)} ms, empty .mjs ${bare.toFixed(1)} ms`);
  } finally { s.cleanup(); }
});
