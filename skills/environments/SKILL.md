---
name: environments
description: >
  Branch-before-you-build workflow for Voiceflow changes — clone Main into a
  persistent working environment, make and test every edit there, and promote
  to Main only via an approval-gated merge. Keeps Main (and live traffic)
  clean while iterating.
  TRIGGER when: about to write ANY change to an existing agent (prompt, tool,
  function, routing, KB content, voice/behaviour); the user mentions
  environments, staging, publishing, merging, or "don't touch production"; or
  a subagent is resolving which environment to edit.
version: 0.1.0
---

# Working in Environments — Branch Before You Build

**Never edit Main directly.** Main is what live traffic hits. Every change
goes into a cloned **working environment**; promoting to Main is a separate,
explicit, approval-gated step.

This mirrors a git branch: you don't commit straight to `main` — you branch,
work, review, then merge.

The loop:

```
Resolve working env → edit + test there → show diff → merge to Main (on approval) → publish
```

A Voiceflow project starts with one **Main** environment and supports up to
nine more, each with its own draft + live version. The plugin keeps **one
persistent working environment** and reuses it for every edit.

---

## Resolve the working environment (before any write)

1. List environments: `voiceflow_environment` (list).
2. **Reuse** the plugin's working environment if it exists — the one with
   alias `copilot-staging`. Use its draft version ID for every env-scoped
   write.
3. **If it doesn't exist, auto-create it** by cloning Main:
   `voiceflow_environment` (clone) with `cloneFromEnvironmentID` = Main,
   `name` = "Copilot Staging", `alias` = `copilot-staging`. Then tell the
   user plainly:
   > Created a working environment `copilot-staging` from Main. Edits land
   > there, not Main — I'll merge to Main once you approve.
4. From then on, every write targets the working env's draft, never Main's.

**Clone caveat:** don't clone Main while it has unpublished draft changes you
don't want carried over. Publish Main first, or clone from its live version
(`cloneFromEnvironmentVersionID` = Main's live version). The working env
should start from a known-good baseline.

**At the environment cap:** if the project already has nine non-Main
environments and none is reusable, ask the user which existing environment to
treat as the working env rather than failing.

---

## Promote to Main (approval-gated)

Changes stay in the working env until the user explicitly approves shipping.

1. Show what will be promoted (which prompts / tools / KB changed).
2. On approval, `voiceflow_environment` (merge) the working env into Main.
3. If they want it live immediately, `voiceflow_environment` (publish) Main
   (draft → live).

Never merge to Main speculatively. "Apply the change" means apply it in the
working env; "ship it" is the separate merge step.

---

## What counts as "a change"

Gate these behind the working env — they ship to Main and affect live behavior:

- **Prompts** — global prompt, agent instructions, playbook instructions
- **Tools** — functions, API tools, MCP tools, integrations, routing, system tools
- **Knowledge base** — document uploads, edits, deletes
- **Voice / behaviour** config

These do **not** need the env loop — they're measurement or notes, not
Main-shipped behavior: evaluations, transcripts, analytics, the project wiki.

**Exception — greenfield builds.** A brand-new project with no live version has
nothing to protect; build on Main's draft, then clone the working env once it
goes live so future edits run through the loop.

---

## Warning

A stray edit to Main's draft is a production change waiting to be published.
If you're not certain which environment you're writing to, stop and re-resolve
(step 1 above) before applying anything.

---

## Related skills

- **`build-agent`** — the build/edit workflows that write through this loop.
- **`start`** — resolves the working environment at session start.
