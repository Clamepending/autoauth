import { getBaseUrl } from "@/lib/base-url";
import type { ServiceManifest } from "@/services/_shared/types";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "pay",
    name: "OttoAuth Pay",
    description:
      "Search paid agent services, call marketplace endpoints, and settle internal service calls through OttoAuth credits",
    category: "finance",
    status: "beta",
    endpoints: [
      {
        name: "ottoauth_search_market",
        method: "POST",
        path: "/api/market/tools",
        description:
          "Search public enabled services in the OttoAuth Pay marketplace by capability, provider, tag, or endpoint domain.",
        params: {
          tool: {
            type: "string",
            required: true,
            description: "Set to ottoauth_search_market",
          },
          arguments: {
            type: "object",
            required: true,
            description: "Object with optional query and limit fields",
          },
        },
      },
      {
        name: "ottoauth_use_service",
        method: "POST",
        path: "/api/market/tools",
        description:
          "Call a paid marketplace service with max_price_cents and an idempotency key. Internal services settle through OttoAuth credits.",
        params: {
          authorization: {
            type: "string",
            required: true,
            description: "Authorization: Bearer <linked_agent_private_key>",
          },
          tool: {
            type: "string",
            required: true,
            description: "Set to ottoauth_use_service",
          },
          arguments: {
            type: "object",
            required: true,
            description:
              "Object with service_id, input, max_price_cents, reason, task_id, and idempotency_key",
          },
        },
      },
      {
        name: "ottoauth_get_payment_status",
        method: "POST",
        path: "/api/market/tools",
        description:
          "Read a marketplace payment/service-call status. Only the buyer or provider can read the call.",
        params: {
          authorization: {
            type: "string",
            required: true,
            description: "Authorization: Bearer <linked_agent_private_key>",
          },
          tool: {
            type: "string",
            required: true,
            description: "Set to ottoauth_get_payment_status",
          },
          arguments: {
            type: "object",
            required: true,
            description: "Object with call_id",
          },
        },
      },
      {
        name: "publish_market_service",
        method: "POST",
        path: "/api/market/services",
        description:
          "Publish a bring-your-own-endpoint service into the OttoAuth Pay catalog.",
        params: {
          authorization: {
            type: "string",
            required: true,
            description: "Authorization: Bearer <linked_agent_private_key>",
          },
          name: { type: "string", required: true, description: "Service name" },
          capability: {
            type: "string",
            required: true,
            description: "Machine-readable capability label",
          },
          endpoint_url: {
            type: "string",
            required: true,
            description: "HTTP endpoint OttoAuth will POST to when buyers call this service",
          },
          price_cents: {
            type: "number",
            required: true,
            description: "Fixed exact price in cents",
          },
        },
      },
    ],
    docsMarkdown: `# OttoAuth Pay

OttoAuth Pay is the marketplace layer for paid agent services.

## Browse from the web

- Market UI: ${baseUrl}/market
- Publish service: ${baseUrl}/market/new

## Agent tool endpoint

All three agent tools use:

\`\`\`
POST ${baseUrl}/api/market/tools
Content-Type: application/json
Authorization: Bearer <linked_agent_private_key>
\`\`\`

Search does not require auth, but authenticated agents should still send their bearer token for a consistent integration.

### Search market

\`\`\`json
{
  "tool": "ottoauth_search_market",
  "arguments": { "query": "summarize", "limit": 5 }
}
\`\`\`

### Use service

\`\`\`json
{
  "tool": "ottoauth_use_service",
  "arguments": {
    "service_id": 1,
    "input": {},
    "max_price_cents": 1,
    "reason": "Need this capability for task_123",
    "task_id": "task_123",
    "idempotency_key": "task_123:service_1"
  }
}
\`\`\`

### Get payment status

\`\`\`json
{
  "tool": "ottoauth_get_payment_status",
  "arguments": { "call_id": "<market_service_call_id>" }
}
\`\`\`

## Settlement

V1 live settlement uses the fee-free OttoAuth credit ledger. OttoAuth holds buyer credits before invoking the provider endpoint, releases credits to the provider on success, and refunds buyer credits on failure.

The catalog can represent \`x402_usdc\`, but external x402 signing and facilitator settlement are intentionally fail-closed until wallet policy and facilitator configuration are added.
`,
  };
}
