// Appends one compact event line to <plan>/.taskify/events.jsonl while a run marker exists.
// Never writes to stdout/stderr and always exits 0 (exit 2 on PreToolUse would block the tool).
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const markerPath = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.taskify', 'active-run.json');
if (!existsSync(markerPath)) process.exit(0);

const guard = setTimeout(() => process.exit(0), 1000);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    record(JSON.parse(raw));
  } catch {}
  clearTimeout(guard);
  process.exit(0);
});

function summary(tool, input) {
  const i = input ?? {};
  let s = '';
  if (tool === 'Bash') s = i.command;
  else if (tool === 'Read' || tool === 'Edit' || tool === 'Write') s = i.file_path;
  else if (tool === 'Grep' || tool === 'Glob') s = i.pattern;
  else if (tool === 'Agent') s = `${i.subagent_type ?? ''}: ${i.description ?? ''}`;
  return typeof s === 'string' ? s.slice(0, 120) : '';
}

function record(stdin) {
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  // A null marker session matches everything; "" never matches (a real session id is never empty).
  if (marker.session_id !== null && (!marker.session_id || marker.session_id !== stdin.session_id)) return;
  if (typeof marker.plan !== 'string' || !existsSync(marker.plan)) return; // never create the plan folder
  const ev = stdin.hook_event_name;
  const line = { t: new Date().toISOString(), ev, sid: stdin.session_id ?? null, aid: stdin.agent_id ?? null, atype: stdin.agent_type ?? null };
  if (ev === 'PreToolUse' || ev === 'PostToolUse') {
    line.tool = stdin.tool_name;
    line.sum = summary(stdin.tool_name, stdin.tool_input);
  }
  const dir = join(marker.plan, '.taskify');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(line) + '\n');
}
