import { useState, useEffect, useMemo } from "react";
import { useDeckStats } from "../hooks";
import { useDeckStore } from "../lib/store";
import styles from "./TopBar.module.css";

const TABS = ["All Sessions", "Active", "Queued", "Completed"] as const;

export function TopBar({
  activeTab,
  onTabChange,
  onAddSession,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddSession: () => void;
}) {
  const stats = useDeckStats();
  const allModels = useDeckStore((s) => s.allModels);
  const modelProvider = useDeckStore((s) => s.modelProvider);
  const setModelProvider = useDeckStore((s) => s.setModelProvider);
  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const m of allModels) {
      if (m.provider) set.add(m.provider);
    }
    return Array.from(set).sort();
  }, [allModels]);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={styles.bar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>◈</div>
        <span className={styles.logoText}>OpenClaw</span>
        <span className={styles.logoBadge}>DECK</span>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
            {tab === "All Sessions" && (
              <span className={styles.tabCount}>{stats.totalSessions}</span>
            )}
            {tab === "Active" && stats.active > 0 && (
              <span className={styles.tabCount}>{stats.active}</span>
            )}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <div
            className={styles.statDot}
            style={{
              backgroundColor: stats.gatewayConnected ? "#34d399" : "#ef4444",
            }}
          />
          <span>
            <span
              style={{
                color: stats.gatewayConnected ? "#34d399" : "#ef4444",
              }}
            >
              {stats.active}
            </span>{" "}
            streaming
          </span>
        </div>
        <div className={styles.stat}>
          tokens:{" "}
          <span className={styles.statValue}>
            {stats.totalTokens.toLocaleString()}
          </span>
        </div>
        <div className={styles.stat}>
          {time.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
        </div>
      </div>

      {providers.length > 0 && (
        <div className={styles.providerPicker}>
          <label className={styles.providerLabel}>Model Provider</label>
          <select
            className={styles.providerSelect}
            value={modelProvider}
            onChange={(e) => setModelProvider(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      )}

      <button className={styles.addBtn} onClick={onAddSession}>
        <span>+</span> New Session
      </button>
    </div>
  );
}
