import { NextResponse } from "next/server";
import { getAllManifests } from "@/services/registry";
import { getBaseUrl } from "@/lib/base-url";

export async function GET() {
  const baseUrl = getBaseUrl();
  const manifests = getAllManifests();

  return NextResponse.json({
    message:
      "List of currently supported services. Use a service id from this list for service-specific endpoints and info.",
    listServicesUrl: `${baseUrl}/api/services`,
    serviceInfoUrl: `${baseUrl}/api/services/<id>`,
    hint: "GET /api/services/<id> returns a description of how to use that service (for bots, on a need-to-know basis).",
    services: manifests.map((m) => ({
      id: m.id,
      description: m.description,
      category: m.category,
      status: m.status,
      infoUrl: `${baseUrl}/api/services/${m.id}`,
    })),
  });
}
