# Taskify Dashboard (v0.2.0) Task Specs

Executable task specs derived from the plan in [`../../`](../../). One file per task, each
self-contained enough for a subagent to execute without reading the whole plan set.

- **Plan** (`00`–`05`) = the design and its rationale. Source of truth for *what and why*.
- **These specs** = the executable contract. Source of truth for *do this, prove it works*.

Where a spec and the plan disagree, the plan wins and the spec is wrong — fix the spec. Where either
disagrees with a **recorded measurement** — `specs/baselines/hook-facts.md`, written by T0.01 — the
measurement wins: it is an observation, not an intention.

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
| Ask the user a question a spec names (T3.01 P3, T1.07 AC4) | orchestrator | `AskUserQuestion` |

On `changes_requested` the implementer fixes and the task returns to review. A task is `done` only on
an `approved` verdict. **The implementer never reviews its own work.**

If an AC turns out to be *wrong* (unverifiable, or testing the wrong thing), record that in
`Follow-ups discovered` and leave it unchecked rather than quietly rewriting the bar.

**How to run the AC commands.** They are written for a POSIX shell — the Bash tool (Git Bash on
Windows). Shell variables do not survive between Bash calls: where a spec sets `R=…`, `P=…`, `T=…`,
or `$SPIKE`, run the whole AC command in one call, or substitute the literal values. Commands that
run `claude -p` spend API budget; each caps it with `--max-budget-usd` and passes the prompt on stdin
(because `--allowedTools` takes several values and would swallow a trailing prompt argument).

## Evidence rules

The point of these specs is that "done" means *the behaviour exists*, not *the file exists*.
Two AC types, and the distinction is load-bearing:

| Type | Proves | Example |
|---|---|---|
| `structural` | A file/config/dependency is in place | `wc -c < dashboard/public/vendor/marked.umd.js` prints `46891`; `hooks/hooks.json` parses and lists four events |
| `behavioural` | A code path actually executes correctly at runtime | `curl` without the token gets `401` and with it gets the plan list; a headless browser clicks "Comment" and `review.json` on disk gains the comment |

**A task cannot be marked `done` on structural evidence alone.** Every spec must carry at least one
behavioural AC, verified with pasted output.

Concretely, for this task:

- ❌ "`server.mjs` contains `timingSafeEqual`" — structural only; the token could still be skipped on
  static routes.
- ✅ "`curl` of `/api/plans` and of `/static/app.css` without the token both return `401`, and with
  `Authorization: Bearer <token>` the first returns the fixture plan."
- ❌ "`record-event.mjs` exits 0" — passes even if it records nothing.
- ✅ "With a matching marker, a headless session that dispatches a subagent adds `SubagentStart` and
  `SubagentStop` lines to `events.jsonl`; with another session's marker it adds none."

Prefer an AC that would **fail if the change were reverted**. An AC that passes both before and
after the task is not testing the task. T1.02 AC3 and T2.02 AC3 go further: they break the code on
purpose to prove their test catches it, then restore it.

**Browser tests must not skip.** On the author's machine the UI tests run under headless Edge
(`00` B12). `# skipped 0` is part of every AC-REG from T2.01 on; a skip is not a pass.

## Waves and dependency graph

`taskify-implementer` runs one task at a time (`00` B14), so every wave is a strict sequence. Waves
are strictly ordered. `→` is sequential.

```
Wave 0   T0.01
Wave 1   T1.01 → T1.02 → T1.03 → T1.04 → T1.05 → T1.06 → T1.06b → T1.07 → T1.08 → T1.08b
Wave 2   T2.01 → T2.02 → T2.03 → T2.03b → T2.04
Wave 3   T3.01 → T3.02 → T3.02b → T3.03
Wave 4   T4.01 → T4.02 → T4.03 → T4.04 → T4.05
Wave 5   T5.01
```

**Collision rule:** two tasks may only run concurrently if their `touches:` lists are disjoint.
Before launching a wave, diff the `touches:` lists; if they overlap, serialise those two. Overlaps
between tasks in *different* waves are benign by construction — the waves are ordered.

An incomplete `touches:` list defeats this rule silently — agents writing the same file concurrently
clobber, they do not rebase. These files are genuinely multi-task; the order above already
serialises them:

