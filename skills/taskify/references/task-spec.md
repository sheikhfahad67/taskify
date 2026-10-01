# Task spec template

Copy this file's body (everything below the `---8<---` line) verbatim to
`<output>/specs/tasks/_TEMPLATE.md`, then fill one copy per task as
`T<phase>.<NN>-<kebab-title>.md`.

**Contents:** frontmatter fields · body skeleton · the per-AC block · filling notes

## Frontmatter fields

| Field | Meaning |
|---|---|
| `id` | `T<phase>.<NN>`. Letter suffix for a task inserted later (`T4.03b`) — never renumber siblings. |
| `phase` | Matches the phase number in `04-execution-phases.md`. |
| `title` | Imperative, one line, states what this task **makes true**. |
| `implementer` | Fixed: `general-purpose`, model `sonnet`. |
| `reviewer` | Fixed: `feature-dev:code-reviewer`, model `opus`. `model:` is an override the orchestrator passes when dispatching. |
| `status` | `pending` → `in_progress` → `in_review` → `done`, or `changes_requested` / `blocked`. |
| `depends_on` | Task IDs that must be terminal first. A `skipped` task is terminal and unblocks its dependents. |
| `parallel_with` | Task IDs safe to run concurrently — their `touches:` must be disjoint from this one's. |
| `touches` | **Every** path this task creates, moves, or edits. Used to detect collisions. The one field worth double-checking before a wave. |
| `plan_refs` | One line per plan doc, each with a trailing `#` comment naming the exact section. |
| `blast_radius` | One line: how many files, how reversible. |

## Filling notes

- **Preconditions are commands you actually run**, not assumptions. Do not start on a precondition
  you have not run. If one fails, set `status: blocked`, record why, and stop — do not fix a
  dependency that belongs to another task.
- **`### Explicitly out of scope` is not optional.** List what a reader might reasonably assume is
  included, with the task ID that owns it instead. This is where scope creep gets caught.
- **Every AC needs a command and a precise expected observable** — an exit code, a count, a string in
  output. Prefer an AC that would fail if the change were reverted.
- **At least one `behavioural` AC per spec.** A `behavioural` AC carries the extra
  `**Why this is behavioural:**` field, stating what runtime behaviour it proves that file existence
  cannot.
- **Evidence is pasted actual output.** Truncating to the interesting lines is fine. Editing,
  summarising, or reconstructing from memory is not.
- **If an AC turns out to be wrong** (unverifiable, or testing the wrong thing), record that in
  `Follow-ups discovered` and leave it unchecked. Do not quietly rewrite the bar.
- **The `## Review record` is filled by the orchestrator** from the reviewer's report — the reviewer
  has no write tools. Leave it as-is until review runs.

---8<--- copy from here

---
id: TX.YY
phase: X
title: <imperative, one line — what this task makes true>
implementer:
  agent: general-purpose
  model: sonnet
reviewer:
  agent: feature-dev:code-reviewer
  model: opus
status: pending            # pending | in_progress | in_review | changes_requested | blocked | done
depends_on: []             # task IDs that must be terminal first
parallel_with: []          # task IDs safe to run concurrently (no shared files)
touches:                   # every path this task creates/moves/edits — used to detect collisions
  - <path>
plan_refs:
  - docs/<task-slug>/04-execution-phases.md  # §Phase X
blast_radius: <one line — how many files, how reversible>
---

# TX.YY — <title>

## Objective

One paragraph: what state the repo is in when this task is done, in behavioural terms
("migrations run from `packages/db` against a clean database", not "files moved").

## Preconditions

Each precondition is a **command that must pass before starting**. Do not start on a
precondition you have not actually run.

| # | Precondition | Command | Expected |
|---|---|---|---|
| P1 | `TX.YY` is terminal | `grep '^status:' docs/<task-slug>/specs/tasks/TX.YY-*.md` | `status: done` |

## Scope

### Create
- `path` — purpose

### Move (`git mv`, preserve history)
- `old` → `new`

### Edit
- `path` — what changes and why

### Explicitly out of scope
- Things a reader might assume are included but are not, with the task ID that owns them.

## Implementation steps

1. Ordered, concrete steps. Name real files. Where the plan already specifies content
   (a config block, a file shape), reference the plan section rather than restating it —
   the plan is the source of truth, this spec is the executable contract.

## Acceptance criteria

**Every AC carries a command and an expected observable.** Fill in `Evidence` with the
*actual, unedited* output. This task is not `done` until every AC is checked, **at least
one `behavioural` AC has pasted evidence**, and the reviewer verdict is `approved`.

### AC1 — <name>
- **Type:** structural
- **Command:**
  ```bash
  <command>
  ```
- **Expected:** <precise observable — an exit code, a count, a string in output>
- **Evidence:**
  ```
  <paste actual output>
  ```
- **Verified:** [ ]

### AC2 — <name>
- **Type:** behavioural
- **Why this is behavioural:** <what runtime behaviour it proves that file existence cannot>
- **Command:**
  ```bash
  <command that exercises the code path>
  ```
- **Expected:** <observable runtime result>
- **Evidence:**
  ```
  <paste actual output>
  ```
- **Verified:** [ ]

### AC-REG — No regression in what already worked
- **Type:** behavioural
- **Command:** <the project's own typecheck/lint/test gate, plus any narrower check this blast radius implies>
- **Expected:** exit 0
- **Evidence:**
  ```
  ```
- **Verified:** [ ]

## Definition of done

- [ ] Every AC above verified with pasted, unedited evidence
- [ ] At least one `behavioural` AC among them
- [ ] Reviewer verdict is `approved` in `## Review record`
- [ ] `## Review record` carries the reviewer's actual findings, not "LGTM"
- [ ] `status:` in this file's frontmatter set to `done`
- [ ] Row updated in `specs/tasks/README.md` index
- [ ] Working tree contains only changes this spec's **Scope** authorises (`git status` reviewed)
- [ ] No commit made — commits belong to the user

## Rollback

The exact command(s) to undo this task if a later task fails because of it. For a pure
`git mv` task this is usually `git checkout -- .` plus a named inverse move; state it
explicitly rather than assuming.

## Completion record

- **Completed by:** general-purpose (model: sonnet)
- **Date:**
- **Evidence summary:** <2–3 lines: what was proven to work, and what was deliberately not covered>
- **Follow-ups discovered:** <anything found that belongs in another task — do not fix it here>

## Review record

Filled by the **orchestrator** from the reviewer's report. The reviewer re-derives the claims
statically; it does not take the evidence on trust, and it has no tools to run or write anything.

- **Reviewed by:** feature-dev:code-reviewer (model: opus)
- **Date:**
- **Verdict:** pending          <!-- pending | approved | changes_requested -->

### Plan conformance

| Plan ref | What it requires | Conforms? | Note |
|---|---|---|---|
| `<doc> §<section>` | <the requirement> | yes / no / partial | <note> |

### AC re-derivation

| AC | Evidence proves its claim? | Re-run by orchestrator? | Note |
|---|---|---|---|
| AC1 | yes / no / weaker-than-claimed | no | <note> |

### Findings

- **R-1** — **Severity:** Critical | Important | Minor | Observation
  - **Claim:** <one line>
  - **Evidence:** <file:line, or the output that shows it>
  - **Required fix:** <what must change before approval>

### Scope check

- [ ] Changed paths are a subset of this spec's `touches:`
- [ ] No commit was made
