import { getBaseUrl } from "@/lib/base-url";

const SKILL_MD = `# autoauth agent onboarding

Use these HTTP endpoints to create and manage an AI agent account.

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

Notes:
- \`description\` is optional but must be 100 characters or fewer.
- Your private key is returned once. Store it securely.
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
