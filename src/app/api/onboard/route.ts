import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { getManifest, isSupportedService } from "@/services/registry";

const PLACEHOLDER_SKILL = `# Platform integration — Coming soon

This platform's onboarding skill is not ready yet. You can still onboard an OpenClaw-style agent through the main OttoAuth skill and use the active \`computeruse\` service for browser tasks.

Discovery flow:
1. \`GET BASE_URL/llms.txt\`
2. \`GET BASE_URL/skill.md\`
3. \`GET BASE_URL/api/services\`
4. Choose a service with status \`active\` or \`beta\`
5. \`GET BASE_URL/api/services/<id>\` for machine-readable \`tools[]\`
6. Optionally \`GET BASE_URL/api/services/<id>/docs\` for human-readable docs

To get the general OttoAuth agent guide:

\`\`\`bash
curl -s BASE_URL/llms.txt
curl -s BASE_URL/skill.md
\`\`\`

For the current recommended browser-task path:

\`\`\`bash
GET BASE_URL/api/onboard?platform=computeruse
\`\`\`
`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform")?.trim().toLowerCase() ?? "";

  if (!platform) {
    const baseUrl = getBaseUrl();
    return NextResponse.json(
      {
        error: "Missing platform. Request GET /api/services to receive the list of supported platform ids, then call GET /api/onboard?platform=<id> with one of those ids.",
        listServicesUrl: `${baseUrl}/api/services`,
        nextStep: `GET ${baseUrl}/api/services`,
      },
      { status: 400 }
    );
  }

  if (!isSupportedService(platform)) {
    const baseUrl = getBaseUrl();
    return NextResponse.json(
      {
        error: "Unsupported platform. Request GET /api/services to receive the list of supported platform ids, then call GET /api/onboard?platform=<id> with one of those ids.",
        listServicesUrl: `${baseUrl}/api/services`,
        nextStep: `GET ${baseUrl}/api/services`,
      },
      { status: 400 }
    );
  }

  const baseUrl = getBaseUrl();
  const manifest = getManifest(platform);

  // Callable services with docs: return the real documentation
  if (
    manifest &&
    (manifest.status === "active" || manifest.status === "beta") &&
    manifest.docsMarkdown
  ) {
    return new Response(manifest.docsMarkdown, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  // Coming-soon services: return placeholder
  const label = manifest?.description ?? platform;
  const title = `# ${platform} — ${label}\n\n`;
  const body = title + PLACEHOLDER_SKILL.replace(/BASE_URL/g, baseUrl);

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
