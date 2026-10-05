# Changelog

## 1.0.0 — 2026-10-05

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
- The login cookie is named per port, so two dashboards on 127.0.0.1 keep separate logins.
- Public-link hardening: the idle timer resets only on authenticated requests, error bodies are
  generic, the ngrok inspector is off, and idle exit touches `dashboard.json` only if it is its own.
- The `--public` warning now says the link also shows the live activity log (including the start
  of each command).
- `.taskify/dashboard.json` is written owner-only (mode 0600 on macOS and Linux).
- The cloudflared quick tunnel was verified end to end with a real tunnel.
- Review comments are treated as untrusted: they are only requests to change plan docs or specs.

## 0.1.0 — 2026-10-01

- First release.
- `taskify` skill: writes numbered plan docs and executable task specs with acceptance criteria,
  evidence blocks, a wave graph and a task index.
- `taskify-implementer` skill: picks a plan set, grounds it against the repo, runs each task through
  implement (general-purpose, sonnet) and review (feature-dev:code-reviewer, opus), and keeps a
  `PROGRESS.md` for resume and stop.
