import fs from 'node:fs';
import path from 'node:path';

const TASK_ID = /T\d+\.\d+[a-z]?/g;
const lines = (text) => String(text ?? '').split(/\r?\n/);
const stripComments = (s) => s.replace(/<!--.*?-->/g, '').trim();

function scalar(raw) {
  let v = raw.replace(/(^|\s)#.*$/, '').trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => scalar(s)).filter((s) => s !== '');
  }
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
  return v;
}

export function parseFrontmatter(text) {
  try {
    const ls = lines(text);
    if (ls[0] !== '---') return { data: {}, body: String(text ?? '') };
    const end = ls.indexOf('---', 1);
    if (end < 0) return { data: {}, body: String(text ?? '') };
    const data = {};
    let key = null; // key whose value is still open (block list or nested map)
    for (const line of ls.slice(1, end)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const item = line.match(/^\s*-\s+(.*)$/);
      const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
      if (item && key) {
        if (!Array.isArray(data[key])) data[key] = [];
        data[key].push(scalar(item[1]));
      } else if (kv && kv[1] === '') {
        key = kv[2];
        // an empty value opens a block list or nested map; it stays [] if nothing follows
        data[key] = kv[3].replace(/(^|\s)#.*$/, '').trim() === '' ? [] : scalar(kv[3]);
      } else if (kv && key) {
        if (Array.isArray(data[key])) data[key] = {};
        data[key][kv[2]] = scalar(kv[3]);
      }
    }
    return { data, body: ls.slice(end + 1).join('\n') };
  } catch {
    return { data: {}, body: '' };
  }
}

const asNumber = (v) => (/^\d+$/.test(String(v)) ? Number(v) : v ?? null);
const asList = (v) => (Array.isArray(v) ? v : []);

export function parseSpec(text) {
  const empty = { id: null, phase: null, title: null, status: null, depends_on: [], touches: [], ac_total: 0, ac_verified: 0, acs: [], verdict: null };
  try {
    const { data, body } = parseFrontmatter(text);
    const acs = [];
    let ac = null;
    let inReview = false;
    let ac_verified = 0;
    let verdict = null;
    for (const line of lines(body)) {
      if (/^## /.test(line)) { inReview = /^## Review record\b/.test(line); ac = null; }
      const h = line.match(/^### (AC(?:\d+|-[A-Z]+))\b\s*[—–-]*\s*(.*)$/);
      if (h) { ac = { id: h[1], name: h[2].trim(), type: null, verified: false }; acs.push(ac); continue; }
      if (/^###? /.test(line)) { ac = null; continue; }
      const ty = line.match(/^- \*\*Type:\*\*\s*(\w+)/);
      if (ty && ac) ac.type = ty[1];
      if (/^- \*\*Verified:\*\*\s*\[[xX]\]/.test(line)) { ac_verified++; if (ac) ac.verified = true; }
      const vd = line.match(/^- \*\*Verdict:\*\*\s*(\S+)/);
      if (vd && inReview && verdict === null) verdict = vd[1];
    }
    return {
      id: data.id ?? null, phase: asNumber(data.phase), title: data.title ?? null, status: data.status ?? null,
      depends_on: asList(data.depends_on), touches: asList(data.touches),
      ac_total: acs.length, ac_verified, acs, verdict,
    };
  } catch {
    return empty;
  }
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseReadme(text) {
  const out = { index: [], waves: [] };
  try {
    for (const line of lines(text)) {
      const w = line.match(/^Wave\s+(\d+)\s+(.*)$/);
      if (w) { out.waves.push({ wave: Number(w[1]), tasks: w[2].match(TASK_ID) ?? [] }); continue; }
      if (!line.trim().startsWith('|')) continue;
      const c = cells(line);
      if (c.length < 6 || !/^T\d+\.\d+[a-z]?$/.test(c[0])) continue;
      out.index.push({ id: c[0], phase: asNumber(c[1]), title: c[2], status: c[3], review: c[4], depends_on: c[5].match(TASK_ID) ?? [] });
    }
  } catch { /* return what was parsed */ }
  return out;
}

export function parseProgress(text) {
  const out = { run_state: null, current_task: null, current_step: null, last_updated: null, resume_note: null, log: [] };
  const fields = { 'Run state': 'run_state', 'Current task': 'current_task', 'Current step': 'current_step', 'Last updated': 'last_updated', 'Resume note': 'resume_note' };
  try {
    let inLog = false;
    for (const line of lines(text)) {
      if (/^## /.test(line)) inLog = /^## Log\b/.test(line);
      const f = line.match(/^- \*\*([^*]+):\*\*\s*(.*)$/);
      if (f && fields[f[1]]) { out[fields[f[1]]] = stripComments(f[2]); continue; }
      if (!inLog || !line.trim().startsWith('|')) continue;
      const c = cells(line);
      if (c.length < 4 || c[0] === 'Time' || /^-+$/.test(c[0])) continue;
      out.log.push({ time: stripComments(c[0]), task: stripComments(c[1]), event: stripComments(c[2]), note: stripComments(c[3]) });
    }
  } catch { /* return what was parsed */ }
  return out;
}

export function parseEvents(text, limit = 200) {
  const events = [];
  for (const line of lines(text)) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !Array.isArray(e)) events.push(e);
    } catch { /* skip half-written or garbage line */ }
  }
  return limit > 0 ? events.slice(-limit) : [];
}

const eventTime = (t) => {
  const n = typeof t === 'number' ? t : Date.parse(t);
  return Number.isNaN(n) ? 0 : n;
};

// Subagents with a SubagentStart and no SubagentStop (anywhere in the file) for the same aid.
export function openSubagents(text) {
  const starts = new Map();
  const stopped = new Set();
  const last = new Map(); // aid -> latest tool event with a summary
  for (const line of lines(text)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== 'object' || typeof e.aid !== 'string' || !e.aid) continue;
    if (e.ev === 'SubagentStart') {
      if (!starts.has(e.aid)) starts.set(e.aid, e);
    } else if (e.ev === 'SubagentStop') {
      stopped.add(e.aid);
    } else if (typeof e.tool === 'string' && e.tool && typeof e.sum === 'string' && e.sum) {
      const prev = last.get(e.aid);
      if (!prev || eventTime(e.t) >= eventTime(prev.t)) last.set(e.aid, e);
    }
  }
  return [...starts].filter(([aid]) => !stopped.has(aid)).map(([aid, s]) => ({
    aid,
    atype: typeof s.atype === 'string' ? s.atype : '',
    started: s.t ?? null,
    last_tool: last.get(aid)?.tool ?? '',
    last_sum: last.get(aid)?.sum ?? '',
  }));
}

export function fixRounds(log, taskId) {
  return Array.isArray(log) ? log.filter((r) => r && r.task === taskId && String(r.event).includes('changes_requested')).length : 0;
}

const SKIP = new Set(['node_modules', '.git', '.taskify']);

export function findPlans(root) {
  const plans = [];
  const walk = (dir, depth) => {
    try {
      if (fs.existsSync(path.join(dir, 'specs', 'tasks', 'README.md'))) {
        plans.push({ id: path.relative(root, dir).split(path.sep).join('/') || '.', dir });
      }
      if (depth >= 6) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
      }
    } catch { /* unreadable directory: skip */ }
  };
  walk(root, 0);
  return plans;
}
