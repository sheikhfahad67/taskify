# Changelog

## 1.2.0 — 2026-10-06

- `taskify-implementer` runs independent tasks in parallel. Each batch is up to `--max-parallel`
  ready tasks (default 3) that share no `touches:` path and no serialisation point: their
  implementers run together, the project gate runs once, then their reviewers run together.
  `--max-parallel 1` keeps the old one-at-a-time run. PROGRESS.md can list several current tasks.
- `taskify` builds waves for parallel runs: `depends_on` lists only real needs, each with a `# why`
  comment; a task's wave is one more than the highest wave of its dependencies; a wave is a set of
  parallel tasks (`∥` only). A new Serialisation points table covers shared files and shared runtime
  resources (a database, a port, a build folder). The final report gives the widest wave.
- Older plans still run: `A → B` inside a wave still means `B` waits for `A`.
- Dashboard: clicking a board card opens its details (status, phase, wave, verdict, fix rounds,
  dependencies, files touched, acceptance criteria, the task's log rows, and the full spec). It is
  a centred dialog on wide screens and full screen on phones.
- Dashboard: every task in a running batch is highlighted on the wave track.
- The plan API now includes each task's acceptance criteria (`acs`).

## 1.1.0 — 2026-10-06

- Dashboard redesign ("blueprint"): a blueprint-blue sheet in dark mode and a white sheet in light
  mode, with the Barlow font bundled (no network fonts; the page's security policy is unchanged).
- Progress view: a full-width wave track shows every task by wave, with the current task
  highlighted and headline numbers (tasks done, checks verified, in progress, need you, subagents
  working). Below it: a status ring, run notes, most used tools, the board, live activity and the log.
- Review view: document and comment counts sit with the approve form in one panel.
- Works on phones: full-width layout, stacked panels, a swipeable board with filled columns first,
  and a Document / Comments switch on the review view. A heading's Comment button opens the
  Comments tab.
- The dashboard server now serves `.woff2` font files.
- The repo enables the `frontend-design` plugin at project scope (`.claude/settings.json`).

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
