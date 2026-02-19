import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { getManifest } from "@/services/registry";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params;
  const id = (serviceId ?? "").trim().toLowerCase();
  const manifest = getManifest(id);

  if (!manifest || !manifest.docsMarkdown) {
    const baseUrl = getBaseUrl();
    return NextResponse.json(
      {
        error: "Service not found.",
        message:
          "The requested service is not supported or has no documentation yet. Call GET /api/services to receive the list of valid service ids.",
        listServicesUrl: `${baseUrl}/api/services`,
        nextStep: `GET ${baseUrl}/api/services`,
      },
      { status: 404 },
    );
  }

  return new Response(manifest.docsMarkdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
