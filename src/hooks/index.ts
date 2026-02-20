import { useEffect, useRef, useCallback } from "react";
import { useDeckStore } from "../lib/store";
import type { SessionConfig, DeckConfig } from "../types";

/**
 * Initialize the deck with config. Call once at app root.
 */
export function useDeckInit(config: Partial<DeckConfig>) {
  const initialize = useDeckStore((s) => s.initialize);
  const disconnect = useDeckStore((s) => s.disconnect);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initialize(config);
    }
    return () => {
      initialized.current = false;
      disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Get session data for a specific session.
 */
export function useSession(sessionId: string) {
  return useDeckStore((s) => s.sessions[sessionId]);
}

/**
 * Get the session config by ID.
 */
export function useSessionConfig(sessionId: string): SessionConfig | undefined {
  return useDeckStore((s) => s.config.sessions.find((a) => a.id === sessionId));
}

/**
 * Send a message to a session. Returns a stable callback.
 */
export function useSendMessage(sessionId: string) {
  const sendMessage = useDeckStore((s) => s.sendMessage);
  return useCallback(
    (text: string) => sendMessage(sessionId, text),
    [sessionId, sendMessage]
  );
}

/**
 * Auto-scroll a container to bottom when content changes.
 */
export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [dep]);

  return ref;
}

/**
 * Get global deck stats.
 */
export function useDeckStats() {
  const sessions = useDeckStore((s) => s.sessions);
  const connected = useDeckStore((s) => s.gatewayConnected);
  const pairingRequired = useDeckStore((s) => s.gatewayPairingRequired);

  const allSessions = Object.values(sessions);
  const streaming = allSessions.filter((a) => a.status === "streaming").length;
  const thinking = allSessions.filter((a) => a.status === "thinking").length;
  const errors = allSessions.filter((a) => a.status === "error").length;
  const totalTokens = allSessions.reduce(
    (sum, a) => sum + (a.usage?.totalTokens ?? a.tokenCount),
    0
  );
  const waitingForUser = allSessions.filter((a) => {
    if (a.status !== "idle" || a.messages.length === 0) return false;
    const last = a.messages[a.messages.length - 1];
    return last.role === "assistant" && !last.streaming;
  }).length;

  return {
    gatewayConnected: connected,
    gatewayPairingRequired: pairingRequired,
    totalSessions: allSessions.length,
    streaming,
    thinking,
    active: streaming + thinking,
    idle: allSessions.length - streaming - thinking,
    errors,
    totalTokens,
    waitingForUser,
  };
}
