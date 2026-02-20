import { useState, type KeyboardEvent } from "react";
import type { SessionConfig } from "../types";
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

const MODELS = [
  "claude-sonnet-4-5",
  "claude-opus-4-6",
];

const GATEWAY_AGENTS = ["main", "tieouttr"];

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
  const [context, setContext] = useState("");
  const [model, setModel] = useState(MODELS[0]);
  const [agentId, setAgentId] = useState(GATEWAY_AGENTS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await onCreate({
        id: id || `session-${Date.now()}`,
        name: name.trim(),
        icon: icon || name.trim()[0]?.toUpperCase() || "?",
        accent,
        context: context.trim() || name.trim(),
        model,
        agentId,
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
          <label className={styles.label}>Context</label>
          <input
            className={styles.input}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Deep web research &amp; synthesis"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Model</label>
          <select
            className={styles.select}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Server Agent</label>
          <select
            className={styles.select}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {GATEWAY_AGENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
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
