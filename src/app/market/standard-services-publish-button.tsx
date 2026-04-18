"use client";

import { useState } from "react";

export function StandardServicesPublishButton() {
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/market/standard-fulfillment/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not list your Pi services.");
        return;
      }
      setMessage(`Listed ${payload?.services?.length ?? 6} Pi services. Reloading Market...`);
      window.setTimeout(() => {
        window.location.href = "/market";
      }, 600);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="stack-form">
      <button
        className="auth-button primary"
        type="button"
        onClick={handlePublish}
        disabled={publishing}
      >
        {publishing ? "Listing..." : "List my Pi services"}
      </button>
      {message && <div className="auth-success">{message}</div>}
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
