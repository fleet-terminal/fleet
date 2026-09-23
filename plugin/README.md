# The Fleet plugin

This is the plugin [Fleet Terminal](https://fleet-terminal.app) installs into
Claude Code for you, published on its own so you can read it before you install
anything, and install it from inside Claude Code:

```
/plugin marketplace add fleet-terminal/fleet
/plugin install fleet@fleet-terminal
```

**It needs the app.** The hooks write a small status file per session, and the
MCP server talks to a running Fleet over a Unix socket in its config directory.
With no Fleet running, the hooks are harmless no-ops and the tools have nothing
to talk to.

## What is in it

- **`hooks/`** — the status hooks. Every session event writes one JSON file
  keyed by the `FLEET_SESSION` id Fleet puts in the shell's environment, which
  is what a sidebar row reads: working, your turn, needs permission, question,
  MCP call in flight, and the model, context and branch alongside.
- **`mcp/server.js`** — a hand-rolled stdio JSON-RPC server, so it needs
  nothing installed. It gives a session tools to open another session, read
  what a session is showing, send it input, and manage groups, profiles and
  settings.
- **`skills/fleet-control/`** — when to reach for those tools.
- **`commands/`** — `/new-session` and `/sessions`.

Fleet installs a copy of this into every Claude Code config directory it finds,
so if you already run Fleet you have it and do not need to install anything.
