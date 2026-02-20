/**
 * Thin adapter around OpenClawClient from the `openclaw-client` NPM package.
 *
 * The library handles device identity (Ed25519 signing), device token
 * persistence, and pairing detection natively. This wrapper adds
 * initial-connect retry (the library's built-in reconnect only covers
 * connections that succeed then drop) and bridges the config to the store.
 */

import { OpenClawClient } from "openclaw-client";
import type { EventFrame } from "openclaw-client";

interface GatewayConnectionOptions {
  url: string;
  token?: string;
  onEvent?: (event: EventFrame) => void;
  onConnection?: (connected: boolean) => void;
  onPairingRequired?: (required: boolean) => void;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
}

const DEVICE_IDENTITY_KEY = "openclaw.deck.deviceIdentity.v1";

export class GatewayConnection {
  private _client: OpenClawClient | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private options: Required<GatewayConnectionOptions>;
  private baseDelay: number;
  private maxDelay = 30_000;
  private maxAttempts: number;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: GatewayConnectionOptions) {
    this.options = {
      url: opts.url,
      token: opts.token ?? "",
      onEvent: opts.onEvent ?? (() => {}),
      onConnection: opts.onConnection ?? (() => {}),
      onPairingRequired: opts.onPairingRequired ?? (() => {}),
      maxReconnectAttempts: opts.maxReconnectAttempts ?? Infinity,
      reconnectBaseDelay: opts.reconnectBaseDelay ?? 1000,
    };
    this.baseDelay = this.options.reconnectBaseDelay;
    this.maxAttempts = this.options.maxReconnectAttempts;
  }

  get connected() {
    return this._client?.isConnected() ?? false;
  }

  /** The underlying OpenClawClient — use for typed RPC calls. */
  get client(): OpenClawClient {
    if (!this._client) {
      throw new Error("Gateway not connected");
    }
    return this._client;
  }

  connect(): void {
    this.stopped = false;
    this.attempt = 0;
    this.connectWithRetry();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.cleanup();
  }

  // ─── Private ───

  private buildClient(): OpenClawClient {
    const deviceTokenKey = `openclaw.deck.deviceToken.v1:${this.options.url}`;

    return new OpenClawClient({
      gatewayUrl: this.options.url,
      token: this.options.token,
      clientId: "gateway-client",
      clientVersion: "2026.2.16",
      platform: "web",
      mode: "webchat",
      connectTimeoutMs: 120_000,
      deviceIdentity: {
        load: async () => {
          try {
            const raw = localStorage.getItem(DEVICE_IDENTITY_KEY);
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        },
        save: async (record) => {
          try {
            localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(record));
          } catch {
            // ignore
          }
        },
      },
      deviceToken: {
        load: async () => {
          try {
            return localStorage.getItem(deviceTokenKey);
          } catch {
            return null;
          }
        },
        save: async (token) => {
          try {
            localStorage.setItem(deviceTokenKey, token);
          } catch {
            // ignore
          }
        },
      },
      reconnect: {
        enabled: true,
        baseDelay: this.baseDelay,
        maxDelay: this.maxDelay,
        maxAttempts: this.maxAttempts,
      },
      onConnection: (connected) => {
        this.options.onConnection(connected);
      },
      onPairingRequired: this.options.onPairingRequired,
    });
  }

  private cleanup(): void {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    try {
      this._client?.disconnect();
    } catch {
      // ignore
    }
  }

  /**
   * Create a fresh client and attempt connection.
   * On failure, retry with exponential backoff.
   * Once connected, the library's built-in reconnect handles subsequent drops.
   */
  private connectWithRetry(): void {
    // Clean up previous attempt
    this.cleanup();

    // Create a fresh client for each attempt to avoid stale WebSocket state
    this._client = this.buildClient();
    this.unsubscribeEvents = this._client.addEventListener(this.options.onEvent);

    this._client.connect().then(() => {
      this.attempt = 0;
      this.options.onPairingRequired(false);
      console.log("[GatewayConnection] Connected to gateway");
    }).catch((err) => {
      if (this.stopped) return;

      const message = err instanceof Error ? err.message : String(err);

      // "pairing required" means the device is pending approval on the gateway.
      // Show pairing UI and keep retrying — approval will let the next attempt through.
      if (message.includes("pairing required")) {
        this.options.onPairingRequired(true);
        console.log(
          "[GatewayConnection] Device pairing required — approve this device on the gateway."
        );
      }

      if (this.attempt >= this.maxAttempts) {
        console.error("[GatewayConnection] Max connect attempts reached");
        return;
      }
      const delay = message.includes("pairing required")
        ? 3000 // poll more slowly while waiting for approval
        : Math.min(this.baseDelay * Math.pow(2, this.attempt), this.maxDelay);
      this.attempt++;
      this.retryTimer = setTimeout(() => this.connectWithRetry(), delay);
    });
  }
}
