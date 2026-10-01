---
name: taskify
description: Author a two-layer task document set — numbered plan docs (what and why) plus executable per-task specs under specs/tasks/ carrying preconditions, acceptance criteria with commands and pasted evidence, a wave/dependency graph, and a task index. Use when asked to "taskify this", "plan and spec this out", "break this into tasks", "write the plan and specs", or before starting multi-step work that needs a verifiable audit trail. Generates docs only — never implements.
argument-hint: "<what to plan> [--slug <name>] [--out <dir>] [--baselines] [--review-docs]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, TodoWrite
context: fork
background: false
---

# Taskify

Turn a piece of work into two layers of documents: a **plan** that states what and why, and a set of
**executable specs** that state do-this-and-prove-it. The plan is prose and rationale; each spec is a
contract whose acceptance criteria carry a command, a precise expected observable, and a block where
the implementer pastes the actual output.

The reference implementation of this convention is `docs/conversion-docs/` in the
`health-data-layer-experiment` repo — 6 numbered plan docs plus 33 task specs that carried an 8-wave
monorepo migration with a real audit trail. Match its shape.

## Arguments

`<what to plan>` is the only required argument — a plain description of the work. Everything else is
inferred, and the four flags exist to override an inference or opt into an extra layer.

| Argument | Effect |
|---|---|
| `<what to plan>` | The work to plan. Required. Free text, not a flag. |
| `--slug <name>` | Override the derived output folder name. Use when the inferred slug reads badly. |
| `--out <dir>` | Write somewhere other than `docs/<slug>/`. Use when the gate found a different convention and you want to force it. |
| `--baselines` | Also emit `specs/baselines/` plus a `T0.00` task that measures the before-state. Worth it for refactors and migrations, where later specs verify by comparison. |
| `--review-docs` | Also emit the `review-docs/` layer — coverage matrix, findings register (`F-01`…), known deferrals (`D1`…). Only for large multi-wave work that will get an audit pass. |

With no flags: derive the slug from the description, write to `docs/<slug>/`, and emit plans + specs
only. `--baselines` and `--review-docs` are **off unless asked for** — they are real overhead, not
free thoroughness.

## Where it goes

```
docs/<task-slug>/
  00-overview.md              # always
  0N-*.md                     # only the ones the task earns (see Sizing)
  specs/
    tasks/
      README.md               # protocol, evidence rules, wave graph, task index
      _TEMPLATE.md            # copied verbatim from references/task-spec.md
      T<phase>.<NN>-<kebab-title>.md
```

`<task-slug>` is short, kebab-case, and names the work not the action — `rate-limiting`,
`oauth-migration`, `ai-layer-workspace`. Not `add-rate-limiting`, not `task-1`.

## Before writing — the docs-folder gate

**Run this before creating any file.** It is what makes the output grounded instead of plausible.

1. **List the docs folder.** `ls docs/` and one level down. You are looking for an existing plan or
   spec set, and for the naming convention this repo already uses.
2. **If a convention already exists, adopt it — do not impose this one.** A repo that keeps plans in
   `plans/`, `rfcs/`, or `design/`, or that numbers differently, wins. State which convention you
   detected and where you are writing, before you write.
3. **Read the code the task actually touches.** Every path, command, count, and file name you are
   about to put in a doc must come from something you read, not from inference.
4. **Read the project's `CLAUDE.md` / `AGENTS.md`** for standing constraints — commit rules, build
   commands, lint gates. These get copied into the specs README, because subagents may not load them.

A spec whose commands you have not checked against the real repo is worse than no spec: it looks
verified and is not. If you could not verify something, write it as an open question in
`05-risks-*.md` rather than as a command.

## Sizing — emit a doc only when it carries content nothing else can

There are no tiers. Each plan doc is conditional on an observable fact about the task:

| Emit | When |
|---|---|
| `00-overview.md` | Always. Goal, the decisions actually settled, and the `## Document index`. |
| `01-target-*.md` | The task changes structure — a directory tree, module layout, or schema shape. |
| `02-*-mapping.md` | Files or symbols move or get renamed. A pure old-path/new-path table. |
| `03-*-changes.md` | Config, build, tooling, or dependencies change. The copy-paste source of truth. |
| `04-execution-phases.md` | There is more than one task. One `##` per phase, each closing with a bold **Verify:**. |
| `05-risks-and-*.md` | The gate turned up a risk, an open decision, or something already stale. |

Spec count follows the same logic: **one spec per independently-verifiable unit of work**, plus a
gate spec (`T<phase>.NN-phase<N>-<thing>-gate.md`) for any phase holding more than one spec.

A task small enough for one spec gets `00-overview.md` and that spec — nothing else. Do not emit an
empty `02`/`03` stub to complete the set. Six files for a one-file change is a failure of this skill,
not fidelity to it.

**The two opt-in layers** (`--baselines`, `--review-docs`) are never emitted unless the flag is
present, even for large work:

