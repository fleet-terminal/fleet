---
description: Drive the Fleet terminal app from inside a session — open a new Fleet session for a separate task, check on or read the other sessions, manage groups and launch profiles, and change Fleet's settings. Use whenever the user says "in a new Fleet session", "another session", "open a session for this", asks how their other sessions are doing, or asks to change something about Fleet itself.
---

# Driving Fleet

Fleet is the terminal app this session is running in. One sidebar row per
session, each with live status. These tools let you act on it.

## Splitting work into a new session

This is the main one. "Do this in a new Fleet session", "spin up a session for
the migration", "start that in parallel" — all `new_session`.

```
new_session(cwd: "~/code/api", prompt: "Rename the User model to Account, everywhere")
```

`prompt` starts Claude with that prompt already submitted, so the session is
working the moment it opens. Pass the whole task, written as you would write it
to a colleague who cannot see this conversation — the new session shares no
context with this one.

Points worth knowing:

- **Give it a `cwd`.** A new session starts in Fleet's default folder unless you
  say otherwise, which is rarely the folder the work is in.
- **It takes focus.** The new session becomes the selected one — a session's
  terminal does not start until it has been on screen, so there is no
  "open it in the background" and asking for one will not produce one.
- **Name it** when you open more than one at a time (`name: "api rename"`).
  Otherwise the sidebar fills up with rows called "New Session 7".
- **`command` without `prompt`** runs anything else: a dev server, a test watch,
  a plain shell.

Tell the user which session you opened and what you set it going on.

## Checking on the others

`list_sessions` is the cheap one, and usually enough: it carries each session's
status, whether it is blocked on the user, its model, context %, branch and
what it is currently doing. Read it before answering "how is that going?".

`read_session` gives you the actual terminal output of one session when the
status is not enough — a build that failed, output the user is asking about.

`fleet_status` answers the app-level questions in one call: version, how many
sessions are working or waiting, whether an update is available. Fleet never
restarts itself to install an update: a staged one takes over the running
sessions in the background, with none of them closing, so there is nothing to
offer the user and no reason to suggest a restart.

## Typing into another session

`send_input` types into another session as if the user had. It is off unless
they have switched it on in Fleet ▸ Settings ▸ Claude Code integration. If it
refuses, say so and let them decide — do not look for a way around it.

When it is on, it is still the tool to reach for last. Prefer opening a new
session with the prompt you want run; steering an existing agent mid-turn is
rarely what someone means.

## Settings, groups and profiles

`get_settings` first — it lists exactly which keys can be written and what they
currently are. Then `set_setting` one key at a time.

A few settings are deliberately not writable from here: the user's telemetry
choice, their first-run state, and the two settings that govern these tools.
If one of those is what they want changed, point them at Fleet's Settings
window rather than trying.

Groups are the sidebar's folders (`manage_group`); profiles are a saved folder
plus a starting command (`manage_profile`, then `launch_profile`). A user
opening the same three repos every morning wants profiles.

## When Fleet is not there

If a tool reports that Fleet is not running or that control is switched off,
that is the whole answer — repeat it and stop. There is no fallback path, and
nothing here is worth doing with `Bash` instead.
