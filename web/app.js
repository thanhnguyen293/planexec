/*
 * planexec agent monitor — zero-dependency web UI for `opencode serve`.
 *
 * Data sources:
 *   GET  {base}/session              backfill session list
 *   GET  {base}/session/:id/message  backfill messages ({info, parts}[])
 *   GET  {base}/event                SSE bus: session.*, message.*, ...
 *
 * Events consumed (shape per opencode SDK types):
 *   session.created / session.updated / session.deleted -> properties.info: Session
 *   session.idle                                        -> properties.sessionID
 *   session.status                                      -> properties.sessionID, properties.status
 *   message.updated                                     -> properties.info: Message
 *   message.part.updated                                -> properties.part: Part
 */

"use strict";

const $ = (sel) => document.querySelector(sel);

const els = {
  url: $("#server-url"),
  connectBtn: $("#connect-btn"),
  demoBtn: $("#demo-btn"),
  connDot: $("#conn-dot"),
  connLabel: $("#conn-label"),
  statSessions: $("#stat-sessions"),
  statActive: $("#stat-active"),
  statCost: $("#stat-cost"),
  tree: $("#tree"),
  empty: $("#empty"),
  serveHint: $("#serve-hint"),
  detailPane: $("#detail-pane"),
  detailTitle: $("#detail-title"),
  detailMeta: $("#detail-meta"),
  detailClose: $("#detail-close"),
  timeline: $("#timeline"),
};

const state = {
  base: localStorage.getItem("monitor.base") || "http://127.0.0.1:4096",
  es: null,
  demoTimer: null,
  connected: false,
  // sessionID -> session record
  sessions: new Map(),
  // sessionID -> Map(messageID -> { info, parts: Map(partID -> part) })
  messages: new Map(),
  loadedMessages: new Set(),
  selected: null,
  renderQueued: false,
};

/* ---------------- session records ---------------- */

function sessionRecord(id) {
  let s = state.sessions.get(id);
  if (!s) {
    s = {
      id,
      parentID: undefined,
      title: "",
      directory: "",
      timeUpdated: 0,
      agent: "",
      provider: "",
      model: "",
      cost: 0, // sum of assistant message costs
      costByMessage: new Map(),
      tokens: null, // last assistant message tokens
      status: "unknown", // busy | idle | retry | error | unknown
      lastActivity: 0,
      lastTool: null, // { name, status, title }
      lastSubtask: null, // { agent, description }
      error: null,
    };
    state.sessions.set(id, s);
  }
  return s;
}

function msgStore(sessionID) {
  let m = state.messages.get(sessionID);
  if (!m) {
    m = new Map();
    state.messages.set(sessionID, m);
  }
  return m;
}

/* ---------------- event handling ---------------- */

function applySessionInfo(info) {
  if (!info || !info.id) return;
  const s = sessionRecord(info.id);
  s.parentID = info.parentID;
  s.title = info.title || s.title;
  s.directory = info.directory || s.directory;
  s.timeUpdated = info.time?.updated || s.timeUpdated;
}

function applyMessage(info) {
  if (!info || !info.sessionID) return;
  const s = sessionRecord(info.sessionID);
  s.lastActivity = Date.now();
  if (s.status === "unknown" || s.status === "idle") s.status = "busy";

  const store = msgStore(info.sessionID);
  let entry = store.get(info.id);
  if (!entry) {
    entry = { info, parts: new Map() };
    store.set(info.id, entry);
  } else {
    entry.info = info;
  }

  if (info.role === "assistant") {
    // opencode calls the agent "mode" on the message; newer builds may use "agent"
    s.agent = info.mode || info.agent || s.agent;
    s.provider = info.providerID || s.provider;
    s.model = info.modelID || s.model;
    if (typeof info.cost === "number") {
      s.costByMessage.set(info.id, info.cost);
      s.cost = [...s.costByMessage.values()].reduce((a, b) => a + b, 0);
    }
    if (info.tokens && (info.tokens.input || info.tokens.output)) {
      s.tokens = info.tokens;
    }
    s.error = info.error ? info.error.name || "error" : null;
    if (s.error) s.status = "error";
  }
}

function applyPart(part) {
  if (!part || !part.sessionID) return;
  const s = sessionRecord(part.sessionID);
  s.lastActivity = Date.now();
  if (s.status !== "error") s.status = "busy";

  if (part.messageID) {
    const store = msgStore(part.sessionID);
    let entry = store.get(part.messageID);
    if (!entry) {
      entry = { info: { id: part.messageID, sessionID: part.sessionID, role: "assistant" }, parts: new Map() };
      store.set(part.messageID, entry);
    }
    entry.parts.set(part.id, part);
  }

  if (part.type === "tool") {
    s.lastTool = {
      name: part.tool,
      status: part.state?.status || "pending",
      title: part.state?.title || "",
    };
  } else if (part.type === "subtask") {
    s.lastSubtask = { agent: part.agent, description: part.description || "" };
  } else if (part.type === "agent") {
    s.lastSubtask = { agent: part.name, description: "" };
  }
}

