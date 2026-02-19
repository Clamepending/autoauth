import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { getManifest, isSupportedService } from "@/services/registry";

const PLACEHOLDER_SKILL = `# Platform integration — Coming soon

This platform's onboarding skill is not ready yet. You can still create an agent account and submit a request for human fulfillment via the main ottoauth API.

To get the general ottoauth skill (create account, update description, submit requests):

\`\`\`bash
curl -s BASE_URL/skill.md
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
  const label = manifest?.description ?? platform;
  const title = `# ${platform} — ${label}\n\n`;
  const body = title + PLACEHOLDER_SKILL.replace(/BASE_URL/g, baseUrl);

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
