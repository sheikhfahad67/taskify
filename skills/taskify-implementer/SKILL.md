---
name: taskify-implementer
description: Run a plan written by the taskify skill — find recent taskify plan sets, ask which one to implement, re-read and ground every plan doc and spec against the repo, then drive each task through implement (general-purpose, sonnet) and review (feature-dev:code-reviewer, opus) in wave order. Keeps a PROGRESS.md so an interrupted or stopped run resumes where it left off. Use when asked to "implement the plan", "run the specs", "start implementing", "resume the implementation", or "continue taskify".
argument-hint: "[<plan folder or slug>] [--from <task-id>]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, TodoWrite, Agent, AskUserQuestion, TaskStop
---

# Taskify Implementer

Execute a plan set that `taskify` wrote. This skill is the **orchestrator** the taskify specs refer
to: it dispatches the implementer and the reviewer, writes the `## Review record`, sets `status:`,
and keeps the task index and progress file current.

It runs in the main session, **not forked**, so the user can watch every dispatch and result as it
happens.

## Arguments

| Argument | Effect |
|---|---|
| *(none)* | Find recent plan sets and ask which one to run. |
| `<plan folder or slug>` | Skip the question and use this plan set (`docs/rate-limiting` or `rate-limiting`). |
| `--from <task-id>` | Start or resume at this task instead of the first non-terminal one. |

## Step 1 — Pick the plan

1. Find plan sets: `Glob **/specs/tasks/README.md` (ignore `node_modules`, `.git`). Each match's
   grandparent folder is one plan set.
2. For each, read the task index and count `done` / total, and check for `specs/tasks/PROGRESS.md`.
3. Sort by most recently modified. Ask with `AskUserQuestion`, showing up to 4 plan sets. Each option
   shows the slug, `done/total`, and the run state from PROGRESS.md if one exists
   (`paused at T2.03 — review`). Put a plan with an unfinished run first, marked `(Resume)`.

If no plan set is found, say so and stop. Suggest running `taskify:taskify` first.

## Step 2 — Ground the plan before touching code

Read **everything** before the first dispatch. A spec written days ago may no longer match the repo.

1. Read every plan doc (`00-overview.md` … `0N-*.md`), `specs/tasks/README.md`, and every spec file.
2. Read the project's `CLAUDE.md` / `AGENTS.md`. Check that the README's standing constraints still
   match it.
3. For the tasks not yet `done`, check against the real repo:
   - every `touches:` path that should already exist does exist (and `Create` paths do not yet);
   - commands named in preconditions and ACs exist (`package.json` scripts, binaries, Makefile targets);
   - each `depends_on` points at a real task ID.
4. Run `git status --short` so you know which changes were already there before this run.
5. Report what you found in a short list: `ok`, or a drift item with file and reason.

**If there is any drift, stop and ask the user** whether to fix the spec first or go on anyway. Do
not change a spec's acceptance criteria to fit the repo on your own — the plan wins, and a changed
bar has to be the user's call.

## Step 3 — Run the tasks

Work out the order from the README's wave graph and each spec's `depends_on`. Run **one task at a
time**. Skip tasks that are `done` or `skipped`.

For each task:

1. **Update progress first** — PROGRESS.md: current task, step `implement`, state `running`.
2. **Dispatch the implementer:** `Agent` with `subagent_type: general-purpose`, `model: sonnet`.
   The prompt gives the spec path, the plan set path, and says: follow the implementer protocol in
   `specs/tasks/README.md`; paste real command output as evidence; set `status: in_review` when done;
   never commit. On a resumed or fix round, also pass the note from PROGRESS.md and the review
   findings to fix.
3. **Wait and check the result.** Read the spec again.
   - `blocked` → log the reason, set state `paused`, tell the user, and stop.
   - not `in_review` → the agent did not finish. Log it and ask the user: retry or stop.
4. **Update progress** — step `review`.
5. **Dispatch the reviewer:** `Agent` with `subagent_type: feature-dev:code-reviewer`,
   `model: opus`. Give it the spec path, the `plan_refs`, and the changed files
   (`git diff --stat` limited to `touches:`). Ask for plan conformance, AC evidence check, scope
   check, and findings with severities. It is read-only, so do not ask it to run or write anything.
6. **Act on the review** (you are the orchestrator):
   - Re-run any AC command the reviewer disputes, with `Bash`.
   - Write the `## Review record` into the spec.
   - `approved` → set `status: done`, update the README task index row.
   - `changes_requested` → set that status, then go back to step 1 as a fix round with the findings.
     After **3** fix rounds on one task, stop and ask the user.
7. **Update progress** — log the result, move to the next task.

When every task is terminal, set state `complete`, list what was done and any follow-ups the specs
recorded, and remind the user that nothing was committed.

## Progress file — `specs/tasks/PROGRESS.md`

Write it **before and after every step**, not only at the end. A crash between writes must lose at
most one step. Create it on the first run from this shape:

```markdown
# Progress — <task-slug>

- **Run state:** running            <!-- running | paused | stopped-by-user | complete -->
- **Current task:** T1.02
- **Current step:** implement       <!-- implement | review | fix-round-N -->
- **Last updated:** 2026-10-01 14:32
- **Resume note:** <one or two lines: what is half-done and what to do next>

## Log

| Time | Task | Event | Note |
|---|---|---|---|
| 2026-10-01 14:10 | T1.01 | approved | — |
| 2026-10-01 14:32 | T1.02 | implement started | — |
```

The spec `status:` fields stay the source of truth for each task. PROGRESS.md only adds where in
the run you are and what the next step needs to know.

## Resuming

When the chosen plan has a PROGRESS.md whose state is not `complete`:

- `running` means the last session ended without saying so (crash, closed window, lost
  connection). Treat it as interrupted.
- Do Step 2 (grounding) again — the repo may have changed since.
- For the current task, look at its `status:` and the working tree (`git status`, `git diff` on its
  `touches:` paths):
  - `pending` or `in_progress` with partial changes → re-dispatch the implementer, tell it the work
    is partly done, and give it the diff so it continues rather than starting over.
  - `in_review` → go straight to review.
  - `changes_requested` → a fix round with the findings from the Review record.
- Tell the user where you are resuming from before you dispatch anything.

## Stopping on request

When the user asks to stop:

1. Stop any running subagent with `TaskStop`.
2. Check what it left: the spec's `status:` and `git status` on the task's `touches:`.
3. Write PROGRESS.md: state `stopped-by-user`, current task and step, and a resume note naming the
   partial changes.
4. Tell the user what was done, where it stopped, and that running this skill again resumes there.

Do not revert partial changes when stopping. The resume step uses them.

## Rules

- **Never commit, push, or reset.** Commits belong to the user.
- **The implementer never reviews its own work.** Implementation and review always go to the two
  different agents above.
- **Do not edit acceptance criteria or plan docs to make a task pass.** Report it and ask.
- **One task at a time**, in wave and dependency order.
- **Keep PROGRESS.md and the README task index current after every step.**
