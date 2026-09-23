---
description: Report on every Fleet session — what each one is doing and which need you
---

Call `list_sessions`, then `fleet_status`.

Report, briefly:

- Any session blocked on the user, first, by name and what it wants.
- Anything stuck or reporting an error.
- What everything else is working on, one line each.
- The app-level line only if it matters: an update waiting, or the Claude
  integration reporting a problem.

Do not read session output unless something in the list is unexplained.
