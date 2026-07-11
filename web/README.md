# Agent Monitor

Zero-dependency web UI to watch OpenCode agents in realtime: which agent runs
with which model, which sub-agents (subtasks) they spawn, live tool activity,
tokens and cost — rendered as a session tree.

## Run

1. Start the OpenCode server with CORS for the UI origin:

   ```sh
   opencode serve --port 4096 --cors http://127.0.0.1:8080
   ```

2. Serve this folder with any static file server:

   ```sh
   python3 -m http.server 8080 -d web
   # or: npx serve -l 8080 web
   ```

3. Open <http://127.0.0.1:8080>, keep the default server URL
   (`http://127.0.0.1:4096`) and hit **Connect**.

4. Run agents in another terminal (`opencode`), watch them appear live.

No build step, no dependencies — plain HTML/CSS/JS.

## Demo mode

Preview the UI without a running server: press **Demo** in the top bar, or open
<http://127.0.0.1:8080/?demo=1>. Synthetic planner/executor/explore sessions
with live tool events are generated locally.

## What it shows

| UI element | Source |
|---|---|
| Session tree (parent → sub-agent) | `Session.parentID` |
| Agent chip (colored) | `AssistantMessage.mode` |
| Model chip | `AssistantMessage.providerID` / `modelID` |
| Busy / idle / retry / error dot | `session.status`, `session.idle`, message activity |
| Tool line (`▶ bash — bun test`) | `message.part.updated` with `type: "tool"` |
| Subtask spawn (`↳ subtask → executor`) | part `type: "subtask"` (`agent`, `description`) |
| Tokens / cost | `AssistantMessage.tokens` / `.cost` (cost summed per session) |

Click a session card to open the message timeline (text, reasoning, tool calls,
subtask spawns) in the right panel.

## Endpoints used

- `GET /session` — backfill session list
- `GET /session/:id/message` — backfill message history (lazy, on select)
- `GET /event` — SSE bus (`session.*`, `message.updated`, `message.part.updated`)

## Notes

- The `executor` agent in this repo is `hidden: true` — its child sessions
  still appear here (hidden only affects the TUI).
- `OPENCODE_SERVER_PASSWORD` auth is not supported: browsers cannot attach
  headers to `EventSource`. Use it on localhost without a password.
- Sessions from the server are shown as-is; the 12 most recently updated get
  their badges hydrated on connect, the rest hydrate when clicked.