- `--baselines` → `specs/baselines/pre-<slug>.md` plus a `T0.00` spec whose whole job is to *measure*
  the before-state (route lists, row counts, test counts, file counts) and paste it there. Later
  specs then verify by comparison, and the README gains one line: where a spec disagrees with a
  recorded baseline, **the baseline wins — it is a measurement, not an intention.**
- `--review-docs` → a parallel `review-docs/` set that audits the first: `02-coverage-matrix.md`,
  `findings-register.md` (`F-01`…, grouped by severity, ending in a stated verdict), and
  `05-known-deferrals.md` (`D1`…, IDs never renumbered, resolved rows struck through in place rather
  than deleted). Its specs use `verdict:` instead of `status:` and are run by a reviewer, not a coder.

## Plan layer

Numbered `NN-*.md`, **no frontmatter**, exactly one `#` H1 on line 1, then a short orientation
paragraph, then `##` sections. Full templates and heading conventions: `references/plan-docs.md`.

Two things carry most of the value:

- **Headings are assertions, not labels.** `## Entity extraction is the highest-risk phase in this
  plan`, not `## Risks`. A reader scanning only headings should come away with the findings.
- **`00-overview.md` closes with a `## Document index` table** listing each sibling doc and what it
  contains. That is how the set indexes itself.

## Spec layer

One file per task: `specs/tasks/T<phase>.<NN>-<kebab-title>.md`. Copy `references/task-spec.md` to
`<output>/specs/tasks/_TEMPLATE.md` verbatim, then fill one copy per task. The index and protocol
template is `references/specs-readme.md`.

IDs: `T<phase>.<NN>`, two-digit sequence, phase digit matching `04-execution-phases.md`. A task
inserted later takes a letter suffix (`T4.03b`) rather than renumbering its siblings. Preconditions
are `P1..Pn`, local to a spec. Acceptance criteria are `AC1..ACn` plus a mandatory trailing `AC-REG`
(no regression in what already worked).

**The two AC types are the load-bearing distinction:**

| Type | Proves |
|---|---|
| `structural` | A file, config, or dependency is in place. |
| `behavioural` | A code path actually executes correctly at runtime. |

Every spec needs at least one `behavioural` AC, and no spec can be marked done on structural
evidence alone. Prefer an AC that would **fail if the change were reverted** — one that passes both
before and after is not testing the task.

## Execution flow every spec declares

Every spec pins both roles in frontmatter, so an orchestrator reading one file knows who runs it and
who signs it off:

```yaml
implementer:
  agent: general-purpose
  model: sonnet
reviewer:
  agent: feature-dev:code-reviewer
  model: opus
```

```
implement (general-purpose, sonnet)  ->  review (feature-dev:code-reviewer, opus)  ->  done
      ^                                            |
      +---------------- changes_requested ---------+
```

The reviewer revalidates against **two** things: the `plan_refs` sections (does this do what the plan
specifies?) and the acceptance criteria (does each pasted evidence block prove its stated claim, or
was something weaker proven?). A task reaches `done` only on an `approved` verdict, recorded in the
spec's `## Review record`.

**The reviewer is read-only.** `feature-dev:code-reviewer` has no `Bash`, `Edit`, or `Write` — it
cannot re-run an AC command or write its own verdict. So the reviewer judges and returns findings;
the **orchestrator** writes the Review record, sets `status:`, and re-runs any command the reviewer
disputes. State this division in the generated `specs/tasks/README.md` so a subagent run does not
stall waiting for the reviewer to do something its tools forbid.

## Rules

- **Generate only.** Write documents. Never implement the task, never commit. Stop when the docs are
  written, and say what the first wave is.
- **Ground every claim.** Every path, command, and count traces to something read during the gate.
- **Every AC carries a command and a precise expected observable** — an exit code, a count, a string
  in output. Never "works correctly".
- **At least one `behavioural` AC per spec.** No spec is done on structural evidence alone.
- **Every spec declares both roles**, and the implementer never reviews its own work.
- **The plan is the source of truth for what and why; the spec is the executable contract.** Where
  they disagree the plan wins and the spec gets fixed.
- **Two tasks may run concurrently only if their `touches:` lists are disjoint.** An incomplete
  `touches:` list defeats this silently — it is the one field worth double-checking before a wave.
- **Repeat the project's standing constraints at the bottom of `specs/tasks/README.md`**, verbatim.
- **No placeholders in delivered docs.** `TBD`, `TODO`, and "similar to task N" are failures. A
  genuinely open question belongs in `05-risks-*.md`, named as open.

## Related skills

For a single feature needing a design doc and a bite-sized TDD task list, `superpowers:brainstorming`
then `superpowers:writing-plans` is the lighter convention, and writes to `docs/superpowers/`. Use
`taskify` when the work is multi-task and needs the wave graph, gate specs, and evidence trail.

To run a finished plan set, use `taskify:taskify-implementer`. It picks the plan, grounds the specs, runs
each task through implement and review, and keeps a resumable `PROGRESS.md`.
