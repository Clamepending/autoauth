import { NextResponse } from "next/server";
import { getAllManifests } from "@/services/registry";
import { getBaseUrl } from "@/lib/base-url";

export async function GET() {
  const baseUrl = getBaseUrl();
  const manifests = getAllManifests();

  return NextResponse.json({
    services: manifests.map((m) => ({
      id: m.id,
      description: m.description,
      status: m.status,
      docsUrl:
        m.status === "active"
          ? `${baseUrl}/api/services/${m.id}`
          : null,
    })),
    hint: "For active services, GET the docsUrl to see endpoints and usage. For coming_soon services, POST /api/requests to request human fulfillment.",
  });
}
