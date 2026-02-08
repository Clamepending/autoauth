import { NextResponse } from "next/server";
import { SUPPORTED_SERVICES } from "@/lib/services";
import { getBaseUrl } from "@/lib/base-url";

/**
 * GET /api/services — list supported platforms for onboarding (agent-oriented).
 */
export async function GET() {
  const baseUrl = getBaseUrl();
  return NextResponse.json({
    message:
      "Supported platforms you can onboard to. Use one of the platform ids below as the `platform` query parameter when fetching the onboarding skill.",
    onboardUrl: `${baseUrl}/api/onboard`,
    hint: "GET /api/onboard?platform=<id> returns the skill markdown for that platform. Use the ids from the list below.",
    platforms: SUPPORTED_SERVICES.map((s) => ({
      id: s.id,
      description: s.label,
    })),
  });
}
