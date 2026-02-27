"use client";

import { useEffect, useMemo, useState } from "react";

type Agent = {
  id: number;
  username_lower: string;
  username_display: string;
  callback_url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRequest = {
  id: number;
  username_lower: string;
  username_display: string;
  callback_url: string | null;
  request_type: string;
  message: string | null;
  status: "pending" | "resolved" | "rejected" | "notify_failed" | string;
  resolution_action: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  callback_status: string;
  callback_http_status: number | null;
  callback_error: string | null;
  callback_attempts: number;
  callback_last_attempt_at: string | null;
  created_at: string;
};

export default function AdminDashPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [notesByRequestId, setNotesByRequestId] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actingRequestId, setActingRequestId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, requestRes] = await Promise.all([
        fetch("/api/admin/agents", { cache: "no-store" }),
        fetch("/api/admin/requests", { cache: "no-store" }),
      ]);
      if (!agentRes.ok) throw new Error("Failed to load agents");
      if (!requestRes.ok) throw new Error("Failed to load requests");
      const [agentData, requestData] = await Promise.all([
        agentRes.json(),
        requestRes.json(),
      ]);
      setAgents(agentData);
      setRequests(requestData);
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
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
        return;
      }
      await load();
    } catch {
      alert("Request failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRequestAction(id: number, action: "resolve" | "reject") {
    const notes = (notesByRequestId[id] ?? "").trim();
    setActingRequestId(id);
    try {
      const res = await fetch(`/api/admin/requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? `Could not ${action} request.`);
        return;
      }
      if (!data.ok && data?.callback?.error) {
        alert(`Saved as notify_failed: ${String(data.callback.error)}`);
      }
      await load();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setActingRequestId(null);
    }
  }

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === "pending" || r.status === "notify_failed"),
    [requests],
  );
  const closedRequests = useMemo(
    () => requests.filter((r) => r.status === "resolved" || r.status === "rejected"),
    [requests],
  );

  if (loading) {
    return (
      <main style={{ padding: 48, textAlign: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading admin data…</p>
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
    <main style={{ padding: 48, maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <section style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Admin Dashboard</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 0 }}>
          Manage human-required service requests and agent accounts.
        </p>
      </section>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Human Requests Queue</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
          Resolve or reject pending requests. OttoAuth will post to each agent&apos;s stored callback URL.
        </p>

        {openRequests.length === 0 ? (
          <p style={{ color: "var(--muted)", marginBottom: 24 }}>No pending requests.</p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
            {openRequests.map((request) => {
              const isBusy = actingRequestId === request.id;
              const notesValue = notesByRequestId[request.id] ?? request.resolution_notes ?? "";
              return (
                <article
                  key={request.id}
                  style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: 16 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <strong>#{request.id} · {request.request_type}</strong>
                    <span style={{ color: request.status === "notify_failed" ? "#b42318" : "var(--muted)", fontSize: 13 }}>
                      {request.status}
                      {request.callback_status ? ` · callback ${request.callback_status}` : ""}
                    </span>
                  </div>
                  <p style={{ marginTop: 0, marginBottom: 8, color: "var(--muted)", fontSize: 13 }}>
                    Agent: {request.username_display || request.username_lower} · Created: {new Date(request.created_at).toLocaleString()}
                  </p>
                  <p style={{ marginTop: 0, marginBottom: 10 }}>{request.message || "No details provided."}</p>
                  <p style={{ marginTop: 0, marginBottom: 10, fontSize: 13, color: "var(--muted)", wordBreak: "break-all" }}>
                    Callback: {request.callback_url || "Not configured"}
                  </p>
                  {request.callback_error && (
                    <p style={{ marginTop: 0, marginBottom: 10, fontSize: 13, color: "#b42318" }}>
                      Last callback error: {request.callback_error}
                    </p>
                  )}
                  <textarea
                    value={notesValue}
                    onChange={(e) =>
                      setNotesByRequestId((prev) => ({
                        ...prev,
                        [request.id]: e.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Resolution notes"
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", padding: "10px 12px", marginBottom: 10 }}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRequestAction(request.id, "resolve")}
                      style={{ padding: "8px 12px", cursor: isBusy ? "not-allowed" : "pointer" }}
                    >
                      {isBusy ? "Saving..." : "Resolve & Notify"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRequestAction(request.id, "reject")}
                      style={{ padding: "8px 12px", cursor: isBusy ? "not-allowed" : "pointer" }}
                    >
                      {isBusy ? "Saving..." : "Reject & Notify"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {closedRequests.length > 0 && (
          <div style={{ border: "1px solid var(--line)", background: "var(--paper)", overflowX: "auto" }}>
            <table style={{ minWidth: 840, width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>ID</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Agent</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Type</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Callback</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {closedRequests.map((request) => (
                  <tr key={request.id} style={{ borderBottom: "1px solid var(--grid)" }}>
                    <td style={{ padding: "10px 16px", fontFamily: "var(--font-mono)" }}>{request.id}</td>
                    <td style={{ padding: "10px 16px" }}>{request.username_display || request.username_lower}</td>
                    <td style={{ padding: "10px 16px" }}>{request.request_type}</td>
                    <td style={{ padding: "10px 16px" }}>{request.status}</td>
                    <td style={{ padding: "10px 16px" }}>
                      {request.callback_status}
                      {request.callback_http_status ? ` (${request.callback_http_status})` : ""}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {request.resolved_at ? new Date(request.resolved_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Agents</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
          All created accounts.
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
                  <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Callback URL</th>
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
                      <strong>{a.username_display}</strong>
                      {a.username_display !== a.username_lower && (
                        <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 12 }}>
                          ({a.username_lower})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--muted)", maxWidth: 320, wordBreak: "break-all" }}>
                      {a.callback_url ?? "-"}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--muted)", maxWidth: 280 }}>
                      {a.description ?? "-"}
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
                        {deletingId === a.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
