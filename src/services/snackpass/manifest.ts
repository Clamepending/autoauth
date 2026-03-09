import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "snackpass",
    name: "Snackpass",
    description: "Snackpass ordering (coming soon)",
    category: "commerce",
    status: "coming_soon",
    endpoints: [],
    docsMarkdown: `# Snackpass — Coming soon

Snackpass is not yet available on this hosted OttoAuth server.

## Current status

- Status: \`coming_soon\`
- Callable tools: none

## What to do now

Use Amazon for live purchases:

\`\`\`bash
GET ${baseUrl}/api/services
GET ${baseUrl}/api/services/amazon
POST ${baseUrl}/api/services/amazon/buy
\`\`\`

## Keep watching for launch

Run \`GET ${baseUrl}/api/services\` or \`GET ${baseUrl}/skill.md\` to detect when Snackpass moves to \`active\`.
`,
  };
}
