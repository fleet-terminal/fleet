"use strict";
// Shared helpers for the Fleet Terminal Claude-session status layer.
// The Claude Code hooks write a per-session state file; Fleet Terminal reads
// it and renders one sidebar row per session. This module owns the state
// model, the MCP-server -> glyph map, the state file I/O, and describe().
//
// Vendored from omr-terminal-setup and kept as-is: it is the shared
// contract between the hooks and the (Swift) renderer. The Swift side ports
// STATE_EMOJI / colorHexFor / MCP_GLYPHS / describe from here.

const fs = require("fs");
const os = require("os");
const path = require("path");

// `~/.fleet`, not `~/.claude` and not `process.env.CLAUDE_CONFIG_DIR`.
//
// This directory is not Claude's data. It is the join table between a Fleet
// pane and an agent session, read by one FSEvents watch on the Fleet side —
// and Codex's and Antigravity's plugins write into the same place, which is
// most of the reason it is no longer named after Claude. Honouring
// CLAUDE_CONFIG_DIR would scatter it across as many directories as a machine
// has config roots, each needing its own watch, discovered while Fleet is
// already running, for no gain to anyone.
//
// Fleet still reads the old `~/.claude/session-status/state` as well, so a
// session that was open across an update — running the copy of these scripts
// that was on disk when it started — keeps reporting. See `FleetState`.
const STATE_DIR = path.join(os.homedir(), ".fleet", "session-status", "state");

// state values: "working" | "mcp" | "wait" | "perm" | "ask" | "plan" | "pr" | "idle"
// A session is "blocked on you" for: wait, perm, ask, plan, idle.
// "ask" = an AskUserQuestion prompt (a multiple-choice question) and "plan" = a
// written plan waiting to be read — both distinct from "perm" (a genuine
// tool-permission grant) even though Claude Code reports all three as
// notification_type "permission_prompt".
const STATE_EMOJI = {
  working: "⏳",
  mcp: "🔌",
  wait: "🟡",
  perm: "🔴",
  ask: "❓",
  plan: "📋",
  pr: "✅",
  idle: "🟡",
};

const MCP_GLYPHS = [
  ["slack", "💬"],
  ["stripe", "💳"],
  ["linear", "📐"],
  ["metabase", "📊"],
  ["mezmo", "📜"],
  ["mixpanel", "📈"],
  ["statsig", "🚩"],
  ["pagerduty", "🚨"],
  ["newrelic", "📡"],
  ["intercom", "🎧"],
  ["notion", "📔"],
  ["figma", "🎨"],
  ["chrome", "🌐"],
  ["gmail", "📧"],
  ["calendar", "📅"],
  ["drive", "📁"],
  ["github", "🐙"],
  ["aws", "☁️"],
];

function classifyMcp(toolName) {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  const server = (parts[1] || "").toLowerCase();
  for (const [needle, glyph] of MCP_GLYPHS) {
    if (server.includes(needle)) return { glyph, label: shortServer(server) };
  }
  return { glyph: "🔌", label: shortServer(server) };
}

function shortServer(server) {
  let s = server
    .replace(/^plugin_[a-z0-9]+_/, "")
    .replace(/^claude_ai_/, "")
    .replace(/^claude-/, "")
    .replace(/-server$/, "");
  for (const [needle] of MCP_GLYPHS) {
    if (s.includes(needle)) return needle;
  }
  return s;
}

function stateFile(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(STATE_DIR, `${safe}.json`);
}

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), "utf8"));
  } catch {
    return {};
  }
}

// ~ is drwxr-xr-x on macOS, so a 0644 file underneath it is readable by every
// other local account — and these carry working directories, session names,
// branches and transcript paths. Everything here is written 0600 into a 0700
// directory.
let stateDirReady = false;

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  // mkdirSync leaves an existing directory's mode alone and earlier versions
  // created this one 0755, so fix it — once per process, not once per write.
  if (!stateDirReady) {
    try {
      fs.chmodSync(STATE_DIR, 0o700);
    } catch {
      /* ignore */
    }
    stateDirReady = true;
  }
}

/// Write one state-directory file 0600, via a temp file and a rename.
///
/// The mode goes on the temp file rather than the destination: the rename
/// swaps the inode, so a 0644 file an earlier version left behind is replaced
/// rather than chmod'ed. Throws; callers decide what that means.
function writePrivateAtomic(file, data) {
  ensureStateDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  // `mode` only applies on create, and this process may have written this same
  // temp path before.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

function writeState(sessionId, obj) {
  writeJSONAtomic(stateFile(sessionId), obj);
}

// Write to a temp file and rename, rather than truncating in place. Fleet
// Terminal re-reads this directory on an FSEvent, and the event fires on the
// truncate — so a plain writeFileSync gives it a window in which the file is
// empty. It cannot decode that, the session drops out of the scan, and the
// sidebar row blanks until something writes again.
function writeJSONAtomic(file, obj) {
  try {
    writePrivateAtomic(file, JSON.stringify(obj));
  } catch {
    /* best effort */
  }
}

function clearState(sessionId) {
  try {
    fs.unlinkSync(stateFile(sessionId));
  } catch {
    /* ignore */
  }
}

function colorHexFor(state) {
  switch (state) {
    case "perm":
      return "#e74c3c";
    // A plan shares the question colour: both are Claude asking you something,
    // and neither is the brick red kept for a tool-permission grant.
    case "ask":
    case "plan":
      return "#a970ff";
    case "wait":
    case "idle":
      return "#ffb000";
    case "pr":
      return "#2ecc71";
    case "mcp":
      return "#3498db";
    case "working":
      return "#8a8f98";
    default:
      return "#8a8f98";
  }
}

function glyphForServer(label) {
  const s = String(label || "").toLowerCase();
  for (const [needle, glyph] of MCP_GLYPHS) {
    if (s.includes(needle)) return glyph;
  }
  return "🔌";
}

function shortMode(m) {
  switch (m) {
    case "plan":
      return "plan";
    case "acceptEdits":
      return "auto";
    case "bypassPermissions":
      return "bypass";
    case "default":
      return "";
    default:
      return m || "";
  }
}

function describe(st) {
  const state = st && st.state;
  const extra = st && st.extra;
  const needsYou =
    state === "perm" || state === "ask" || state === "plan" || state === "wait" || state === "idle";
  const mode = shortMode(st && st.mode);
  if (state === "mcp") {
    return { state, emoji: glyphForServer(extra), label: extra || "mcp", colorHex: colorHexFor("mcp"), needsYou: false, mode };
  }
  const labels = {
    working: "working",
    wait: "waiting",
    perm: extra ? `perm · ${extra}` : "needs permission",
    ask: "question",
    plan: "plan ready",
    pr: "PR opened",
    idle: "your turn",
  };
  return {
    state,
    emoji: STATE_EMOJI[state] || "",
    label: labels[state] || state || "",
    colorHex: colorHexFor(state),
    needsYou,
    mode,
  };
}

module.exports = {
  STATE_DIR,
  writePrivateAtomic,
  classifyMcp,
  readState,
  writeState,
  writeJSONAtomic,
  clearState,
  describe,
  colorHexFor,
  glyphForServer,
};
