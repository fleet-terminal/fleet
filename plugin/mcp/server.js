#!/usr/bin/env node
"use strict";
// The Fleet MCP server: the half of the `fleet` plugin that runs inside a
// Claude session and asks the app to do things.
//
//   Claude Code ──stdio JSON-RPC──▶ this file ──unix socket──▶ Fleet.app
//
// Hand-rolled rather than built on @modelcontextprotocol/sdk, for the same
// reason ../../ClaudeHooks/hook.js is hand-rolled: this file is copied into
// ~/.claude by the app, and nothing can reliably `npm install` there. The
// protocol surface a tools-only server needs is four methods.
//
// Every tool is one round trip: connect, write one JSON line, read one back,
// close. Fleet owns all the state; this file owns none, so there is nothing
// here to get out of step with the app.

const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Which Fleet to talk to. Fleet stamps the path into every PTY it starts
// (Session.start), so a session belonging to a local build drives that build
// and not the user's real app. The fallback is for a Claude running outside
// Fleet entirely — a plain Terminal.app, an IDE — where "open a Fleet session"
// is still a perfectly good thing to ask for.
const SOCKET = process.env.FLEET_CONTROL_SOCKET
  || path.join(os.homedir(), ".config", "fleet-terminal", "control.sock");

// The pane this Claude is running in, if any. Sent with every request so
// Fleet can resolve "this session" without the model having to know its uuid.
const FLEET_SESSION = process.env.FLEET_SESSION || null;

const VERSION = (() => {
  try {
    const manifest = path.join(__dirname, "..", ".claude-plugin", "plugin.json");
    return JSON.parse(fs.readFileSync(manifest, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// --- tools ----------------------------------------------------------------
// Descriptions stay to a line each: every one of them is in the context of
// every session that loads this plugin. The idioms live in skills/fleet/SKILL.md,
// which Claude reads only when it is actually about to do this.

const SESSION_ID = {
  type: "string",
  description: "Session id or exact title from list_sessions. Omit for the session this Claude is running in.",
};

const TOOLS = [
  {
    name: "list_sessions",
    description: "Every session in Fleet's sidebar, with what each one is doing right now.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "new_session",
    description: "Open a new Fleet session and select it. With `prompt`, it starts Claude on that prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Starts `claude` with this prompt already submitted." },
        command: { type: "string", description: "Command to run instead of a plain shell. Combines with `prompt`." },
        cwd: { type: "string", description: "Folder to start in. Defaults to Fleet's configured one." },
        name: { type: "string", description: "Sidebar name for the row." },
        group: { type: "string", description: "Group name to file it under. Must already exist." },
        color: { type: "string", description: "Row colour: #rrggbb, or red/orange/yellow/green/blue/purple/grey." },
        profile: { type: "string", description: "Launch profile to base it on, by name." },
      },
    },
  },
  {
    name: "focus_session",
    description: "Bring a session to the front of Fleet's pane and select its row.",
    inputSchema: { type: "object", properties: { id: SESSION_ID }, required: ["id"] },
  },
  {
    name: "close_session",
    description: "Close a session. Refuses while something is running there unless force is true.",
    inputSchema: {
      type: "object",
      properties: {
        id: SESSION_ID,
        force: { type: "boolean", description: "Close it even though something is still running." },
      },
      required: ["id"],
    },
  },
  {
    name: "update_session",
    description: "Rename a session, recolour its row, move it between groups, or mute its notifications.",
    inputSchema: {
      type: "object",
      properties: {
        id: SESSION_ID,
        name: { type: "string", description: "New name. Empty string restores the automatic one." },
        color: { type: "string", description: "#rrggbb or a palette name; \"none\" clears it." },
        group: { type: "string", description: "Group name; \"none\" removes it from every group." },
        muted: { type: "boolean" },
      },
    },
  },
  {
    name: "read_session",
    description: "The tail of what is on screen in a session — its terminal output, as the user sees it.",
    inputSchema: {
      type: "object",
      properties: { id: SESSION_ID, lines: { type: "integer", description: "1-500, default 60." } },
    },
  },
  {
    name: "send_input",
    description: "Type text into a session as if the user had. Off unless they enabled it in Fleet's settings.",
    inputSchema: {
      type: "object",
      properties: {
        id: SESSION_ID,
        text: { type: "string" },
        submit: { type: "boolean", description: "Press Return afterwards. Default true." },
      },
      required: ["text"],
    },
  },
  {
    name: "list_groups",
    description: "Fleet's sidebar groups and which sessions are in them.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "manage_group",
    description: "Create, rename, recolour or delete a sidebar group.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "rename", "color", "delete"] },
        id: { type: "string", description: "Group id or name. Not needed for create." },
        name: { type: "string" },
        color: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "list_profiles",
    description: "Fleet's launch profiles — a saved folder and starting command each.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "manage_profile",
    description: "Create, edit or delete a launch profile.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"] },
        id: { type: "string", description: "Profile id or name. Not needed for create." },
        name: { type: "string" },
        cwd: { type: "string" },
        command: { type: "string", description: "Empty string clears it, leaving a plain shell." },
      },
      required: ["action"],
    },
  },
  {
    name: "launch_profile",
    description: "Open a new session from a saved launch profile.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Profile id or name." } },
      required: ["id"],
    },
  },
  {
    name: "get_settings",
    description: "Fleet's settings and which of them can be changed from here.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_setting",
    description: "Change one Fleet setting. get_settings lists the writable keys and their current values.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { description: "String, number or boolean, to match the key." } },
      required: ["key", "value"],
    },
  },
  {
    name: "fleet_status",
    description: "Fleet's version, session counts, update state and Claude-integration health, in one call.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_for_updates",
    description: "Ask Fleet to check the download host now, and report what it found.",
    inputSchema: { type: "object", properties: {} },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// --- talking to Fleet -----------------------------------------------------

function ask(command, args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: SOCKET });
    let buffer = "";
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };

    // Fleet answers in well under a second for everything but the update
    // check, which has its own 10s ceiling on the app side.
    socket.setTimeout(30000, () => finish(reject, new Error("Fleet did not answer in time.")));

    socket.on("connect", () => {
      socket.write(JSON.stringify({ command, session: FLEET_SESSION, args: args || {} }) + "\n");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      try {
        finish(resolve, JSON.parse(buffer.slice(0, nl)));
      } catch {
        finish(reject, new Error("Fleet sent a reply this plugin could not read."));
      }
    });

    socket.on("error", (err) => {
      // The socket file only exists while Fleet is running with the control
      // server on, so its absence is the ordinary case, not a fault.
      const why = err && (err.code === "ENOENT" || err.code === "ECONNREFUSED")
        ? "Fleet isn't running, or “Let agents control Fleet” is switched off in its settings "
          + "(Fleet ▸ Settings ▸ Claude Code integration)."
        : `Could not reach Fleet: ${err && err.message ? err.message : err}`;
      finish(reject, new Error(why));
    });

    socket.on("close", () => finish(reject, new Error("Fleet closed the connection without answering.")));
  });
}

