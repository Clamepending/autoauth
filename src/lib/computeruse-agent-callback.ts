import type { AgentRecord } from "@/lib/db";
import { getAgentClarificationTimeoutMs } from "@/lib/computeruse-agent-clarification-config";
import type { GenericBrowserTaskRecord } from "@/lib/generic-browser-tasks";

export async function notifyAgentClarificationRequested(params: {
  agent: AgentRecord;
  task: GenericBrowserTaskRecord;
  question: string;
  baseUrl: string;
}) {
  const callbackUrl = params.agent.callback_url?.trim() || "";
  if (!callbackUrl) {
    return {
      ok: false,
      statusCode: null,
      error: "Agent has no callback_url configured.",
      clarificationResponse: null,
    };
  }

  const defaultTimeoutMs = getAgentClarificationTimeoutMs();
  const clarificationResponseDeadline =
    params.task.clarification_deadline_at ||
    new Date(Date.now() + defaultTimeoutMs).toISOString();
  const remainingMs = Math.max(
    1_000,
    Math.min(
      defaultTimeoutMs,
      new Date(clarificationResponseDeadline).getTime() - Date.now(),
    ),
  );
  const payload = {
    event: "ottoauth.computeruse.clarification_requested",
    task_id: params.task.id,
    run_id: params.task.run_id,
    computeruse_task_id: params.task.computeruse_task_id,
    agent_username: params.agent.username_lower,
    status: "awaiting_agent_clarification",
    clarification: {
      question: params.question,
      requested_at: new Date().toISOString(),
      deadline_at: clarificationResponseDeadline,
      timeout_seconds: Math.ceil(remainingMs / 1000),
      respond_url: `${params.baseUrl}/api/services/computeruse/tasks/${params.task.id}/clarification`,
      method: "POST",
      auth: "Include the agent username and private_key in the JSON body.",
      body: {
        username: params.agent.username_lower,
        private_key: "sk-oa-...",
        clarification_response: "<your answer for OttoAuth>",
      },
    },
    task_status_url: `${params.baseUrl}/api/services/computeruse/tasks/${params.task.id}`,
    order_url: `${params.baseUrl}/orders/${params.task.id}`,
    task_title: params.task.task_title,
    task_prompt: params.task.task_prompt,
    website_url: params.task.website_url,
    max_charge_cents: params.task.max_charge_cents,
    created_at: params.task.created_at,
  };

  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `ottoauth-computeruse-clarification-${params.task.id}-${params.task.updated_at}`,
      },
      signal: AbortSignal.timeout(remainingMs),
      body: JSON.stringify(payload),
    });
    let clarificationResponse: string | null = null;
    const responseText = await res.text().catch(() => "");
    let responseBody: unknown = null;
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
    }
    if (responseBody && typeof responseBody === "object") {
      const body = responseBody as Record<string, unknown>;
      const rawClarificationResponse =
        typeof body.clarification_response === "string"
          ? body.clarification_response
          : typeof body.clarificationResponse === "string"
            ? body.clarificationResponse
            : null;
      clarificationResponse =
        rawClarificationResponse && rawClarificationResponse.trim()
          ? rawClarificationResponse.trim()
          : null;
    }
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        error: `Callback returned ${res.status}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`,
        clarificationResponse: null,
      };
    }
    return {
      ok: true,
      statusCode: res.status,
      error: null,
      clarificationResponse,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "Callback request failed.",
      clarificationResponse: null,
    };
  }
}
