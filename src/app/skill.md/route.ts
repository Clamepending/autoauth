import { getBaseUrl } from "@/lib/base-url";

const SKILL_MD = `# autoauth agent onboarding

Use these HTTP endpoints to create and manage an AI agent account.

## Supported platforms and platform-specific onboarding

- **List supported platforms:** \`GET BASE_URL/api/services\` — returns a JSON list of platform \`id\`s and descriptions. Use this to see which integrations you can onboard to.
- **Get onboarding skill for a platform:** \`GET BASE_URL/api/onboard?platform=<id>\` — returns the skill markdown for that platform. Use an \`id\` from the services list (e.g. \`github\`, \`telegram\`, \`email\`, \`doordash\`, \`amazon\`, \`snackpass\`, \`other\`).
- If you call \`/api/onboard\` without \`platform\` or with an unsupported value, the response will tell you to request \`GET BASE_URL/api/services\` and try again with one of the listed ids.

## 1. Create an agent account

Request a username and receive a private key (password).

\`\`\`bash
curl -s -X POST BASE_URL/api/agents/create \\
  -H "Content-Type: application/json" \\
  -d '{"username":"your_agent_name"}'
\`\`\`

Response:

\`\`\`json
{
  "username": "your_agent_name",
  "privateKey": "...",
  "message": "Account created. Save your private key securely — it cannot be recovered. Use it as your password for future updates."
}
\`\`\`

## 2. Update your description (<= 100 chars)

\`\`\`bash
curl -s -X POST BASE_URL/api/agents/update-description \\
  -H "Content-Type: application/json" \\
  -d '{"username":"your_agent_name","password":"YOUR_PRIVATE_KEY","description":"Short agent description"}'
\`\`\`

Response:

\`\`\`json
{
  "username": "your_agent_name",
  "description": "Short agent description",
  "message": "Description updated."
}
\`\`\`

## 3. Submit a request for human fulfillment

Ask for an integration to be set up by a human. The request is recorded and can be sent to a Slack channel for fulfillment.

\`\`\`bash
curl -s -X POST BASE_URL/api/requests \\
  -H "Content-Type: application/json" \\
  -d '{"username":"your_agent_name","password":"YOUR_PRIVATE_KEY","type":"github","message":"Optional note for the human"}'
\`\`\`

\`type\` must be one of the supported platform ids (same as for onboarding). Request \`GET BASE_URL/api/services\` for the full list: \`github\`, \`telegram\`, \`email\`, \`doordash\`, \`amazon\`, \`snackpass\`, \`other\`. \`message\` is optional (max 500 chars).

Response:

\`\`\`json
{
  "id": 1,
  "type": "github",
  "details": "Optional note for the human",
  "status": "pending",
  "message": "Request received. A human will fulfill it when possible."
}
\`\`\`

Notes:
- \`description\` is optional but must be 100 characters or fewer.
- Your private key is returned once. Store it securely.
- If the app has Slack configured, requests are posted to a channel for humans to fulfill.
`;

export async function GET() {
  const baseUrl = getBaseUrl();
  const body = SKILL_MD.replace(/BASE_URL/g, baseUrl);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
