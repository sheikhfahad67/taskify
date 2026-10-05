# Risks & Open Decisions

What can go wrong with the dashboard, and the questions not yet settled. Standing rule: when a risk
turns out wrong, or T0.01 answers a question, correct the entry **in place** (mark it answered and
state the result) — do not delete it.

## A public tunnel exposes the plan docs, specs, and activity log to anyone with the link

With `--public`, the plan folders (rendered docs, specs, PROGRESS.md) and `events.jsonl` (tool names
and up to 120 characters of each Bash command or file path) are reachable from the internet. A spec
can name internal hosts or paths; a Bash command can contain a secret passed on the command line.

**Mitigation:** tunnel off by default; only an explicit `--public` turns it on
(`/taskify:dashboard start --public` or `/taskify:taskify ... --public`), or the user picking
"Yes — public link" in the implementer's question — never plain `--dashboard` (T4.01–T4.03). The token is required on every
route, static files included (T1.03). `/api/file` serves only `.md` files inside allow-listed plan
folders. The dashboard skill prints a warning with the public URL. `stop` ends the tunnel. The hook
records a 120-character summary, never full tool input or output (T3.01).

## The API can write, so a leaked link can add comments and approve the plan

A comment or approval cannot change code or docs (the server writes only `review.json`), but a false
"approved" or a flood of comments could mislead the implementer's Step 2.

**Mitigation:** token on every POST; `Content-Type: application/json` required (forces a CORS
preflight cross-site); `Origin` must match `Host` when present; cookie is `SameSite=Strict` and
`HttpOnly`; 64 KB body limit; field length limits (`01` §2c). The implementer shows who approved and
when, and lists plan docs changed after the approval (`cli.mjs review`). Owned by T1.04, T1.06.

## Rendered markdown could run script in the dashboard page

A plan doc can contain raw HTML (`<script>`, `<img onerror>`) or a `javascript:` link. marked does
not sanitise. Script in the page could read data and send POSTs with the cookie.

**Mitigation:** marked is configured to escape raw HTML tokens instead of passing them through
(T2.02). The CSP `script-src 'self'` with no `unsafe-inline` blocks inline scripts, inline event
handlers, and `javascript:` URLs even if escaping misses a case (T1.03). `ui-review.test.mjs` proves a
`<script>` in a fixture doc shows as text (T2.02).

## Plugin hooks add cost to every tool call in every session

**Answered by T0.01:** `"async": true` works (a 3 s hook did not delay the next tool call), so the entries become async per `03` §0. A no-op Node hook measured 54.4 ms median, 59.5 ms max (spawn wall time, 10 runs). See `specs/baselines/hook-facts.md`.

Plugin hooks fire in every session where taskify is enabled, not only during a run. Measured: a
no-op Node launch is 58 ms median (B4); with PreToolUse and PostToolUse that is about 116 ms per
tool call. Hooks are synchronous unless T0.01 shows `"async": true` works.

**Mitigation:** the script checks the marker with `existsSync` before reading stdin, and imports
only `node:fs` and `node:path` (`03` §0). T0.01 measures the real in-session cost; T3.01 has an AC
that a no-marker run exits 0 within 150 ms median on the author's machine. If async works, the
entries become async (`03` §0).

## Is PreToolUse worth its cost? (open)

PreToolUse is what shows a tool *while it is running* (a long Bash command). PostToolUse alone shows
it only after it ends, and halves the overhead. **Decided by the user** at T3.01, using T0.01's
in-session numbers. Until then the plan keeps both (U5).

## A hook that errors could block or clutter tool calls

**Answered by T0.01:** on Windows, hook commands run under Git Bash (`$0` = `/usr/bin/bash`), so `node "…" 2>/dev/null || true` is a valid wrapper. Whether a missing `node` shows a visible error was not measured. See `specs/baselines/hook-facts.md`.

On PreToolUse, exit code 2 blocks the tool; other non-zero codes show an error. If `node` is missing
from `PATH`, the command itself fails on every tool call, in every session.

**Mitigation:** the script exits 0 on every path and writes nothing to stdout/stderr (`03` §0,
T3.01 tests malformed stdin, missing plan folder, unwritable file). `timeout: 5` caps a hang. The
README states the Node requirement. **Open:** whether a missing `node` produces a visible error on
every call — T0.01 records which shell runs hook commands on Windows; if it is a POSIX shell, T3.01
may wrap the command as `node "…" 2>/dev/null || true`, and records the choice.

## A stale marker could make hooks record in later sessions

**Answered by T0.01:** `session_id` inside a subagent equals the main session's, so matching the marker on `session_id` alone keeps subagent events; no parent-id rule is needed. See `specs/baselines/hook-facts.md`.

If a run crashes, `active-run.json` stays. Every later session in that project would then pay the
full hook cost and write events.

**Mitigation:** the marker carries `session_id` (B6); the hook records only when stdin `session_id`
matches it. The implementer removes the marker on complete, pause, and stop, and rewrites it on
resume (T4.03). **Depends on T0.01 (a):** if a subagent's tool calls carry a different
`session_id`, matching on session alone would drop them; T3.01 then matches on the rule T0.01
records (for example, session id or parent session id).

## Do subagent tool calls reach plugin hooks, and can we tell which subagent made them? (open — T0.01)

**Answered by T0.01:** yes. PreToolUse/PostToolUse fire inside subagents, and their stdin carries `agent_id` and `agent_type` (absent in the main session). The negative-branch fallback below is therefore **not** the plan of record; tool hooks stay. See `specs/baselines/hook-facts.md`. (measured on a background-launched subagent only; foreground unconfirmed — see specs/baselines/hook-facts.md)

