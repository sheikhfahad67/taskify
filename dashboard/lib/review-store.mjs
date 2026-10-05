import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ version: 1, comments: [], approvals: [] });

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const reviewPath = (planDir) => path.join(planDir, '.taskify', 'review.json');

export function readReview(planDir) {
  try {
    const data = JSON.parse(fs.readFileSync(reviewPath(planDir), 'utf8'));
    if (data && Array.isArray(data.comments) && Array.isArray(data.approvals)) {
      return { version: 1, comments: data.comments, approvals: data.approvals };
    }
  } catch {
    // missing, empty or invalid: treated as an empty review
  }
  return EMPTY();
}

// Lock file created with 'wx': retry every 25 ms for up to 2 s; a lock older than 5 s is stale.
function acquireLock(lockPath) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST' && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
    }
    if (Date.now() > deadline) throw fail('ELOCKED', 'could not lock review.json');
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > 5000) {
        fs.unlinkSync(lockPath);
        continue; // removed: try again at once (deadline is checked on the next pass)
      }
    } catch {
      // lock vanished between open and stat, or stale unlink failed: wait and retry
    }
    sleep(25);
  }
}

// Strict read for the write path: only a missing or blank file is an empty review.
function readForWrite(planDir) {
  let raw;
  try {
    raw = fs.readFileSync(reviewPath(planDir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY();
    throw Object.assign(fail('ECORRUPT', `cannot read review.json: ${err.message}`), { cause: err });
  }
  if (raw.trim() === '') return EMPTY();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw Object.assign(fail('ECORRUPT', `review.json is not valid JSON: ${err.message}`), { cause: err });
  }
  if (!data || !Array.isArray(data.comments) || !Array.isArray(data.approvals)) {
    throw fail('ECORRUPT', 'review.json has the wrong shape');
  }
  return { version: 1, comments: data.comments, approvals: data.approvals };
}

function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if ((err.code !== 'EPERM' && err.code !== 'EBUSY') || i >= 10) throw err;
      sleep(20);
    }
  }
}

// Runs fn(review) under the lock, then writes the (mutated) review atomically.
function update(planDir, fn) {
  const dir = path.join(planDir, '.taskify');
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, 'review.json.lock');
  acquireLock(lockPath);
  try {
    const review = readForWrite(planDir);
    const result = fn(review);
    const tmp = path.join(dir, `review.json.${process.pid}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify(review, null, 2) + '\n');
      renameWithRetry(tmp, reviewPath(planDir));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    return result;
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // already removed
    }
  }
}

function str(value, name, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw fail('EINVAL', `${name} must be a string of ${min}-${max} characters`);
  }
  return value;
}

function checkFile(planDir, file) {
  str(file, 'file', 1, 500);
  const bad = file.includes('\\') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)
    || file.split('/').includes('..') || !file.endsWith('.md');
  const full = path.join(planDir, file);
  let isFile = false;
  try {
    isFile = !bad && fs.statSync(full).isFile();
  } catch {
    // not found
  }
  if (!isFile) throw fail('EINVAL', 'file must be an existing relative .md path inside the plan folder');
  return file;
}

export function addComment(planDir, { file, anchor, text, author } = {}) {
  checkFile(planDir, file);
  const comment = {
    id: '',
    file,
    anchor: anchor == null ? null : str(anchor, 'anchor', 0, 500),
    text: str(text, 'text', 1, 4000),
    author: str(author ?? '', 'author', 0, 60),
    created: new Date().toISOString(),
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
  };
  return update(planDir, (review) => {
    do {
      comment.id = 'c_' + crypto.randomBytes(4).toString('hex');
    } while (review.comments.some((c) => c.id === comment.id));
    review.comments.push(comment);
    return comment;
  });
}

export function resolveComment(planDir, id, { note, by } = {}) {
  const resolution_note = str(note ?? '', 'note', 0, 500);
  const resolved_by = str(by ?? '', 'by', 0, 60);
  return update(planDir, (review) => {
    const comment = review.comments.find((c) => c.id === id);
    if (!comment) throw fail('ENOENT', `no comment with id ${id}`);
    Object.assign(comment, {
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by,
      resolution_note,
    });
    return comment;
  });
}

export function addApproval(planDir, { note, by } = {}) {
  const approval = {
    at: new Date().toISOString(),
    by: str(by ?? '', 'by', 0, 60),
    note: str(note ?? '', 'note', 0, 500),
  };
  return update(planDir, (review) => {
    review.approvals.push(approval);
    return approval;
  });
}

export function reviewSummary(planDir) {
  const { comments, approvals } = readReview(planDir);
  const latest = approvals.length ? approvals[approvals.length - 1] : null;
  const since = latest ? Date.parse(latest.at) : NaN;
  let changed = [];
  if (latest) {
    try {
      changed = fs.readdirSync(planDir).filter((name) => /^\d\d-.*\.md$/.test(name)
        && fs.statSync(path.join(planDir, name)).mtimeMs > since);
    } catch {
      // unreadable plan folder: report nothing changed
    }
  }
  return {
    approved: latest !== null,
    approved_at: latest ? latest.at : null,
    docs_changed_since_approval: changed,
    open_comments: comments.filter((c) => !c.resolved).length,
    resolved_count: comments.filter((c) => c.resolved).length,
  };
}
