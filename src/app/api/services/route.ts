import { NextResponse } from "next/server";
import { getAllManifests } from "@/services/registry";
import { getBaseUrl } from "@/lib/base-url";

export async function GET() {
  const baseUrl = getBaseUrl();
  const visible = getAllManifests().filter(
    (m) => m.status === "active" || m.status === "beta"
  );

  return NextResponse.json({
    services: visible.map((m) => ({
      id: m.id,
      description: m.description,
      docsUrl: `${baseUrl}/api/services/${m.id}`,
    })),
    hint: "GET the docsUrl for full API details. For services not listed here, POST /api/requests to request human fulfillment.",
  });
}
