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
      agentHints: {
        callOnlyIfStatusIs: ["active", "beta"],
        auth:
          "Most hosted service tools authenticate with dashboard-generated username + private_key in the JSON body.",
        defaultCredentialSource:
          "Ask the human to generate Agent API Keys in the OttoAuth dashboard. Do not use legacy pairing-key flows for new integrations.",
        stableContract:
          "For normal hosted agent integrations, use /api/services/order and the tools listed here. Put Amazon, Snackpass, or other store specificity in request fields instead of calling store-specific service endpoints. Lower-level /api/computeruse/* routes are worker/device infrastructure.",
        nextStep:
          manifest.status === "coming_soon"
            ? `Do not call this service yet. GET ${baseUrl}/api/services later to check whether it moved to active or beta.`
            : manifest.docsMarkdown
              ? `Read ${baseUrl}/api/services/${manifest.id}/docs, then call one of the tools above.`
              : "Call one of the tools above using the required params.",
      },
    },
  });
}