function handleEvent(evt) {
  const { type, properties: p = {} } = evt || {};
  switch (type) {
    case "server.connected":
      backfill();
      break;
    case "session.created":
    case "session.updated":
      applySessionInfo(p.info);
      break;
    case "session.deleted":
      if (p.info?.id) {
        state.sessions.delete(p.info.id);
        state.messages.delete(p.info.id);
        state.loadedMessages.delete(p.info.id);
        if (state.selected === p.info.id) closeDetail();
      }
      break;
    case "session.idle": {
      const s = state.sessions.get(p.sessionID);
      if (s && s.status !== "error") s.status = "idle";
      break;
    }
    case "session.status": {
      const sid = p.sessionID || p.info?.id;
      if (!sid) break;
      const s = sessionRecord(sid);
      const st = typeof p.status === "string" ? p.status : p.status?.type;
      if (st === "busy" || st === "retry" || st === "idle") s.status = st;
      if (st === "busy" || st === "retry") s.lastActivity = Date.now();
      break;
    }
    case "message.updated":
      applyMessage(p.info);
      break;
    case "message.part.updated":
      applyPart(p.part);
      break;
    default:
      break;
  }
  scheduleRender();
}

/* ---------------- backfill ---------------- */

async function backfill() {
  try {
    const res = await fetch(state.base + "/session");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const list = await res.json();
    for (const info of list) applySessionInfo(info);

    // hydrate badges for the most recently active sessions
    const recent = [...list]
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
      .slice(0, 12);
    await Promise.allSettled(recent.map((info) => loadMessages(info.id, { silent: true })));
  } catch (err) {
    console.warn("backfill failed:", err);
  }
  scheduleRender();
}

async function loadMessages(sessionID, { silent = false } = {}) {
  if (state.demoTimer) return; // demo data is already local
  if (state.loadedMessages.has(sessionID)) return;
  state.loadedMessages.add(sessionID);
  try {
    const res = await fetch(state.base + "/session/" + sessionID + "/message");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const items = await res.json();
    const before = state.sessions.get(sessionID)?.status;
    for (const item of items) {
      const info = item.info || item; // SDK returns {info, parts}; be lenient
      applyMessage(info);
      for (const part of item.parts || []) applyPart(part);
    }
    // backfill must not fake liveness — restore pre-backfill status
    const s = state.sessions.get(sessionID);
    if (s) {
      s.status = before && before !== "unknown" ? before : s.error ? "error" : "idle";
      s.lastActivity = 0;
    }
  } catch (err) {
    state.loadedMessages.delete(sessionID);
    if (!silent) console.warn("loadMessages failed:", err);
  }
  scheduleRender();
}

/* ---------------- connection ---------------- */

function setConn(label, cls) {
  els.connLabel.textContent = label;
  els.connDot.className = "dot " + cls;
}

function disconnect() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  if (state.demoTimer) {
    clearInterval(state.demoTimer);
    state.demoTimer = null;
  }
  state.connected = false;
}

function connect() {
  disconnect();
  state.base = els.url.value.trim().replace(/\/+$/, "") || "http://127.0.0.1:4096";
  els.url.value = state.base;
  localStorage.setItem("monitor.base", state.base);

  state.sessions.clear();
  state.messages.clear();
  state.loadedMessages.clear();
  closeDetail();
  setConn("connecting…", "off");

  const es = new EventSource(state.base + "/event");
  state.es = es;
  es.onopen = () => {
    state.connected = true;
    setConn("connected", "on");
    backfill();
  };
  es.onerror = () => {
    state.connected = false;
    setConn("reconnecting…", "retry");
  };
  es.onmessage = (e) => {
    try {
      handleEvent(JSON.parse(e.data));
    } catch {
      /* ignore malformed frames */
    }
  };
}

