import { useState, useEffect, type KeyboardEvent } from "react";
import type { SessionConfig } from "../types";
import { useDeckStore } from "../lib/store";
import styles from "./NewSessionModal.module.css";

const ACCENTS = [
  "#22d3ee", // cyan
  "#a78bfa", // purple
  "#34d399", // green
  "#fb923c", // orange
  "#f472b6", // pink
  "#facc15", // yellow
  "#60a5fa", // blue
  "#ef4444", // red
];

interface ServerSession {
  sessionKey: string;
  title?: string;
}

export function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (session: SessionConfig) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [accent, setAccent] = useState(ACCENTS[1]);
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use global agents from store
  const agents = useDeckStore((s) => s.agents);
  const defaultAgentId = useDeckStore((s) => s.defaultAgentId);
  const client = useDeckStore((s) => s.client);
  const [serverSessions, setServerSessions] = useState<ServerSession[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>("__new__");
  const [newSessionName, setNewSessionName] = useState("");

  // Pre-select default agent on mount
  useEffect(() => {
    if (!agentId && (defaultAgentId || agents.length > 0)) {
      setAgentId(defaultAgentId ?? agents[0]?.id ?? "main");
    }
  }, [agents, defaultAgentId, agentId]);

  // Fetch sessions when agent changes
  useEffect(() => {
    if (!client?.connected || !agentId) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await client.client.listSessions({ agentId });
        if (cancelled) return;

        const sessions: ServerSession[] = (result?.sessions ?? result ?? []).map(
          (s: { sessionKey?: string; key?: string; title?: string; name?: string }) => ({
            sessionKey: s.sessionKey ?? s.key ?? "",
            title: s.title ?? s.name,
          })
        );
        setServerSessions(sessions);
      } catch (err) {
        console.warn("[NewSessionModal] Failed to fetch sessions:", err);
        setServerSessions([]);
      }
      setSelectedSessionKey("__new__");
    })();

    return () => { cancelled = true; };
  }, [client, agentId]);

  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const canCreate = name.trim().length > 0;

  const handleCreate = async () => {
    if (!canCreate || loading) return;
    setLoading(true);
    setError(null);
    try {
      let sessionKey: string | undefined;
      if (selectedSessionKey === "__new__") {
        const sessionPart = newSessionName.trim() || id || `s-${Date.now()}`;
        sessionKey = `agent:${agentId}:${sessionPart}`;
      } else {
        sessionKey = selectedSessionKey;
      }

      await onCreate({
        id: id || `session-${Date.now()}`,
        name: name.trim(),
        accent,
        agentId,
        sessionKey,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && canCreate) {
      e.stopPropagation();
      handleCreate();
    }
    if (e.key === "Escape") onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose} onKeyDown={handleKeyDown}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>New Session</div>

        <div className={styles.field}>
          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Research Agent"
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Color</label>
          <div className={styles.colors}>
            {ACCENTS.map((c) => (
              <div
                key={c}
                className={`${styles.colorSwatch} ${accent === c ? styles.colorSwatchActive : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setAccent(c)}
              />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Server Agent</label>
          {agents.length > 0 ? (
            <select
              className={styles.select}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={styles.input}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="main"
            />
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Session</label>
          <select
            className={styles.select}
            value={selectedSessionKey}
            onChange={(e) => setSelectedSessionKey(e.target.value)}
          >
            <option value="__new__">New session</option>
            {serverSessions.map((s) => (
              <option key={s.sessionKey} value={s.sessionKey}>
                {s.title ?? s.sessionKey}
              </option>
            ))}
          </select>
          {selectedSessionKey === "__new__" && (
            <input
              className={styles.input}
              value={newSessionName}
              onChange={(e) =>
                setNewSessionName(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "-")
                    .replace(/-{2,}/g, "-")
                    .replace(/^-/, "")
                )
              }
              onKeyDown={handleKeyDown}
              placeholder="session-name (e.g. research-jan)"
              style={{ marginTop: 6 }}
            />
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className={styles.createBtn}
            disabled={!canCreate || loading}
            onClick={handleCreate}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