// --- JSON-RPC over stdio --------------------------------------------------

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  if (id === undefined || id === null) return;   // a notification wants no answer
  write({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

// Tool calls are async (a socket round trip), so stdin closing must not take
// the process down while one is in flight. Claude Code holds stdin open for the
// life of the session and would never expose this, but a piped request would
// silently produce no answer — which is exactly how this file gets tested.
let inFlight = 0;
let stdinClosed = false;
function maybeExit() {
  if (stdinClosed && inFlight === 0) process.exit(0);
}

async function callTool(id, params) {
  const name = params && params.name;
  if (!TOOL_NAMES.has(name)) {
    return replyError(id, -32602, `Unknown tool: ${name}`);
  }
  let text;
  let isError = false;
  inFlight += 1;
  try {
    const answer = await ask(name, (params && params.arguments) || {});
    if (answer && answer.ok) {
      text = JSON.stringify(answer.result, null, 2);
    } else {
      isError = true;
      text = (answer && answer.error) || "Fleet refused the request without saying why.";
    }
  } catch (err) {
    isError = true;
    text = err.message;
  } finally {
    inFlight -= 1;
  }
  // A refusal comes back as tool content rather than a protocol error on
  // purpose: "that session is still running npm install" is something the
  // model should read and act on, not a transport failure.
  reply(id, { content: [{ type: "text", text }], isError });
  maybeExit();
}

function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      return reply(id, {
        // Echo the client's version when it names one: this server has no
        // version-specific behaviour to guard, and refusing a newer client
        // over a number would be the only way it could fail.
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fleet", version: VERSION },
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call":
      return callTool(id, params);
    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
  let nl;
  while ((nl = stdin.indexOf("\n")) >= 0) {
    const line = stdin.slice(0, nl).trim();
    stdin = stdin.slice(nl + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    try {
      handle(message);
    } catch (err) {
      replyError(message.id, -32603, err && err.message ? err.message : String(err));
    }
  }
});
process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});
