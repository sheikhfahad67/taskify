# Target Layout, Data Shapes, API and CLI

This is the shape of the plugin after 0.2.0: the file tree, the four `.taskify/` files, the HTTP API
the UI calls, and the CLI the skills call. Specs reference these sections instead of restating them.
Where a spec and this doc disagree, this doc wins.

## 1. File tree

```
.claude-plugin/plugin.json          # version 0.1.0 -> 0.2.0 (03 §1)
.gitignore                          # + .taskify/ and the fixture negation (03 §2)
README.md                           # + dashboard section, --dashboard/--public flags, Node requirement
CHANGELOG.md                        # + 0.2.0 entry (03 §5)
hooks/
  hooks.json                        # SubagentStart, SubagentStop, PreToolUse, PostToolUse (03 §0)
  record-event.mjs                  # tiny recorder; exit 0 always
dashboard/
  server.mjs                        # HTTP server entry: auth, static, read API, write API, idle exit
  cli.mjs                           # start | stop | status | url | review | resolve | run-start | run-end
  lib/
    parse.mjs                       # frontmatter, specs, README index + waves, PROGRESS.md, events.jsonl
    review-store.mjs                # review.json read / lock / atomic write (server and CLI share it)
  public/
    index.html                      # shell; loads vendor/marked.umd.js, then app.js as a module
    app.css
    app.js                          # ES module: router (#/plan/<id>/review|progress), fetch, poll toggle;
                                    #   lazy-imports ./review.js and ./progress.js per route
    review.js                       # ES module: review view (doc list, rendered markdown, comments, approve)
    progress.js                     # ES module: progress view (run header, waves, board, activity, log)
    vendor/marked.umd.js            # marked 18.0.14, lib/marked.umd.js, unmodified (B2)
  test/
    fixtures/plan-basic/            # a small real plan set, incl. PROGRESS.md and .taskify/
    fixtures/fake-tunnel.mjs        # stands in for cloudflared in tunnel tests
    helpers.mjs                     # copy fixture to temp dir, start server on port 0, stop it
    browser.mjs                     # headless Edge/Chrome over the DevTools protocol (Node's built-in WebSocket)
    parse.test.mjs
    review-store.test.mjs
    server-read.test.mjs
    server-write.test.mjs
    cli.test.mjs
    tunnel.test.mjs
    ui-shell.test.mjs
    ui-review.test.mjs
    ui-progress.test.mjs
    record-event.test.mjs
skills/
  dashboard/SKILL.md                # new: /taskify:dashboard start|stop|status|url
  taskify/SKILL.md                  # + --dashboard/--public flags; reads/resolves comments when revising a plan
  taskify-implementer/SKILL.md      # + ask to open dashboard, review gate, run-start/run-end, resolve
```

### Not added

- **No `package.json`.** There are no dependencies to declare and `.mjs` makes every file an ES
  module. The test command is documented in `03` §3 and in the specs README.
- **No build step, no bundler, no TypeScript.** The UI files are served as written.
- **No server-side markdown rendering.** The server returns raw markdown; the browser renders it with
  marked. One renderer, one place to make it safe.
- **No `--open` (auto-open a browser).** The skills print the URL; terminals make it clickable.

## 2. `.taskify/` file shapes

All files are UTF-8 JSON (one object), except `events.jsonl` (one JSON object per line). Every
reader tolerates a missing, empty, or half-written file.

### 2a. `<project>/.taskify/dashboard.json`

Written by the server once it has bound a port; the CLI adds `tunnel`. Removed on stop and on idle
exit.

```json
{
  "pid": 12345,
  "port": 4317,
  "token": "<43 chars, base64url of 32 random bytes>",
  "root": "D:\\own-plugin\\taskify-plugin",
  "started_at": "2026-10-05T10:00:00.000Z",
  "tunnel": { "provider": "cloudflared", "pid": 12399, "url": "https://example.trycloudflare.com" }
}
```

`tunnel` is `null` when no tunnel runs.

### 2b. `<project>/.taskify/active-run.json` — the hook marker

Written by `cli.mjs run-start`, removed by `cli.mjs run-end`. Its presence is what turns the hooks on
(B7).

```json
{
  "plan": "D:\\own-plugin\\taskify-plugin\\docs\\dashboard",
  "session_id": "5ae5657a-1f27-48c9-a5d9-20558128603d",
  "started_at": "2026-10-05T10:00:00.000Z"
}
```

### 2c. `<plan>/.taskify/review.json`

