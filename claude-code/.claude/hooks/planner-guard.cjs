#!/usr/bin/env node
/*
 * planner-guard.cjs
 *
 * Enforces the /planner workflow. While a planner session is "armed", the MAIN
 * (supervisor) agent is not allowed to edit code directly — only docs/plans/**.
 * All code changes must go through the executor subagent (which edits on a
 * ticket/<id> branch). This turns the soft prompt rules in
 * ~/.claude/commands/planner.md into a hard, hook-enforced constraint.
 *
 * Handles two hook events (dispatched by hook_event_name):
 *   - UserPromptSubmit : arms the lock on `/planner`, disarms on `/planner-off`.
 *   - PreToolUse       : blocks the main agent's Edit/Write while armed.
 *
 * Distinguishing main vs subagent: the PreToolUse payload includes `agent_id`
 * ONLY for tool calls made inside a subagent. So the executor (a subagent) is
 * always allowed; the main agent (no agent_id) is the one constrained.
 *
 * The lock is per-session (keyed by session_id) so it never leaks into other
 * conversations, and auto-expires after MAX_AGE_MS.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const LOCK_DIR = path.join(os.homedir(), '.claude', 'planner-locks');
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h stale-lock expiry

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function lockPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(LOCK_DIR, safe);
}

function arm(sessionId) {
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    fs.writeFileSync(lockPath(sessionId), String(Date.now()));
  } catch (_) {}
}

function disarm(sessionId) {
  try {
    fs.unlinkSync(lockPath(sessionId));
  } catch (_) {}
}

function isArmed(sessionId) {
  try {
    const p = lockPath(sessionId);
    const raw = fs.readFileSync(p, 'utf8');
    const stamp = Number(raw) || fs.statSync(p).mtimeMs;
    if (Date.now() - stamp > MAX_AGE_MS) {
      try { fs.unlinkSync(p); } catch (_) {}
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function allow() {
  // Silent allow: no output, exit 0.
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch (_) {
    process.exit(0);
  }

  const event = input.hook_event_name;
  const sessionId = input.session_id;

  if (event === 'UserPromptSubmit') {
    const prompt = String(input.prompt || '').replace(/^\s+/, '');
    // Check disarm first: "/planner-off" also starts with "/planner".
    if (/^\/planner-off\b/.test(prompt) || /\bplanner[-\s]?guard\s+off\b/i.test(prompt)) {
      disarm(sessionId);
    } else if (/^\/planner\b/.test(prompt) || prompt.includes('PLANNER_GUARD_ARM')) {
      arm(sessionId);
    }
    process.exit(0); // never block a prompt, add no context
  }

  if (event === 'PreToolUse') {
    if (!isArmed(sessionId)) allow();      // not inside a planner session
    if (input.agent_id) allow();           // subagent (e.g. the executor) — allowed

    const ti = input.tool_input || {};
    const target = ti.file_path || ti.notebook_path || ti.path || '';
    const cwd = input.cwd || process.cwd();
    const abs = target
      ? (path.isAbsolute(target) ? target : path.resolve(cwd, target))
      : '';
    const absPosix = abs.replace(/\\/g, '/');

    // Allow the plan itself: docs/plans/**
    if (absPosix && /(^|\/)docs\/plans\//.test(absPosix)) allow();

    // Safety-net: allow on a ticket/* branch (the executor switches to one
    // before editing). Only spawned while armed, so cost is negligible.
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      if (/^ticket\//.test(branch)) allow();
    } catch (_) {}

    deny(
      'Blocked by planner-guard: during a /planner session the supervisor must NOT edit code ' +
      'directly. Only docs/plans/** is writable here. Write the plan to docs/plans/<ticket-id>.md, ' +
      'then dispatch the executor subagent — it makes all code changes on a ticket/<id> branch. ' +
      '(If the user wants to edit directly, they can turn the guard off with /planner-off.)'
    );
  }

  process.exit(0);
}

main();
