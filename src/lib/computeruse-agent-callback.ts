import type { AgentRecord } from "@/lib/db";
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
    };
  }

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
      respond_url: `${params.baseUrl}/api/services/computeruse/tasks/${params.task.id}/clarification`,
      method: "POST",
      auth: "Include the agent username and private_key in the JSON body.",
      body: {
        username: params.agent.username_display,
        private_key: "YOUR_PRIVATE_KEY",
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