```json
{
  "version": 1,
  "comments": [
    {
      "id": "c_3f9a1b2c",
      "file": "specs/tasks/T1.03-http-server-read-api.md",
      "anchor": "AC2 — Token is required on every route",
      "text": "Also cover the static files.",
      "author": "fahad",
      "created": "2026-10-05T10:00:00.000Z",
      "resolved": false,
      "resolved_at": null,
      "resolved_by": null,
      "resolution_note": null
    }
  ],
  "approvals": [
    { "at": "2026-10-05T11:00:00.000Z", "by": "fahad", "note": "" }
  ]
}
```

Rules:

- `id` is `c_` plus 8 lowercase hex characters from `crypto.randomBytes(4)`.
- `file` is relative to the plan folder, uses `/`, and must name a `.md` file inside it.
- `anchor` is the heading text without the leading `#`s, or `null` for a whole-file comment.
- `text` is 1–4000 characters; `author` and `note` are 0–60 and 0–500 characters.
- `resolved_by` is a free string such as `taskify-implementer` or `browser`.
- The plan counts as **approved** when `approvals` is non-empty. The latest approval is the one shown.
- Writes take a lock file `review.json.lock` (created with the `wx` flag; retry every 25 ms for up to
  2 s; a lock older than 5 s is stale and is removed), then write `review.json.<pid>.tmp` and rename
  it over `review.json`. A rename that fails with `EPERM`/`EBUSY` (Windows, file open by a reader) is
  retried up to 10 times, 20 ms apart.

### 2d. `<plan>/.taskify/events.jsonl`

One line per hook event, appended by `hooks/record-event.mjs`. Field names on the left are fixed;
where a value comes from hook stdin, T0.01's baseline (`specs/baselines/hook-facts.md`) names the
stdin field it is read from.

```json
{"t":"2026-10-05T10:00:01.000Z","ev":"PreToolUse","sid":"5ae5…","aid":"a1b2…","atype":"general-purpose","tool":"Bash","sum":"node --test \"dashboard/test/*.test.mjs\""}
```

| Field | Meaning |
|---|---|
| `t` | ISO time the hook ran |
| `ev` | `SubagentStart` \| `SubagentStop` \| `PreToolUse` \| `PostToolUse` |
| `sid` | session id from stdin |
| `aid`, `atype` | subagent id and type, or `null` when the event comes from the main session or stdin does not carry them |
| `tool` | tool name (tool events only) |
| `sum` | at most 120 characters: Bash `command`; Read/Edit/Write `file_path`; Grep/Glob `pattern`; Agent `subagent_type: description`; otherwise `""` |
| `ok` | PostToolUse only, and only if T0.01 found a success field in stdin |

Nothing else from the tool input or output is recorded. The file is emptied by `cli.mjs run-start`.

## 3. HTTP API

The server binds `127.0.0.1` only. Every route, static files included, requires the token (U3).

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/` | optional `?t=<token>` | With a correct `t`: `302` to `/`, setting cookie `taskify_t_<port>=<token>; HttpOnly; SameSite=Strict; Path=/` (`<port>` is the server's own bound port; plus `Secure` when `X-Forwarded-Proto: https`). With a valid cookie: `index.html`. Otherwise `401`. |
| GET | `/static/<file>` | — | A file from `dashboard/public/`, correct `Content-Type`. Path escape → `404`. |
| GET | `/api/health` | — | `{"ok":true,"pid":…,"port":…,"root":"…","bind":"127.0.0.1"}` |
| GET | `/api/plans` | — | `[{"id":"docs/dashboard","title":"…","tasks_total":20,"tasks_done":0,"run_state":"running"\|null,"mtime":"…"}]` |
| GET | `/api/plan?plan=<id>` | — | `{"id","title","docs":[{"path","kind"}],"tasks":[…],"waves":[…],"progress":{…}\|null,"events":[…last 200],"open_subagents":[{"aid","atype","started","last_tool","last_sum"}],"review":{…}}` — `open_subagents` is computed from the **whole** `events.jsonl`, not only the last 200 (user decision 2026-10-05, T3.02b) |
| GET | `/api/file?plan=<id>&path=<rel>` | — | raw markdown, `text/markdown; charset=utf-8` |
| POST | `/api/comments` | `{"plan","file","anchor","text","author"}` | `201` + the new comment |
| POST | `/api/comments/<cid>/resolve` | `{"plan","note"}` | `200` + the updated comment; unknown id → `404` |
| POST | `/api/approve` | `{"plan","note","author"}` | `201` + the new approval |

Auth and safety rules every route follows:

- **Token:** from the `taskify_t_<port>` cookie, or `Authorization: Bearer <token>` (used by the CLI and
  tests). Browsers do not scope cookies by port, so the name carries the port; two dashboards on
  127.0.0.1 then keep separate logins (user decision 2026-10-05, T1.08b). Other `taskify_t*`
  cookies in the request are ignored. Both sides are SHA-256 hashed, then compared with `crypto.timingSafeEqual`, so lengths
  always match. Missing or wrong → `401` with no body detail.
- **Plan ids are allow-listed.** `plan` must equal an id that `/api/plans` would return. Anything
  else → `404`.
- **File reads stay inside the plan.** `path` is resolved against the plan folder; both are passed
  through `fs.realpathSync.native`; the result must start with the plan's real path plus the path
  separator and end in `.md`. Otherwise `404`. This blocks `..`, absolute paths, and symlinks out.
- **Writes (POST):** need the token, `Content-Type: application/json`, and — when an `Origin` header
  is present — an `Origin` whose host equals the request's `Host`. Bodies over 64 KB → `413`. Bad
  JSON or a field out of range → `400`. Writes touch only `review.json`.
- **Headers on every response:** `Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors
  'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
  `Cache-Control: no-store` on `/api/*`.
