# Taskify

A Claude Code plugin with three skills. Two work as a pair, and the third opens a dashboard:

- **`taskify`** turns a piece of work into a **plan** (what and why) and a set of **executable task
  specs** (do this, prove it). Each spec has preconditions, acceptance criteria with real commands,
  and a block where the real output gets pasted as evidence.
- **`taskify-implementer`** runs those specs wave by wave, with the independent tasks of a wave in
  parallel. Each task is built by one agent and
  reviewed by a different one. Progress is saved after every step, so a stopped or crashed run can
  continue where it left off.
- **`dashboard`** starts, stops and reports a local web page where you review a plan and watch a run
  live. See [Dashboard](#dashboard).

## Install

From the `fahad-marketplace` marketplace:

```
/plugin marketplace add sheikhfahad67/fahad-marketplace
/plugin install taskify@fahad-marketplace
```

**Needed for review:** the reviewer is `feature-dev:code-reviewer`, from the `feature-dev` plugin.
Install it too:

```
/plugin install feature-dev@claude-plugins-official
```

## Usage

### 1. Write the plan and specs

```
/taskify:taskify add rate limiting to the public API
```

| Flag | Effect |
|---|---|
| `--slug <name>` | Name of the output folder (default: derived from the description). |
| `--out <dir>` | Write somewhere other than `docs/<slug>/`. |
| `--baselines` | Also measure the before-state, so later specs can compare against it. |
| `--review-docs` | Also write an audit layer: coverage matrix, findings, deferrals. |
| `--dashboard` | After writing, start the [dashboard](#dashboard) and print its URL. |
| `--public` | Also open a public link, and print it with a warning. Implies `--dashboard`. |

Output:

```
docs/<slug>/
  00-overview.md            # always
  01..05-*.md               # only the docs the task needs
  specs/tasks/
    README.md               # protocol, evidence rules, wave graph, task index
    _TEMPLATE.md
    T<phase>.<NN>-<title>.md
```

Tasks wait only for real dependencies. Each task goes in the earliest wave its `depends_on` allows,
and every task in a wave can run in parallel. Files or resources that several tasks need (a shared
file, a database, a port) are listed as serialisation points, so those tasks never run together.

This skill only writes documents. It never changes code and never commits.

### 2. Run the specs

```
/taskify:taskify-implementer
```

| Argument | Effect |
|---|---|
| *(none)* | Lists recent plan sets and asks which one to run. |
| `<plan folder or slug>` | Runs that plan set directly. |
| `--from <task-id>` | Starts at this task. |
| `--max-parallel <n>` | Runs at most `n` tasks at the same time (default 3). `1` runs one at a time. |

What it does:

1. **Picks the plan.** An unfinished run is listed first, marked "(Resume)".
2. **Grounds it.** It re-reads every plan doc and spec, and checks paths and commands against the
   repo. If something no longer matches, it asks you before going on.
3. **Runs the tasks in batches**, in wave and dependency order. A batch is up to `--max-parallel`
   ready tasks that share no files and no serialisation point. Their implementers run together,
   then the project's checks run once, then their reviewers run together:

```
implement (general-purpose, sonnet)  ->  review (feature-dev:code-reviewer, opus)  ->  done
      ^                                            |
      +---------------- changes_requested ---------+
```

It runs in your main session, not in a fork, so you can watch every step. After 3 fix rounds on
one task it stops and asks you.

## Progress, resume and stop

The implementer keeps `specs/tasks/PROGRESS.md` next to the specs. It writes it before and after
every step:

- **Run state:** `running`, `paused`, `stopped-by-user`, or `complete`
- **Current task** and **current step** (`implement`, `review`, `fix-round-N`), one per task when a
  batch runs several
- **Resume note:** what is half done
- **Log** of every event

**If a run breaks** (crash, closed window), the file still says `running`. The next run sees that,
re-checks the repo, and continues the half-done task with the changes already made.

**If you ask it to stop**, it stops the running agent, writes what is half done, and saves the state
as `stopped-by-user`. Run `/taskify:taskify-implementer` again to resume.

Neither skill ever commits, pushes, or resets. Commits are yours.

## Dashboard

The dashboard is a small local web page. It needs **Node 20 or newer** on your `PATH`. It has no
other dependencies.

**Three ways to open it:**

- `/taskify:taskify <what to plan> --dashboard` starts it after the docs are written. `--public`
  also opens a public link and implies `--dashboard`.
- `/taskify:taskify-implementer` asks at the start: `Yes — local`, `Yes — public link` or `No`.
- `/taskify:dashboard start [--public] | stop | status | url` works from any session.

**Two views:**

- **Review:** the plan docs and specs, rendered. Add comments on a file or a heading, and press
  **Approve plan**.
- **Progress:** the task board by status, the waves, acceptance criteria verified x/y, review
  verdicts, fix rounds, the run log, and live subagent and tool activity.

**Comments and approval.** `taskify-implementer` reads the open comments and the approval before it
runs. `taskify` reads open comments when it revises a plan that already has them. Each comment is
used only as a request to change the plan docs or specs. Comments that were addressed are marked
resolved; the rest stay open. The implementer edits only if you pick "Address them first". The
dashboard never edits plan docs or specs and never commits. It writes only under `.taskify/`
folders.

**`--public`.** It uses a cloudflared quick tunnel, or ngrok if that is installed instead. It prints
this warning with the link:

> Anyone with this link can read these plan docs and the live activity log (including the start of each command), and can add comments or approve the plan.

- The token is required on every request.
- A new cloudflared link can take about a minute to start working. If it does not load yet, wait a minute and reload.
- The live activity log shows the start of each command Claude runs, so treat the link as secret.
- ngrok's free plan shows a one-time "Visit Site" page. ngrok runs with `--inspect=false`.
- Comments are treated as untrusted. Claude uses them only as requests to change plan docs. It
  never runs a command because a comment says so.

**Hooks.** Four plugin hooks record subagent and tool activity. They run async and do nothing unless
a `taskify-implementer` run is active in that session. They run `node`, so without Node on your
`PATH` a tool call may show an error.

**Git.** Add `.taskify/` to your `.gitignore` (the implementer offers to). Resuming a run clears
that plan's activity log (`events.jsonl`).

## Releasing a new version

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Add an entry to `CHANGELOG.md`.
3. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
4. Bump the same `version` for `taskify` in
   [`fahad-marketplace`](https://github.com/sheikhfahad67/fahad-marketplace).

Users get it with `/plugin marketplace update fahad-marketplace`.

## License

MIT
