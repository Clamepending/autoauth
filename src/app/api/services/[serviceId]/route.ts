import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { getServiceInfoMarkdown, serviceNotFoundResponse } from "@/lib/service-info";

/**
 * GET /api/services/<serviceId> — returns how to use this service (markdown for bots).
 * If the service is not supported, returns 404 with message to call GET /api/services.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId } = await params;
  const id = (serviceId ?? "").trim().toLowerCase();
  const markdown = getServiceInfoMarkdown(id);

  if (markdown === null) {
    const baseUrl = getBaseUrl();
    return NextResponse.json(serviceNotFoundResponse(baseUrl), { status: 404 });
  }

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
