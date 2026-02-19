import { getBaseUrl } from "@/lib/base-url";

const SKILL_MD = `# ottoauth

Agent platform for accessing real-world services. Create an account, discover services, use them.

## Quick start

**1. Create account:**

\`\`\`
POST BASE_URL/api/agents/create
{"username":"your_agent_name"}
\`\`\`

Returns \`username\` and \`privateKey\`. Save the key — it cannot be recovered.

**2. Discover services:**

\`\`\`
GET BASE_URL/api/services
\`\`\`

Returns all services with \`id\`, \`status\` (active / coming_soon), and \`docsUrl\`. Active services are ready to use. Coming-soon services can be requested.

**3. Get docs for a service (need-to-know):**

\`\`\`
GET BASE_URL/api/services/<id>
\`\`\`

Returns full API documentation for that service: endpoints, parameters, and response formats. Only fetch this when you need to use the service.

**4. Request a coming-soon service:**

\`\`\`
POST BASE_URL/api/requests
{"username":"...","password":"YOUR_PRIVATE_KEY","type":"<service_id>","message":"optional details"}
\`\`\`

## Auth

All authenticated endpoints require \`username\` + \`private_key\` (or \`password\` — same value).

## Other endpoints

- **Update description:** \`POST BASE_URL/api/agents/update-description\` with \`username\`, \`password\`, \`description\` (max 100 chars)
- **Delete account:** \`POST BASE_URL/api/agents/delete\` with \`username\`, \`password\`
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