| Shared file | Claimed by | Why |
|---|---|---|
| `dashboard/server.mjs` | T1.03, T1.04, T1.07 | read routes, then write routes, then an optional `X-Forwarded-Host` rule |
| `dashboard/cli.mjs` | T1.05, T1.06, T1.07 | lifecycle, then review/run commands, then tunnel |
| `dashboard/test/helpers.mjs` | T1.01, T1.03 | fixture copy, then server helpers |
| `dashboard/test/cli.test.mjs` | T1.05, T1.06 | T1.06 appends tests |
| `dashboard/public/index.html` | T1.03, T2.01 | minimal shell, then the real one |
| `dashboard/public/app.css` | T2.01, T2.02, T2.03 | shell, review, progress styles |
| `docs/dashboard/05-risks-and-open-decisions.md` | T0.01 | answers recorded in place |

## Task index

| ID | Phase | Title | Status | Review | Depends on |
|---|---|---|---|---|---|
| T0.01 | 0 | Measure what plugin hooks receive in a real session and record it as a baseline | done (3 review rounds) | approved | — |
| T1.01 | 1 | parse.mjs turns a taskify plan folder into structured data, tolerating broken files | done (follow-ups R-2..R-4 Minor) | approved | T0.01 |
| T1.02 | 1 | review-store.mjs reads and safely writes review.json, even with two writers at once | done (2 review rounds; follow-ups R-3, R-4, N-2) | approved | T1.01 |
| T1.03 | 1 | server.mjs serves the read API on 127.0.0.1 behind a mandatory token, with path safety | done (follow-ups R-1..R-5; R-4 security) | approved | T1.02 |
| T1.04 | 1 | The server accepts comments, resolutions and approvals, writing only review.json | done (Minor follow-ups R-1, R-2, R-4) | approved | T1.03 |
| T1.05 | 1 | cli.mjs starts a detached server once per repo, reuses it, and stops it cleanly on any OS | done (2 review rounds; follow-up R-3) | approved | T1.04 |
| T1.06 | 1 | cli.mjs gives skills one command each to read the review, resolve a comment, and mark a run | done (Minor follow-ups R-1..R-4) | approved | T1.05 |
| T1.06b | 1 | /api/file rejects a path that leaves the plan folder before touching the disk (inserted 2026-10-05, user-requested fix of T1.03 R-4) | done (2 review rounds) | approved | T1.06 |
| T1.07 | 1 | start --public opens a cloudflared or ngrok tunnel, or falls back to local with an install hint | done (AC4 deferred, cloudflared not installed, user-approved) | approved | T1.06 |
| T1.08 | 1 | Phase 1 gate — the server, store and CLI work end to end and leave the repo clean | done (62 tests; follow-ups F-1..F-3) | approved | T1.01–T1.07 |
| T1.08b | 1 | The login cookie is named per port, so two dashboards on 127.0.0.1 keep separate logins (inserted 2026-10-05, user decision) | done (2 review rounds) | approved | T1.08 |
| T2.01 | 2 | The dashboard page loads, lists plans, routes to a plan, and polls with a toggle | done (2 review rounds) | approved | T1.08 |
| T2.02 | 2 | The review view renders plan docs safely and lets a reviewer comment, resolve-view and approve | done (Minor follow-ups R-1..R-3, R-5) | approved | T2.01 |
| T2.03 | 2 | The progress view shows the board, waves, run state, log and live subagent activity, updating live | done (Minor follow-ups R-1..R-4; R-6 for T3.01) | approved | T2.02 |
| T2.03b | 2 | The dashboard page requests no favicon, so page loads log no 404 and the console-error tests are stable (inserted 2026-10-05, user decision) | done | approved | T2.03 |
| T2.04 | 2 | Phase 2 gate — both views work on the real plan set, at phone width, with no CSP errors | done (86 tests; real plan 24 cards at 375 px) | approved | T2.01–T2.03b |
| T3.01 | 3 | Plugin hooks append compact events during an active run and cost almost nothing otherwise | done (reopened once; empty .mjs timing baseline per user) | approved | T2.04 |
| T3.02 | 3 | Phase 3 gate — a real Claude Code session records subagent activity only when a run is active | done (real sessions; $0.75; foreground subagent unmeasured) | approved | T3.01 |
| T3.02b | 3 | The progress view's open subagents come from the whole events file, so busy or out-of-order agents are shown correctly (inserted 2026-10-05, user decision) | done (Minor follow-up R-1) | approved | T3.02 |
| T3.03 | 3 | A forgotten public dashboard still shuts itself down, and leaks less, before skills expose --public (inserted 2026-10-05, user decision) | done (Minor follow-ups R-1, R-2) | approved | T3.02b |
| T4.01 | 4 | /taskify:dashboard starts, stops and reports the dashboard from any session | done (R-1..R-3 applied post-approval) | approved | T3.03 |
| T4.02 | 4 | taskify --dashboard starts the dashboard (public with --public), and a revision resolves the comments it addressed | done (2 review rounds; injection check passed) | approved | T4.01 |
| T4.03 | 4 | taskify-implementer offers the dashboard, gates on review state, and marks the run for the hooks | done (R-1..R-5, O-3 applied post-approval) | approved | T4.02 |
| T4.04 | 4 | README, CHANGELOG, plugin.json and .gitignore describe and ship taskify 0.2.0 | done (2 review rounds; README N-1 follow-up) | approved | T4.03 |
| T4.05 | 4 | Phase 4 gate — taskify 0.2.0 validates, passes every test, and its dashboard runs from a real session | done (102 tests; real session) | approved | T4.01–T4.04 |
| T5.01 | 5 | The pre-release fixes are in, cloudflared is verified, and the plugin is versioned 1.0.0 (added 2026-10-05, user request) | done (2 review rounds; cloudflared verified) | approved | T4.05 |

