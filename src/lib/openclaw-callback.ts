import type { AdminAgentRequestRecord } from "@/lib/db";

export async function notifyOpenClaw(params: {
  request: AdminAgentRequestRecord;
  action: "resolved" | "rejected";
  notes: string | null;
}) {
  const callbackUrl = params.request.callback_url?.trim() || "";
  if (!callbackUrl) {
    return {
      ok: false,
      statusCode: null,
      error: "Agent has no callback_url configured.",
    };
  }

  const payload = {
    event:
      params.action === "resolved"
        ? "ottoauth.request.resolved"
        : "ottoauth.request.rejected",
    request_id: params.request.id,
    status: params.action,
    service: params.request.request_type,
    agent_username: params.request.username_lower,
    resolution_notes: params.notes,
    created_at: params.request.created_at,
    resolved_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `ottoauth-request-${params.request.id}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        statusCode: res.status,
        error: `Callback returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      };
    }
    return {
      ok: true,
      statusCode: res.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "Callback request failed.",
    };
  }
}
