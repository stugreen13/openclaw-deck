import { useState, useEffect, useMemo, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  useSession,
  useSessionConfig,
  useSendMessage,
  useAutoScroll,
} from "../hooks";
import { useDeckStore } from "../lib/store";
import type { SessionStatus, ChatMessage, Session } from "../types";
import styles from "./SessionColumn.module.css";

// ─── Status Indicator ───

function StatusBadge({
  status,
  accent,
}: {
  status: SessionStatus;
  accent: string;
}) {
  const color =
    status === "streaming" || status === "thinking" || status === "tool_use"
      ? accent
      : status === "error"
        ? "#ef4444"
        : status === "disconnected"
          ? "#6b7280"
          : "rgba(255,255,255,0.25)";

  const label =
    status === "tool_use" ? "tool use" : status;

  const isActive =
    status === "streaming" || status === "thinking" || status === "tool_use";

  return (
    <div className={styles.statusBadge}>
      <div
        className={isActive ? styles.statusDotPulse : styles.statusDot}
        style={{ backgroundColor: color }}
      />
      <span className={styles.statusLabel} style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// ─── Message Bubble ───

function MessageBubble({
  message,
  accent,
  agentName,
  agentEmoji,
}: {
  message: ChatMessage;
  accent: string;
  agentName?: string;
  agentEmoji?: string;
}) {
  const isUser = message.role === "user";

  if (message.thinking) {
    return (
      <div className={styles.thinkingBubble}>
        <span className={styles.thinkingDot} style={{ color: accent }}>
          ●
        </span>
        <span style={{ color: accent }}>{message.text}</span>
      </div>
    );
  }

  if (message.toolUse) {
    return (
      <div className={styles.toolBubble}>
        <span className={styles.toolIcon}>⚙</span>
        <span>
          {message.toolUse.name}
          {message.toolUse.status === "running" && (
            <span className={styles.thinkingDot}> ...</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.messageBubble} ${
        isUser ? styles.userMsg : styles.assistantMsg
      }`}
    >
      {isUser && <div className={styles.roleLabel}>You</div>}
      {!isUser && <div className={styles.roleLabel}>{agentName || "Assistant"}{agentEmoji ? ` ${agentEmoji}` : ""}</div>}
      <div
        className={styles.messageText}
        style={
          isUser
            ? undefined
            : { borderLeft: `2px solid ${accent}33`, paddingLeft: 12 }
        }
      >
        {isUser ? (
          message.text
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {message.text}
          </ReactMarkdown>
        )}
        {message.streaming && (
          <span className={styles.cursor} style={{ backgroundColor: accent }} />
        )}
      </div>
    </div>
  );
}

// ─── Compaction Divider ───

function CompactionDivider({ message }: { message: ChatMessage }) {
  const c = message.compaction;
  if (!c) return null;

  return (
    <div className={styles.compactionDivider}>
      <div className={styles.compactionLine} />
      <span className={styles.compactionLabel}>
        context compacted &middot; {c.droppedMessages} msgs dropped &middot;{" "}
        {c.beforeTokens.toLocaleString()} &rarr; {c.afterTokens.toLocaleString()} tokens
      </span>
      <div className={styles.compactionLine} />
    </div>
  );
}

// ─── Failover Badge ───

function FailoverBadge({ session }: { session: Session }) {
  const failover = session.usage?.failover;
  if (!failover) return null;

  return (
    <span className={styles.failoverBadge} title={failover.reason}>
      failover: {failover.from} &rarr; {failover.to}
    </span>
  );
}

// ─── Main Column ───

export function SessionColumn({ sessionId, columnIndex }: { sessionId: string; columnIndex: number }) {
  const session = useSession(sessionId);
  const config = useSessionConfig(sessionId);
  const send = useSendMessage(sessionId);
  const deleteSessionOnGateway = useDeckStore((s) => s.deleteSessionOnGateway);
  const resetSessionOnGateway = useDeckStore((s) => s.resetSessionOnGateway);
  const updateSessionName = useDeckStore((s) => s.updateSessionName);
  const updateSessionKey = useDeckStore((s) => s.updateSessionKey);
  const updateSessionAgentId = useDeckStore((s) => s.updateSessionAgentId);
  const client = useDeckStore((s) => s.client);
  const agents = useDeckStore((s) => s.agents);
  const agent = useDeckStore((s) => {
    const agentId = s.config.sessions.find((c) => c.id === sessionId)?.agentId ?? "main";
    return s.agents.find((a) => a.id === agentId);
  });
  const allModels = useDeckStore((s) => s.allModels);
  const modelProvider = useDeckStore((s) => s.modelProvider);
  const models = useMemo(
    () => allModels.filter((m) => m.provider === modelProvider),
    [allModels, modelProvider]
  );
  const updateAgentOnGateway = useDeckStore((s) => s.updateAgentOnGateway);
  const agentId = useDeckStore((s) => s.config.sessions.find((c) => c.id === sessionId)?.agentId ?? "main");
  const agentEmoji = agent?.emoji;
  const agentModel = agent?.model;
  const [input, setInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessionSwitcher, setShowSessionSwitcher] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editAgentName, setEditAgentName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editAgentId, setEditAgentId] = useState("");
  const [editSessionKey, setEditSessionKey] = useState("");
  const [serverSessions, setServerSessions] = useState<{ sessionKey: string; title?: string }[]>([]);
  const scrollRef = useAutoScroll(session?.messages);

  // Fetch server sessions when session switcher opens or agent changes
  useEffect(() => {
    if (!showSessionSwitcher || !client?.connected || !editAgentId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await client.client.listSessions({ agentId: editAgentId });
        if (cancelled) return;
        const sessions = (result?.sessions ?? result ?? []).map(
          (s: { sessionKey?: string; key?: string; title?: string; name?: string }) => ({
            sessionKey: s.sessionKey ?? s.key ?? "",
            title: s.title ?? s.name,
          })
        );
        setServerSessions(sessions);
        // Auto-select first session when agent changes
        if (sessions.length > 0) {
          setEditSessionKey(sessions[0].sessionKey);
        }
      } catch {
        setServerSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showSessionSwitcher, client, editAgentId]);

  if (!config || !session) return null;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Tab") {
      const offset = e.shiftKey ? -1 : 1;
      const next = document.querySelector<HTMLTextAreaElement>(
        `[data-deck-input="${columnIndex + offset}"]`
      );
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };

  const isActive =
    session.status === "streaming" ||
    session.status === "thinking" ||
    session.status === "tool_use";

  // Determine if session has completed work ready to review
  const lastMessage = session.messages[session.messages.length - 1];
  const hasCompletedWork =
    session.status === "idle" &&
    session.messages.length > 0 &&
    lastMessage?.role === "assistant" &&
    !lastMessage?.streaming;

  return (
    <div
      className={styles.column}
      data-status={session.status}
      data-has-completed-work={hasCompletedWork}
    >
      {/* Header */}
      <div className={styles.header}>
        <div
          className={styles.sessionIcon}
          style={{
            color: config.accent,
            backgroundColor: `${config.accent}15`,
            borderColor: `${config.accent}30`,
          }}
        >
          {agentEmoji ?? columnIndex + 1}
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.headerRow}>
            <span className={styles.sessionName}>{config.name}</span>
            <StatusBadge status={session.status} accent={config.accent} />
          </div>
          <div className={styles.headerMeta}>
            {config.context ? <span>{config.context}</span> : null}
            {config.context ? <span className={styles.metaDot}>·</span> : null}
            <span
              className={styles.sessionKeyLink}
              style={{ color: config.accent, opacity: 0.5 }}
              onClick={() => {
                setEditAgentId(agentId);
                setEditSessionKey(config.sessionKey ?? `agent:${config.agentId ?? "main"}:${sessionId}`);
                setShowSessionSwitcher((v) => !v);
                setShowSettings(false);
              }}
            >
              {config.sessionKey ?? `agent:${config.agentId ?? "main"}:${sessionId}`}
            </span>
            <FailoverBadge session={session} />
          </div>
          {agentModel && (
            <div className={styles.headerMeta}>
              <span className={styles.modelLabel}>
                {agentModel.split("/").pop()}
              </span>
            </div>
          )}
          {showSessionSwitcher && (
            <div
              className={styles.settingsPopover}
              style={{ top: "100%", left: 0, right: "auto", marginTop: 4 }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowSessionSwitcher(false);
              }}
            >
              <label className={styles.settingsLabel}>Agent</label>
              <select
                className={styles.settingsSelect}
                value={editAgentId}
                onChange={(e) => setEditAgentId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ? `${a.name} - ${a.id}` : a.id}
                  </option>
                ))}
              </select>

              <label className={styles.settingsLabel}>Session</label>
              <select
                className={styles.settingsSelect}
                value={editSessionKey}
                onChange={(e) => setEditSessionKey(e.target.value)}
              >
                {serverSessions.map((s) => (
                  <option key={s.sessionKey} value={s.sessionKey}>
                    {s.title ?? s.sessionKey}
                  </option>
                ))}
                {!serverSessions.some((s) => s.sessionKey === editSessionKey) && (
                  <option value={editSessionKey}>{editSessionKey}</option>
                )}
              </select>

              <div className={styles.settingsBtnRow}>
                <button className={styles.settingsCancel} onClick={() => setShowSessionSwitcher(false)}>
                  Cancel
                </button>
                <button
                  className={styles.settingsSave}
                  onClick={() => {
                    if (editAgentId !== agentId) {
                      updateSessionAgentId(sessionId, editAgentId);
                    }
                    const currentSessionKey = config.sessionKey ?? `agent:${config.agentId ?? "main"}:${sessionId}`;
                    if (editSessionKey !== currentSessionKey) {
                      updateSessionKey(sessionId, editSessionKey);
                    }
                    setShowSessionSwitcher(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
        <div className={styles.headerActions}>
          <div style={{ position: "relative" }}>
            <button
              className={styles.headerBtn}
              title="Settings"
              onClick={() => {
                setEditLabel(config.name);
                setEditAgentName(agent?.name ?? "");
                setEditModel(agentModel ?? "");
                setShowSettings((v) => !v);
                setShowSessionSwitcher(false);
              }}
            >
              <span style={{ fontSize: 16 }}>⚙</span>
            </button>
            {showSettings && (
              <div
                className={styles.settingsPopover}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowSettings(false);
                }}
              >
                <label className={styles.settingsLabel}>Session Label</label>
                <input
                  className={styles.settingsInput}
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  autoFocus
                />

                <label className={styles.settingsLabel}>Agent Name</label>
                <input
                  className={styles.settingsInput}
                  value={editAgentName}
                  onChange={(e) => setEditAgentName(e.target.value)}
                />

                <label className={styles.settingsLabel}>Model</label>
                <select
                  className={styles.settingsSelect}
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                >
                  <option value="">— default —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <div className={styles.settingsBtnRow}>
                  <button className={styles.settingsCancel} onClick={() => setShowSettings(false)}>
                    Cancel
                  </button>
                  <button
                    className={styles.settingsSave}
                    onClick={() => {
                      const trimmedLabel = editLabel.trim();
                      if (trimmedLabel) updateSessionName(sessionId, trimmedLabel);

                      const nameChanged = editAgentName !== (agent?.name ?? "");
                      const modelChanged = editModel !== (agentModel ?? "");
                      if (nameChanged || modelChanged) {
                        const updates: { name?: string; model?: string } = {};
                        if (nameChanged) updates.name = editAgentName;
                        if (modelChanged) updates.model = editModel || undefined;
                        updateAgentOnGateway(agentId, updates);
                      }

                      setShowSettings(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className={styles.headerBtn}
            title="Reset Session"
            onClick={() => setConfirmReset(true)}
          >
            ↺
          </button>
          <button
            className={`${styles.deleteBtn} ${confirmDelete ? styles.confirmDelete : ""}`}
            title={confirmDelete ? "Click again to confirm" : "Close Session"}
            onClick={() => {
              if (confirmDelete) {
                deleteSessionOnGateway(sessionId);
              } else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
              }
            }}
          >
            {confirmDelete ? "✕" : "×"}
          </button>
        </div>

        {/* Reset confirmation modal */}
        {confirmReset && (
          <div className={styles.confirmOverlay} onClick={() => setConfirmReset(false)}>
            <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
              <p>This will start a new session with the /new command. The session key will remain the same:</p>
              <p style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all' }}>
                {config.sessionKey ?? `agent:${config.agentId ?? "main"}:${sessionId}`}
              </p>
              <div className={styles.confirmActions}>
                <button className={styles.cancelBtn} onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className={styles.confirmBtn} onClick={async () => { setConfirmReset(false); await resetSessionOnGateway(sessionId); window.location.reload(); }}>Confirm</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Messages */}
      <div ref={scrollRef} className={styles.messages}>
        {session.messages.length === 0 && (
          <div className={styles.emptyState}>
            <div
              className={styles.emptyIcon}
              style={{ color: config.accent }}
            >
              {agentEmoji ?? columnIndex + 1}
            </div>
            <p>Send a message to start a conversation with {config.name}</p>
          </div>
        )}
        {session.messages.map((msg) =>
          msg.role === "compaction" ? (
            <CompactionDivider key={msg.id} message={msg} />
          ) : (
            <MessageBubble key={msg.id} message={msg} accent={config.accent} agentName={agent?.name} agentEmoji={agent?.emoji} />
          )
        )}
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${config.name}...`}
            className={styles.input}
            data-deck-input={columnIndex}
            autoComplete="off"
            autoCapitalize="off"
            rows={4}
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim()}
            style={
              input.trim()
                ? { backgroundColor: config.accent, color: "#000" }
                : undefined
            }
          >
            ↑
          </button>
        </div>
        {isActive && (
          <div
            className={styles.streamingBar}
            style={{ backgroundColor: config.accent }}
          />
        )}
      </div>
    </div>
  );
}
