---
description: Open a new Fleet session and set Claude working on something in it
---

Open a new Fleet session for this task: $ARGUMENTS

Use `new_session`. Decide the folder from what is being asked and from where
this session is working — pass it as `cwd` rather than accepting the default.
Write the `prompt` as a complete, self-contained instruction: the new session
starts with none of this conversation's context.

Give it a short `name` if the task is one of several running at once.

Then tell the user what you opened and what it is doing — in one line.
