import { useEffect, useState } from "react";
import "./App.css";
import { NewSessionModal } from "./components/NewSessionModal";
import { SessionColumn } from "./components/SessionColumn";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useDeckInit } from "./hooks";
import { useDeckStore } from "./lib/store";
import type { SessionConfig } from "./types";

/**
 * Session column configuration.
 *
 * You're running default single-agent mode, so there's one agent: "main".
 * The Gateway routes all messages to the default workspace at:
 *   /Users/austenallred/.openclaw/workspace
 *
 * To add more columns later, set up multi-agent in openclaw.json:
 *   { "agents": { "list": [
 *     { "id": "research", "workspace": "~/.openclaw/workspace-research" },
 *     { "id": "codegen",  "workspace": "~/.openclaw/workspace-codegen" },
 *   ]}}
 *
 * Then add matching entries here.
 */
const SESSION_ACCENTS = [
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#60a5fa",
  "#facc15",
  "#fb7185",
  "#4ade80",
  "#c084fc",
  "#f97316",
  "#2dd4bf",
];

const DEFAULT_SESSIONS: Partial<SessionConfig>[] = [
  { name: "Cass", agentId: "main", sessionKey: "agent:main:main" },
  { name: "TieoutTR", agentId: "tieouttr", sessionKey: "agent:tieouttr:main" },
];

function buildDefaultSessions(count: number): SessionConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i + 1}`,
    name: DEFAULT_SESSIONS[i]?.name ?? `Session ${i + 1}`,
    accent: SESSION_ACCENTS[i % SESSION_ACCENTS.length],
    model: "claude-sonnet-4-5",
    agentId: DEFAULT_SESSIONS[i]?.agentId,
    sessionKey: DEFAULT_SESSIONS[i]?.sessionKey,
  }));
}

function getGatewayConfig() {
  const params = new URLSearchParams(window.location.search);
  let gatewayUrl =
    params.get("gateway") ||
    import.meta.env.VITE_GATEWAY_URL ||
    "ws://127.0.0.1:18789";

  // Resolve relative paths (e.g. "/ws") to full WebSocket URLs
  if (gatewayUrl.startsWith("/")) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    gatewayUrl = `${proto}//${window.location.host}${gatewayUrl}`;
  }

  return {
    gatewayUrl,
    token:
      params.get("token") ||
      import.meta.env.VITE_GATEWAY_TOKEN ||
      undefined,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("All Sessions");
  const [showAddModal, setShowAddModal] = useState(false);
  const [initialSessions] = useState<SessionConfig[]>(() =>
    buildDefaultSessions(2)
  );
  const columnOrder = useDeckStore((s) => s.columnOrder);
  const createSessionOnGateway = useDeckStore((s) => s.createSessionOnGateway);

  const { gatewayUrl, token } = getGatewayConfig();

  useDeckInit({
    gatewayUrl,
    token,
    sessions: initialSessions,
  });

  // Cmd+1-9 to focus column inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        const input = document.querySelector<HTMLTextAreaElement>(
          `[data-deck-input="${index}"]`
        );
        if (input) {
          e.preventDefault();
          input.focus();
        }
      } else if (e.metaKey && e.key === "k") {
        e.preventDefault();
        setShowAddModal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="deck-root">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddSession={() => setShowAddModal(true)}
      />

      <div className="deck-columns">
        {columnOrder.map((sessionId, index) => (
          <SessionColumn key={sessionId} sessionId={sessionId} columnIndex={index} />
        ))}
      </div>

      <StatusBar />

      {showAddModal && (
        <NewSessionModal
          onClose={() => setShowAddModal(false)}
          onCreate={createSessionOnGateway}
        />
      )}
    </div>
  );
}
