import { NextResponse } from "next/server";
import { getAllManifests } from "@/services/registry";
import { getBaseUrl } from "@/lib/base-url";

export async function GET() {
  const baseUrl = getBaseUrl();
  const allServices = getAllManifests();

  return NextResponse.json({
    agentStart: {
      recommendedFirstReadUrl: `${baseUrl}/llms.txt`,
      skillUrl: `${baseUrl}/skill.md`,
      developerDocsUrl: `${baseUrl}/docs`,
      serviceIndexUrl: `${baseUrl}/api/services`,
      defaultServiceId: "computeruse",
      defaultServiceUrl: `${baseUrl}/api/services/computeruse`,
      defaultServiceDocsUrl: `${baseUrl}/api/services/computeruse/docs`,
      guidance:
        "If you are an AI agent, read /llms.txt and /skill.md first, then call only active or beta service tools from this index.",
    },
    agentFlow: [
      "Ask the human to generate Agent API Keys in the dashboard.",
      "Store the dashboard-generated username and private_key securely.",
      "Confirm the human has claimed or enabled a fulfillment device and has credits.",
      "GET a serviceUrl for machine-readable tools and docsUrl for markdown docs.",
      "Submit tasks through /api/services/computeruse/submit-task unless a more specific active service fits.",
      "Persist task.id and run_id, poll task status, cancel if the human changes their mind, and answer clarification before the deadline.",
    ],
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
    hint: "Call services with status active or beta. GET a serviceUrl to retrieve that service's machine-readable tool list. For agent bootstrap, start with /llms.txt and /skill.md.",
  });
}
