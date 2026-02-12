"use client";

import { useEffect, useState } from "react";

type Agent = {
  id: number;
  username_lower: string;
  username_display: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminDashPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/agents");
      if (!res.ok) throw new Error("Failed to load agents");
      const data = await res.json();
      setAgents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: number) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    if (!confirm(`Delete agent "${agent.username_display}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/agents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
        return;
      }
      await load();
    } catch (e) {
      alert("Request failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <main style={{ padding: 48, textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading agents…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ padding: 48, textAlign: "center" }}>
        <p style={{ color: "var(--ink)" }}>{error}</p>
        <button type="button" onClick={load} style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: 48, maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "block" }}>
      <div style={{ width: "100%" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Admin — Agents</h1>
      <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>
        All created accounts. Delete below.
      </p>
      {agents.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No agents yet.</p>
      ) : (
        <div style={{ border: "1px solid var(--line)", background: "var(--paper)", overflowX: "auto" }}>
          <table style={{ minWidth: 720, width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>ID</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Username</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Description</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600, whiteSpace: "nowrap" }}>Created</th>
                <th style={{ textAlign: "right", padding: "12px 16px", fontWeight: 600, whiteSpace: "nowrap" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--grid)" }}>
                  <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)" }}>{a.id}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span>
                      <strong>{a.username_display}</strong>
                      {a.username_display !== a.username_lower && (
                        <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 12 }}>
                          ({a.username_lower})
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--muted)", maxWidth: 280 }}>
                    {a.description ?? "—"}
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      disabled={deletingId === a.id}
                      style={{
                        padding: "6px 12px",
                        cursor: deletingId === a.id ? "not-allowed" : "pointer",
                        fontSize: 13,
                        color: "var(--ink)",
                        border: "1px solid var(--line)",
                        background: deletingId === a.id ? "var(--grid)" : "transparent",
                      }}
                    >
                      {deletingId === a.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </main>
  );
}
