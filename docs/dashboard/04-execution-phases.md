# Execution Phases

An ordered rollout in five phases. Each phase ends in a known-good state with its own verify step,
and nothing in a later phase is needed for an earlier one to work. Tasks run one at a time (B14), so
the wave graph in the specs README only fixes order.

The order follows risk. Phase 0 measures the Claude Code facts the hook design leans on, before any
hook code exists. Phases 1–2 build the server and UI against fixtures, with no Claude Code
dependency at all. Phase 3 adds hooks once their input is known. Phase 4 wires the skills last,
because the skills only call CLI commands that already exist and are tested.

## Phase 0 — Measure the hook and skill facts (spike)

T0.01 builds a throwaway plugin in a temp folder (outside this repo) whose hooks dump their stdin and
environment to files, and runs it headless with `claude -p --plugin-dir <tmp> --max-budget-usd 1`
using a prompt that runs a Bash command, then dispatches a `general-purpose` subagent that runs one
too. It records in `specs/baselines/hook-facts.md`:

- (a) whether `PreToolUse`/`PostToolUse` fire for tool calls inside a subagent, and which stdin
  fields (if any) identify the subagent; whether `session_id` there equals the main session's;
- (b) the stdin fields of `SubagentStart` and `SubagentStop`;
- (c) whether a `context: fork` skill can call `AskUserQuestion` — measured only if it can be done
  headless; the design does not depend on it (U1);
- (d) whether `"async": true` stops a hook that sleeps 3 s from delaying the tool call (B5);
- the in-session cost of a no-op Node hook (B4), whether `CLAUDE_PROJECT_DIR` and
  `CLAUDE_PLUGIN_ROOT` are set for hooks and in the Bash tool (B9), stdin `cwd`, and which shell runs
  hook commands on Windows.

It then corrects `05` in place: each open question it answers is marked answered, with the result.

**Verify:** `specs/baselines/hook-facts.md` exists and has a filled row for each of (a)–(d) and the
extra facts, each row quoting the raw stdin or timing it came from. If (a) is negative, `05` names
the fallback (start/stop plus PROGRESS.md steps only) as the plan of record.

## Phase 1 — Data and server (no UI, no Claude Code needed)

- **T1.01** `dashboard/lib/parse.mjs` and the `plan-basic` fixture: frontmatter, spec ACs and
  verdict, README task index and waves, PROGRESS.md fields and log, events.jsonl with a broken last
  line (`01` §3).
- **T1.02** `dashboard/lib/review-store.mjs`: tolerant read, add comment, resolve, approve; lock plus
  atomic rename (`01` §2c), proven by two processes writing at once.
- **T1.03** `dashboard/server.mjs` read side: token auth, cookie flow, static files, `/api/health`,
  `/api/plans`, `/api/plan`, `/api/file` with path safety, security headers, last-good cache,
  `dashboard.json`, idle exit (`01` §3).
- **T1.04** write side: `POST /api/comments`, `/resolve`, `/api/approve`, with CSRF and size checks.
- **T1.05** `dashboard/cli.mjs` lifecycle: `start` (detached, reuse, port fallback), `stop`,
  `status`, `url` (`01` §4).
- **T1.06** `cli.mjs` review/run commands: `review`, `resolve`, `run-start`, `run-end`.
- **T1.07** `start --public`: cloudflared, then ngrok, else a printed install hint and a local-only
  server.
- **T1.08** phase gate.

**Verify:** `node --test "dashboard/test/*.test.mjs"` reports `# fail 0`; `node dashboard/cli.mjs
start --root <fixture copy>` then `curl` of `/api/plans` with the token returns the fixture plan and
without it returns `401`; `stop` leaves no server process (`/api/health` connection refused).

## Phase 2 — UI (review view, progress view)

- **T2.01** `dashboard/public/` shell: `index.html`, `app.css`, `app.js` (hash router, plan picker,
  poll toggle stored in `localStorage` inside `try/catch`), vendored `marked.umd.js` (B2).
- **T2.02** `review.js`: doc list, rendered markdown with raw HTML escaped, heading anchors with a
  comment button, comment list and form, resolved toggle, "Approve plan" with approval status.
- **T2.03** `progress.js`: run header (state, current task and step, last updated, resume note),
  waves row, board with seven status columns plus "other", cards with AC x/y, verdict and fix
  rounds, live activity (open subagents and recent tool events), log timeline.
- **T2.04** phase gate.

**Verify:** the `ui-*.test.mjs` files pass under headless Edge with `# skipped 0`: the review view
shows the fixture's rendered H1 and its open comment, a `<script>` in a fixture doc appears as text
and does not run, a comment typed and posted in the page lands in `review.json`, and the progress
view shows one card per fixture spec in the right column and moves a card when its status changes
on disk. T2.04 repeats the check on the real `docs/dashboard` plan at 375 px wide.

## Phase 3 — Hook event capture

- **T3.01** `hooks/hooks.json` (`03` §0) and `hooks/record-event.mjs`, mapping stdin fields as
  recorded by T0.01, with unit tests that spawn the script with fake stdin.
- **T3.02** phase gate, in a real session: `claude -p --plugin-dir .` with an active-run marker
  dispatches a subagent; `events.jsonl` gains `SubagentStart`/`SubagentStop` (and tool events if
  T0.01 found them); without the marker it gains nothing.

**Verify:** the T3.02 runs above (matching marker records; another session's marker and no marker
record nothing), plus T3.01 AC3: an event written by the hook is returned by `/api/plan`.

## Phase 4 — Wiring and release

- **T4.01** `skills/dashboard/SKILL.md` (`03` §4): parses `start [--public] [--port]`, `stop`,
  `status`, `url`; runs `cli.mjs` located from its base directory (B9); prints the URL and, for
  `--public`, a warning that anyone with the link can read the plan docs and write comments.
- **T4.02** `skills/taskify/SKILL.md`: `--dashboard` flag (local start after writing docs) and `--public`
  (also opens the tunnel; implies `--dashboard`); when it
  revises an existing plan folder, it reads open comments and resolves the ones it addressed.
- **T4.03** `skills/taskify-implementer/SKILL.md`: dashboard question, review gate in Step 2 (`cli.mjs
  review`), `run-start`/`run-end` around Step 3 and on stop/pause/complete, `resolve` after
  addressing a comment, and the `.taskify/` gitignore suggestion (ask, never edit unasked).
- **T4.04** release files: `README.md`, `CHANGELOG.md` (`03` §5), `plugin.json` (`03` §1),
  `.gitignore` (`03` §2).
- **T4.05** phase gate.

**Verify:** `claude plugin validate --strict .` exits 0; `node --test "dashboard/test/*.test.mjs"`
reports `# fail 0`; a headless `claude -p --plugin-dir . "/taskify:dashboard start"` prints a
`http://127.0.0.1:` URL that answers `/api/health` with the token, and `/taskify:dashboard stop`
ends it.