- **Never crash on a bad file.** Each parsed file is cached by path with its `mtimeMs` and size. If a
  parse throws, the last good result is returned. Any unexpected error in a handler → `500`, and the
  server keeps running.

**Plan discovery** walks the root for `specs/tasks/README.md`, skipping `node_modules`, `.git`, and
`.taskify`, to a depth of 6. Each match's grandparent folder is one plan; its id is that folder's
path relative to the root, with `/`.

**What `/api/plan` derives, per spec file** (`specs/tasks/T*.md`, not `_TEMPLATE.md`): `id`,
`phase`, `title`, `status`, `depends_on`, `touches` from frontmatter; `ac_total` = number of
`### AC` headings; `ac_verified` = number of `- **Verified:** [x]` lines; `verdict` = the first word after
`- **Verdict:**` in `## Review record` (`pending`, `approved`, `changes_requested`); `fix_rounds` = number of
PROGRESS.md log rows for that task whose Event contains `changes_requested`. Waves come from lines
`Wave <n> …` in the README's wave graph code block, task ids matched by `T\d+\.\d+[a-z]?`.

## 4. CLI — `node dashboard/cli.mjs <command>`

Skills call these through Bash. Every command prints one JSON object on stdout and exits 0 on
success; a usage error exits 2.

| Command | Does |
|---|---|
| `start [--root <dir>] [--port <n>] [--public]` | Reuse a running server for `root` if `dashboard.json` exists and `/api/health` answers with the same pid; otherwise make a token, spawn `server.mjs` detached (token passed in the env var `TASKIFY_DASHBOARD_TOKEN`, never on the command line), and wait up to 5 s for `dashboard.json`. Default port 4317, trying up to 4326. With `--public`, also start a tunnel (`05` covers the tool fallback). Prints `{"url","public_url","pid","port","reused"}`. |
| `stop [--root <dir>]` | Kill the server (only after `/api/health` confirms the pid) and the tunnel (only if the process name contains `cloudflared` or `ngrok`), then remove `dashboard.json`. |
| `status [--root <dir>]` | `{"running":bool,"url","public_url","pid","port"}` |
| `url [--root <dir>]` | `{"url","public_url"}`; `running:false` if none |
| `review --plan <dir>` | `{"approved","approved_at","docs_changed_since_approval":[…],"open_comments":[…],"resolved_count"}`. `docs_changed_since_approval` lists `0N-*.md` plan docs (not specs) modified after the latest approval. |
| `resolve --plan <dir> --id <cid> [--note <text>] [--by <name>]` | Mark one comment resolved through `review-store.mjs`; works whether or not the server runs. Unknown id → exit 1. |
| `run-start --plan <dir> [--root <dir>] [--session <id>]` | Write `active-run.json` (session defaults to `CLAUDE_CODE_SESSION_ID`, B6) and empty `<plan>/.taskify/events.jsonl`. |
| `run-end [--root <dir>]` | Remove `active-run.json`. Missing file is not an error. |

`--root` defaults to the current directory. The server itself (`node dashboard/server.mjs --root
<dir> [--port <n> | --port-start <n>] [--idle-minutes <n>]`) is started by `cli.mjs start` and by
tests; `--port 0` lets the OS choose. It exits after `--idle-minutes` (default 240) with no request,
killing the tunnel recorded in `dashboard.json` and removing that file.
