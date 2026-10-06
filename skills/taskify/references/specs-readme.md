# specs/tasks/README.md template

The index and protocol file for a spec set. Copy the body below, fill the bracketed parts, and keep
every section — the protocol and standing-constraints blocks exist because subagents may not load
the project's `CLAUDE.md`.

**Contents:** template body · what to adapt per project

## What to adapt per project

- **`## Standing constraints`** — replace with the actual rules from the target repo's `CLAUDE.md` /
  `AGENTS.md`, verbatim. Commit policy, import conventions, migration rules, lint gates.
- **The evidence-rule examples** — replace the ❌/✅ pairs with ones drawn from *this* task, so the
  distinction lands concretely instead of abstractly.
- **`AC-REG`'s command** in the protocol — the project's own typecheck/lint/test gate.

---8<--- copy from here

# <Task Name> Task Specs

Executable task specs derived from the plan in [`../../`](../../). One file per task, each
self-contained enough for a subagent to execute without reading the whole plan set.

- **Plan** (`00`–`0N`) = the design and its rationale. Source of truth for *what and why*.
- **These specs** = the executable contract. Source of truth for *do this, prove it works*.

Where a spec and the plan disagree, the plan wins and the spec is wrong — fix the spec. Where either
disagrees with a **recorded measurement**, the measurement wins: it is an observation, not an
intention.

## Execution protocol

Each task runs through two roles, both declared in its own frontmatter:

```
implement (general-purpose, sonnet)  ->  review (feature-dev:code-reviewer, opus)  ->  done
      ^                                            |
      +---------------- changes_requested ---------+
```

**The implementer** (`general-purpose`, model `sonnet`):

1. Reads its spec file, then the `plan_refs` sections it names.
2. Runs every **Precondition** command. If one fails, sets `status: blocked`, records why, and stops
   — it does not fix a dependency that belongs to another task.
3. Sets `status: in_progress`.
4. Implements only what **Scope** authorises.
5. Runs every **Acceptance criteria** command and pastes the **actual, unedited** output into that
   AC's `Evidence` block. Truncating to the interesting lines is fine; editing, summarising, or
   reconstructing output from memory is not.
6. Fills `## Completion record` and sets `status: in_review`. **It does not set `done`.**
   Other tasks may be running at the same time in the same working tree. If a command fails only
   because of changes outside this task's `touches:`, it does not fix them: it records the failure
   and the files involved in the Completion record.
7. **Never commits.** Commits belong to the user.

**The reviewer** (`feature-dev:code-reviewer`, model `opus`) revalidates against **two** things:

- **The plan** — does the implementation do what the `plan_refs` sections actually specify?
- **The ACs** — does each pasted evidence block prove its stated claim, or was something weaker
  proven? An AC that would pass both before and after the change proves nothing.

It also checks that changed paths are a subset of `touches:`, and raises findings with a severity
(`Critical` / `Important` / `Minor` / `Observation`).

**The reviewer is read-only — plan around it.** `feature-dev:code-reviewer` has no `Bash`, `Edit`, or
`Write`. Division of labour:

| Step | Who | How |
|---|---|---|
| Re-read plan refs, spec, changed files, pasted evidence | reviewer | `Read` / `Grep`, static |
| Judge plan conformance and evidence sufficiency; raise findings | reviewer | returns them in its report |
| Re-run an AC command the reviewer disputes | orchestrator | `Bash` |
| Write `## Review record`, set `status:` | orchestrator | `Edit` |

On `changes_requested` the implementer fixes and the task returns to review. A task is `done` only on
an `approved` verdict. **The implementer never reviews its own work.**

If an AC turns out to be *wrong* (unverifiable, or testing the wrong thing), record that in
`Follow-ups discovered` and leave it unchecked rather than quietly rewriting the bar.

## Evidence rules

The point of these specs is that "done" means *the behaviour exists*, not *the file exists*.
Two AC types, and the distinction is load-bearing:

| Type | Proves | Example |
|---|---|---|
| `structural` | A file/config/dependency is in place | `test -f <built artifact>`; a dependency resolves to one version |
| `behavioural` | A code path actually executes correctly at runtime | The app boots and the new route returns `200`; a migration builds the schema on a clean database and a second run reports nothing pending |

**A task cannot be marked `done` on structural evidence alone.** Every spec must carry at least one
behavioural AC, verified with pasted output.

Concretely, for this task:

- ❌ "<the structural-only claim a reader might accept>" — structural only.
- ✅ "<the behavioural claim that proves the thing the change could silently break>".

Prefer an AC that would **fail if the change were reverted**. An AC that passes both before and
after the task is not testing the task.

## Waves and dependency graph

The tasks in one wave run in parallel, as concurrent subagents. Waves run in order: a wave starts
only when every task it depends on is terminal. A task's wave is one more than the highest wave
among its `depends_on`, so the order between waves carries every dependency. Wave lines list task
IDs joined by `∥` and nothing else.

```
Wave 1   T0.01 ∥ T1.01 ∥ T1.02
Wave 2   T1.03 ∥ T2.01
Wave 3   T2.02
```

**Collision rule:** two tasks may only run concurrently if their `touches:` lists are disjoint and
they claim no common serialisation point below. The orchestrator checks both before starting tasks
together and runs a clashing pair one after the other. Overlaps between tasks in *different* waves
are benign by construction — the waves are ordered.

An incomplete `touches:` list defeats this rule silently — agents writing the same file concurrently
clobber, they do not rebase. Tasks running together also share the working tree, so one task's
half-done edits can break another's build or tests; the orchestrator re-runs the project gate after
each batch to catch that.

## Serialisation points

Files or runtime resources (a database, a port, a fixed build or output folder, a global install, a
migration sequence) that more than one task needs. Tasks that claim the same entry never run at the
same time.

| Shared file or resource | Claimed by | Why |
|---|---|---|

## Task index

| ID | Phase | Title | Status | Review | Depends on |
|---|---|---|---|---|---|
| T0.01 | 0 | <title> | pending | pending | — |

`Status` carries its caveats inline rather than in a footnote — `done (AC4 deferred, no credentials,
user-approved)` is the useful form. `skipped` is a terminal status that satisfies a downstream
`depends_on`.

## Standing constraints for every task

Carried from the project's own `CLAUDE.md`, repeated here because subagents may not load it:

- **Never `git commit`, `push`, `amend`, `rebase`, or `reset`.** Leave changes in the working tree.
- Touch only what the spec's Scope authorises. Report adjacent problems as
  `Follow-ups discovered`; do not opportunistically fix them.
- <the project's own conventions, verbatim>
