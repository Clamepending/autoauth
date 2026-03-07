import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { getManifest } from "@/services/registry";

function buildToolSignature(params: Record<
  string,
  { type: string; required: boolean; description: string }
>) {
  const entries = Object.entries(params);
  const required = entries
    .filter(([, config]) => config.required)
    .map(([name]) => name);
  const optional = entries
    .filter(([, config]) => !config.required)
    .map(([name]) => `${name}?`);
  return [...required, ...optional].join(", ");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params;
  const id = (serviceId ?? "").trim().toLowerCase();
  const manifest = getManifest(id);

  if (!manifest) {
    const baseUrl = getBaseUrl();
    return NextResponse.json(
      {
        error: "Service not found.",
        message: "The requested service is not supported.",
        listServicesUrl: `${baseUrl}/api/services`,
        nextStep: `GET ${baseUrl}/api/services`,
      },
      { status: 404 },
    );
  }

  const baseUrl = getBaseUrl();
  return NextResponse.json({
    service: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      status: manifest.status,
      tools: manifest.endpoints.map((endpoint) => ({
        name: endpoint.name,
        signature: `${endpoint.name}(${buildToolSignature(endpoint.params)})`,
        description: endpoint.description,
        method: endpoint.method,
        path: endpoint.path,
        params: endpoint.params,
      })),
      docsUrl: manifest.docsMarkdown
        ? `${baseUrl}/api/services/${manifest.id}/docs`
        : null,
    },
  });
}
