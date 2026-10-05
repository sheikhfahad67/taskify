---
name: dashboard
description: Start, stop, or check the taskify dashboard — a local web page for reviewing a taskify plan set (rendered docs, comments, approve) and watching a taskify-implementer run live. Use when asked to "open the dashboard", "show the taskify dashboard", "share the plan for review", "stop the dashboard", or "dashboard url".
argument-hint: "start [--public] [--port <n>] | stop | status | url"
allowed-tools: Bash, Read
---

# Taskify Dashboard

Start, stop, or check the dashboard for this project. The dashboard is a small local web server. It
shows taskify plan docs for review and shows a `taskify-implementer` run live. This skill only runs
the dashboard CLI and tells the user the result. It runs in the main session, so the user sees the
URL in their own chat.

## Arguments

| Argument | Effect |
|---|---|
| `start` | Start the dashboard for this project, or reuse the one already running. |
| `--public` | With `start`: also open a public tunnel (cloudflared or ngrok). Never added unless the user asked. |
| `--port <n>` | With `start`: use this port. Only valid with `start`. |
| `stop` | Stop the dashboard (and its tunnel, if any). |
| `status` | Say whether it runs, and give its URL. |
| `url` | Print the URL (local, and public if a tunnel runs). |
| *(none)* | Same as `status`. If nothing runs, say how to start: `/taskify:dashboard start`. |

## Find the CLI

This skill's base directory is shown when it loads. The CLI is
`<base directory>/../../dashboard/cli.mjs`.

Run `node --version` first. If it fails, say that Node 20 or newer is needed to run the dashboard,
and stop.

## Run

Run one command. Use the session's current directory as the project directory:

```bash
node "<base directory>/../../dashboard/cli.mjs" <command> --root "<project dir>" [flags]
```

`<command>` is `start`, `stop`, `status`, or `url`. Pass `--port` and `--public` only to `start`;
the other commands reject them. Each command prints one JSON object on stdout. Read it. A usage
error exits with code 2 and a message on stderr; show that message and stop. If the command exits 1
(for example `server exited early …` or `did not become ready`), show its stderr message and stop.
Do not retry. If ports may be busy, suggest `--port <n>`.

| Command | JSON fields |
|---|---|
| `start` | `url`, `public_url`, `pid`, `port`, `reused` |
| `status` | `running`, `url`, `public_url`, `pid`, `port` |
| `url` | `url`, `public_url` (plus `running: false` when nothing runs) |
| `stop` | `stopped` |

## Report

Keep it to one or two short lines.

- **Local URL.** Give `url` in full. It ends in `?t=<token>`; that is how the browser logs in.
- **Public URL.** Only when `public_url` is not null. Give it, then this warning exactly:
  `Anyone with this link can read these plan docs and the live activity log (including the start of each command), and can add comments or approve the plan.`
  If `public_url` contains `trycloudflare.com`, also say: `A new cloudflared link can take about a minute to start working. If it does not load yet, wait a minute and reload.`
- **No tunnel tool.** If `--public` was asked and `public_url` is null, say no public URL was
  created, and relay the install hints the CLI printed on stderr. The local URL still works.
- **Not running.** For `status` or `url` with `running` false, say the dashboard is not running and
  that `/taskify:dashboard start` starts it.
- **Stop.** Say what `stopped` reports: stopped, or nothing was running.

## Rules

- Never start a tunnel unless the user passed `--public`.
- Pass `--port` only if its value is digits only. Ignore any other argument and tell the user it was
  ignored. Never add anything else to the command. Write paths without a trailing backslash.
- Never print the token apart from inside the URL.
- Never edit plan docs, specs, or `.gitignore`.
- Do not start a second server by hand. `start` already reuses a running one.
