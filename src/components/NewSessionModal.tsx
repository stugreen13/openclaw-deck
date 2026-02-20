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

interface AgentInfo {
  id: string;
  name?: string;
}

interface ServerSession {
  sessionKey: string;
  title?: string;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (session: SessionConfig) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [accent, setAccent] = useState(ACCENTS[1]);
  const [model, setModel] = useState("");
  const [agentId, setAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-driven data
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [serverSessions, setServerSessions] = useState<ServerSession[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>("__new__");
  const [newSessionName, setNewSessionName] = useState("");
  const [fetching, setFetching] = useState(true);

  const client = useDeckStore((s) => s.client);

  // Fetch agents and models on mount
  useEffect(() => {
    if (!client?.connected) {
      setFetching(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [agentsResult, modelsResult] = await Promise.all([
          client.client.listAgents(),
          client.client.listModels(),
        ]);

        if (cancelled) return;

        const agentList: AgentInfo[] = (agentsResult.agents ?? []).map(
          (a) => ({
            id: a.id,
            name: a.name ?? a.identity?.name,
          })
        );
        setAgents(agentList);
        setAgentId(agentsResult.defaultId ?? agentList[0]?.id ?? "main");

        const modelList: ModelInfo[] = (modelsResult.models ?? [])
          .filter((m) => m.provider === "vercel-ai-gateway")
          .map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
          }));
        setModels(modelList);
        if (modelList.length > 0) setModel(modelList[0].id);
      } catch (err) {
        console.warn("[NewSessionModal] Failed to fetch server data:", err);
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();

    return () => { cancelled = true; };
  }, [client]);

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
        icon: icon || name.trim()[0]?.toUpperCase() || "?",
        accent,
        model,
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

        <div className={styles.row}>
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
          <div className={styles.fieldSmall}>
            <label className={styles.label}>Icon</label>
            <input
              className={styles.input}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="&#x25CE;"
              style={{ textAlign: "center" }}
            />
          </div>
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
          {fetching ? (
            <div className={styles.fetchingHint}>Loading agents...</div>
          ) : agents.length > 0 ? (
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

        <div className={styles.field}>
          <label className={styles.label}>Model</label>
          {fetching ? (
            <div className={styles.fetchingHint}>Loading models...</div>
          ) : models.length > 0 ? (
            <select
              className={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
          ) : (
            <input
              className={styles.input}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="claude-sonnet-4-5"
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
