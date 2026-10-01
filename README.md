# Taskify

A Claude Code plugin with two skills that work as a pair:

- **`taskify`** turns a piece of work into a **plan** (what and why) and a set of **executable task
  specs** (do this, prove it). Each spec has preconditions, acceptance criteria with real commands,
  and a block where the real output gets pasted as evidence.
- **`taskify-implementer`** runs those specs, one task at a time. Each task is built by one agent and
  reviewed by a different one. Progress is saved after every step, so a stopped or crashed run can
  continue where it left off.

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

What it does:

1. **Picks the plan.** An unfinished run is listed first, marked "(Resume)".
2. **Grounds it.** It re-reads every plan doc and spec, and checks paths and commands against the
   repo. If something no longer matches, it asks you before going on.
3. **Runs each task** in wave and dependency order:

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
- **Current task** and **current step** (`implement`, `review`, `fix-round-N`)
- **Resume note:** what is half done
- **Log** of every event

**If a run breaks** (crash, closed window), the file still says `running`. The next run sees that,
re-checks the repo, and continues the half-done task with the changes already made.

**If you ask it to stop**, it stops the running agent, writes what is half done, and saves the state
as `stopped-by-user`. Run `/taskify:taskify-implementer` again to resume.

Neither skill ever commits, pushes, or resets. Commits are yours.

## Releasing a new version

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Add an entry to `CHANGELOG.md`.
3. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
4. Bump the same `version` for `taskify` in
   [`fahad-marketplace`](https://github.com/sheikhfahad67/fahad-marketplace).

Users get it with `/plugin marketplace update fahad-marketplace`.

## License

MIT
