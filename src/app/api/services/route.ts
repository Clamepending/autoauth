import { NextResponse } from "next/server";
import { SUPPORTED_SERVICES } from "@/lib/services";
import { getBaseUrl } from "@/lib/base-url";

/**
 * GET /api/services — list all currently supported services.
 * Bots should call this to discover valid service ids, then use GET /api/services/<id>/info for usage docs.
 */
export async function GET() {
  const baseUrl = getBaseUrl();
  return NextResponse.json({
    message: "List of currently supported services. Use a service id from this list for service-specific endpoints and info.",
    listServicesUrl: `${baseUrl}/api/services`,
    serviceInfoUrl: `${baseUrl}/api/services/<id>`,
    hint: "GET /api/services/<id> returns a description of how to use that service (for bots, on a need-to-know basis).",
    services: SUPPORTED_SERVICES.map((s) => ({
      id: s.id,
      description: s.label,
      infoUrl: `${baseUrl}/api/services/${s.id}`,
    })),
  });
}
