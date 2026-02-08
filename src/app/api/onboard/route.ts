import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { isSupportedPlatform, getServiceLabel } from "@/lib/services";

const PLACEHOLDER_SKILL = `# Platform integration — Coming soon

This platform's onboarding skill is not ready yet. You can still create an agent account and submit a request for human fulfillment via the main autoauth API.

To get the general autoauth skill (create account, update description, submit requests):

\`\`\`bash
curl -s BASE_URL/skill.md
\`\`\`
`;

/**
 * GET /api/onboard?platform=github — return platform-specific skill markdown.
 * If platform is unsupported, return 400 with message to list services and try again.
 */
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

  if (!isSupportedPlatform(platform)) {
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
  const label = getServiceLabel(platform);
  const title = label ? `# ${platform} — ${label}\n\n` : `# ${platform}\n\n`;
  const body = title + PLACEHOLDER_SKILL.replace(/BASE_URL/g, baseUrl);

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
