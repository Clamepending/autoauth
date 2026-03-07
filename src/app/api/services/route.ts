import { NextResponse } from "next/server";
import { getAllManifests } from "@/services/registry";
import { getBaseUrl } from "@/lib/base-url";

export async function GET() {
  const baseUrl = getBaseUrl();
  const allServices = getAllManifests();

  return NextResponse.json({
    services: allServices.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      status: m.status,
      serviceUrl: `${baseUrl}/api/services/${m.id}`,
      docsUrl: m.docsMarkdown ? `${baseUrl}/api/services/${m.id}/docs` : null,
      toolCount: m.endpoints.length,
    })),
    hint: "Call services with status active or beta. GET a serviceUrl to retrieve that service's machine-readable tool list.",
  });
}
