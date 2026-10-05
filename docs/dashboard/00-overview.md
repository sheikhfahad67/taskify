# Taskify Dashboard (v0.2.0) — Overview

## Goal

Ship taskify 0.2.0 with a local web dashboard. In it, a user reviews a plan set (reads the plan docs
and specs as rendered markdown, leaves comments, approves the plan) and watches a
`taskify-implementer` run live (task board, waves, AC counts, review verdicts, PROGRESS.md state, and
subagent activity captured by plugin hooks). The one invariant: **the dashboard never edits a plan
doc or a spec.** Its only write target is `<plan>/.taskify/review.json`.

**This document set is planning only.** Landing these docs changes no code and makes no commit. The
work runs against [`04-execution-phases.md`](./04-execution-phases.md) and the specs under
[`specs/tasks/`](./specs/tasks/README.md), driven by `taskify:taskify-implementer`.

## Settled decisions (user-decided)

These were decided before planning. Specs implement them; they do not reopen them.

| # | Decision |
|---|---|
| U1 | **Three triggers.** `/taskify:taskify ... --dashboard [--public]` starts the dashboard after the docs are written, with a public tunnel when `--public` is given (`--public` alone implies `--dashboard`) (taskify is `context: fork` and has no `AskUserQuestion`, so it never asks). `taskify-implementer` asks at start whether to open it (it runs in the main session and has `AskUserQuestion`). A new `/taskify:dashboard` skill (`start` \| `stop` \| `status` \| `url`) works at any time. |
| U2 | **Remote access is a public tunnel, off by default.** The server binds `127.0.0.1` only. `/taskify:dashboard start --public` adds a cloudflared quick tunnel (no account needed), or ngrok if cloudflared is missing and ngrok is installed. |
| U3 | **Auth is mandatory**, because the URL can be public and the API can write. A random token is made at start. It is required on every request: `?t=<token>` once, then an `HttpOnly` cookie. Compare in constant time. No token means `401`. |
| U4 | **The review view is interactive.** Comments per file, optionally anchored to a heading, and an "Approve plan" button. Writes go only to `<plan>/.taskify/review.json`. `taskify-implementer` reads it in Step 1/2: open comments are listed and the user is asked whether to address them first; an unapproved plan gets a warning and a question before the run. Claude marks comments resolved through a CLI command. |
| U5 | **The progress view shows live agent activity.** Task board by status (`pending`, `in_progress`, `in_review`, `changes_requested`, `blocked`, `done`, `skipped`), waves, AC verified x/y per spec, review verdict, fix rounds, PROGRESS.md run state, current task and step, and the log timeline — plus subagent and tool activity recorded by plugin hooks into `<plan>/.taskify/events.jsonl`. Hooks do nothing unless an active-run marker exists. |
| U6 | **Live update by re-reading disk.** The server reads files on every request (no build step). The client polls every ~3 s, with a toggle. Half-written files are tolerated: keep the last good parse, never crash. |

## Findings from the grounding pass

Reading the repo and measuring on the author's machine (Windows 11, Node v22.22.3, Claude Code
2.1.289) changed or sharpened the brief in these places. Later docs cite these IDs.

