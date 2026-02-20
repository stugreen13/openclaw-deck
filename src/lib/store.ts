import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SessionConfig,
  Session,
  SessionStatus,
  ChatMessage,
  DeckConfig,
  GatewayEvent,
  SessionUsage,
} from "../types";
import { GatewayConnection } from "./gateway-wrapper";

// ─── Default Config ───

const DEFAULT_CONFIG: DeckConfig = {
  gatewayUrl: "ws://127.0.0.1:18789",
  token: undefined,
  sessions: [],
};

// ─── Agent Info ───

export interface AgentInfo {
  id: string;
  name?: string;
  emoji?: string;
  model?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

// ─── Store Shape ───

interface DeckStore {
  config: DeckConfig;
  sessions: Record<string, Session>;
  gatewayConnected: boolean;
  gatewayPairingRequired: boolean;
  columnOrder: string[];
  client: GatewayConnection | null;
  agents: AgentInfo[];
  allModels: ModelInfo[];
  modelProvider: string;
  defaultAgentId: string | null;

  // Actions
  initialize: (config: Partial<DeckConfig>) => void;
  loadAgents: () => Promise<void>;
  loadModels: () => Promise<void>;
  setModelProvider: (provider: string) => void;
  updateAgentOnGateway: (agentId: string, updates: { name?: string; model?: string }) => Promise<void>;
  addSession: (session: SessionConfig) => void;
  removeSession: (sessionId: string) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  reorderColumns: (order: string[]) => void;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  appendMessageChunk: (sessionId: string, runId: string, chunk: string) => void;
  finalizeMessage: (sessionId: string, runId: string) => void;
  handleGatewayEvent: (event: GatewayEvent) => void;
  createSessionOnGateway: (session: SessionConfig) => Promise<void>;
  deleteSessionOnGateway: (sessionId: string) => Promise<void>;
  loadChatHistory: (sessionId: string) => Promise<void>;
  loadAllChatHistory: () => Promise<void>;
  disconnect: () => void;
  resetStore: () => void;
}

// ─── Helpers ───

function createSession(sessionId: string): Session {
  return {
    sessionId,
    status: "idle",
    messages: [],
    activeRunId: null,
    tokenCount: 0,
    connected: false,
  };
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize message content to a plain string (handles content block arrays). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (typeof block === "string") return block;
        if (block?.type === "text") return block.text ?? "";
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return String(content ?? "");
}

/** Resolve a sessionKey like "agent:<gwAgentId>:<sessionPart>" to the local column ID. */
function resolveColumnId(
  sessionKey: string | undefined,
  sessions: SessionConfig[]
): string {
  if (!sessionKey) return sessions[0]?.id ?? "main";

  // First try exact sessionKey match
  const exactMatch = sessions.find((s) => s.sessionKey === sessionKey);
  if (exactMatch) return exactMatch.id;

  // Fall back to matching by agentId
  const parts = sessionKey.split(":");
  const gwAgentId = parts[1] ?? "main";
  const match = sessions.find(
    (a) => (a.agentId ?? "main") === gwAgentId
  );
  return match?.id ?? gwAgentId;
}

// ─── Store ───

export const useDeckStore = create<DeckStore>()(persist((set, get) => ({
  config: DEFAULT_CONFIG,
  sessions: {},
  gatewayConnected: false,
  gatewayPairingRequired: false,
  columnOrder: [],
  client: null,
  agents: [],
  allModels: [],
  modelProvider: "vercel-ai-gateway",
  defaultAgentId: null,

  initialize: (partialConfig) => {
    const existingConfig = get().config;
    const existingOrder = get().columnOrder;

    // Use persisted column config if it exists, otherwise fall back to defaults
    const hasPersisted = existingOrder.length > 0;
    const sessionConfigs = hasPersisted ? existingConfig.sessions : (partialConfig.sessions ?? []);

    const config: DeckConfig = {
      ...DEFAULT_CONFIG,
      ...partialConfig,
      sessions: sessionConfigs,
    };

    // Always start with fresh (empty) sessions — history is loaded from server on connect
    const sessions: Record<string, Session> = {};
    const columnOrder = hasPersisted ? [...existingOrder] : [];

    for (const sessionConfig of config.sessions) {
      sessions[sessionConfig.id] = createSession(sessionConfig.id);
      if (!hasPersisted) {
        columnOrder.push(sessionConfig.id);
      }
    }

    // Create the gateway connection (reconnecting wrapper around OpenClawClient)
    const client = new GatewayConnection({
      url: config.gatewayUrl,
      token: config.token,
      onEvent: (event) => get().handleGatewayEvent(event),
      onPairingRequired: (required) => {
        set({ gatewayPairingRequired: required });
      },
      onConnection: (connected) => {
        set({ gatewayConnected: connected });
        if (connected) {
          // Mark all sessions as connected
          const sessions = { ...get().sessions };
          for (const id of Object.keys(sessions)) {
            sessions[id] = { ...sessions[id], connected: true };
          }
          set({ sessions });
          // Fetch models first (needed for agent model resolution), then agents + history
          get().loadModels().then(() => get().loadAgents());
          get().loadAllChatHistory();
        }
      },
    });

    set({ config, sessions, columnOrder, client });
    client.connect();
  },

  addSession: (sessionConfig) => {
    set((state) => ({
      config: {
        ...state.config,
        sessions: [...state.config.sessions, sessionConfig],
      },
      sessions: {
        ...state.sessions,
        [sessionConfig.id]: createSession(sessionConfig.id),
      },
      columnOrder: [...state.columnOrder, sessionConfig.id],
    }));
  },

  removeSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...sessions } = state.sessions;
      return {
        config: {
          ...state.config,
          sessions: state.config.sessions.filter((a) => a.id !== sessionId),
        },
        sessions,
        columnOrder: state.columnOrder.filter((id) => id !== sessionId),
      };
    });
  },

