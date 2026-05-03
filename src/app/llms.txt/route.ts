import { getBaseUrl } from "@/lib/base-url";
import { getAllManifests } from "@/services/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = getBaseUrl();
  const services = getAllManifests();
  const serviceRows = services
    .map((service) => {
      const docsUrl = service.docsMarkdown
        ? `${baseUrl}/api/services/${service.id}/docs`
        : "none";
      return `- ${service.id}: ${service.status}; ${service.description}; tools ${baseUrl}/api/services/${service.id}; docs ${docsUrl}`;
    })
    .join("\n");

  const body = `# OttoAuth for AI agents

OttoAuth lets AI agents submit browser and commerce tasks through a human-linked account without taking custody of the human's retailer passwords or payment credentials.

If you are an AI agent, read these in order:

1. Main operating guide: ${baseUrl}/skill.md
2. Machine-readable service index: ${baseUrl}/api/services
3. Computer-use tool JSON: ${baseUrl}/api/services/computeruse
4. Computer-use markdown docs: ${baseUrl}/api/services/computeruse/docs
5. Human-facing developer docs: ${baseUrl}/docs

Stable hosted contract:

- Use only /api/services/* for normal hosted agent integrations.
- Authenticate service calls with dashboard-generated username + private_key.
- The human must generate Agent API Keys in ${baseUrl}/dashboard and send them to you.
- The human must claim or enable a browser fulfillment device and keep credits available.
- Submit flexible checkout, pickup, delivery, cancellation, return, refund, and support tasks through the active computeruse service.
- Save both task.id and run_id after submission.
- Poll task status every 15-60 seconds until completed, failed, or awaiting_agent_clarification.
- Cancel in-flight tasks with POST ${baseUrl}/api/services/computeruse/tasks/<taskId>/cancel when the human changes their mind before completion.
- Use run events for detailed order progress, execution history, and support debugging.
- Answer clarification requests through your callback_url or the clarification endpoint before the deadline.

Default agent loop:

1. Ask the human to sign in at ${baseUrl}/login.
2. Ask the human to generate Agent API Keys in ${baseUrl}/dashboard.
3. Store the returned username and private_key securely.
4. Ask the human to finish device setup and credits.
5. GET ${baseUrl}/api/services and choose a service with status active or beta.
6. For general browser commerce, POST ${baseUrl}/api/services/computeruse/submit-task.
7. Share ${baseUrl}/orders/<taskId> with the human if they want to watch the task.
8. Poll POST ${baseUrl}/api/services/computeruse/tasks/<taskId>.
9. If the human cancels, POST ${baseUrl}/api/services/computeruse/tasks/<taskId>/cancel.
10. If blocked, answer clarification. If completed, report summary, pickup_details, tracking_details, totals, and errors if present.

Do not:

- Do not ask the human for retailer passwords or card numbers.
- Do not use legacy pairing-key flows for new integrations.
- Do not use lower-level /api/computeruse/* routes unless you are building worker-side fulfillment infrastructure.
- Do not call services marked coming_soon.
- Do not exceed max_charge_cents or continue checkout if the browser fulfiller reports a higher total.

Services:

${serviceRows}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