| # | Finding | Resolution |
|---|---|---|
| B1 | `node --test dashboard/test/` fails on Node 22.22.3: the directory is loaded as a module (`MODULE_NOT_FOUND`). A quoted glob, `node --test "dashboard/test/*.test.mjs"`, runs the files. | The test command is the quoted glob everywhere (`03` §3). |
| B2 | marked 18.0.14 (current on npm) ships no `marked.min.js`. Its browser build is `lib/marked.umd.js`, 46,891 bytes, MIT. | Vendor it as `dashboard/public/vendor/marked.umd.js` (`01` tree, T2.01). |
| B3 | `cloudflared` is **not** installed on the author's machine. `ngrok` 3.39.9 is installed and `ngrok config check` reports a valid config. | cloudflared stays the default (U2). T1.07 verifies the tunnel path with ngrok; the cloudflared path is an open decision in `05`. |
| B4 | A no-op Node script that only checks for a marker file takes **58 ms median, 75 ms max** (10 runs). With `PreToolUse` + `PostToolUse` that is about 116 ms added to every tool call, in every session where the plugin is enabled. | The hook checks the marker before anything else. T0.01 re-measures inside a real session. Whether to keep `PreToolUse` is an open decision in `05`. |
| B5 | The brief said hooks have no documented async option. But shipped official plugins use `"asyncRewake": true` and `"if"` on hook entries (`security-guidance`, `code-modernization` `hooks/hooks.json`). | Some async mechanism exists. T0.01 measures whether `"async": true` makes a slow hook stop delaying the tool call. |
| B6 | The marker-plus-session pattern already exists: `ralph-loop`'s `stop-hook.sh` reads `.claude/ralph-loop.local.md` relative to the project, and compares stdin `session_id` to a value written from `$CLAUDE_CODE_SESSION_ID`. That variable is set in the Bash tool's environment (observed in this session). | The marker stores the session id. The CLI reads `CLAUDE_CODE_SESSION_ID` itself, so skills need no shell-specific syntax. |
| B7 | A hook cannot search for plan folders in a few milliseconds, so it cannot find a marker that lives inside a plan folder. | The marker lives at a fixed place, `<project>/.taskify/active-run.json`, and holds the plan path. Events go to `<plan>/.taskify/events.jsonl`. |
| B8 | Plugins load `hooks/hooks.json` without a manifest key: `hookify` and `ralph-loop` have no `hooks` field in `plugin.json`. | `plugin.json` changes only `version` (`03` §1). |
| B9 | A loaded skill is told "Base directory for this skill: `<path>`" (seen in this session). Whether `${CLAUDE_PLUGIN_ROOT}` is expanded inside skill text is not documented. | Skills locate the CLI as `<base directory>/../../dashboard/cli.mjs`. T0.01 records whether `CLAUDE_PLUGIN_ROOT` is set in the Bash tool too. |
| B10 | The suggested `GET /api/plan/:slug` is ambiguous: two plan folders can share a basename (`docs/x`, `plans/x`). | A plan's id is its folder path relative to the root, passed as `?plan=docs/dashboard` (`01` §API). |
| B11 | Test fixtures need a `.taskify/` folder, but `.taskify/` will be gitignored. Tested in a scratch repo: `.taskify/` plus `!dashboard/test/fixtures/**/.taskify/` keeps the fixture files tracked. | Both lines go into this repo's `.gitignore` (`03` §2). Tests copy fixtures to a temp dir, so test runs never write into the repo. |
| B12 | Headless Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless=new --virtual-time-budget=5000 --dump-dom <url>`) runs page JavaScript including `fetch` before dumping the DOM (tested). | UI specs get real behavioural ACs with no npm dependency. |
| B13 | `claude plugin validate .` and `claude plugin validate --strict .` both exit 0 today. `claude --plugin-dir`, `-p`, `--max-budget-usd`, `--permission-mode`, `--allowedTools` exist in 2.1.289. | `validate --strict` is part of every AC-REG. The spike and in-session gates run Claude headless with `--plugin-dir`. |
| B14 | `taskify-implementer` runs **one task at a time** (its Step 3). | Waves here only order the work. No task is planned to run in parallel. |

## Ship fixed code, not generated HTML

The dashboard is a small fixed program inside the plugin: a Node HTTP server with **zero npm
dependencies** (`node:http`, `node:fs`, `node:crypto`, `node:child_process`), a parser library, a
static single-page UI, and one vendored file (marked). Claude never writes HTML per run.

Rejected: having Claude generate a static HTML report each time. It goes stale the moment a task
changes status, it cannot take comments, and each run would render differently. Also rejected: a
framework or bundler. They add an install step to a plugin that today has none.

**Runtime needs Node ≥ 20 on `PATH`.** The code uses no Node-22-only API (no `fs.globSync`).
Developing the plugin (running its tests) needs Node ≥ 22, because the test command relies on
`node --test` glob support (B1).

## The dashboard reads; only review.json is written

Every view is computed from files the skills already write: spec frontmatter, the README task index
and wave graph, `PROGRESS.md`. The only new files are under `.taskify/` folders:

| File | Written by | Purpose |
|---|---|---|
| `<project>/.taskify/dashboard.json` | server + CLI | pid, port, token, tunnel of the running server |
| `<project>/.taskify/active-run.json` | `cli.mjs run-start` / `run-end` | marker that turns the hooks on |
| `<plan>/.taskify/review.json` | server, `cli.mjs resolve` | comments and approvals |
| `<plan>/.taskify/events.jsonl` | `hooks/record-event.mjs` | one JSON line per hook event |

Shapes are fixed in [`01-target-layout.md`](./01-target-layout.md).

## How existing conventions carry over

1. **Spec `status:` stays the source of truth for each task.** The board reads frontmatter, not the
   README index, because the implementer skill says frontmatter wins.
2. **Neither skill commits, pushes, or resets** — and the dashboard does not either. It also never
   edits `.gitignore` in a user's repo. The implementer suggests the line and asks first.
3. **The implementer still asks before it runs past drift.** Open review comments and a missing
   approval become two more reasons to ask, in the same place (Step 2).
4. **Markdown stays plain markdown.** Plan docs and specs keep their current format; the dashboard
   parses what `references/task-spec.md` and the implementer's PROGRESS.md template already define.
5. **A public tunnel always needs an explicit `--public`.** `/taskify:taskify --dashboard` starts
   a local server only; `/taskify:taskify --dashboard --public` (or `--public` alone) also opens
   the tunnel and prints the public URL with the same warning as `/taskify:dashboard start
   --public`. Nothing becomes public without that flag.

## Document index

| File | Contents |
|---|---|
| [`01-target-layout.md`](./01-target-layout.md) | Target file tree, the four `.taskify/` file shapes, the HTTP API, and the CLI commands. |
| [`03-tooling-changes.md`](./03-tooling-changes.md) | Literal `hooks/hooks.json`, `plugin.json` bump, `.gitignore` lines, test command, dashboard skill frontmatter, CHANGELOG entry. |
| [`04-execution-phases.md`](./04-execution-phases.md) | Phases 0–4, each with its verify step. |
| [`05-risks-and-open-decisions.md`](./05-risks-and-open-decisions.md) | Security, hook overhead, process lifetime, Windows, tunnel tools, concurrency, and the open questions T0.01 settles. |
| [`specs/tasks/README.md`](./specs/tasks/README.md) | Protocol, evidence rules, wave graph, task index, standing constraints. |
