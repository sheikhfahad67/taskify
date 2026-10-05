# Tooling and Config Changes

This doc holds the literal content of every config-like file 0.2.0 adds or changes. Specs point at
these sections and do not restate them. Code files (`server.mjs`, `parse.mjs`, …) are specified by
behaviour in `01` and in their specs, not here.

## 0. `hooks/hooks.json`

```json
{
  "description": "Taskify dashboard: records subagent and tool activity to <plan>/.taskify/events.jsonl, only while a taskify-implementer run is active",
  "hooks": {
    "SubagentStart": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/record-event.mjs\"", "timeout": 5 } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/record-event.mjs\"", "timeout": 5 } ] }
    ],
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/record-event.mjs\"", "timeout": 5 } ] }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/record-event.mjs\"", "timeout": 5 } ] }
    ]
  }
}
```

The `"node \"${CLAUDE_PLUGIN_ROOT}/…\""` form and the `timeout` key follow the shipped `hookify`
plugin's `hooks.json`. One script handles all four events; it reads `hook_event_name` from stdin.

### Two edits depend on what T0.01 measures

These are the only places this file may differ from the block above, and only on T0.01's recorded
result:

- **`"async": true` on each hook entry** — add it only if T0.01 shows that a hook with `"async":
  true` no longer delays the tool call. Otherwise leave the entries synchronous.
- **Drop the `PreToolUse` block** — only if the user takes that option in `05` §"Is PreToolUse worth
  its cost".

### The script never blocks or fails a tool call

`record-event.mjs` must: check `${CLAUDE_PROJECT_DIR ?? process.cwd()}/.taskify/active-run.json`
with `existsSync` **before** reading stdin and exit 0 at once if it is missing; wrap everything else
in `try/catch`; never write to stdout or stderr; always exit 0 (exit code 2 on `PreToolUse` would
block the tool). It imports only `node:fs` and `node:path`.

## 1. `.claude-plugin/plugin.json`

Only `version` changes. Hooks load from `hooks/hooks.json` with no manifest key (B8).

```diff
-  "version": "0.1.0",
+  "version": "0.2.0",
```

## 2. `.gitignore` (this repo)

Append:

```gitignore
.taskify/
!dashboard/test/fixtures/**/.taskify/
```

### The negation keeps fixture state tracked

`.taskify/` hides the dashboard's state folders anywhere in the tree, including a dogfooded
`docs/dashboard/.taskify/`. The second line re-includes the fixture's `.taskify/` folder, which the
tests need as input. Checked in a scratch repo: `git ls-files` listed
`dashboard/test/fixtures/plan-basic/.taskify/review.json` and not `docs/p/.taskify/review.json`
(B11).

**This repo only.** In a user's repo the implementer suggests `.taskify/` and asks before touching
their `.gitignore` (U4, `05`).

## 3. Test and validation commands

```bash
node --test "dashboard/test/*.test.mjs"      # unit + integration tests (quoted glob, B1; Node >= 22)
claude plugin validate --strict .            # plugin manifest, skills, hooks
```

Run both from the repo root. Tests copy `dashboard/test/fixtures/plan-basic/` into
`fs.mkdtempSync(os.tmpdir() + '/taskify-')` and work there, so a test run leaves `git status`
unchanged. Each server test starts `server.mjs` with `--port 0` and stops it in `after()`.

The UI tests (`ui-*.test.mjs`) drive a headless browser through `dashboard/test/browser.mjs` (B12).
It launches

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --remote-debugging-port=0 --user-data-dir=<fresh temp dir> about:blank
```

reads the port from `<user-data-dir>/DevToolsActivePort`, and talks the DevTools protocol over
Node 22's built-in `WebSocket` (no npm package) to navigate, wait for a selector, evaluate
expressions, click, and collect console and CSP errors. A fresh `--user-data-dir` keeps it apart
from the user's own browser. B12 showed `--dump-dom` works too; the protocol is used because the
review tests must click and type.

`browser.mjs` finds the browser from `TASKIFY_BROWSER`, else that Edge path, else `google-chrome` /
`chromium` on `PATH`. When none exists the UI tests **skip** (not pass) with a printed reason.

## 4. `skills/dashboard/SKILL.md` frontmatter

```yaml
---
name: dashboard
description: Start, stop, or check the taskify dashboard — a local web page for reviewing a taskify plan set (rendered docs, comments, approve) and watching a taskify-implementer run live. Use when asked to "open the dashboard", "show the taskify dashboard", "share the plan for review", "stop the dashboard", or "dashboard url".
argument-hint: "start [--public] [--port <n>] | stop | status | url"
allowed-tools: Bash, Read
---
```

No `context: fork`: it is a few Bash calls and the user should see the URL in their own session.

## 5. `CHANGELOG.md` entry

Insert above `## 0.1.0`:

```markdown
## 0.2.0 — <release date>

- New `dashboard`: a local web page (Node, no dependencies) to review a plan set and watch a run.
  - Review view: rendered plan docs and specs, comments per file or heading, "Approve plan".
    Writes only `<plan>/.taskify/review.json`; plan docs and specs are never edited.
  - Progress view: task board by status, waves, AC verified x/y, review verdicts, fix rounds,
    PROGRESS.md state and log, and live subagent/tool activity.
  - Token auth on every request. Binds 127.0.0.1; `--public` adds a cloudflared or ngrok tunnel.
- New `/taskify:dashboard` skill: `start [--public]`, `stop`, `status`, `url`.
- `taskify`: `--dashboard` starts the dashboard after the docs are written; `--public` also opens a
  public tunnel.
- `taskify-implementer`: asks whether to open the dashboard; checks open review comments and plan
  approval before running; resolves comments it addressed; records live activity while it runs.
- New plugin hooks (SubagentStart/Stop, PreToolUse/PostToolUse). They exit at once unless a
  taskify-implementer run is active in that project.
- Requires Node 20 or newer on `PATH`.
```

`<release date>` is the date T4.04 runs, written as `YYYY-MM-DD`; the task fills it.