/* ---------------- rendering ---------------- */

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  // setTimeout, not requestAnimationFrame: rAF pauses in background tabs,
  // freezing the monitor until refocused
  setTimeout(() => {
    state.renderQueued = false;
    render();
  }, 50);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function agentColor(name) {
  if (!name) return "#3d4450";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 38%)`;
}

function fmtTokens(t) {
  if (!t) return "";
  const total = (t.input || 0) + (t.output || 0);
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
  return `${k(total)} tok (${k(t.input || 0)}↑ ${k(t.output || 0)}↓)`;
}

function fmtCost(c) {
  if (!c) return "";
  return "$" + (c < 0.01 ? c.toFixed(4) : c.toFixed(2));
}

function relTime(ts) {
  if (!ts) return "";
  const d = Math.max(0, Date.now() - ts);
  if (d < 5000) return "now";
  if (d < 60000) return Math.floor(d / 1000) + "s ago";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}

function effectiveStatus(s) {
  if (s.status === "error") return "error";
  if (s.status === "retry") return "retry";
  // "busy" decays: no event for 10s -> treat as idle-looking
  if (s.status === "busy" && Date.now() - s.lastActivity < 10000) return "busy";
  return "idle";
}

const toolIcons = { pending: "…", running: "▶", completed: "✓", error: "✗" };

function cardHTML(s) {
  const st = effectiveStatus(s);
  const chips = [];
  if (s.agent) chips.push(`<span class="chip agent" style="background:${agentColor(s.agent)}">${esc(s.agent)}</span>`);
  if (s.model) chips.push(`<span class="chip model">${esc(s.provider ? s.provider + "/" : "")}${esc(s.model)}</span>`);
  if (s.tokens) chips.push(`<span class="chip tokens">${esc(fmtTokens(s.tokens))}</span>`);
  if (s.cost) chips.push(`<span class="chip cost">${esc(fmtCost(s.cost))}</span>`);

  let tool = "";
  if (s.lastTool) {
    const ts = s.lastTool.status;
    tool = `<div class="card-tool"><span class="tool-status ${esc(ts)}">${toolIcons[ts] || "·"}</span>` +
      `<span>${esc(s.lastTool.name)}</span>` +
      (s.lastTool.title ? `<span class="dim">— ${esc(s.lastTool.title)}</span>` : "") + `</div>`;
  }
  let subtask = "";
  if (s.lastSubtask && st === "busy") {
    subtask = `<div class="card-subtask">↳ subtask → <b>${esc(s.lastSubtask.agent)}</b>` +
      (s.lastSubtask.description ? ` · ${esc(s.lastSubtask.description)}` : "") + `</div>`;
  }

  return `<div class="card ${st}${state.selected === s.id ? " selected" : ""}" data-id="${esc(s.id)}">
    <div class="card-row1">
      <span class="dot ${st}"></span>
      <span class="card-title">${esc(s.title || s.id)}</span>
      <span class="card-time">${esc(relTime(s.timeUpdated))}</span>
    </div>
    <div class="card-row2">${chips.join("") || '<span class="chip">no messages yet</span>'}</div>
    ${tool}${subtask}
  </div>`;
}

function nodeHTML(s, byParent) {
  const kids = byParent.get(s.id) || [];
  const children = kids.length
    ? `<div class="children">${kids.map((k) => nodeHTML(k, byParent)).join("")}</div>`
    : "";
  return `<div class="node">${cardHTML(s)}${children}</div>`;
}

function render() {
  const all = [...state.sessions.values()];
  const byParent = new Map();
  const roots = [];
  for (const s of all) {
    if (s.parentID && state.sessions.has(s.parentID)) {
      const arr = byParent.get(s.parentID) || [];
      arr.push(s);
      byParent.set(s.parentID, arr);
    } else {
      roots.push(s);
    }
  }
  const byUpdated = (a, b) => (b.timeUpdated || 0) - (a.timeUpdated || 0);
  roots.sort(byUpdated);
  for (const arr of byParent.values()) arr.sort((a, b) => (a.timeUpdated || 0) - (b.timeUpdated || 0));

  els.tree.innerHTML = roots.map((s) => nodeHTML(s, byParent)).join("");
  els.empty.style.display = all.length ? "none" : "";

  const active = all.filter((s) => effectiveStatus(s) === "busy" || effectiveStatus(s) === "retry").length;
  els.statSessions.textContent = all.length;
  els.statActive.textContent = active;
  els.statCost.textContent = fmtCost(all.reduce((a, s) => a + s.cost, 0)) || "$0.00";

  if (state.selected) renderDetail();
}

/* ---------------- detail panel ---------------- */

function openDetail(id) {
  state.selected = id;
  els.detailPane.classList.remove("hidden");
  loadMessages(id);
  scheduleRender();
}

function closeDetail() {
  state.selected = null;
  els.detailPane.classList.add("hidden");
}

function partHTML(part) {
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
  switch (part.type) {
    case "text":
      return part.text ? `<div class="part-text">${esc(trunc(part.text, 600))}</div>` : "";
    case "reasoning":
      return part.text ? `<div class="part-reasoning">${esc(trunc(part.text, 300))}</div>` : "";
    case "tool": {
      const st = part.state?.status || "pending";
      return `<div class="part-tool"><span class="tool-status ${esc(st)}">${toolIcons[st] || "·"}</span>` +
        `<span><b>${esc(part.tool)}</b>${part.state?.title ? " · " + esc(trunc(part.state.title, 120)) : ""}` +
        (st === "error" && part.state?.error ? ` <span style="color:var(--red)">${esc(trunc(part.state.error, 160))}</span>` : "") +
        `</span></div>`;
    }
    case "subtask":
      return `<div class="part-subtask">↳ spawn <b>${esc(part.agent)}</b>` +
        (part.description ? `<div class="desc">${esc(trunc(part.description, 200))}</div>` : "") + `</div>`;
    case "agent":
      return `<div class="part-subtask">↳ agent <b>${esc(part.name)}</b></div>`;
    case "file": {
      const name = part.filename || part.file?.path || part.url || "";
      return name ? `<div class="part-tool"><span>📎 ${esc(trunc(name, 120))}</span></div>` : "";
    }
    default:
      // step-start / step-finish / snapshot / patch etc. — nothing to show
      return "";
  }
}

function renderDetail() {
  const s = state.sessions.get(state.selected);
  if (!s) return closeDetail();

  els.detailTitle.textContent = s.title || s.id;
  const chips = [];
  const st = effectiveStatus(s);
  chips.push(`<span class="dot ${st}" style="align-self:center"></span>`);
  if (s.agent) chips.push(`<span class="chip agent" style="background:${agentColor(s.agent)}">${esc(s.agent)}</span>`);
  if (s.model) chips.push(`<span class="chip model">${esc(s.provider ? s.provider + "/" : "")}${esc(s.model)}</span>`);
  if (s.cost) chips.push(`<span class="chip cost">${esc(fmtCost(s.cost))}</span>`);
  if (s.parentID) chips.push(`<span class="chip">child of ${esc((state.sessions.get(s.parentID)?.title || s.parentID).slice(0, 24))}</span>`);
  els.detailMeta.innerHTML = chips.join("");

  const store = state.messages.get(s.id);
  if (!store || !store.size) {
    els.timeline.innerHTML = `<div class="empty" style="padding:30px 10px">no messages loaded</div>`;
    return;
  }

  const ids = [...store.keys()].sort().slice(-80); // cap: long sessions stay snappy
  const html = ids.map((mid) => {
    const { info, parts } = store.get(mid);
    const head = [`<span class="role">${esc(info.role || "?")}</span>`];
    if (info.role === "assistant") {
      const agent = info.mode || info.agent;
      if (agent) head.push(`<span class="chip agent" style="background:${agentColor(agent)}">${esc(agent)}</span>`);
      if (info.modelID) head.push(`<span class="chip model">${esc(info.modelID)}</span>`);
      if (info.tokens && (info.tokens.input || info.tokens.output)) head.push(`<span class="chip tokens">${esc(fmtTokens(info.tokens))}</span>`);
      if (info.cost) head.push(`<span class="chip cost">${esc(fmtCost(info.cost))}</span>`);
    }
    const partIds = [...parts.keys()].sort();
    const body = partIds.map((pid) => partHTML(parts.get(pid))).filter(Boolean).join("");
    const error = info.error ? `<div class="msg-error">${esc(info.error.name || "error")}: ${esc(info.error.data?.message || "")}</div>` : "";
    // skip messages with nothing to show (only step/snapshot/patch parts):
    // they render as rows of empty boxes on real sessions
    if (!body && !error && head.length === 1) return "";
    return `<div class="msg"><div class="msg-head">${head.join("")}</div>` +
      (body ? `<div class="msg-body">${body}</div>` : "") + error + `</div>`;
  }).filter(Boolean).join("");

  // skip identical rebuilds so the timeline keeps its scroll position
  if (html !== state._timelineHTML) {
    const el = els.timeline;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const switched = state._timelineSession !== s.id;
    state._timelineHTML = html;
    state._timelineSession = s.id;
    el.innerHTML = html;
    // newest messages live at the bottom — follow them
    if (switched || nearBottom) el.scrollTop = el.scrollHeight;
  }
}

/* ---------------- demo mode ---------------- */

function startDemo() {
  disconnect();
  state.sessions.clear();
  state.messages.clear();
  state.loadedMessages.clear();
  closeDetail();
  setConn("demo", "on");

  const now = Date.now();
  const feed = (type, properties) => handleEvent({ type, properties });

  const mkSession = (id, title, parentID) =>
    feed("session.created", { info: { id, title, parentID, directory: "~/dev/planexec", time: { created: now, updated: Date.now() } } });

  const mkAssistant = (id, sessionID, mode, providerID, modelID, cost, input, output) =>
    feed("message.updated", {
      info: {
        id, sessionID, role: "assistant", mode, providerID, modelID, cost,
        tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      },
    });

  // root 1: planner orchestrating an executor + explore subagent
  mkSession("ses_root1", "TICKET-42: add retry to sync worker");
  mkAssistant("msg_r1a", "ses_root1", "planner", "anthropic", "claude-opus-4-8", 0.183, 24100, 3900);
  feed("message.part.updated", { part: { id: "prt_r1_1", messageID: "msg_r1a", sessionID: "ses_root1", type: "text", text: "Plan approved. Dispatching executor for step 1/4: add retry wrapper with exponential backoff to sync worker." } });
  feed("message.part.updated", { part: { id: "prt_r1_2", messageID: "msg_r1a", sessionID: "ses_root1", type: "subtask", agent: "executor", description: "Step 1: retry wrapper in worker/sync.ts" } });

  mkSession("ses_exec1", "Step 1: retry wrapper in worker/sync.ts", "ses_root1");
  mkAssistant("msg_e1a", "ses_exec1", "executor", "opencode-go", "deepseek-v4-flash", 0.006, 8200, 1400);
  feed("message.part.updated", { part: { id: "prt_e1_1", messageID: "msg_e1a", sessionID: "ses_exec1", type: "tool", tool: "edit", state: { status: "running", title: "worker/sync.ts" } } });

  mkSession("ses_explore1", "Locate sync worker call sites", "ses_root1");
  mkAssistant("msg_x1a", "ses_explore1", "explore", "opencode-go", "deepseek-v4-flash", 0.002, 5100, 600);
  feed("message.part.updated", { part: { id: "prt_x1_1", messageID: "msg_x1a", sessionID: "ses_explore1", type: "tool", tool: "grep", state: { status: "completed", title: "syncWorker( — 7 matches" } } });
  feed("session.idle", { sessionID: "ses_explore1" });

  // root 2: idle review session
  mkSession("ses_root2", "Review PR #18: install.sh bash fix");
  mkAssistant("msg_r2a", "ses_root2", "plan-reviewer", "anthropic", "claude-sonnet-5", 0.041, 12000, 2100);
  feed("session.idle", { sessionID: "ses_root2" });

  // periodic activity on the executor
  const tools = [
    ["bash", "bun test worker/"],
    ["read", "worker/sync.ts"],
    ["edit", "worker/sync.ts"],
    ["grep", "backoff"],
  ];
  let i = 0;
  let execTokens = 1400;
  state.demoTimer = setInterval(() => {
    i++;
    const [tool, title] = tools[i % tools.length];
    feed("message.part.updated", { part: { id: "prt_live_" + i, messageID: "msg_e1a", sessionID: "ses_exec1", type: "tool", tool, state: { status: i % 3 === 0 ? "completed" : "running", title } } });
    execTokens += 300;
    mkAssistant("msg_e1a", "ses_exec1", "executor", "opencode-go", "deepseek-v4-flash", 0.006 + i * 0.0015, 8200 + i * 900, execTokens);
    feed("session.updated", { info: { id: "ses_exec1", title: "Step 1: retry wrapper in worker/sync.ts", parentID: "ses_root1", time: { created: now, updated: Date.now() } } });
    if (i % 6 === 0) {
      feed("message.part.updated", { part: { id: "prt_r1_sub" + i, messageID: "msg_r1a", sessionID: "ses_root1", type: "subtask", agent: "executor", description: "Step " + (1 + (i / 6) % 4) + ": continue plan" } });
    }
  }, 2500);

  scheduleRender();
}

/* ---------------- wiring ---------------- */

els.url.value = state.base;
els.serveHint.textContent = `opencode serve --port 4096 --cors ${location.origin}`;
els.connectBtn.addEventListener("click", connect);
els.demoBtn.addEventListener("click", startDemo);
els.url.addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
els.detailClose.addEventListener("click", closeDetail);
// pointerdown, not click: the tree re-renders while agents stream events, and a
// rebuild between mousedown and mouseup would swallow the click
els.tree.addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".card");
  if (card) openDetail(card.dataset.id);
});

// keep relative times & busy-decay fresh
setInterval(scheduleRender, 2000);

if (new URLSearchParams(location.search).has("demo")) {
  startDemo();
} else {
  connect();
}