Not documented. If PreToolUse/PostToolUse do not fire inside subagents, or stdin does not identify
the subagent, the live view cannot show per-subagent tool activity.

**Fallback (plan of record if T0.01 is negative):** record only `SubagentStart`/`SubagentStop` and
show them next to the PROGRESS.md current task and step. The tool hooks are then dropped from
`hooks.json` (no cost for no value), and T2.03's activity panel shows subagents only. T0.01 writes
which branch applies here.

## What fields do SubagentStart and SubagentStop send? (open — T0.01)

**Answered by T0.01:** both name the agent type. SubagentStart: `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type, hook_event_name`. SubagentStop adds `permission_mode, effort, stop_hook_active, agent_transcript_path, background_tasks, session_crons`. `atype` comes from `agent_type`. See `specs/baselines/hook-facts.md`. (measured on a background-launched subagent only; foreground unconfirmed — see specs/baselines/hook-facts.md)

Not documented. T3.01 maps fields only from what T0.01 recorded. If neither event names the agent
type, `atype` is `null` and the UI shows "subagent".

## Can a context: fork skill use AskUserQuestion? (open — not blocking)

**Answered by T0.01:** not measured — it cannot be measured headless, and the design does not depend on it (U1).

Not documented. The design does not depend on it: `taskify` never asks (U1). T0.01 records the
answer if it can be measured headless, else records "not measured".

## Detached processes can outlive the session that started them

The server and tunnel are detached so they survive the skill's Bash call. They also survive the
Claude Code session, and keep a public URL open if `--public` was used.

**Mitigation:** idle exit after 240 minutes with no request, which also kills the tunnel (`01` §4,
T1.03). `status` shows what is running; `stop` kills both. The implementer offers to stop the
dashboard when the run completes (T4.03).

## Windows has no POSIX signals, and a killed server cannot clean up its tunnel

On Windows `process.kill(pid)` is a hard terminate: no handler runs, so the server cannot kill its
tunnel on `stop`. A recorded pid can also be reused by an unrelated process after a reboot.

**Mitigation:** `cli.mjs stop` kills both pids itself. It kills the server pid only after
`/api/health` (with the token) returns that same pid, and the tunnel pid only if the process name
contains `cloudflared` or `ngrok` (`tasklist /FI "PID eq <pid>" /FO CSV /NH` on Windows,
`ps -p <pid> -o comm=` elsewhere). Spawns use `process.execPath`, `detached: true`,
`stdio: 'ignore'`, `windowsHide: true`, and no shell. No `kill -9`, `lsof`, or `&` in code. Owned by
T1.05, T1.07.

## cloudflared is not installed on the author's machine (B3)

The default tunnel tool is missing here; ngrok is installed with a valid config. Users may have
neither. ngrok v3 needs a free account authtoken.

**Mitigation:** `start --public` tries `cloudflared --version`, then `ngrok version`. With neither,
it prints install hints (`winget install --id Cloudflare.cloudflared`, `brew install cloudflared`,
or the cloudflared downloads page) and keeps the local server running, exit 0, `public_url: null`
(T1.07).

## Should the cloudflared path be verified by installing it on the author's machine? (open)

T1.07 can prove the ngrok path and the "no tool" path here. Proving the cloudflared path needs
`cloudflared` installed, which changes the user's machine. **Decided by the user** when T1.07 runs:
install it (then T1.07's cloudflared AC runs), or leave that AC unchecked and record it as a known
gap in T1.07's completion record.

## Two writers can race on review.json

The server (a browser comment) and `cli.mjs resolve` (Claude) can write at the same moment.
Read-modify-write without a lock loses one update. On Windows, renaming over a file a reader holds
open can fail with `EPERM`.

**Mitigation:** lock file plus atomic rename plus rename retry (`01` §2c), shared by server and CLI
through `review-store.mjs`. T1.02 proves it: two processes each add 20 comments at once and the file
ends with 40 valid comments.

## The token is stored in plain text in .taskify/dashboard.json

The CLI needs it to print the URL again (`url`) and to call `/api/health`. Anyone who can read the
project folder can read it.

**Mitigation:** accepted — anyone who can read the folder can read the plan docs directly. The file
is removed on stop and idle exit. It sits under `.taskify/`, which the implementer suggests
ignoring. The token never goes on a command line (env var), so it does not appear in process lists.

## Node must be installed on the user's machine

The server, CLI, and hooks all run `node`. Claude Code itself does not guarantee Node on `PATH`.

**Mitigation:** README and CHANGELOG state "Node 20 or newer" (T4.04). The dashboard skill runs
`node --version` first and prints a clear message if it fails (T4.01). Hook behaviour without Node
is covered above.

## .taskify/ should be gitignored in the user's repo, but the plugin must not edit .gitignore unasked

`review.json` and `events.jsonl` are local state; committing them is noise, and `dashboard.json`
holds the token.

**Decision:** the implementer checks `git check-ignore -q .taskify/` at run start. If not ignored, it
asks once (`AskUserQuestion`) whether to append `.taskify/` to the repo's `.gitignore`, and edits it
only on "yes" (T4.03). It never edits `.gitignore` silently. This repo's own `.gitignore` is changed
by T4.04 (`03` §2).

## UI behavioural checks depend on a local browser

The `ui-*.test.mjs` files need headless Edge or Chrome (B12). Edge is present on the author's Windows machine.
On a machine without one, the UI tests skip.

**Mitigation:** a skip prints its reason and is not a pass: T2.02–T2.04 ACs require the UI tests to
show `# skipped 0` on the author's machine.
