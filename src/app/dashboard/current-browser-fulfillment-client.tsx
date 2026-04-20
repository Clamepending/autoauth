"use client";

import { useEffect, useMemo, useState } from "react";

const REQUEST_SOURCE = "ottoauth-dashboard";
const RESPONSE_SOURCE = "ottoauth-extension-dashboard";
const BRIDGE_TIMEOUT_MS = 1800;

type BridgeAction = "status" | "configure";

type ExtensionFulfillmentStatus = {
  installed: true;
  hasApiKey: boolean;
  configured: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  headlessModeEnabled: boolean;
  pollingRequested: boolean;
  runtimeActive: boolean;
  pollingActive: boolean;
  lastError: string | null;
  lastSeenAt: number | null;
};

type Notice = {
  kind: "success" | "error";
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function postBridgeRequest<T>(action: BridgeAction, payload?: Record<string, unknown>, timeoutMs = BRIDGE_TIMEOUT_MS) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The browser bridge can only run in Chrome."));
  }

  return new Promise<T>((resolve, reject) => {
    const requestId = `ottoauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let timeoutId = 0;

    function cleanup() {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;

      const message = event.data as unknown;
      if (!isRecord(message)) return;
      if (message.source !== RESPONSE_SOURCE || message.requestId !== requestId) return;

      cleanup();
      if (message.ok === true) {
        resolve(message.payload as T);
        return;
      }

      reject(
        new Error(
          typeof message.error === "string"
            ? message.error
            : "The OttoAuth Chrome extension rejected the request.",
        ),
      );
    }

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Could not detect the OttoAuth Chrome extension on this page. Reload the dashboard after installing or updating the extension.",
        ),
      );
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: REQUEST_SOURCE,
        requestId,
        action,
        payload,
      },
      window.location.origin,
    );
  });
}

async function postJson(path: string, body: Record<string, unknown>, fallbackError: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.error === "string" ? payload.error : fallbackError,
    );
  }

  return isRecord(payload) ? payload : {};
}

function makeDeviceId() {
  const random =
    typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `chrome-browser-${random}`;
}

function makeDeviceLabel() {
  if (typeof navigator === "undefined") return "Chrome extension fulfiller";
  const platform = navigator.platform || "current device";
  return `Chrome extension fulfiller (${platform.slice(0, 48)})`;
}

function workerStatusText(status: ExtensionFulfillmentStatus | null) {
  if (!status) return "Not checked yet";
  if (status.lastError) return `Error: ${status.lastError}`;
  if (status.runtimeActive && status.pollingActive) return "Polling for OttoAuth orders";
  if (status.headlessModeEnabled && status.pollingRequested) return "Enabled and starting";
  if (status.configured) return "Paired but not enabled";
  return "Not paired yet";
}

function formatLastSeen(status: ExtensionFulfillmentStatus | null) {
  if (!status?.lastSeenAt) return "No heartbeat yet";
  return new Date(status.lastSeenAt).toLocaleString();
}

export function CurrentBrowserFulfillmentClient({ serverUrl }: { serverUrl: string }) {
  const normalizedServerUrl = useMemo(() => serverUrl.replace(/\/+$/, ""), [serverUrl]);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionFulfillmentStatus | null>(null);
  const [bridgeState, setBridgeState] = useState<"idle" | "checking" | "ready" | "missing" | "configuring">(
    "idle",
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkExtension() {
      setBridgeState("checking");
      try {
        const status = await postBridgeRequest<ExtensionFulfillmentStatus>("status");
        if (cancelled) return;
        setExtensionStatus(status);
        setBridgeState("ready");
      } catch {
        if (cancelled) return;
        setExtensionStatus(null);
        setBridgeState("missing");
      }
    }

    void checkExtension();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshStatus(showNotice = true) {
    setBridgeState("checking");
    if (showNotice) setNotice(null);
    try {
      const status = await postBridgeRequest<ExtensionFulfillmentStatus>("status");
      setExtensionStatus(status);
      setBridgeState("ready");
      if (showNotice) {
        setNotice({ kind: "success", text: "Chrome extension detected." });
      }
      return status;
    } catch (error) {
      setExtensionStatus(null);
      setBridgeState("missing");
      if (showNotice) {
        setNotice({
          kind: "error",
          text: getErrorMessage(error, "Could not detect the OttoAuth Chrome extension."),
        });
      }
      throw error;
    }
  }

  async function enableCurrentDevice() {
    setBridgeState("configuring");
    setNotice(null);

    try {
      const status = await postBridgeRequest<ExtensionFulfillmentStatus>("status");
      setExtensionStatus(status);

      if (!status.hasApiKey) {
        setBridgeState("ready");
        setNotice({
          kind: "error",
          text: "The extension is installed, but it does not have an Anthropic API key yet. Add the key in the extension side panel, then click this again.",
        });
        return;
      }

      const deviceId = status.deviceId?.trim() || makeDeviceId();
      const deviceLabel = makeDeviceLabel();
      const pairing = await postJson(
        "/api/human/devices/pairing-code",
        { device_label: deviceLabel, ttl_minutes: 10 },
        "Could not create a device pairing code.",
      );
      const pairingCode = typeof pairing.code === "string" ? pairing.code : "";
      if (!pairingCode) throw new Error("OttoAuth did not return a device pairing code.");

      const paired = await postJson(
        "/api/computeruse/device/pair",
        {
          device_id: deviceId,
          device_label: deviceLabel,
          pairing_code: pairingCode,
        },
        "Could not pair this Chrome browser as a fulfillment device.",
      );
      const authToken = typeof paired.deviceToken === "string" ? paired.deviceToken : "";
      if (!authToken) throw new Error("OttoAuth did not return a device token for the extension.");

      await postJson(
        `/api/human/devices/${encodeURIComponent(deviceId)}/marketplace`,
        { enabled: true },
        "Paired the browser, but could not enable it for orders.",
      );

      const configuredStatus = await postBridgeRequest<ExtensionFulfillmentStatus>(
        "configure",
        {
          serverUrl: normalizedServerUrl,
          deviceId,
          authToken,
        },
        2500,
      );
      setExtensionStatus(configuredStatus);
      setBridgeState("ready");
      setNotice({
        kind: "success",
        text: "This Chrome browser is now enabled as an OttoAuth fulfillment device. Keep Chrome open so it can poll for orders.",
      });

      window.setTimeout(() => {
        void refreshStatus(false).catch(() => undefined);
      }, 1200);
    } catch (error) {
      setBridgeState(extensionStatus ? "ready" : "missing");
      setNotice({
        kind: "error",
        text: getErrorMessage(error, "Could not enable this browser as a fulfillment device."),
      });
    }
  }

  const extensionLabel = extensionStatus ? "Detected" : bridgeState === "checking" ? "Checking" : "Not detected";
  const apiKeyLabel = extensionStatus?.hasApiKey ? "Ready" : extensionStatus ? "Missing" : "Unknown";
  const deviceLabel = extensionStatus?.deviceId || "Not paired yet";
  const workerLabel = workerStatusText(extensionStatus);

  return (
    <main className="dashboard-page" style={{ minHeight: "auto", paddingBottom: 0 }}>
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Current Device Fulfillment</div>
            <h1>Use this Chrome as a fulfiller</h1>
            <p className="lede">
              Navigate to OttoAuth, log in, and enable fulfillment from this browser. The Chrome extension keeps your Anthropic key locally and uses this same browser profile to poll for orders.
            </p>
          </div>
          <div className="dashboard-actions">
            <button
              type="button"
              className="auth-button primary"
              onClick={enableCurrentDevice}
              disabled={bridgeState === "checking" || bridgeState === "configuring"}
            >
              {bridgeState === "configuring" ? "Enabling..." : "Enable fulfillment via my current device"}
            </button>
            <button
              type="button"
              className="auth-button"
              onClick={() => void refreshStatus(true).catch(() => undefined)}
              disabled={bridgeState === "checking" || bridgeState === "configuring"}
            >
              {bridgeState === "checking" ? "Checking..." : "Check extension"}
            </button>
          </div>
        </div>

        {notice && <div className={notice.kind === "error" ? "auth-error" : "auth-success"}>{notice.text}</div>}

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Extension</div>
            <div className="dashboard-stat">{extensionLabel}</div>
            <p className="dashboard-muted">
              If this says not detected, install or reload the OttoAuth Chrome extension, then refresh this dashboard tab.
            </p>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Anthropic Key</div>
            <div className="dashboard-stat">{apiKeyLabel}</div>
            <p className="dashboard-muted">
              The API key stays inside Chrome extension storage. OttoAuth only receives the generated device pairing token.
            </p>
          </article>
        </section>

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Fulfillment Device</div>
            <div className="dashboard-muted mono">{deviceLabel}</div>
            <div className="dashboard-row">
              <div>
                <strong>Worker</strong>
                <div className="dashboard-muted">{workerLabel}</div>
              </div>
              <div>
                <strong>Last seen</strong>
                <div className="dashboard-muted">{formatLastSeen(extensionStatus)}</div>
              </div>
            </div>
            {extensionStatus?.serverUrl && (
              <div className="dashboard-muted mono">Server: {extensionStatus.serverUrl}</div>
            )}
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Quick Setup</div>
            <div className="dashboard-list">
              <div className="dashboard-row">
                <strong>1. Log in here</strong>
                <span className="dashboard-muted">You are already on the OttoAuth dashboard.</span>
              </div>
              <div className="dashboard-row">
                <strong>2. Add the key once</strong>
                <span className="dashboard-muted">Open the extension side panel and register your Anthropic API key.</span>
              </div>
              <div className="dashboard-row">
                <strong>3. Enable this device</strong>
                <span className="dashboard-muted">This button pairs Chrome, enables the device, and starts the existing fulfillment worker.</span>
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
