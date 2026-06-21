---
name: log-bug
description: Log a bug or issue encountered during this session
---

Log a bug or issue encountered during this session.

Ask the user to describe what happened. Keep it conversational — one or
two questions max.

Then write an entry to `bugs.md` in the repo root. If the file doesn't
exist yet, create it with a heading. If it already exists, append to it.

Each entry should include:
- **Date**: today's date
- **Reporter**: ask who's reporting (or use "unknown" if they don't say)
- **Description**: what the user described, in their words
- **Context**: auto-capture what you know from the session — which project
  was being used, what task was being performed, any transcript URLs or
  tool calls that were involved
- **Steps to reproduce**: if you can infer them from the session, include
  them. If not, skip this section.

Format each entry like this:

```
---

## [date] — [short title]

**Reporter:** [name]

**What happened:**
[user's description]

**Context:**
- Project: [project name if known]
- Task: [what they were doing]
- Relevant URLs: [any transcript/creator URLs from the session]

**Steps to reproduce:**
[if known]

---
```

After writing the entry, tell the user it's been logged to `bugs.md`
and remind them they can share that file with Pete when ready.

Do NOT commit or push. Just write the file.