  updateSessionName: (sessionId, name) => {
    set((state) => ({
      config: {
        ...state.config,
        sessions: state.config.sessions.map((a) =>
          a.id === sessionId ? { ...a, name } : a
        ),
      },
    }));
  },

  reorderColumns: (order) => set({ columnOrder: order }),

  sendMessage: async (sessionId, text) => {
    const { client, sessions } = get();
    if (!client?.connected) {
      console.error("Gateway not connected");
      return;
    }

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: makeId(),
      role: "user",
      text,
      timestamp: Date.now(),
    };

    const session = sessions[sessionId];
    if (!session) return;

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: [...session.messages, userMsg],
          status: "thinking",
        },
      },
    }));

    try {
      // Route through the session's configured gateway agent (default "main"),
      // using distinct session keys to keep conversations separate.
      const sessionConfig = get().config.sessions.find((a) => a.id === sessionId);
      const gwAgent = sessionConfig?.agentId ?? "main";
      const sessionKey = sessionConfig?.sessionKey ?? `agent:${gwAgent}:${sessionId}`;
      const idempotencyKey = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { runId } = await client.client.sendToAgent({
        agentId: gwAgent,
        message: text,
        sessionKey,
        idempotencyKey,
      }) as { runId: string; status: string };

      // Create placeholder assistant message for streaming
      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: "assistant",
        text: "",
        timestamp: Date.now(),
        streaming: true,
        runId,
      };

      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            messages: [...state.sessions[sessionId].messages, assistantMsg],
            activeRunId: runId,
            status: "streaming",
          },
        },
      }));
    } catch (err) {
      console.error(`Failed to run session ${sessionId}:`, err);
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            status: "error",
          },
        },
      }));
    }
  },

  setSessionStatus: (sessionId, status) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...state.sessions[sessionId],
          status,
        },
      },
    }));
  },

  appendMessageChunk: (sessionId, runId, chunk) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      const messages = session.messages.map((msg) => {
        if (msg.runId === runId && msg.streaming) {
          return { ...msg, text: msg.text + chunk };
        }
        return msg;
      });

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages,
            tokenCount: session.tokenCount + chunk.length, // approximate
          },
        },
      };
    });
  },

  finalizeMessage: (sessionId, runId) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      const messages = session.messages.map((msg) => {
        if (msg.runId === runId) {
          return { ...msg, streaming: false };
        }
        return msg;
      });

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages,
            activeRunId: null,
            status: "idle",
          },
        },
      };
    });
  },

  handleGatewayEvent: (event) => {
    const payload = event.payload as Record<string, unknown>;

    switch (event.event) {
      // Agent streaming events
      // Format: { runId, stream: "assistant"|"lifecycle"|"tool_use", data: {...}, sessionKey: "agent:<gwAgentId>:main" }
      case "agent": {
        const runId = payload.runId as string;
        const stream = payload.stream as string | undefined;
        const data = payload.data as Record<string, unknown> | undefined;
        const sessionKey = payload.sessionKey as string | undefined;

        const sessionId = resolveColumnId(sessionKey, get().config.sessions);

        if (stream === "assistant" && data?.delta) {
          get().appendMessageChunk(sessionId, runId, data.delta as string);
          get().setSessionStatus(sessionId, "streaming");
        } else if (stream === "lifecycle") {
          const phase = data?.phase as string | undefined;
          if (phase === "start") {
            get().setSessionStatus(sessionId, "thinking");
          } else if (phase === "end") {
            get().finalizeMessage(sessionId, runId);
          }
        } else if (stream === "tool_use") {
          get().setSessionStatus(sessionId, "tool_use");
        }
        break;
      }

      // Presence changes (agents coming online/offline)
      case "presence": {
        const agents = payload.agents as
          | Record<string, { online: boolean }>
          | undefined;
        if (agents) {
          set((state) => {
            const sessions = { ...state.sessions };
            for (const [id, info] of Object.entries(agents)) {
              if (sessions[id]) {
                sessions[id] = {
                  ...sessions[id],
                  connected: info.online,
                  status: info.online ? sessions[id].status : "disconnected",
                };
              }
            }
            return { sessions };
          });
        }
        break;
      }

      // Tick events (keep-alive, can update token counts, etc.)
      case "tick": {
        // Could update token usage, cost, etc.
        break;
      }

      // Context compaction dividers
      case "compaction": {
        const sessionKey = payload.sessionKey as string | undefined;
        const sessionId = resolveColumnId(sessionKey, get().config.sessions);
        const beforeTokens = (payload.beforeTokens as number) ?? 0;
        const afterTokens = (payload.afterTokens as number) ?? 0;
        const droppedMessages = (payload.droppedMessages as number) ?? 0;

        const compactionMsg: ChatMessage = {
          id: makeId(),
          role: "compaction",
          text: "",
          timestamp: Date.now(),
          compaction: { beforeTokens, afterTokens, droppedMessages },
        };

        set((state) => {
          const session = state.sessions[sessionId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                messages: [...session.messages, compactionMsg],
              },
            },
          };
        });
        break;
      }

      // Real usage data from gateway
      case "sessions.usage": {
        const sessionKey = payload.sessionKey as string | undefined;
        const sessionId = resolveColumnId(sessionKey, get().config.sessions);
        const usage = payload.usage as SessionUsage | undefined;

        if (usage) {
          set((state) => {
            const session = state.sessions[sessionId];
            if (!session) return state;
            return {
              sessions: {
                ...state.sessions,
                [sessionId]: {
                  ...session,
                  usage,
                  tokenCount: usage.totalTokens,
                },
              },
            };
          });
        }
        break;
      }

      default:
        console.log("[DeckStore] Unhandled event:", event.event, payload);
    }
  },

  createSessionOnGateway: async (sessionConfig) => {
    // Add the column locally, then load chat history from server
    get().addSession(sessionConfig);
    if (sessionConfig.sessionKey) {
      await get().loadChatHistory(sessionConfig.id);
    }
  },

  deleteSessionOnGateway: async (sessionId) => {
    const { client } = get();
    try {
      if (client?.connected) {
        await client.client.deleteAgent({ agentId: sessionId });
      }
    } catch (err) {
      console.warn("[DeckStore] Gateway deleteAgent failed, removing locally:", err);
    }
    get().removeSession(sessionId);
  },

  loadAgents: async () => {
    const { client } = get();
    if (!client?.connected) return;
    try {
      // Fetch agent list, identities, and config models in parallel
      const [listResult, configResult] = await Promise.all([
        client.client.listAgents(),
        client.client.getConfig().catch(() => null),
      ]);

      // Build model map from config agents.list (non-critical, fail gracefully)
      // The server strips the provider prefix when saving, so config returns e.g.
      // "anthropic/claude-3.7-sonnet" instead of "vercel-ai-gateway/anthropic/claude-3.7-sonnet".
      // Resolve back to the full key by finding the known model that ends with the config value.
      const knownModels = get().allModels;
      const modelMap = new Map<string, string>();
      try {
        const parsed = configResult?.parsed ?? configResult;
        const configAgents = parsed?.agents?.list;
        if (Array.isArray(configAgents)) {
          for (const a of configAgents) {
            if (a?.id && typeof a.model === "string") {
              const configModel = a.model;
              const match = knownModels.find((m) =>
                m.id === configModel || m.id.endsWith("/" + configModel)
              );
              modelMap.set(a.id, match?.id ?? configModel);
            }
          }
        }
      } catch (err) {
        console.warn("[DeckStore] config parsing failed:", err);
      }

      // Build agent info: name from list, emoji from getAgentIdentity
      const rawAgents = (listResult.agents ?? []) as { id: string; name?: string }[];
      const agents: AgentInfo[] = await Promise.all(
        rawAgents.map(async (a) => {
          let emoji: string | undefined;
          try {
            const identity = await client.client.getAgentIdentity({ agentId: a.id });
            emoji = identity.emoji;
          } catch { /* ignore */ }
          return { id: a.id, name: a.name, emoji, model: modelMap.get(a.id) };
        })
      );

      set({ agents, defaultAgentId: listResult.defaultId ?? null });
    } catch (err) {
      console.warn("[DeckStore] Failed to load agents:", err);
    }
  },

  loadModels: async () => {
    const { client } = get();
    if (!client?.connected) return;
    try {
      const result = await client.client.listModels();
      const raw = (result.models ?? []) as { id: string; name: string; provider: string }[];
      const allModels: ModelInfo[] = raw.map((m) => ({
        id: `${m.provider}/${m.id}`,
        name: m.name,
        provider: m.provider,
      }));
      set({ allModels });
    } catch (err) {
      console.warn("[DeckStore] Failed to load models:", err);
    }
  },

  setModelProvider: (provider) => set({ modelProvider: provider }),

  updateAgentOnGateway: async (agentId, updates) => {
    const { client } = get();
    if (!client?.connected) return;
    try {
      await client.client.updateAgent({ agentId, ...updates });
      await get().loadAgents();
    } catch (err) {
      console.error("[DeckStore] Failed to update agent:", err);
    }
  },

  loadChatHistory: async (sessionId) => {
    const { client, config } = get();
    if (!client?.connected) return;

    const sessionConfig = config.sessions.find((s) => s.id === sessionId);
    if (!sessionConfig) return;

    const gwAgent = sessionConfig.agentId ?? "main";
    const sessionKey = sessionConfig.sessionKey ?? `agent:${gwAgent}:${sessionId}`;

    try {
      const result = await client.client.getChatHistory({ sessionKey, limit: 10 });
      const rawMessages: unknown[] = result?.messages ?? result ?? [];

      const messages: ChatMessage[] = rawMessages.map((m: any) => ({
        id: m.id ?? makeId(),
        role: m.role ?? "assistant",
        text: extractText(m.text ?? m.content ?? ""),
        timestamp: m.timestamp ?? (m.createdAt ? new Date(m.createdAt).getTime() : Date.now()),
        streaming: false,
      }));

      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages,
            },
          },
        };
      });
    } catch (err) {
      console.warn(`[DeckStore] Failed to load chat history for ${sessionId}:`, err);
    }
  },

  loadAllChatHistory: async () => {
    const { config } = get();
    await Promise.all(
      config.sessions.map((s) => get().loadChatHistory(s.id))
    );
  },

  disconnect: () => {
    get().client?.disconnect();
    set({ gatewayConnected: false, client: null });
  },

  resetStore: () => {
    get().client?.disconnect();
    localStorage.removeItem("openclaw-deck-store");
    window.location.reload();
  },
}), {
  name: "openclaw-deck-store",
  partialize: (state) => ({
    columnOrder: state.columnOrder,
    config: state.config,
    modelProvider: state.modelProvider,
  }),
}));
