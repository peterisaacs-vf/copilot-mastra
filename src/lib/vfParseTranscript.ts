/**
 * Parse a Voiceflow transcript into structured turns and system prompts.
 *
 * Faithful TypeScript port of the plugin's `bin/vf-parse-transcript` (Python).
 * The output shape (snake_case keys) is kept IDENTICAL to the Python version so
 * downstream consumers and fidelity checks against the original plugin stay valid.
 *
 * Input: the raw transcript object/array returned by the Voiceflow MCP
 *   `voiceflow_transcript` (get) — either `{ logs: [...] }`, `{ transcript: { logs } }`,
 *   or a bare logs array.
 */

export interface RawLog {
  type?: string;
  data?: unknown;
  [k: string]: unknown;
}

export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
  latency_ms?: number | null;
}

export interface Turn {
  turn_index: number;
  user_message: string;
  agent_response: string;
  agent_name: string;
  model: string;
  tool_calls: ToolCall[];
  conversation_history: string;
  tokens: number;
  latency_ms: number;
}

export interface ParsedTranscript {
  version: "v3" | "v4";
  system_prompts: Record<string, string>;
  turns: Turn[];
  metadata: {
    total_turns: number;
    agents: string[];
    filtered_agent: string | null;
  };
}

interface HistoryEntry {
  role: string;
  content: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Detect v3 (named agents) vs v4 (playbooks) from raw logs. */
export function detectVersion(logs: RawLog[]): "v3" | "v4" {
  const agentNames = new Set<string>();
  for (const log of logs) {
    if (log?.type === "trace") {
      const data = asRecord(log.data);
      if (data.type === "text") {
        const payload = asRecord(data.payload);
        const ref = asRecord(payload.ref);
        const name = typeof ref.agentName === "string" ? ref.agentName : "";
        if (name) agentNames.add(name);
      }
    }
  }

  if (agentNames.size === 0) return "v4";

  let v4Signals = 0;
  for (const n of agentNames) {
    if (n === "Agent" || /^[a-z][a-z0-9_]*$/.test(n)) v4Signals += 1;
  }
  return v4Signals > agentNames.size / 2 ? "v4" : "v3";
}

function formatHistory(history: HistoryEntry[]): string {
  return history
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
}

export function parseTranscript(
  logs: RawLog[],
  agentFilter: string | null = null,
): ParsedTranscript {
  const version = detectVersion(logs);
  const systemPrompts: Record<string, string> = {};
  const turns: Turn[] = [];
  const conversationHistory: HistoryEntry[] = [];

  let pendingUserMessage: string | null = null;
  let pendingToolCalls: ToolCall[] = [];
  let currentAgent = "";
  let lastAiMetadata: { model?: string; tokens?: number; latency?: number } = {};

  for (const log of logs) {
    const logType = typeof log?.type === "string" ? log.type : "";
    const data = asRecord(log?.data);
    const dataType = typeof data.type === "string" ? data.type : "";
    const payload = asRecord(data.payload);

    // User message (action: request)
    if (logType === "action" && dataType === "request") {
      const innerPayload = asRecord(data.payload);
      if (innerPayload.type === "text") {
        const userText = typeof innerPayload.payload === "string" ? innerPayload.payload : "";
        if (userText) {
          pendingUserMessage = userText;
          pendingToolCalls = [];
          conversationHistory.push({ role: "user", content: userText });
        }
      }
    }

    // User message (action: text, direct payload)
    else if (logType === "action" && dataType === "text") {
      const userText = data.payload;
      if (typeof userText === "string" && userText) {
        pendingUserMessage = userText;
        pendingToolCalls = [];
        conversationHistory.push({ role: "user", content: userText });
      }
    }

    // Agent text response
    else if (logType === "trace" && (dataType === "text" || dataType === "speak")) {
      const agentText = typeof payload.message === "string" ? payload.message : "";
      const ref = asRecord(payload.ref);
      const agentName = typeof ref.agentName === "string" ? ref.agentName : currentAgent;
      if (agentName) currentAgent = agentName;

      if (agentText && pendingUserMessage !== null) {
        const turn: Turn = {
          turn_index: turns.length,
          user_message: pendingUserMessage,
          agent_response: agentText,
          agent_name: currentAgent,
          model: lastAiMetadata.model ?? "",
          tool_calls: [...pendingToolCalls],
          conversation_history: formatHistory(conversationHistory.slice(0, -1)),
          tokens: lastAiMetadata.tokens ?? 0,
          latency_ms: lastAiMetadata.latency ?? 0,
        };

        if (agentFilter === null || currentAgent.toLowerCase().includes(agentFilter.toLowerCase())) {
          turns.push(turn);
        }

        conversationHistory.push({ role: "assistant", content: agentText });
        pendingUserMessage = null;
        pendingToolCalls = [];
        lastAiMetadata = {};
      } else if (agentText) {
        conversationHistory.push({ role: "assistant", content: agentText });
      }
    }

    // AI result (system prompt + metadata) / tool calls
    else if (logType === "trace" && dataType === "debug") {
      const msg = typeof payload.message === "string" ? payload.message : "";
      const metadata = asRecord(payload.metadata);

      if (msg.toLowerCase().includes("ai result")) {
        const match = msg.match(/"([^"]+)" ai result/);
        const agentName = match ? match[1] : "";
        if (agentName) currentAgent = agentName;

        const systemPrompt = typeof metadata.assistant === "string" ? metadata.assistant : "";
        if (systemPrompt && agentName && !(agentName in systemPrompts)) {
          systemPrompts[agentName] = systemPrompt;
        }

        lastAiMetadata = {
          model: typeof metadata.model === "string" ? metadata.model : "",
          tokens: typeof metadata.tokens === "number" ? metadata.tokens : 0,
          latency: typeof metadata.latency === "number" ? metadata.latency : 0,
        };
      } else if (msg.includes("succeeded")) {
        const match = msg.match(/"([^"]+)" succeeded/);
        if (match) {
          const fnName = match[1];
          const inputVars = metadata.inputVars;
          const outputVars = metadata.outputVars;
          pendingToolCalls.push({
            name: fnName,
            arguments: inputVars && typeof inputVars === "object" && !Array.isArray(inputVars)
              ? (inputVars as Record<string, unknown>)
              : {},
            result: outputVars && typeof outputVars === "object" && !Array.isArray(outputVars)
              ? (outputVars as Record<string, unknown>)
              : {},
            latency_ms: typeof metadata.latency === "number" ? metadata.latency : null,
          });
        }
      } else if (msg.toLowerCase().includes("calling") && msg.toLowerCase().includes("tool")) {
        const match = msg.match(/calling (\w+) tool/);
        if (match) {
          pendingToolCalls.push({ name: match[1] });
        }
      }
    }
  }

  return {
    version,
    system_prompts: systemPrompts,
    turns,
    metadata: {
      total_turns: turns.length,
      agents: Object.keys(systemPrompts),
      filtered_agent: agentFilter,
    },
  };
}

/** Accepts wrapped `{transcript:{logs}}`, `{logs}`, or a bare logs array. */
export function extractLogs(data: unknown): RawLog[] {
  let d: unknown = data;
  if (d && typeof d === "object" && !Array.isArray(d) && "transcript" in (d as object)) {
    d = (d as Record<string, unknown>).transcript;
  }
  if (Array.isArray(d)) return d as RawLog[];
  const rec = asRecord(d);
  return Array.isArray(rec.logs) ? (rec.logs as RawLog[]) : [];
}
