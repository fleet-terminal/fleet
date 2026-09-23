#!/usr/bin/env node
"use strict";
// Fleet Terminal session-status hook dispatcher.
//   Usage: node hook.js <event>
//   event ∈ session-start | prompt | pretool | posttool | subagentstop |
//           notify | stop | session-end
//
// Registered by hooks.json in this same plugin, so these run because the
// `fleet` plugin is enabled — not because anything was merged into anyone's
// settings.json. `session-start` is the heartbeat that lets Fleet tell "the
// plugin is installed" from "the plugin is running"; see writeHeartbeat.
//
// Reads the hook JSON on stdin and updates this session's state file under
// ~/.claude/session-status/state/. Fleet Terminal reads those files (via
// FSEvents) and renders the sidebar. Nothing is written to the terminal.
//
// Fleet Terminal spawns each PTY with FLEET_SESSION=<uuid> in the environment.
// This hook runs as a descendant of that shell, so process.env.FLEET_SESSION
// is available — we stamp it into every state object (see the writeState
// wrapper below). Fleet matches pane uuid -> state file DIRECTLY on that field:
// no ps, no tty-ancestry walk. The tty cache is kept only as a fallback for
// sessions started OUTSIDE Fleet.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const lib = require(path.join(__dirname, "lib.js"));

// Fleet's own Haiku summariser used to run `claude -p` headlessly; never let a
// nested invocation write session state (it would be a phantom session). Fleet
// stopped spawning one in 0.5.1 — this is kept because anything else may still
// set it, and because it costs a single environment read.
if (process.env.FLEET_SUMMARY) process.exit(0);

// --- Fleet correlation: stamp FLEET_SESSION into every state write ---------
// transcriptPath and cwd ride along too: Fleet reads the transcript for the
// model / context % / effort / branch chips, and every hook event carries both
// on stdin, so this is the whole of what the sidebar needs. It used to come
// from a status-line script Fleet installed into ~/.claude/settings.json —
// which meant taking over the user's one `statusLine` slot.
const FLEET = process.env.FLEET_SESSION || null;
const _origWriteState = lib.writeState;
lib.writeState = (sid, obj) => {
  // Which agent wrote this. One state directory serves all of them, and Fleet
  // reads the field to decide whose transcript reader to point at the path
  // below — a Codex rollout and a Claude transcript share neither format nor
  // location. Stamped on every write rather than at session start: each write
  // replaces the file wholesale.
  const extra = { agent: "claude" };
  if (FLEET) extra.fleetSession = FLEET;
  // transcriptPath and cwd describe the session, not the event — but not every
  // hook payload carries them, and each write replaces the file wholesale. Take
  // only what this event has and a Stop or Notification without them wipes the
  // path, and the row loses its model, context % and branch until some later
  // event happens to bring it back. Carry the last known value forward.
  const previous = lib.readState(sid);
  const transcriptPath = input.transcript_path || previous.transcriptPath;
  const cwd = input.cwd || previous.cwd;
  if (transcriptPath) extra.transcriptPath = transcriptPath;
  if (cwd) extra.cwd = cwd;
  // `permission_mode` is missing from a Notification payload for the same
  // reason, and the mode chip should not blank every time a prompt is raised.
  // Only carry it: an event that states the mode still wins, since `obj` is
  // merged over `extra` last.
  if (obj.mode === undefined && previous.mode) extra.mode = previous.mode;
  _origWriteState(sid, Object.assign({}, obj, extra));
};

const event = process.argv[2] || "";

// The heartbeat, and the only case that must not read stdin first: Fleet reads
// this file to answer "are the plugin's hooks actually running, and whose
// copy?" — the question that has no answer from the filesystem alone, because a
// plugin sitting on disk is not a plugin that is enabled.
//
// One file for the machine rather than one per session or per config root: the
// question is about the plugin, and a session that fires this has already
// proved the answer for whichever root loaded it. It sits beside `state/`
// rather than inside it — anything inside is scanned as a session.
if (event === "session-start") {
  writeHeartbeat();
  process.exit(0);
}

const input = readStdin();
const sid = input.session_id || "unknown";

