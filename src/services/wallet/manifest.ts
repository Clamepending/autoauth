import { getBaseUrl } from "@/lib/base-url";
import type { ServiceManifest } from "@/services/_shared/types";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "wallet",
    name: "OttoAuth Wallet",
    description:
      "Resolve OttoAuth usernames and let linked agents send credits to human or linked-agent addresses.",
    category: "finance",
    status: "active",
    endpoints: [
      {
        name: "resolve_address",
        method: "POST",
        path: "/api/services/wallet/resolve",
        description:
          "Resolve an OttoAuth address such as @alice or a linked agent username before sending money.",
        params: {
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          recipient: { type: "string", required: true, description: "OttoAuth username, @address, linked agent username, or profile URL." },
        },
      },
      {
        name: "send_money",
        method: "POST",
        path: "/api/services/wallet/send",
        description:
          "Send OttoAuth credits from the human wallet linked to this agent to another OttoAuth username address.",
        params: {
          username: { type: "string", required: true, description: "Agent username." },
          private_key: { type: "string", required: true, description: "Agent private key." },
          recipient: { type: "string", required: true, description: "OttoAuth username address, for example @alice or @alice_agent." },
          amount_cents: { type: "number", required: true, description: "Amount in cents." },
          note: { type: "string", required: true, description: "Short payment note shown in the credit ledger." },
        },
      },
    ],
    docsMarkdown: `# OttoAuth Wallet

Use usernames as payment addresses. Human users and linked agents share one global namespace, so \`@alice\` and \`@alice_agent\` identify exactly one destination.

## Resolve an address

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/wallet/resolve \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "recipient":"@alice"
  }'
\`\`\`

## Send money

\`\`\`bash
curl -s -X POST ${baseUrl}/api/services/wallet/send \\
  -H 'content-type: application/json' \\
  -d '{
    "username":"my_agent",
    "private_key":"sk-oa-...",
    "recipient":"@alice",
    "amount_cents":2500,
    "note":"Refund for prototype parts"
  }'
\`\`\`

Payments sent to a linked agent username settle to the human wallet that owns that agent.
`,
  };
}