`Status` carries its caveats inline rather than in a footnote — `done (AC4 deferred, cloudflared not
installed, user-approved)` is the useful form. `skipped` is a terminal status that satisfies a
downstream `depends_on`.

## Standing constraints for every task

This repo has no `CLAUDE.md` or `AGENTS.md`. These rules come from the plugin's own README, from
this plan, and — verbatim where quoted — from the author's global `~/.claude/CLAUDE.md`. They are
repeated here because subagents may not load them.

- **Never `git commit`, `push`, `amend`, `rebase`, or `reset`.** Leave changes in the working tree.
  (README: "Neither skill ever commits, pushes, or resets. Commits are yours.")
- Touch only what the spec's Scope authorises. Report adjacent problems as
  `Follow-ups discovered`; do not opportunistically fix them.
- **Zero npm dependencies.** Code imports only `node:` built-ins and files in this repo. The one
  vendored file is `dashboard/public/vendor/marked.umd.js`, unmodified. No `package.json`.
- **Runtime Node ≥ 20; dev and tests Node ≥ 22.** Do not use `fs.globSync` or other Node-22-only
  APIs in `dashboard/` or `hooks/` runtime code.
- **Works on Windows, macOS and Linux.** No POSIX-only signals or commands in code; spawn with
  `process.execPath` or a resolved executable, never `shell: true`; `windowsHide: true` on spawns.
- **The dashboard never edits a plan doc or a spec.** Its only write target is
  `<plan>/.taskify/review.json` (`00` §Goal).
- **Tests never write into the repo.** They copy fixtures to `os.tmpdir()` (`03` §3).
- **Never edit a user's `.gitignore` without a yes.** This repo's `.gitignore` changes only in T4.04.
- Test command: `node --test "dashboard/test/*.test.mjs"` (quoted glob). Validation:
  `claude plugin validate --strict .`.
- From the author's global CLAUDE.md, verbatim:
  - "Write the minimum code that solves the request."
  - "Handle errors that can really happen."
  - "Change only what the request needs. Every changed line should trace back to it."
  - "Match the existing style, even if you would do it differently."
  - "Remove imports, variables, and functions that your own changes made unused."
  - "If you see unrelated dead code or problems, mention them at the end and leave them in place."
  - "Use the Edit and Write tools for file changes. Do not generate shell or sed patch scripts, which break on quoting and escaping (especially on Windows)."
  - "For any command likely to run longer than 5 minutes (preflight, full regression, smokes), redirect output to a log file, e.g. `cmd > .logs/preflight.log 2>&1`, and run it in the background. Then check the log with `tail`. Never pipe long runs directly to `tail`."
  - "Secrets such as API keys go into env vars referenced from .mcp.json or settings, never inline."
