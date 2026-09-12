<p align="center">
  <img src=".github/assets/mark.svg" width="76" alt="">
</p>

<h1 align="center">Fleet Terminal</h1>

<p align="center">
  <a href="https://fleet-terminal.app"><b>fleet-terminal.app</b></a>
</p>

<p align="center">
  <b>A native macOS terminal for running many AI coding agents at once.</b><br>
  One sidebar row per session with live status — so you always know which one needs you.
</p>

<p align="center">
  <a href="https://fleet-terminal.app/download"><img src=".github/assets/download.png" width="271" alt="Download for macOS"></a>
</p>

<p align="center">
  <sub>macOS 14 or later · Apple silicon &amp; Intel · notarized by Apple · free, no account, no API key</sub>
</p>

<p align="center">
  Works with <b>Claude Code</b>, <b>Codex</b> and <b>Antigravity</b>.
</p>

---

> **About this repository.** Fleet is closed source, so there's no code here.
> This is the front desk: file a bug, ask whether something works, see what
> changed. It's the fastest way to reach me, and everything filed here gets an
> answer.

## What it does

- **One row per session**, with a live status indicator and colour — working,
  your turn, needs permission, question, MCP call in flight, PR opened — so a
  glance tells you which of your agents is blocked on you. `⌘⇧J` jumps to the
  next one that is.
- **Plain-English activity** under every working session: "wiring auth
  middleware", not "Running…".
- **Attention routing** — a menu-bar extra and Dock badge count what needs you
  even when Fleet isn't focused, with Approve and Deny on the notification
  itself.
- **Hover preview** to peek at a session's recent conversation without leaving
  the one you're in.
- **Groups, colours and launch profiles**, for the many-worktrees workflow.
- **Search every session's scrollback at once** with `⌘⇧F`.
- **Quick Terminal** (`` ⌃` ``) — a scratch shell in a drawer, for the command
  an agent asked you to run yourself.
- **Nerd Font bundled**, so your powerline prompt renders on first launch.

Full feature list and screenshots: **[fleet-terminal.app](https://fleet-terminal.app)**

## How it works

Fleet spawns every PTY itself, so it injects a session id into the shell and the
agents' hooks stamp that id into their state files — session maps to sidebar row
directly, with no process-ancestry guessing. It watches the state directory with
FSEvents rather than polling, and reads status out of the agents' own
transcripts, which is why there's no API key and nothing to configure.

## Privacy

- No account, no sign-in, no API key.
- Fleet reports which features get used and forwards the crash reports macOS
  collects, under a random identifier not tied to you or your Mac. **The format
  it uses cannot carry text at all** — no terminal output, no session names, no
  directories, no branches, nothing you type. Turn it off in Settings ▸ Privacy,
  or set `DO_NOT_TRACK`.
- Your shell is untouched: zsh, fish, bash, your prompt, your dotfiles, spawned
  exactly as they are.

## Getting help

| | |
|---|---|
| Something's broken | [File a bug](../../issues/new/choose) |
| "Does it work with…?" | [Ask in Discussions](../../discussions) |
| Chat, or watch for releases | [Discord](https://fleet-terminal.app/discord) |
| Rather email | [help@fleet-terminal.app](mailto:help@fleet-terminal.app) |

- **[Documentation](https://fleet-terminal.app/docs/getting-started/)**
- **[Changelog](https://fleet-terminal.app/changelog)** — every version stays
  downloadable, so a release that breaks something for you is never a one-way
  door.
- **[Troubleshooting](https://fleet-terminal.app/docs/troubleshooting/)**

---

<p align="center">
  <sub>Built in Fleet, by <a href="https://github.com/oliver-richman">Oliver Richman</a>.</sub>
</p>