switch (event) {
  case "prompt": {
    lib.writeState(sid, { state: "working" });
    resetAgents(sid);
    break;
  }

  case "pretool": {
    const mcp = lib.classifyMcp(input.tool_name);
    if (mcp) {
      lib.writeState(sid, { state: "mcp", extra: mcp.label });
    } else if (input.tool_name === "Bash" && isPrCreate(input)) {
      const s = lib.readState(sid);
      lib.writeState(sid, Object.assign({}, s, { prPending: true }));
    } else if (input.tool_name === "Agent" || input.tool_name === "Task") {
      const d = (input.tool_input && (input.tool_input.description || input.tool_input.subagent_type)) || "agent";
      bumpAgents(sid, +1, String(d).slice(0, 24));
    }
    break;
  }

  case "subagentstop": {
    bumpAgents(sid, -1);
    break;
  }

  case "posttool": {
    const s = lib.readState(sid);
    if (input.tool_name === "Bash" && s.prPending && !toolErrored(input)) {
      lib.writeState(sid, { state: "pr" });
    } else {
      lib.writeState(sid, { state: "working" });
    }
    break;
  }

  case "notify": {
    const type = input.notification_type || "";
    // Claude Code reports a tool-permission grant, an AskUserQuestion prompt
    // and a finished plan awaiting approval all as notification_type
    // "permission_prompt", with an identical generic message ("Claude needs
    // your permission"). Peek at the transcript's last tool_use to tell them
    // apart.
    //
    // The peek often cannot: measured 2026-09-01, the assistant entry carrying
    // an `AskUserQuestion` tool_use is not on disk when the hook runs. The
    // payload's `transcript_path` is valid and the file is there, but its last
    // lines are still the *previous* turn's records — the entry lands only when
    // the tool resolves, which for a question means when it is answered. So
    // every question was filed as `perm`, the fallback.
    //
    // That is not just a wrong label. Fleet puts Approve / Deny on a `perm`,
    // and Approve sends Return — which on a question dialog picks whichever
    // option happens to be highlighted. An unidentified prompt is therefore
    // marked `unconfirmed`: Fleet still raises a banner (something is blocking
    // you either way) but withholds the buttons, and `StatusWatcher` corrects
    // the state from the transcript on its next pass, by which time the entry
    // has landed.
    let state = "wait";
    let unconfirmed = false;
    if (type === "permission_prompt" || type === "agent_needs_input") {
      // The state file keeps the last known path, which is the one to use when
      // the payload omits it.
      const tool = pendingTool(input.transcript_path || lib.readState(sid).transcriptPath);
      if (tool && tool.name === "AskUserQuestion") state = "ask";
      else if (isPlanProposal(tool)) state = "plan";
      else if (type === "agent_needs_input") {
        // Nothing identified, but the type says an agent is waiting on you.
        // "Question" is the safe reading of that: it raises the same banner and
        // carries no button that can answer on your behalf.
        state = "ask";
        unconfirmed = true;
      } else {
        state = "perm";
        unconfirmed = !tool;
      }
    }
    // An idle_prompt fires ~60s after any prompt goes unanswered, and carries
    // nothing that says what the session is actually blocked on. Writing "wait"
    // for it overwrites the specific reason with a generic one — so a plan left
    // unread for a minute stops saying it is a plan, which is most of the value
    // of knowing. A nudge never narrows what we already know.
    if (state === "wait") {
      const prev = lib.readState(sid);
      if (prev.state === "plan" || prev.state === "perm" || prev.state === "ask") {
        state = prev.state;
        // Carried too, or a nudge would quietly promote an unidentified prompt
        // to a confirmed one and hand it the buttons a minute later.
        unconfirmed = prev.unconfirmed === true;
      }
    }
    lib.writeState(sid, unconfirmed ? { state, unconfirmed: true } : { state });
    // Fleet Terminal owns notifications for sessions it spawned (it can
    // suppress the focused one). Only fire the OS banner ourselves when this
    // session is NOT running under Fleet.
    if (!FLEET) fireDesktopNotification(input);
    break;
  }

  case "stop": {
    const a = readAgents(sid);
    lib.writeState(sid, { state: a && a.count > 0 ? "working" : "idle" });
    break;
  }

  case "session-end": {
    // Leave a marker saying *why* the session ended, before the state file goes
    // — it is the only place the reason exists, and Fleet has no other way to
    // tell `/exit` (the user quitting) from `/clear` or `/resume` (Claude still
    // running, a new session id starting). Written for every reason: which ones
    // close a pane is Fleet's decision, in `ClaudeExit`, so widening that set
    // later does not mean reinstalling the hooks.
    //
    // Only for sessions running under Fleet — nothing else would ever read or
    // remove one. Fleet deletes each marker as it reads it, and sweeps any left
    // by a session that ended while Fleet was not running.
    if (FLEET) {
      try {
        lib.writeJSONAtomic(path.join(lib.STATE_DIR, `${safe(sid)}.end.json`), {
          fleetSession: FLEET,
          reason: input.reason || "other",
          ts: Date.now(),
        });
      } catch {
        /* best effort */
      }
    }
    lib.clearState(sid);
    try {
      fs.unlinkSync(path.join(lib.STATE_DIR, `${safe(sid)}.tty`));
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(path.join(lib.STATE_DIR, `${safe(sid)}.meta.json`));
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(path.join(lib.STATE_DIR, `${safe(sid)}.agents.json`));
    } catch {
      /* ignore */
    }
    // A hook killed between the write and the rename in writeJSONAtomic leaves
    // a `<file>.<pid>.tmp` behind. Fleet ignores those (they are not `.json`),
    // but nothing else would ever remove them.
    try {
      const prefix = `${safe(sid)}.`;
      for (const f of fs.readdirSync(lib.STATE_DIR)) {
        if (f.startsWith(prefix) && f.endsWith(".tmp")) {
          try { fs.unlinkSync(path.join(lib.STATE_DIR, f)); } catch { /* ignore */ }
        }
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
}

if (input.permission_mode) {
  try {
    const st = lib.readState(sid);
    if (st && st.state) {
      st.mode = input.permission_mode;
      lib.writeState(sid, st);
    }
  } catch {
    /* best effort */
  }
}

// Fallback correlation for non-Fleet sessions only.
if (!FLEET) ensureTtyCached(sid);

// ---------------------------------------------------------------------------
function writeHeartbeat() {
  try {
    // One heartbeat per agent — `plugin-claude.json`, `plugin-codex.json` —
    // because "are the hooks running" has a different answer for each, and a
    // shared file would let a working Claude install vouch for a Codex one
    // that has never run.
    lib.writeJSONAtomic(path.join(path.dirname(lib.STATE_DIR), "plugin-claude.json"), {
      version: pluginVersion(),
      root: path.dirname(__dirname),
      ts: Date.now(),
    });
  } catch {
    /* best effort: a heartbeat that cannot be written must never fail a session */
  }
}

// The version `ClaudeIntegration` stamped into the manifest when it installed
// this copy. Read from disk rather than baked in, so a plugin refreshed by a
// newer Fleet reports that Fleet the moment a session picks it up.
function pluginVersion() {
  try {
    const manifest = path.join(__dirname, "..", ".claude-plugin", "plugin.json");
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function isPrCreate(input) {
  const cmd = String((input.tool_input && input.tool_input.command) || "");
  return /\bgh\s+pr\s+create\b/.test(cmd);
}

function toolErrored(input) {
  const r = input.tool_response != null ? input.tool_response : input.tool_output;
  if (r == null) return false;
  const s = typeof r === "string" ? r : JSON.stringify(r);
  return /"?(is_?error|error)"?\s*[:=]\s*true/i.test(s);
}

// A plan waiting to be approved, in either shape Claude Code presents one.
// Some builds call an ExitPlanMode tool; others write the plan to
// ~/.claude/plans/<name>.md and raise the prompt on that Write, so the path is
// the tell — the dialog names the same file ("ctrl+g to edit in VS Code ·
// ~/.claude/plans/…"). Both have been seen from the same Fleet install, so
// neither can be dropped.
function isPlanProposal(tool) {
  if (!tool) return false;
  if (tool.name === "ExitPlanMode") return true;
  const file = tool.input && tool.input.file_path;
  return typeof file === "string" && file.includes("/.claude/plans/");
}

// The tool this prompt is actually about: the newest tool_use with no
// tool_result yet, which is what "waiting for permission" means.
//
// Not simply the newest tool_use. The transcript lags the prompt — a Bash call
// can raise its permission prompt before its entry is written — and the newest
// tool_use is then the *previous* one, already run and answered. That is how
// approving a plan and immediately being asked about a Bash command reported
// itself as another plan: the plan's own Write was still the last one on file.
// A tool that has a result cannot be the one being asked about, so skip it; if
// that leaves nothing, the prompt is about something not yet written down and
// "perm" (the fallback) is the right answer anyway.
//
// Sidechain entries are a subagent's own tool calls and never prompt here.
// Reads only the tail (transcripts can be many MB); a partial leading line just
// fails to parse and is skipped.
function pendingTool(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      // The windows escalate because a single transcript entry can be huge —
      // an ExitPlanMode call carries the whole plan — and a fixed tail can then
      // hold no complete line at all: the only line in it is the tail of one
      // entry, which will not parse. That reads as "no tool_use", and a plan
      // prompt is reported as a plain permission prompt. Widen until a line
      // parses; stopping on the first window that yields one keeps the common
      // case at a single 64K read.
      for (const window of [65536, 524288, 4194304, 33554432]) {
        const readLen = Math.min(size, window);
        const buf = Buffer.alloc(readLen);
        fs.readSync(fd, buf, 0, readLen, size - readLen);
        const lines = buf.toString("utf8").split("\n");
        let parsedAny = false;
        const settled = new Set(); // tool_use ids that already have a result
        const uses = []; // tool_use blocks, in file order
        for (const line of lines) {
          if (!line) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          parsedAny = true;
          if (obj.isSidechain === true) continue;
          const content = obj && obj.message && obj.message.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (!block) continue;
            if (block.type === "tool_result" && block.tool_use_id) settled.add(block.tool_use_id);
            else if (block.type === "tool_use") uses.push(block);
          }
        }
        for (let i = uses.length - 1; i >= 0; i--) {
          if (!settled.has(uses[i].id)) return uses[i];
        }
        // Every line parsed and nothing is outstanding, or we have already read
        // the whole file: a wider window would only re-read the same bytes.
        if (parsedAny || readLen >= size) return null;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fireDesktopNotification(input) {
  const title = truncate(input.title || "Claude Code", 60);
  const body = truncate(input.message || "waiting for you", 180);
  try {
    const child = spawn(
      "osascript",
      ["-e", `display notification ${q(body)} with title ${q(title)} sound name "Glass"`],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  } catch {
    /* ignore */
  }
}

function q(s) {
  return '"' + String(s).replace(/["\\]/g, "\\$&") + '"';
}
function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function ensureTtyCached(sessionId) {
  const cacheFile = path.join(lib.STATE_DIR, `${safe(sessionId)}.tty`);
  try {
    if (fs.readFileSync(cacheFile, "utf8").trim()) return;
  } catch {
    /* not cached yet */
  }
  const dev = discoverTty();
  if (dev) {
    try {
      lib.writePrivateAtomic(cacheFile, dev);
    } catch {
      /* ignore */
    }
  }
}

function discoverTty() {
  try {
    const out = require("child_process")
      .execSync("ps -Ao pid=,ppid=,tty=", { stdio: ["pipe", "pipe", "pipe"] })
      .toString();
    const parent = new Map();
    const tty = new Map();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)/);
      if (!m) continue;
      parent.set(+m[1], +m[2]);
      tty.set(+m[1], m[3]);
    }
    let pid = process.pid;
    for (let i = 0; i < 16 && pid > 1; i++) {
      const t = tty.get(pid);
      if (t && /^ttys/.test(t)) return "/dev/" + t;
      const pp = parent.get(pid);
      if (!pp) break;
      pid = pp;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function safe(id) {
  return String(id || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_");
}

function agentsFile(sessionId) {
  return path.join(lib.STATE_DIR, `${safe(sessionId)}.agents.json`);
}
function readAgents(sessionId) {
  try { return JSON.parse(fs.readFileSync(agentsFile(sessionId), "utf8")); } catch { return { count: 0, names: [] }; }
}
function writeAgents(sessionId, obj) {
  lib.writeJSONAtomic(agentsFile(sessionId), obj);
}
function bumpAgents(sessionId, delta, name) {
  const a = readAgents(sessionId);
  a.count = Math.max(0, (a.count || 0) + delta);
  a.names = Array.isArray(a.names) ? a.names : [];
  if (delta > 0 && name) { a.names.push(name); if (a.names.length > 6) a.names.shift(); }
  else if (delta < 0) { a.names.pop(); }
  a.ts = Date.now();
  writeAgents(sessionId, a);
}
function resetAgents(sessionId) {
  writeAgents(sessionId, { count: 0, names: [], ts: Date.now() });
}
