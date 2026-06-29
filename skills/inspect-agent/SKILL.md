---
name: inspect-agent
description: Read-only snapshot of an agent's full configuration — agents, prompts, tools, functions, variables, paths, voice settings, crew wiring, LLM settings
---

Read-only inspection of a Voiceflow agent's full configuration.
No changes are made — this is a "show me everything" command.

## Arguments

the user's request — the project name (or projectID).

## Process

### Step 1: Resolve the project

Call `mcp__voiceflow__voiceflow_project` with operation `list`. Find the
project whose `name` matches `the user's request` (case-insensitive substring is
acceptable). If no match, list the available projects and ask which one.
If `the user's request` is empty, list all and ask.

Then call `voiceflow_project` op `get` on the chosen project to resolve
the environmentID. For v1.3 projects (with an `environments` map), use
the `draftVersionID` from the environment entry. For v1.2 projects, use
`devVersion` or `activeEnvironmentID`. Never pass the string alias
`"development"` — it returns a 500 on v1.3 projects.

### Step 2: Gather everything

Read in parallel:

1. **LLM Settings** (`voiceflow_global_prompt` (get))
   - Persona (full text)
   - Guidelines (full text)
   - Default models (chat, voice, realtime)
   - Priority processing

2. **All Agents** (`voiceflow_playbook` (list), then `voiceflow_playbook` (get) for each)
   - Name, ID, model, isOperator
   - Full instructions text
   - Built-in tool configs (KB, web search, buttons, cards, carousel, end, call forward)

3. **Global Crew Settings** (`voiceflow_agent_routing` (list))
   - Main agent ID and description
   - Sub-agents with descriptions
   - Sub-flows with descriptions

4. **All Functions** (`voiceflow_function` (list), then `voiceflow_function` (get) for each)
   - Name, ID, description
   - Full code

5. **Function Variables** (`voiceflow_function` (list_variables))
   - Group by function — show each variable's name, type (input/output), description

6. **Function Paths** (`voiceflow_function` (list_paths))
   - Group by function — show each path's name and label

7. **Agent Function Tools** (`voiceflow_function` (list_agent_tools) for each agent)
   - Which functions are linked to which agents
   - Tool descriptions and input variables

8. **API Tool Definitions** (`voiceflow_api_tool` (list))
   - Name, HTTP method, URL, description
   - For each: `voiceflow_api_tool` (list_input_variables) — input variable names and descriptions

9. **Agent API Tools** (`voiceflow_api_tool` (list agent tools) for each agent)
   - Which API tools are linked to which agents
   - Tool descriptions and input variable mappings

10. **Environment Variables** (`voiceflow_variable` (list))
   - Name, datatype, isArray, isSystem, description, defaultValue

11. **Voice Settings** (`voiceflow_behaviour` (get)) — for voice projects
   - STT provider, model, language/locale
   - TTS provider, model, voice
   - Call recording, keypad input, silence timeout, failure message

### Step 3: Present the snapshot

Format as a structured report:

```
# {Project Name} — Agent Snapshot

## Global Settings
### Persona
{full persona text}

### Guidelines
{full guidelines text}

### Default Models
Chat: {model} | Voice: {model} | Realtime: {model}

## Voice Settings (if voice project)
- STT: {provider} / {model} / {language}
- TTS: {provider} / {model} / {voice}
- Call recording: {yes/no}
- Failure message: {message}

## Crew Configuration
Main agent: {agent name} ({agent ID})
Sub-agents:
- {name}: {description}
- {name}: {description}

## Agents ({count})
### {Agent Name} (main agent)
- Model: {model}
- Instructions: {char count} chars
{full instructions text}

- Built-in tools: KB ✓ | Web Search ✓ | Buttons ✓ | End ✓
- Function tools: {list with descriptions}
- API tools: {list with descriptions}

### {Agent Name} (playbook)
...

## Functions ({count})
### {Function Name}
- Description: {description}
- Linked to: {agent name(s)}
- Variables:
  - Input: {name} ({description}), {name} ({description})
  - Output: {name} ({description}), {name} ({description})
- Paths: {path1} ({label}), {path2} ({label})
- Code: {line count} lines
{full code}

## API Tools ({count})
### {API Tool Name}
- HTTP: {method} {url}
- Description: {description}
- Linked to: {agent name(s)}
- Input Variables:
  - {name} ({description}), {name} ({description})

## Environment Variables ({count})
| Name | Type | Array | System | Default | Description |
| {name} | {datatype} | {yes/no} | {yes/no} | {value} | {desc} |

## Summary
- {count} agents ({count} playbooks + main agent)
- {count} functions
- {count} function tool links
- {count} API tools
- {count} environment variables ({count} system, {count} custom)
- Model: {default model}
- Voice: {STT provider} → {TTS provider} (if voice)
```

### Step 4: Flag issues

After presenting, note anything that looks off:
- Agents with empty instructions
- Functions not linked to any agent
- Functions with no input/output variables defined
- Functions with no paths defined (missing success/error paths)
- Agents not in the crew configuration
- Missing tool descriptions
- Environment variables with no description
- Default/template text that wasn't customized

Do NOT propose fixes — this is read-only. Say "run `/edit-agent`
or `/review-agent` to address these."

## Important

- This is **read-only**. Never modify anything.
- Show full prompt text, not summaries. The user needs to see exactly what's there.
- Show full function code, not descriptions of what it does.
