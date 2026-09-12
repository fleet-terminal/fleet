# Fleet Terminal

**A native macOS terminal for running many AI coding agents at once.** One
sidebar row per session with live status — working, your turn, needs permission,
question, MCP call in flight, PR opened — so you always know which one needs
you. `⌘⇧J` jumps to the next one that does.

Works with **Claude Code**, **Codex** and **Antigravity**.

### [⬇ Download for macOS](https://fleet-terminal.app/download)

macOS 14 or later · Apple silicon & Intel · notarized by Apple · free, no
account, no API key

<br>

> **About this repository.** Fleet is closed source, so there's no code here.
> This is the front desk: file a bug, ask whether something works, see what
> changed. It's the fastest way to reach me, and everything filed here gets an
> answer.

## What it does

- **One row per session**, with a live status indicator and colour, so a glance
  tells you which of your agents is blocked on you.
- **Plain-English activity** under each working session — "wiring auth
  middleware", not "Running…".
- **Attention routing** — menu-bar extra and Dock badge count what needs you
  even when Fleet isn't focused, with Approve and Deny on the notification
  itself.
- **Hover preview** to peek at a session's recent conversation without leaving
  the one you're in.
- **Groups, colours and launch profiles** for the many-worktrees workflow.
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

Built in Fleet, by [Oliver Richman](https://github.com/oliver-richman).
